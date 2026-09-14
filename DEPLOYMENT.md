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
`SESSION_SECRET`, `DEFAULT_TENANT_ID`, the `SMTP_*` set and the five `R2_*` values.
**Do not introduce a `NEXT_PUBLIC_*` name for any of them**; a database URL or an
R2 key behind that prefix would be inlined into the browser bundle.

`PRISMA_QUERY_LOG` must never be set in production. It appends every emitted SQL
statement to a file, unbounded, and exists only for the tenant-scope audit.
