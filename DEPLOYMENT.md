# SFA CRM — deployment

Same flow as v2e: **GitHub Actions builds the image → GHCR → `./deploy.sh` on the server.**

```
push to main  ──▶  Actions "Build & push image"  ──▶  ghcr.io/aryan2364/sfacrm:latest
                                                              │
                                     on the server:  ./deploy.sh  (pull + up -d)
```

**No GitHub secrets are required.** The build needs none, and all real config
(database, session secret, SMTP) is read at runtime from `.env.production` on
the server. Change a value there and restart — no rebuild needed.

## One-time setup

### 1. Make the package pullable from the server

After the first successful workflow run, the image appears under
`github.com/users/Aryan2364/packages`. Either:

- set the package visibility to **public**, or
- keep it private and log the server in once:
  ```bash
  echo <a-PAT-with-read:packages> | docker login ghcr.io -u Aryan2364 --password-stdin
  ```

### 2. Server files

Put these in the app directory on the server (e.g. `/opt/sfacrm`):

- `docker-compose.deploy.yml`
- `deploy.sh`  (`chmod +x deploy.sh`)

Create `.env.production` next to them from `.env.production.example` and fill in
the real values.

## Deploying

```bash
cd /opt/sfacrm
./deploy.sh
```

Pulls `:latest`, restarts the container, prunes old images, prints status.

### One-time: before deploying the pre-delivery security release

Do these **in order**. Skipping step 2 locks field staff out of their daily work.

#### The production database is RDS

The live site's database is **AWS RDS**, and only RDS. Its `DATABASE_URL` is only in
`.env.production` on the server. `.env.local`'s `DATABASE_URL` is the **local
database** (`localhost:5432/sfacrm_local`, the same as `SCRATCH_DATABASE_URL`), so
neither `npm run dev` nor these scripts reach production without `.env.rds`.

To run the release scripts against RDS, create **`.env.rds`** in the repo root on your
machine. It is gitignored (`.env.*`) and excluded from the Docker build context, so it
cannot be committed or shipped. Copy the URL from the server's `.env.production`, and
never paste it into a chat, a ticket or a commit:

```bash
# .env.rds -- local only, never committed. Quote the URL. URL-encode any special
# characters in the password (@ -> %40, # -> %23, / -> %2F, : -> %3A).
DATABASE_URL="postgresql://<user>:<password>@<instance>.<id>.<region>.rds.amazonaws.com:5432/<database>?sslmode=verify-full"
DATABASE_CA_CERT_PATH=certs/rds-global-bundle.pem
```

`certs/rds-global-bundle.pem` is the AWS RDS CA bundle. It is committed, and it is the
same file the production image uses (`/app/certs/rds-global-bundle.pem`). Give the URL
`sslmode=verify-full` (or `require`) so the app treats it as TLS, although the scripts
enforce TLS on any non-local host whatever `sslmode` says.

Every script is then run as `node --env-file=.env.rds scripts/<script>.mjs --use-database-url …`.
Values from `--env-file` win over `.env.local`, and the CA path is taken from the same
file as the URL. Before connecting, each script prints the **database host and name**
it resolved, and where the URL came from. Read that line every time:

- A non-local host is always reached over **TLS verified** against
  `DATABASE_CA_CERT_PATH`, hostname included. With no CA, the script refuses; it
  never falls back to an unverified or plaintext connection.
- **`--apply` needs `--host <rds-host>`**, and that host must match the one in the URL
  exactly, so a write cannot land on the wrong database because the wrong file was
  loaded. Copy the host from the dry run's `database host:` line.

#### Reaching RDS through an SSH tunnel

The RDS endpoint resolves to a private VPC address, so from your machine it is reached
through an SSH tunnel via the web server.

1. **Open the tunnel** in a separate terminal and leave it running for the whole release:
   ```bash
   ssh -N -L 15432:database-1.cxoqkkq469da.ap-south-1.rds.amazonaws.com:5432 v2e-new
   ```
2. **Add one line to `.env.rds`**, below `DATABASE_URL` and `DATABASE_CA_CERT_PATH`:
   ```bash
   DATABASE_TUNNEL=127.0.0.1:15432
   ```
   Leave `DATABASE_URL` naming the **real RDS host**, not `localhost`. The scripts send
   the connection to the tunnel's local port, but check the allow-list and `--host`
   against the RDS host, and verify the TLS certificate against the RDS hostname. The
   tunnel host must be `127.0.0.1`, `localhost` or `::1`; anything else is refused.
3. **`--host` stays the RDS hostname**, never `127.0.0.1`. The dry run prints
   `database host: <rds-host> (via tunnel 127.0.0.1:15432)`. Copy the host from the part
   before the brackets.

Without `DATABASE_TUNNEL` the scripts connect to the RDS host directly, which only works
from inside AWS.

1. **Set the new env vars** in `.env.production`: `APP_URL` (the public base URL,
   e.g. `https://admin.example.com`) and the `SMTP_*` set. Optionally
   `SESSION_MAX_AGE_DAYS` (default 7).
   Then run the **read-only readiness check** against RDS. It opens a read-only
   session (`default_transaction_read_only=on`, `BEGIN READ ONLY … ROLLBACK`), runs
   only SELECTs, and prints a summary: missing tables and columns against
   `prisma/schema.prisma`, the columns this release needs, and how many rows each
   script below would change:
   ```bash
   node --env-file=.env.rds scripts/prod-readiness-check.mjs --use-database-url --out readiness.json
   ```
   Stop if it reports missing tables or release columns.
2. **Backfill `can_create`** on the production (RDS) database. Meetings, expenses and orders now
   check the **Create** permission, which is `NOT NULL DEFAULT false`, and nothing
   checked it before, so every role with Edit but not Create would lose logging
   meetings, adding expenses and creating orders. Dry-run first, read the output,
   then apply:
   ```bash
   node --env-file=.env.rds scripts/backfill-can-create.mjs --use-database-url                          # dry run, writes nothing
   node --env-file=.env.rds scripts/backfill-can-create.mjs --use-database-url --apply --host <rds-host> # one transaction, idempotent
   ```
   The backfill copies Edit → Create only. Taking an order **from a meeting** was
   previously unchecked, so reps with no Orders rights at all could do it. They now
   need **Orders → Create**. Tick it in Settings → Access Control for any field role
   that should take orders.
3. **Deploy.** Every user is signed out **once** on their first request afterwards:
   the old logins carry no expiry date and are refused. Release outside working hours.
   After signing in they land back on the page they were on.
4. **Rehash legacy plaintext passwords** (any time after deploy). Accounts are rehashed
   automatically on their next login. This covers the ones that never log in:
   ```bash
   node --env-file=.env.rds scripts/rehash-plaintext-passwords.mjs --use-database-url                          # dry run: counts per tenant, no passwords printed
   node --env-file=.env.rds scripts/rehash-plaintext-passwords.mjs --use-database-url --apply --host <rds-host> # one row at a time, safe to interrupt and rerun
   ```
   Without `--use-database-url`, all three scripts target the local database
   (`SCRATCH_DATABASE_URL`) and refuse a non-local host.
   When the release is done, delete `.env.rds`.
5. **Turn on the Content Security Policy** once you've checked it. It ships as
   `Content-Security-Policy-Report-Only` (in `next.config.mjs`), so it blocks nothing
   yet. Open the deployed app, use it normally (receipt photos, the meeting map,
   check-in), and look for CSP warnings in the browser console. If there are none,
   rename the header to `Content-Security-Policy`; if there are, add the reported
   source and check again.

### Database constraints still worth adding

The code prevents these, but a database constraint is the durable guarantee. A human
must add them (a migration, after cleaning up any existing duplicates):

- `journal_entries`: `UNIQUE (tenant_id, user_id, week_start, kind)`.
- `point_events`: a partial unique index on `(tenant_id, user_id, action_type, ref_id)
  WHERE ref_type = 'weekly_plan'`, so a plan can only ever be awarded once.
- Composite foreign keys `(tenant_id, id)` on every tenant-scoped parent (PLAN.md §8.2),
  the permanent fix for cross-tenant references.

## Ports

The container listens on **3000**, published on **127.0.0.1:3500** — loopback
only, so the internet cannot reach it directly. Point nginx/Caddy (running on
the host) at `http://127.0.0.1:3500`.

Do NOT shorten this to a bare `3500:3000`. That publishes on 0.0.0.0, and
Docker inserts its own nat/DOCKER-USER rules ahead of UFW, so the port stays
reachable from the internet even when the host firewall appears closed.

If the reverse proxy itself runs in a container it cannot reach the host
loopback: attach it to the `sfacrm_prod` network and proxy to
`http://sfacrm:3000` instead of publishing a host port at all.

Ports already taken on the shared box: **3400** = budget-tracking-frontend
(sbn-frontend), **3300/4300** = v2e. Always check `ss -ltnp | grep <port>`
before claiming a new one.

## Rolling back

Every build is also tagged with its commit SHA. Pin an older one by editing the
`image:` line in `docker-compose.deploy.yml`:

```yaml
image: ghcr.io/aryan2364/sfacrm:<commit-sha>
```

then `docker compose -f docker-compose.deploy.yml up -d`.

## Logs

```bash
docker compose -f docker-compose.deploy.yml logs -f sfacrm
```

## Note on env vars

Next.js inlines any `NEXT_PUBLIC_*` variable into the bundle at **build** time,
so those cannot be changed from `.env.production`. Server-only names (no
`NEXT_PUBLIC_` prefix) are read at runtime.

Every variable this app needs is server-only and read at runtime — `DATABASE_URL`,
`SESSION_SECRET`, `DEFAULT_TENANT_ID`, `APP_URL`, the `SMTP_*` set and the five `R2_*`
values, plus the optional `SESSION_MAX_AGE_DAYS` (login lifetime in days, default 7).
`APP_URL` and `SMTP_HOST`/`SMTP_USER` are required in production: without them
"Forgot password" answers "not available" (503) for everyone.
**Do not introduce a `NEXT_PUBLIC_*` name for any of them**; a database URL or an
R2 key behind that prefix would be inlined into the browser bundle.

`PRISMA_QUERY_LOG` must never be set in production. It appends every emitted SQL
statement to a file, unbounded, and exists only for the tenant-scope audit.
