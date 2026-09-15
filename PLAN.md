# PLAN.md — Migrate sfacrm off Supabase onto PostgreSQL (AWS RDS) + Prisma + Cloudflare R2

**Status:** COMPLETE — **all 115 API routes are on Prisma, and Supabase is gone.**
`@supabase/supabase-js` is uninstalled, both client modules are deleted, and no source file
imports anything Supabase. Phase A, Batches 1–6, Phase B and the §9 teardown are committed
(17 commits from `89085ec`).

Gates, all re-run after teardown: smoke **344/344** across seven suites · tenant-scope audit
**clean on all seven** · write-path **364/364** on the local scratch database · R2 **35/35**
against the real bucket · `verify:data-layer` 42/42 · lint 0 · build 0 with neither
`DATABASE_URL` nor any `R2_*` set.

**Phase B is VERIFIED against real Cloudflare R2** — `npm run verify:r2`, run twice, bucket
empty before and after. Observed, not reasoned: a real `PutObject` landing at exactly
`receipts/{tenantId}/{uuid}.{ext}` with the right content-type and size; the 302; the signed URL
carrying `X-Amz-Expires=300`; following it returning byte-identical content `inline`; a tampered
signature rejected (403); and **an unsigned GET refused** — R2 answers `400
InvalidArgument/Authorization`, *not* 401/403, and refuses auth *before* key lookup so a missing
object is indistinguishable from a present one. The same URL signed returns 200, which is what
proves that refusal is authorisation rather than a malformed request. The `region: 'auto'` +
account-level endpoint + no-`forcePathStyle` construction copied from v2e works in practice.

**Remaining work: the RDS re-pull and diff (§6.1), and it is the server side's move.** The
committed `prisma/schema.prisma` was pulled from **Supabase**, not RDS. Re-pulling against RDS
and diffing is a sign-off requirement rather than a formality — `supabase/migrations.sql` proved
obsolete in *both* directions, so "the schema is probably fine" is exactly the assumption that
already failed once here. RDS currently holds no schema and no data.

§11 is **decided**: delayed replacement. Vercel/Supabase stays authoritative; sfacrm is a
demo/acceptance environment until the client approves it. The data copy therefore runs twice and
demo-period writes do not survive.

**Six pre-existing production bugs** found and deliberately NOT fixed — see §13.
**Audience:** a fresh Claude Code session with no memory of the discussion that produced this file.
Read this whole document before touching code.

---

## 1. What this is and why

`sfacrm` is a copy of the `SFA` product, being re-hosted on an AWS EC2 (Ubuntu, x86_64) box
that points at **AWS RDS PostgreSQL**. The code still talks to **Supabase**, which is not just
a database — it is a database *plus* a proprietary JS query library *plus* file storage.
Plain RDS speaks only SQL. So the data layer must be replaced.

**Decision already made — do not relitigate:** replace the Supabase client with **Prisma**,
converting all call sites to real Prisma queries. An earlier proposal to build a
Supabase-compatible "shim" over `pg` was **rejected**. Reason: the app is under active
development, and a shim would tax every future feature with "does my translator support this?"
while owning an undocumented emulation of a proprietary API.

**Why Prisma specifically:** the other two products in this org already run it on PostgreSQL
with `DATABASE_URL`.

| Product | Stack | Prisma | Models |
|---|---|---|---|
| v2e | NestJS + Next 16 | **7.8** | 158 |
| LBD2 | NestJS + Next 16 | 5.14 | 20 |
| **sfacrm** | **Next 14 fullstack** | **→ 7.x (match v2e)** | **~35** |

sfacrm is the odd one out. This migration brings it in line. Local reference copies exist at
`D:\RGB_Software\v2e` and `D:\RGB_Software\LBD2` — **read v2e's Prisma + Docker + R2 setup
before inventing anything.** It is a working production configuration on the same Prisma
major version.

---

## 2. Ground rules — non-negotiable

1. **No UI changes. No behaviour changes.** This is a data-layer migration only. Auth
   semantics, session handling, the permissions model, and every screen stay identical.
   If a UI file must change, stop and justify it.
2. **Multi-tenancy must not regress.** Every query against a tenant-scoped table carries a
   `tenant_id` filter today. Dropping one leaks data across tenants **with nothing crashing**.
   This is the single highest-consequence risk in the project.
3. **No secrets in the repo.** Never commit `.env.production`, connection strings, R2 keys,
   or the session secret. `.env.production.example` gets placeholders only.
4. **All DB/storage config read at RUNTIME** from `.env.production`. Nothing baked into the
   image at build time. Do **not** introduce `NEXT_PUBLIC_*` for anything server-side.
5. **Image stays `linux/amd64`** (target box is x86_64). Multi-arch is acceptable; dropping
   amd64 is not.
6. **Keep `127.0.0.1:3500:3000`** in `docker-compose.deploy.yml`. Port 3400 is taken by
   another live service; the loopback bind is deliberate because Caddy runs as a host systemd
   service and can reach loopback. Do not "simplify" this.
7. **Convert in reviewable batches.** Never one 113-file commit. Both stacks stay alive during
   conversion; Supabase is deleted in the final batch, not the first.
8. **Report honestly.** If something could not be verified, say so explicitly. A short honest
   gap list beats a green claim.

---

## 3. Current state — verified facts

Measured from the repo, not assumed. Re-verify if the code has moved on.

**Supabase footprint**
- 113 of 178 files under `src/` import `@/lib/supabase-server`
- 114 API routes under `src/app/api/`
- `src/lib/supabase-browser.ts` has **zero importers** — dead code, delete it
- Non-route lib files using Supabase: `auth.ts`, `permissions.ts`, `points.ts`, `visibility.ts`

**Query surface actually used** (counts across `src/`)

```
.single()   117    .or()       121    .in()        80
count:       63    head:        21    .gte()       22
.ilike()     14    .upsert()    11    .maybeSingle() 8
.lte()        8    .neq()        3    .contains()   4    .not()  1
embedded selects: 169
```

**Confirmed ZERO uses** — do not port, do not emulate:
`.rpc()`, `supabase.auth.*`, `.channel()` (realtime), `.range()`, `.textSearch()`,
`.overlaps()`, `!inner`, foreign-table ordering.

**Embedded-select forms present in the code**

```
departments(name)                    plain to-one embed
manager:manager_user_id(id, name)    aliased, via FK column
users!orders_user_id_fkey(name)      explicit FK-constraint hint (disambiguation)
order_items(count)                   nested count aggregate
order_items(*)                       to-many, full rows
```

**Database:** live Supabase is **PostgreSQL 17.6**, 35 tables in `public`, all UUID PKs with
`uuid_generate_v4()` defaults, all carrying `tenant_id`.
Extensions present: `uuid-ossp`, `pgcrypto`, `pg_stat_statements`, `plpgsql`, `supabase_vault`
(the last is Supabase-only and is not needed on RDS).

> ### `supabase/migrations.sql` IS OBSOLETE — DO NOT INTROSPECT IT
> Verified against live on 2026-09-14. It is 35 tables, live is 35 tables, but only **29 are
> shared**. It is wrong in both directions:
>
> **In LIVE, absent from migrations.sql:**
> `attendance`, `expense_categories`, `point_config`, `point_config_history`, `point_events`,
> `tenant_point_settings`
>
> **In migrations.sql, absent from LIVE (legacy, do not model):**
> `dealers`, `distributors`, `institutions`, `levels`, `user_audit_logs`, `user_login_logs`
>
> The phantoms are explained: `masters/dealers`, `masters/distributors` and
> `masters/institutions` all query `from('business_partners')`. Those three tables were
> consolidated into `business_partners`; `migrations.sql` predates that change.
> Column-level drift is confirmed too — its `role_permissions.section` CHECK allows 5 values
> while live data holds **23 distinct values**.
>
> **The code is consistent with LIVE.** Introspect the live database, never this file.

**Live tables (the real 35):** `attendance, business_partners, contextual_remarks,
daily_visits, departments, designations, districts, expense_categories, expenses, lead_stages,
lead_temperatures, lead_types, notifications, order_items, orders, point_config,
point_config_history, point_events, product_categories, product_subcategories, products,
remark_reads, role_permissions, roles, states, talukas, tenant_point_settings, tenants,
user_territory_mappings, user_visibility, users, villages, weekly_plan_audit_logs,
weekly_plan_items, weekly_plans`

**RLS — earlier guidance in this plan was wrong; this is the corrected version.**
`migrations.sql` has 31 x `ENABLE ROW LEVEL SECURITY` and **0 x `CREATE POLICY`**. Everything
ran through the service-role key, which bypasses RLS, so RLS was doing nothing.

An earlier draft said "RLS on + 0 policies + non-`BYPASSRLS` role = every query silently
returns zero rows." That is **conditional, not absolute**: RLS is **not enforced against a
table's owner** unless `ALTER TABLE … FORCE ROW LEVEL SECURITY` is also set. So:

| App connects as | RLS enabled, 0 policies | Result |
|---|---|---|
| The table **owner** (`postgres` today) | inert | works fine, no symptom |
| A dedicated **least-privilege** role | enforced | **every query returns zero rows, no error** |

This inverts the risk: the failure appears precisely **when you do the right thing** and move
the app off the master user onto a least-privilege role. **Decide the role first, then RLS —
not the other way round.**

**The clean resolution: do not carry the `ENABLE ROW LEVEL SECURITY` statements to RDS at all.**
Prisma does not emit them, and they existed only to satisfy Supabase's defaults. That makes the
question moot under either role choice.

**Storage:** exactly one Supabase Storage call site —
`src/app/api/expenses/upload/route.ts:24` and `:30` (`expense-photos` bucket).

**Tests:** none. There is no test script in `package.json`. Verification must be built.

---

## 4. Target architecture

```
Next.js 14 App Router  ->  Prisma Client (singleton)  ->  RDS PostgreSQL  (same region, direct TCP)
                       ->  @aws-sdk/client-s3         ->  Cloudflare R2   (private bucket, signed URLs)
```

Prisma lives in a shared module imported directly by route handlers (v2e/LBD2 use a NestJS
injected service — that pattern does **not** apply here).

**Runtime env — final set for `.env.production`**

```
DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB?sslmode=require&connection_limit=<see 6.2>
SESSION_SECRET=            # unchanged, 32+ chars
DEFAULT_TENANT_ID=         # unchanged
SUPER_ADMIN_PHONE=         # unchanged
SUPER_ADMIN_PASSWORD=      # unchanged
SMTP_HOST= SMTP_PORT= SMTP_SECURE= SMTP_USER= SMTP_PASS= SMTP_FROM=   # unchanged
R2_ACCOUNT_ID=f54b41cb2e053dda20acdd4cfe91b996
R2_ENDPOINT=https://f54b41cb2e053dda20acdd4cfe91b996.r2.cloudflarestorage.com
R2_BUCKET=sfacrm
R2_ACCESS_KEY_ID=          # SAME value as v2e — see section 7
R2_SECRET_ACCESS_KEY=      # SAME value as v2e — see section 7
```

**Deleted:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

## 5. THE TRAPS — read before writing a single query

These are the things that fail **quietly**. Most of the project's risk is concentrated here.

### 5.1 Date and number types  <- highest-volume trap

Supabase returns JSON over HTTP: timestamps arrive as **ISO strings**, decimals as **numbers**.
Prisma returns **`Date` objects** and **`Decimal` objects**. Exactly backwards.

Counts below are measured against **live PostgreSQL**, not `migrations.sql` (an earlier draft
of this plan said "100 timestamp / 15 numeric" — those came from grepping the obsolete SQL file
and were overcounted; these are the real figures):

- **61** `timestamp with time zone` columns, across **13** distinct column names
- **9** `date` (date-only) columns, **9** distinct names
- **11** `numeric` / `bigint` columns

The two date shapes matter: PostgREST serialised `timestamptz` as a full ISO string and `date`
as `"YYYY-MM-DD"`, and the UI renders both raw. A serialiser that returns full ISO for a
date-only column silently appends `T00:00:00.000Z` everywhere — no error, just wrong.

**Do NOT use `Prisma.dmmf` to tell the two date shapes apart — it cannot.** An earlier draft of
this plan said to key on `Prisma.dmmf.datamodel.models[].fields[]` because it "carries the real
native type." Verified against the generated client: it does not. Both `@db.Date` and
`@db.Timestamptz` surface as `type: "DateTime"`.

**The working approach, already implemented:** derive the date-only column set from
`prisma/schema.prisma` — the same artefact `db pull` regenerates — wired into
`npm run prisma:sync` so it cannot drift silently. Use DMMF only for what it *does* carry
reliably: relation structure, so nested `include`/`select` payloads are walked with the correct
model at each level.

**This was not merely hardening.** A hardcoded date-only name list missed `attendance.date`
(bare name `date`), which was serialising as `"2026-04-09T00:00:00.000Z"` instead of
`"2026-04-09"` against live data. `attendance` is one of the 6 tables absent from the obsolete
`migrations.sql`, so no collision check against that schema could have found it.

The code relies on the string behaviour in real places:

```
src/app/(protected)/review/[userId]/page.tsx:257   a.plan_date.localeCompare(...)
src/app/api/conversations/route.ts:121             b.updated_at.localeCompare(...)
src/app/api/daily-activity/[id]/route.ts:25        v.start_time.slice(0, 10)
```

`Date` has no `.slice()` or `.localeCompare()` — those throw `TypeError` (loud, good).
`Decimal` is worse: `amount` becomes a Decimal object, and naive arithmetic or JSON
serialisation silently produces wrong totals (quiet, bad).

**Rule:** every API route must serialise dates to ISO strings and decimals to numbers
**before** returning JSON, matching what the client already receives today. Do this with one
shared helper, not ad hoc per route. Audit every `NUMERIC`/`DECIMAL` column consumer.

### 5.2 Relation cardinality

`src/lib/auth.ts:33` reads `(data?.roles as { name: string } | null)?.name` — a **single
object**. Prisma's `include` returns an object for to-one and an array for to-many, matching
Supabase, but **verify it per relation** as you convert. Get this wrong on `roles` and every
user silently receives the wrong role with nothing crashing.

### 5.3 `.single()` / `.maybeSingle()` semantics

Supabase `.single()` returns an **error** (code `PGRST116`) on 0 or >1 rows; `.maybeSingle()`
returns `null` on 0 rows. Call sites branch on `error` vs `data === null`.
Prisma: `findUnique`/`findFirst` return `null`; `findUniqueOrThrow` throws.
**Read each call site and preserve its branch.** Do not assume `.single()` -> `findFirst`.

### 5.4 Errors-as-values

Every call site is written `const { data, error } = await ...` and handles `error` inline.
Prisma **throws**. Each converted route must catch and return the same HTTP status and JSON
shape it returns today. A thrown exception where a 400 used to be is a behaviour change.
Note `expenses/upload/route.ts` reads `error.message` directly.

### 5.5 Tenant scope

Rule 2 restated because it is the one that matters: never drop `tenant_id`. Section 8.2 defines
a mechanical audit for this — it is not optional.

### 5.6 Prisma engine on Alpine

The Dockerfile uses `node:20-alpine` (musl). Prisma needs the matching engine —
set `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` in `schema.prisma`, or move to a
glibc base image. Getting this wrong produces a container that builds fine and dies at
first query. Copy whatever v2e does.

### 5.7 Build must not touch the database

`next build` runs in CI with no DB. Confirm no route is statically evaluated at build time
(`export const dynamic = 'force-dynamic'` / `runtime = 'nodejs'` where needed). A route that
opens a connection during build will hang or bake stale data into the image.

### 5.8 Timezone — currently benign, becomes a bug the moment someone "fixes" it

- RDS: `TimeZone = UTC`, `log_timezone = UTC`.
- `docker-compose.deploy.yml:17` sets `TZ: Asia/Kolkata`.
- **But the Dockerfile is `node:20-alpine` and never installs `tzdata`.** Alpine ships no
  `/usr/share/zoneinfo`, so Node cannot resolve `Asia/Kolkata` and **`TZ` is silently ignored**.
  The container runs UTC.

So both sides are UTC today and dates are **accidentally consistent** — which matches the
current Vercel production behaviour, where Supabase returned UTC ISO strings.

> **The trap:** adding `tzdata` to the image — an obvious-looking "fix" — jumps the container
> to IST while RDS stays UTC, shifting all 61 timestamptz columns by 5:30 and putting activity
> on the wrong day near midnight. **Introduced by a change that looks like a correction.**

**A concrete symptom of that trap, found in Batch 3.** `weekly-plans/summary` builds its grid
keys with `getMondayOf(new Date())`, which uses **local-time** getters (`getDay`, `setDate`,
`setHours`) and then emits the key via `toISOString()`. Under UTC that yields true Mondays and
the keys match the stored `week_start_date` values. Under IST, local midnight Monday is Sunday
18:30 UTC, so every key lands one day early, matches nothing, and **the entire review grid
renders blank** — no error, no empty state, just every cell empty. Reproduced on an IST dev
machine and fixed by running the process under `TZ=UTC`.

This predates the migration (Supabase returned the same date strings) and is not changed by it,
but it means the §5.8 trap is not merely a 5:30 shift on timestamps: adding `tzdata` would also
silently blank a manager-facing screen. The write-path harness therefore runs under `TZ=UTC`,
matching production.

**Decision for this migration: keep UTC.** Rule 1 says no behaviour changes, and UTC is the
current behaviour. Concretely:
- [ ] Do **not** add `tzdata` to the Dockerfile.
- [ ] Remove the inert `TZ: Asia/Kolkata` line from `docker-compose.deploy.yml` and replace it
      with a comment explaining why, so nobody re-adds it as a fix.

**Pre-existing issue, explicitly OUT OF SCOPE — record, do not fix here:** because the app runs
UTC, `start_time.slice(0,10)` (`src/app/api/daily-activity/[id]/route.ts:25`) puts an early-morning
IST visit on the previous calendar day. That is today's Vercel behaviour too. Changing it is a
product decision, not a migration task. Raise it as separate follow-up work.

### 5.9 SSL — `sslmode=require` does NOT verify the certificate

`rds.force_ssl` is **not set** on this instance, but TLS works (`ssl = on`, session negotiated
TLSv1.3 / `TLS_AES_256_GCM_SHA384`).

`sslmode=require` encrypts but accepts **any** certificate — functionally close to
`rejectUnauthorized: false`, which this plan rejects. Real verification needs the RDS CA:

- [ ] Bake the RDS CA bundle into the image (present on the host at `~/global-bundle.pem`,
      165,408 bytes) or mount it; do not fetch it at runtime.
- [ ] Under `@prisma/adapter-pg`, SSL is configured on the **`pg` Pool**, not via URL params:
      `ssl: { ca: readFileSync(CA_PATH), rejectUnauthorized: true }`.
- [ ] Never `rejectUnauthorized: false` in production.

RDS is private (`172.31.48.74`, same VPC as EC2, `PubliclyAccessible` inferred off from DNS),
so this is defence in depth rather than the only control — but do it properly.

---

## 6. Phase A — Foundation (do this first, in one batch)

### 6.1 Prisma install and schema

- [ ] `npm i prisma@^7 @prisma/client@^7` (match v2e's major; check `v2e/backend/package.json`)
- [ ] `npx prisma init` — keep `provider = "postgresql"`, `url = env("DATABASE_URL")`
- [ ] Run **`npx prisma db pull`** to generate `prisma/schema.prisma` from the live database.
      This only READS; it never modifies the database.
    - Preferred source: **RDS**, once the schema is loaded there.
    - If RDS is still empty: pull from **Supabase** (it is PostgreSQL too) to unblock, then
      **re-pull against RDS before sign-off** and diff the two schemas to prove they match.
- [ ] Review the generated schema: confirm all 35 tables present, every relation resolved,
      and `@default(dbgenerated("uuid_generate_v4()"))` preserved on PKs
- [ ] Add `binaryTargets` per 5.6
- [ ] `npx prisma generate`
- [ ] Commit `prisma/schema.prisma`. Add the generated client output dir to `.gitignore`.

### 6.2 Prisma client singleton — `src/lib/db.ts`

- [ ] Single shared instance, cached on `globalThis` in dev so Next.js hot-reload does not leak
      connections until RDS refuses new ones.
- [ ] **Pool size: `max: 5`.** Confirmed instance is **`db.t4g.micro`** (1 GB RAM,
      ~112 `max_connections`) and it is **shared by 4 applications**, sfacrm being one.
      The binding constraint is RAM, not connection count: each Postgres backend costs
      ~5–10 MB, so 4 apps × 10 would be ~320 MB of backend memory on a 1 GB box that also
      wants ~256 MB `shared_buffers` plus `work_mem` and OS. 4 × 5 = 20 connections leaves
      real headroom. Do not raise this without raising the instance class.
      Note `connection_limit` in the URL is **ignored** under the `@prisma/adapter-pg` driver
      adapter (it is a query-engine parameter); it must be passed to the `pg` Pool as `max`.
      `db.t4g.micro` is burstable — sustained load drains CPU credits and throttles **all four**
      apps together. Treat CPU credit balance as the metric to watch, not connection count.
- [ ] Add the shared date/decimal serialisation helper here (5.1).

### 6.3 Core lib conversion — must precede all route batches

Everything depends on these four:

- [ ] `src/lib/auth.ts` — `requireUser()`; watch the `roles(name)` to-one embed (5.2)
- [ ] `src/lib/permissions.ts` — `checkPermission()`, `getDataScope()`; reads `role_permissions`
- [ ] `src/lib/visibility.ts`
- [ ] `src/lib/points.ts`
- [ ] Verify: login end-to-end, and that a user's role resolves to the **same string** as
      before for at least one Administrator, one role-holder, and one Inactive user

---

## 7. Phase B — Cloudflare R2 storage

Replaces Supabase Storage. **Bucket is private.** v2e's bucket is private and serves
short-lived signed URLs — mirror that. See `v2e/backend/src/storage/r2.service.ts` and copy
its structure (adapted from a NestJS `@Injectable` to a plain module).

**Facts already settled:**

- Dedicated `sfacrm` bucket, same Cloudflare account as v2e
- The existing "R2 Account Token" was extended to cover `sfacrm`. Editing a token's scope does
  **not** rotate its keys, so `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` are **identical to
  v2e's**. Copy them from v2e's `.env.production`. Do not mint a new token.
- `R2_ENDPOINT` is **account-level and must NOT include the bucket name** — the S3 client
  passes `Bucket` separately. Including it doubles the path and 404s.
- Those credentials also grant write access to `v2e-attachments` and `lbd-attachment`.
  Always scope operations to `R2_BUCKET` explicitly; never derive a bucket from user input;
  never list buckets.
- Do **not** enable `r2.dev` or bind a public domain on the bucket.

**Tasks**

- [ ] `npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
- [ ] `src/lib/r2.ts` — lazy module-level `S3Client({ region: 'auto', endpoint, credentials })`.
      **No `forcePathStyle`** (v2e omits it and it works). Include an `isConfigured` guard so a
      missing var gives a clear error, not a cryptic SDK failure.
- [ ] Key shape: `receipts/{tenantId}/{uuid}.{jpg|png}` (no `sfacrm/` prefix — the bucket is
      the namespace)
- [ ] **Rewrite `src/app/api/expenses/upload/route.ts`**
    - Keep validation unchanged: `image/jpeg|jpg|png`, 5 MB max
    - Keep the response contract `{ url }` — the client reads `(await r.json()).url` at
      `src/app/(protected)/daily-activity/page.tsx:701`
    - The returned `url` is the **app-relative path** — but keyed by the **PHOTO file name**,
      not the expense id:  `/api/expenses/photo/<uuid>.<ext>`

> ### ⚠️ CORRECTION — it is the PHOTO id, NOT the expense id
> An earlier draft of this section specified `/api/expenses/photo/<expenseId>`. **That is
> impossible**, and the reason is in the client: `daily-activity/page.tsx:692-705` uploads the
> photo **first**, reads `url`, and only **then** calls `onAdd()` to create the expense carrying
> that `photo_url`. At upload time **no expense exists yet**. The route never receives `category`
> or `amount`, so it cannot create one, and reordering the client is a UI change rule 1 forbids.
>
> Every property §7 actually requires still holds: app-relative, never an R2 address, no bucket
> or account id exposed, per-expense authorisation via `getDataScope`, and the real key rebuilt
> server-side as `receipts/{tenantId}/{file}` from the **session** tenant plus a regex-validated
> file name — so path traversal cannot escape the tenant prefix.
    - Keep errors-as-values: `NextResponse.json({ error }, { status: 500 })`, do not throw
- [ ] **New route `GET /api/expenses/photo/[id]`**
    - `requireUser()`, then authorise against the real permission system
      (`src/lib/permissions.ts`, `getDataScope` own|team|all). **Never hardcode a role.**
    - 302 to a freshly signed **inline** URL (300s expiry; mirror v2e's `getSignedInlineUrl`,
      `ResponseContentDisposition: inline`)
    - Derive the R2 key server-side from the expense row; never expose keys to the client
- [ ] **Column decision — already made:** reuse `expenses.photo_url`. It now stores
      `/api/expenses/photo/<id>`. **No new column, no schema migration.**
- [ ] **Verify unchanged:** `daily-activity/page.tsx:1074` and `review/[userId]/page.tsx:544`
      must be byte-identical in the final diff. They render `<img src={exp.photo_url}>`.
- [ ] **No `next.config.mjs` change.** The app uses plain `<img>`, not `next/image`, and URLs
      are now same-origin. Do not add `remotePatterns`.

**Note this is a security improvement, and say so in the report:** the Supabase bucket was
public, so any receipt was viewable by anyone with the link and no session. Access is now
authorised.

---

## 8. Phase C — Route conversion, 9 batches

**Per-batch loop — repeat for every batch:**

1. Convert the routes in the batch
2. Preserve response shapes, status codes, and error branches exactly (5.3, 5.4)
3. Apply date/decimal serialisation (5.1)
4. Run the tenant-scope audit (8.2)
5. Run the batch's smoke tests (8.3)
6. `npm run lint` + `npm run build`
7. Commit as its own reviewable commit
8. Only then start the next batch

`@supabase/supabase-js` stays installed and working until Batch 9, so the app runs at every step.

### 8.1 Batches (114 routes total)

**Batches are sized by RISK, not by route count.** 108 routes / 6,427 lines remain, averaging 59
lines. The `masters` group is highly repetitive — `departments`, `designations`, `lead-types`,
`lead-temperatures`, `expense-categories` are 23–38 line near-clones of one shape. Uniform,
low-risk routes go in large batches; genuinely tricky ones stay small.

| # | Batch | Routes | Risk | Checkpoint? |
|---|---|---|---|---|
| 1 | `auth` | 5 | high | **DONE** |
| 2 | **All `masters`** (location, product, org, users, leads, territory, import) | 43 | low–med | no — proceed straight on |
| 3 | `weekly-plans` | 17 | **HIGH** | **STOP and report** |
| 4 | `orders` + `leads` + `business-partners` + `daily-activity` + `attendance` + `expenses` | 19 | med–high | no |
| 5 | `points` + `review` + `dashboard` + `remarks` + `conversations` + `notifications` + `access-control` + `settings` | 23 | med | no |
| 6 | `superadmin` + teardown | 7 + cleanup | med | **STOP** — see section 9 |

**Batch notes**
- **2 — masters:** establish the canonical CRUD conversion on 2–3 representative routes, then
  apply it mechanically to the clones. Commit in 2–3 logical commits, not 43. Heaviest embeds
  are here (`users` with departments/designations/roles/manager). This is also where
  `count`/`head` pagination totals get exercised in anger — assert the TOTAL, not just that rows
  came back. Verify cardinality at each level of states → districts → talukas → villages.
- **3 — weekly-plans:** the one genuinely hard batch. Stop and report after it.
  **Reconnaissance against live, so it does not have to be rediscovered:**

> **⚠️ METHOD WARNING — an earlier draft of this section got this wrong.**
> It listed 4 statuses and 8 action types as "the ONLY values", derived from `SELECT DISTINCT`
> over live rows. **Observed values are not legal values.** The real sets are larger, and three
> legal statuses have simply never occurred in production. Trusting the sampled list would have
> meant "correcting" `Resubmitted`/`Resubmit` as typos and silently breaking three transitions.
> **For any enumerated column, read the CHECK constraint and the code — never `SELECT DISTINCT`.**

  | | |
  |---|---|
  | `weekly_plans.status` — **7 legal values** from `weekly_plans_status_check`, exact casing | `Draft` · `Submitted` · `Approved` · `Rejected` · `On Hold` · `Edited by Manager` · `Resubmitted` |
  | …of which live data contains only | `Draft` (8) · `Submitted` (18) · `Approved` (47) · `Rejected` (1). `On Hold`, `Edited by Manager` and `Resubmitted` are legal and reachable but have never occurred. |
  | `weekly_plan_audit_logs.action_type` | **No CHECK constraint at all.** The code writes **13** values: `Create` · `Update` · `Submit` · `Resubmit` · `UndoSubmit` · `Approve` · `Reject` · `Hold` · `Suggest` · `EditByManager` · `RequestReopen` · `AcceptReopen` · `DeclineReopen` |
  | …absent from live data | `Resubmit`, `Hold`, `Suggest`, `EditByManager`, `DeclineReopen` |
  | Date-only columns in this batch (§5.1) | `weekly_plans.week_start_date`, `weekly_plans.week_end_date`, `weekly_plan_items.plan_date` |
  | `day_notes` | `jsonb`, currently `{}` in every row — do not assume a shape |
  | `weekly_plan_items` | has **no** `status` column; state lives on the parent only |
  | Audit log also carries | `edited_fields` (jsonb), `previous_status`, `new_status`, `actor_role`, `ip_address`, `user_agent` |

  These status and action_type strings are written to the database and read by the UI —
  **preserve them exactly**, casing included. Exercise **every** one of the 8 transitions and
  assert the audit row each one writes (`previous_status` → `new_status`).
  All three date-only columns render in the UI, and
  `src/app/(protected)/review/[userId]/page.tsx:257` calls `plan_date.localeCompare(...)` — so a
  serialiser regression here is a crash, not a cosmetic bug.
- **4:** `orders` has the trickiest embeds in the codebase — `order_items(*)`,
  `order_items(count)`, and the `users!orders_user_id_fkey` FK hint.
  `daily-activity/[id]/route.ts:25` has the `.slice(0,10)` date trap.

  > **Correction — an earlier draft said this whole batch must wait for Phase B (R2). It does
  > not.** Verified: exactly **one** route in the codebase touches Supabase Storage —
  > `src/app/api/expenses/upload/route.ts` (lines 24 and 30). The other 17 routes in this batch
  > — all of `orders`, `leads`, `business-partners`, `daily-activity`, `attendance`, and the
  > other three `expenses` routes — have **no storage dependency** and can be converted without
  > R2 credentials. Only `expenses/upload` is genuinely Phase-B-gated.
- **5:** `conversations/route.ts:121` has the `localeCompare` date trap. Dashboard has aggregate
  counts. `access-control` touches `role_permissions` — re-verify permissions resolve
  identically after.

### 8.4 Supabase → Prisma conversion cheatsheet

Decide these once here, not per route. This is the entire surface the codebase uses (section 3).

| Supabase | Prisma |
|---|---|
| `.select('*').eq('tenant_id', tid)` | `findMany({ where: { tenant_id: tid } })` |
| `.eq('c', v)` | `where: { c: v }` |
| `.neq('c', v)` | `where: { c: { not: v } }` |
| `.in('c', arr)` | `where: { c: { in: arr } }` |
| `.gte/.lte/.gt/.lt` | `where: { c: { gte: v } }` etc. |
| `.ilike('c', '%q%')` | `where: { c: { contains: q, mode: 'insensitive' } }` |
| `.or('a.ilike.%q%,b.ilike.%q%')` | `where: { OR: [{ a: { contains: q, mode: 'insensitive' } }, …] }` — `mode` per clause |
| `.is('c', null)` | `where: { c: null }` |
| `.order('c', { ascending: false })` | `orderBy: { c: 'desc' }` |
| `.select('*', { count: 'exact', head: true })` | `count({ where })` |
| rows **and** total | `$transaction([findMany(…), count(…)])` — one round trip |
| `departments(name)` (to-one) | `include: { departments: { select: { name: true } } }` → **object** |
| `order_items(*)` (to-many) | `include: { order_items: true }` → **array** |
| `order_items(count)` | `include: { _count: { select: { order_items: true } } }` |
| `users!orders_user_id_fkey(name)` | the named relation field on the model; no hint syntax needed |
| `manager:manager_user_id(id, name)` | `include: { manager: { select: { id: true, name: true } } }` |

**Judgement calls — apply consistently, do not re-deliberate per route:**
- `.single()` → `findFirst` (or `findUnique` **only** where a real unique constraint exists).
  Supabase returned an *error* on 0 rows; Prisma returns `null`. **Read the call site and
  preserve its branch** — many routes 404 on that error.
- `.maybeSingle()` → `findFirst`; `null` is the expected 0-row result.
- `.upsert()` → `prisma.t.upsert({ where: <unique target>, create, update })`. **Requires a real
  unique constraint.** If none exists, do `findFirst` + branch — do not invent a constraint.
- **Errors-as-values (§5.4):** wrap every call so the route returns the same status and JSON
  shape it returns today. Prisma throws where Supabase returned `{ error }`.
- **Serialisation (§5.1):** apply `serialize()` to any response carrying Date/Decimal. Where a
  route returns only strings/booleans/numbers, **skip it and assert that with a JSON round-trip**
  rather than adding it reflexively.

**Write-path rules — added from Batch 2, where getting these wrong changes status codes:**

| Supabase | Prisma | Why |
|---|---|---|
| `.delete().eq('id', id).eq('tenant_id', tid)` | `deleteMany({ where: { id, tenant_id } })` | Supabase's `.delete()` did **not** error when nothing matched — it returned `{ ok: true }`. Prisma's `delete()` throws `P2025`, turning a silent no-op into a **500** on every cross-tenant or already-deleted id. Use `deleteMany` for every delete that is not guaranteed to match. |
| `.update({...}).eq('id', id).eq('tenant_id', tid)` *(no `.single()`)* | `updateMany({ where: { id, tenant_id }, data })` | Same reasoning. Soft deletes (`update({ is_active: false })`) are the common case — `lead_types`, `lead_stages`, `lead_temperatures`, `expense_categories`. A no-match must stay a no-op, not a 500. |
| `.update({...}).eq('id', id).eq('tenant_id', tid).select().single()` | `update({ where: { id, tenant_id }, data })` | Here `update()` IS correct: `.single()` already errored on 0 rows and the route answered 500, so Prisma's `P2025` preserves the status. Non-unique fields are allowed in `where` beside the primary key (extended where-unique). |
| extra guards, e.g. `.eq('type', 'Dealer')` | keep them in `where` next to the PK | `where: { id, tenant_id, type: 'Dealer' }` — a dealers endpoint still cannot edit a distributor. |

**Rule of thumb:** if the Supabase call had `.single()`, a no-match was already an error → use the
singular Prisma method. If it did **not**, a no-match was silent → use the `*Many` form.

**More rules, added while converting the rest of `masters`:**

| Supabase | Prisma | Why |
|---|---|---|
| `.insert([...]).select('id, name')` | `createManyAndReturn({ data, select })` | `createMany` returns **only a count**. Both bulk importers need the inserted ids to build their lookup maps, so `createMany` would silently break them. PostgreSQL-only, which is what we target. |
| `.insert([...])` with no `.select()` | `createMany({ data })` | Count is all the caller used. |
| `.upsert(rows, { ignoreDuplicates: true })` | `createMany({ data, skipDuplicates: true })` | "Do nothing on conflict". Needs the real unique constraint — `user_visibility` has `@@unique([viewer_user_id, target_user_id])`. |
| `.upsert(row, { onConflict: 'a,b' })` | `upsert({ where: { a_b: {...} }, create, update })` | Only where a matching compound unique exists; `user_territory_mappings` has `@@unique([tenant_id, user_id])`. |
| `.not('status', 'in', '(...)')` | `where: { status: { notIn: [...] } }` | The codebase's single `.not()`. |
| `.or('a.ilike.%q%,b.ilike.%q%')` | `OR: [{ a: { contains: q, mode: 'insensitive' } }, …]` | `mode` goes on **each** clause, not the `OR`. |

**Aliased to-one embeds.** `manager:manager_user_id(id, name)` has no Prisma equivalent at the
query level: the FK is exposed through whatever the introspected relation field is called (for
`users.manager_user_id` that is the self-relation field `users`). Fetch through the real field
and rename in the response, because the client only ever saw the alias:

```ts
include: { users: { select: { id: true, name: true } } }
// then: ({ users, ...rest }) => ({ ...rest, manager: users ?? null })
```

**When Prisma's types reject what Postgres also rejected.** A NOT NULL column the old code never
supplied is a *pre-existing* bug. Prisma catches it at compile time; PostgreSQL caught it at
runtime. Preserve the behaviour with an explicit cast and a comment, record it in section 13, and
do **not** fix it here — see 13.3 (designations) and 13.4 (product import).

**A `Date` is wrong anywhere it is used as an IDENTITY, not just in a response.** `serialize()`
fixes what goes over the wire; it does nothing for server-side logic. Every one of these is
silent — no throw, no error, plausible-looking output:

| Misuse | What actually happens | Seen in |
|---|---|---|
| `new Set(rows.map(r => r.some_date))` | Dates are objects, so the Set holds **one member per ROW, not per DAY** — it dedupes nothing. It then serialises as full ISO, which no date-only consumer matches. Two stacked failures. | `daily-activity/calendar`, `expenses/calendar` |
| `grid[row.week_start_date]` as an object KEY | Stringifies to `"Mon Sep 14 2026 …"`, matches no key, so every cell stays blank. | `weekly-plans/summary` |
| `row.visit_date === "2026-09-14"` | `Date === string` is **always false** — every bucket reads zero and looks like a quiet week. | `dashboard/manager` |
| `today <= row.week_start_date` | Coerces the Date via `toString()`, so the comparison is meaningless rather than wrong-by-a-day. | `weekly-plans/[id]/submit` |
| `row.created_at.localeCompare(...)` / `.slice(0, 10)` | Throws `TypeError` — the LOUD case, and the only one you get told about. | `conversations`, `daily-activity/[id]` |

**Rule:** if a date column is used as a Set member, an object key, or either side of `===`, `<`,
`>` or `localeCompare`, convert it FIRST — `dateOnlyString()` for `@db.Date`, `.toISOString()`
for `timestamptz` — and convert once, at the point the rows are read. Half-converting is worse
than not converting: comparing a normalised string against a raw Date reintroduces the bug at a
different line.

**A missing foreign key STRENGTHENS the case for an explicit tenant filter.** When ids come from
a real FK column, the database itself guarantees the parent is in-tenant and a `tenant_id` filter
is belt-and-braces (the `dealers` distributor lookup). When ids come from a `uuid[]` column — e.g.
`user_territory_mappings.district_ids` — **nothing** enforces that, so the filter is the only
control on the path and must be present. The instinct to reason "no FK, so the integrity argument
does not carry over, so leave it alone" is backwards: follow it through and the conclusion flips.

**Tenant-scope audit note:** Prisma resolves a to-one `include` with a *second* statement that
loads the parents by primary key and carries no `tenant_id`. It appears nowhere in the source, so
only the runtime audit sees it. Allowlist it by **enumerated table**, never by SQL shape — a plain
`findMany({ where: { id: { in: [...] } } })` emits byte-identical SQL, and a shape-matcher would
swallow a genuinely missing filter.

### 8.2 Tenant-scope audit — build this in Batch 1, run every batch

- [ ] A script that enumerates every Prisma call touching a tenant-scoped table and flags any
      without a `tenant_id` predicate. Simplest robust version: enable Prisma query logging,
      exercise the routes, and assert every emitted `SELECT/UPDATE/DELETE` against a
      tenant table contains a `tenant_id` condition.
- [ ] Cross-check: `git show <supabase-version>` of each converted file and confirm every
      `.eq('tenant_id', tid)` has a Prisma counterpart. Do this per batch while the diff is small.
- [ ] Any table intentionally not tenant-scoped (e.g. `tenants`) goes on an explicit allowlist
      **with a written reason**.

#### Prisma's to-one relation fetch has no `tenant_id` — adjudicated, not a regression

The runtime audit surfaces statements that appear nowhere in the source, e.g.
`SELECT … FROM "roles" WHERE "id" IN (…)` with no `tenant_id`. That is how Prisma resolves
`roles: { select: { name: true } }`. It is **safe and not a regression**: it follows an FK
already present on the parent row, no request input reaches it, and PostgREST resolved the old
`roles(name)` embed identically.

The residual assumption is **referential integrity** — a `users.role_id` pointing at another
tenant's role would be followed. **Verified against live: 39 FK pairs where both sides are
tenant-scoped, ZERO cross-tenant references.** So the assumption holds for all current data.

**Follow-up (out of scope here):** nothing at the database level *enforces* this — it is a
write-path property. A composite FK including `tenant_id` would make it structural. Record it;
do not implement it during the migration.

### 8.3 Smoke tests — build in Batch 1, extend every batch

- [ ] A script that logs in and hits at least one route per group as a real session, asserting
      2xx and non-empty payloads
- [ ] Explicit coverage for: every weekly-plan state transition; every route using
      `count: 'exact', head: true` for pagination totals; expense upload + photo view
- [ ] Record which routes could **not** be exercised and why — that list goes in the final report

#### Write-path testing — use the LOCAL PostgreSQL, not Docker, not production

Read-path suites run against live Supabase (real data shapes). **Write paths must never touch
production** — they would create rows in five real customers' tenants. Keep the two separate.

**The local server already exists: PostgreSQL 18 is installed at
`C:\Program Files\PostgreSQL\18\bin` and runs as Windows service `postgresql-x64-18` on port
5432, start type Automatic.** Use it. **Do not start a Docker container** — Docker Desktop costs
~1.5 GB of RAM on this machine and has already caused an OOM during `next build`.

- [ ] Create a scratch database on the local instance and `prisma db push` to it. The schema
      comes from `prisma/schema.prisma`, pulled from live, so fidelity is exact.
- [ ] Seed a disposable tenant: one `tenants` row, one user, one role with `role_permissions`,
      plus the minimal reference rows the write paths need.
- [ ] Point write-path tests (POST/PUT/DELETE) at that database only.

**Version note:** local is PG18 while Supabase is 17.6 and RDS is 17.9. Irrelevant here —
write semantics (`deleteMany` no-op, `where` guards, Decimal/Date serialisation) are identical
across those majors. The version difference matters *only* for `pg_dump`/`pg_restore`, which is
the server-side concern handled in section 11 with pinned pg17 containers. Never use the local
pg18 binaries to dump or restore against 17.x.

---

## 9. Phase D — Teardown and ship (Batch 9)

- [ ] Delete `src/lib/supabase-server.ts`
- [ ] Delete `src/lib/supabase-browser.ts` (dead code, zero importers)
- [ ] `npm uninstall @supabase/supabase-js`
- [ ] `grep -ri supabase src/` returns **zero** hits. Same for `NEXT_PUBLIC_SUPABASE`.
- [ ] **Dockerfile** — currently sets `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
      placeholders at build. Remove both. Add `npx prisma generate` after `npm ci` /
      schema copy. Confirm the musl engine target (5.6). Keep `linux/amd64`.
- [ ] **`.env.production.example`** — drop `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`,
      add `DATABASE_URL` and the five `R2_*` names. Placeholders only.
- [ ] **`docker-compose.deploy.yml`** — unchanged except env. **Keep `127.0.0.1:3500:3000`.**
- [ ] **`DEPLOYMENT.md` / `CLAUDE.md` / `README.md`** — update the Supabase sections to describe
      Prisma + RDS + R2. `CLAUDE.md`'s "Two Supabase clients" section is now wrong.
- [ ] `supabase/migrations.sql` — decide and state: keep as historical record, or replace with
      Prisma migrations. If keeping, note in the file that it is no longer the source of truth.
- [ ] **`PRISMA_QUERY_LOG` must NEVER be set in production.** It appends raw query text to disk
      without bound. Inert unless set — keep it out of `.env.production` and out of
      `.env.production.example`, and state it in the deploy checklist.
- [ ] CI green, image builds and publishes to `ghcr.io/aryan2364/sfacrm`
- [ ] Leave `@vercel/analytics` alone — unrelated, not part of this scope

**Definition of done**

- App boots with **only** `DATABASE_URL` + `R2_*` + existing session/SMTP vars. No Supabase
  vars present anywhere, and no code path referencing them.
- Login works end-to-end against plain PostgreSQL, including the role resolution in
  `src/lib/auth.ts`.
- `@supabase/supabase-js` gone from `package.json`.
- Smoke suite passes; tenant-scope audit clean.
- CI green, image published, `deploy.sh` pulls and runs it.

---

## 10. Open questions — get answers before the phase that needs them

| # | Question | Blocks | Owner | Status |
|---|---|---|---|---|
| 1 | **RDS instance size / class?** | 6.2 connection pool cap | User | **ANSWERED: `db.t4g.micro`** (1 GB RAM, ~112 `max_connections`). Pool `max: 10` is correct — keep it. Small box; first thing to outgrow. |
| 2 | **Is the RDS schema loaded yet** — empty, partial, or full? | 6.1 `db pull` source | Server agent | **OPEN** — RDS confirmed to hold no *data*; whether DDL is loaded is unconfirmed. Not blocking (pull from Supabase). |
| 3 | **Is there production data to copy** from Supabase, or start clean? | Phase E | User | **ANSWERED: YES — sfacrm starts with a full copy of live Supabase production data.** Phase E is fully in scope, including the expense-photo copy. See the fork warning in section 11. |
| 4 | **Has `CREATE EXTENSION "uuid-ossp"` been run on RDS?** Needs `rds_superuser`. | 6.1 | Server agent | **OPEN for RDS.** Confirmed present on live Supabase — RDS needs it too |
| 5 | **Confirm RLS is NOT enabled on RDS** (or the app role is `BYPASSRLS`). 0 policies means RLS on returns zero rows for every query. | All | Server agent | **OPEN** |
| 6 | Are RDS automated backups on, with a sensible retention window? | Sign-off | User | **OPEN** |
| 7 | ~~Do `point_config` / `point_events` / `point_config_history` exist?~~ | `points.ts` | — | **ANSWERED: yes, all three exist with live data.** The points feature is live, not dead. Also `tenant_point_settings`. |

**A live Supabase connection string is available** — ask the user for it; it is not stored in
the repo and must never be committed. Verified working against
`db.zanbhyaeggnzmheeospz.supabase.co:5432`, user `postgres`, database `postgres`, SSL required.
This unblocks `prisma db pull`, `points.ts`, and end-to-end login verification **now** —
question 2 no longer blocks Phase A. Re-pull against RDS before sign-off and diff the two
schemas, as 6.1 requires.

---

## 11. Phase E — Data migration (server agent, not this repo)

**CONFIRMED IN SCOPE:** sfacrm starts with a full copy of live Supabase production data.
Execution is on the server side.

### Measured size of the migration (verified against live)

| | |
|---|---|
| Total rows, all 35 tables | **4,698** — small, a single dump/restore is fine |
| Largest tables | `daily_visits` 1,112 · `point_events` 1,034 · `business_partners` 586 · `weekly_plan_items` 446 |
| Empty tables | `point_config_history` only |
| **Tenants** | **5 real customers** — Makhana, Nuetech Solar Systems, RCB, Sama, Social Chutney |
| Users | 22 |
| Expense photos to move | **128 objects, 140.9 MB** |
| Broken photo references | **0 — all 128 verified reachable** |
| Photo distribution | 127 under tenant `00000000-…-0001`, 1 under `08bfa9da-…` |

Source URL shape (public bucket):
`https://<ref>.supabase.co/storage/v1/object/public/expense-photos/receipts/<ts>-<rand>.<ext>`

> ### DECIDED: delayed replacement — the data copy runs TWICE
> **Vercel/Supabase stays AUTHORITATIVE.** SFA is sold and in active use by a client. sfacrm is
> a **demo / acceptance environment** until the client approves it; only then does Vercel retire
> and sfacrm become authoritative.
>
> This is *not* a parallel production run — the two never both accept authoritative writes — so
> no merge or conflict-resolution design is needed. But it means:
>
> **1. The data copy happens twice, and today's copy is THROWAWAY.**
> The snapshot loaded now is for building and demoing against. Supabase keeps changing
> underneath it, so it is stale the moment it lands. Do not treat it as precious and do not
> build any process that assumes it stays current.
>
> **2. At real cutover, WIPE and re-restore from a fresh dump.** Do not attempt to delta-sync
> the demo database up to date. A fresh freeze-and-cut restore is simpler, faster at 4,698 rows,
> and has no partial-sync failure mode.
>
> **3. Demo-period writes MUST NOT survive into production.** Anything typed into sfacrm during
> acceptance — test records, the client clicking around — is disposable and must be destroyed by
> the cutover wipe. If any of it is ever deemed worth keeping, that is a new problem requiring an
> explicit decision; do not let it happen by accident.
>
> **4. Photos:** the 128 objects are immutable, so pre-copying them to R2 now is safe and
> reusable. Only the delta needs re-copying at cutover.
>
> ⚠️ **The demo environment holds five real customers' production data** (Makhana, Nuetech Solar,
> RCB, Sama, Social Chutney). If sfacrm is demoed to one client, tenant isolation is the only
> thing preventing exposure of the others — which makes the section 8.2 tenant-scope audit a
> customer-data control, not just an internal correctness check.
>
> **The server agent's freeze-and-cut plan is correct and is DEFERRED to the approval date.**
> What is needed now is only a snapshot restore for development and demo.

### Verified RDS facts (server-side read-only pass)

- RDS is **PostgreSQL 17.9** on `db.t4g.micro` (aarch64/Graviton). Source is 17.6 — target is
  newer, so a 17.6 dump restores cleanly. No version-aware flags or schema/data split needed.
- `max_connections = 79` (not ~112 as earlier estimated), minus 3 superuser + 4 RDS reserved
  = **~72 usable**, shared across **seven** application databases, not four.
- `shared_buffers` ~180 MB, `work_mem` 4 MB, cache hit 99.99–100%, zero deadlocks.
- **No connection caps exist anywhere** — `datconnlimit = -1` on every database,
  `rolconnlimit = -1`, and no client-side cap in any of the six other apps. Any one app can
  consume all ~72 and starve the rest.
- ⚠️ **Every app authenticates as `postgres`, the RDS master user.** There is no per-app role.
  All seven databases are owned by it, and it holds CREATEDB/CREATEROLE and `rds_superuser`
  membership. **Any app can read or drop any other app's database.** See the escalation note
  below.

> ### ⚠️ pg_dump VERSION TRAP — will fail mid-freeze-window if ignored
> The EC2 box is Ubuntu 26.04, which ships **PostgreSQL 18.6 client tools**. `pg_dump` must
> never be newer than the restore target, and the target is 17.9. `postgresql-client-17` is
> not in the distro repos.
> **Run both ends pinned in a container:** `docker run --rm postgres:17 pg_dump …` / `pg_restore`.

- [ ] Load the schema into RDS, including the `uuid-ossp` extension
- [ ] Copy production data from Supabase -> RDS (4,698 rows across 35 tables) using **pg17
      client tooling in a container**, never the host's pg18 binaries
- [ ] **Copy expense photos** from the Supabase `expense-photos` bucket into the R2 `sfacrm`
      bucket under `receipts/{tenantId}/`
- [ ] **Rewrite `expenses.photo_url`** to the app-relative form `/api/expenses/photo/<file>`.

> ### ⚠️ THE UUID MUST MATCH ON BOTH SIDES — get this wrong and all 128 photos 404
> The path segment is the **photo file name**, not the expense id (see the correction in §7).
> So the object and the row must be written with **the same uuid**:
>
> | | |
> |---|---|
> | Object lands in R2 at | `receipts/{tenantId}/{uuid}.{ext}` |
> | Row stores | `/api/expenses/photo/{uuid}.{ext}` |
>
> The photo route rebuilds the key server-side as `receipts/{session tenantId}/{file}`. If the
> migration script generates a fresh name for the object without writing that same name into
> `photo_url` — or vice versa — **every one of the 128 receipts returns 404**, and it will look
> like an R2 problem rather than a pairing mistake.
>
> Also: the `{tenantId}` in the key must be the expense row's **own** tenant, since the route
> resolves it from the viewer's session. 127 of the 128 belong to
> `00000000-…-0001` and 1 to `08bfa9da-…` — do not write them all under one prefix.
      Existing rows hold **absolute Supabase Storage URLs** rendered directly by `<img src>`.
      They break the moment the Supabase project is deleted.

> ### ⚠️ DO NOT rewrite photo_url to an R2 URL
> **The R2 `sfacrm` bucket is PRIVATE.** There is no public base URL, no `r2.dev`, no bound
> custom domain, and none may be created. Rewriting `photo_url` to any
> `…r2.cloudflarestorage.com/…` or "R2 public base" address makes **every one of the 128
> receipts fail** — the object is not publicly readable.
> The only correct target is the app-relative path `/api/expenses/photo/<id>`, served by the
> authorising route in section 7, which signs a 300-second inline URL per request.
>
> **Verification must resolve through the app route**, not through whatever string the column
> happens to hold. Immediately after `pg_restore` and before the rewrite, all 128 URLs will
> still point at Supabase and will verify as reachable *because Supabase is still up* — a
> false green. Verify only after the rewrite, through `/api/expenses/photo/<id>`, with a
> logged-in session.
- [ ] Report: rows migrated, objects copied, and the **count of rows whose `photo_url` did not
      resolve to a real object**. Do not silently skip those.
- [ ] If the Supabase bucket is unreachable: **stop**. Do not migrate the DB leaving dead
      references behind.

---

## 12. Final report — required contents

1. Which approach was taken and any deviation from this plan, with reasoning
2. Every file touched, grouped by batch
3. Tenant-scope audit results, including the allowlist and its reasons
4. Smoke test results, and **explicitly** which routes could not be exercised
5. Every date/decimal serialisation site changed (5.1)
6. Anything that could not be verified — an honest gap list, not a green claim

---

## 13. FOLLOW-UPS — capability lost, not migrated

Recorded so nobody later assumes these logs exist.

### 13.1 Login and user-change audit logging is GONE

Login audit logging (`user_login_logs`) and user change auditing (`user_audit_logs`) have
been **non-functional in production since those tables were dropped from the database**. The
Supabase client returned errors as values and the call sites ignored them, so the failure was
invisible. The dead write paths were removed during the Prisma migration in Batch 1.

**THE CAPABILITY IS GONE, NOT MIGRATED.** Restoring it — recreating the tables and reinstating
the writes — is open follow-up work and a product decision, not a migration task.

Evidence: both tables appear in the obsolete `supabase/migrations.sql` but are absent from the
live database (see §3, "In migrations.sql, absent from LIVE"). `prisma db pull` against live
produces no model for either, so the writes could not have been ported even in principle.

### 13.2 Password reset only works for the DEFAULT tenant

Found by the write-path harness, not introduced by this migration — the Supabase code behaves
identically, and the Prisma conversion preserves it faithfully.

`/api/auth/forgot-password` and `/api/auth/reset-password` are in `middleware.ts`'s `PUBLIC`
list, so middleware never injects `x-tenant-id` for them. Both routes call `getTenantId()`,
which then falls back to `process.env.DEFAULT_TENANT_ID`, and both filter their `users` lookup
by that tenant:

```
forgot-password:  where: { contact, tenant_id: tid }
reset-password:   where: { password_reset_token: token, tenant_id: tid }
```

Live has **5 real tenants**. Only users in `DEFAULT_TENANT_ID` can reset a password; for the
other four, `forgot-password` silently returns `{ ok: true }` (the anti-enumeration response)
without sending anything, and a reset link would not validate. It fails silently by design,
which is why it has gone unnoticed.

This is a **product decision, not a migration task** — fixing it means deciding how an
unauthenticated caller's tenant is resolved (look the contact up across all tenants, as
`/api/auth/login` already does, or carry a tenant hint in the reset link). Left unchanged.

**Consequence for testing:** the write-path dev server must run with `DEFAULT_TENANT_ID` set to
the scratch tenant, or every auth write-path test fails for this reason rather than a real one:

```
DATABASE_URL=$SCRATCH_DATABASE_URL DEFAULT_TENANT_ID=0000000a-0000-4000-8000-000000000001 npx next dev -p 3012
```

### 13.3 Creating a Designation has never worked

Found while converting `masters/designations`, not introduced by this migration.

`designations.department_id` is `NOT NULL` with no default, but
`POST /api/masters/designations` only ever inserted `{ name, tenant_id }`, and the UI
(`masters/designations/page.tsx`) only ever submits `{ name }`. Every attempt therefore fails on
a not-null violation and returns 500 — the "Add Designation" button in the UI cannot succeed.

Behaviour is **preserved exactly**: the Prisma `create()` still throws and the route still
answers 500. Prisma's generated types flag it at compile time, where PostgreSQL was rejecting it
at runtime, so the call carries an explicit cast and a comment rather than a silent fix.

Fixing it means deciding how a designation picks its department — the form has no department
field at all, so this is a UI change as well as an API one, and therefore a product decision
outside this migration's scope.


### 13.4 Product import fails when a row has no Sub-Category or no Price

Found while converting `masters/import/products`, not introduced by this migration.

`products.subcategory_id` and `products.price` are both `NOT NULL`, but the importer builds
`subcategory_id: null` when a spreadsheet row has no Sub-Category, and `price: null` when it has
no Price. Because all new products go in as a single multi-row insert, **one such row fails the
entire import** with a not-null violation and a 500 — no products are created and the partial
`created`/`skipped` report is never returned.

Behaviour is **preserved exactly**: the insert still throws and the route still answers 500.
The call carries an explicit cast and a comment because Prisma's generated types reject at
compile time what PostgreSQL was rejecting at runtime.

Fixing it is a product decision: either reject those rows into `skipped` with a clear reason
(consistent with how unknown categories are already handled), or give the columns defaults.
Both change observable behaviour, so neither belongs in this migration.


### 13.5 Deleting a role: the guard and the constraint disagree

Found by the Batch 5 write-path harness. Pre-existing; the Prisma conversion preserves it exactly.

`DELETE /api/settings/roles/[id]` blocks deletion when users are still assigned, but it counts
them by **profile string**:

```
prisma.users.count({ where: { tenant_id, profile: existing.name } })
```

The constraint that actually prevents the delete is the **`users.role_id` foreign key**. Those
two do not have to agree: a user can carry `role_id` pointing at the role while `profile` holds a
different string (exactly what happens to a user whose profile was never migrated to the role
name). Such a user slips past the guard, the delete reaches the database, and the FK raises —
so the caller gets a raw **500** instead of the intended `"Cannot delete role: N user(s) still
assigned to it"` **400**.

Behaviour is unchanged by this migration and the harness asserts both paths so the gap stays
visible. Fixing it means deciding which field is authoritative — most likely counting
`role_id` as well as `profile` — which is a product decision about the role model, not a
migration task.


### 13.6 SuperAdmin per-company user intelligence is dead

Found while converting the superadmin batch. Pre-existing; behaviour preserved exactly.

`GET /api/superadmin/companies/[id]/users` depended on two things absent from the database:

- **`users.level_id`**, selected in its primary query. That column exists only in the obsolete
  `supabase/migrations.sql` (§3). PostgREST rejected the whole select, `allUsers` came back null,
  and the route hit `return NextResponse.json({ error: 'Failed to load users' }, { status: 500 })`.
- **`user_login_logs`**, the source of every login metric (§13.1).

So this endpoint returned **500 before the migration**, and it still does — same status, same
body, with the reason now stated in the file rather than surfacing as a generic failure.

**Its sibling is NOT dead.** `GET /api/superadmin/companies/[id]/usage-summary` reads the same
missing login table, but every consumer there is written `loginLogs ?? []`, so the failure
degraded gracefully and the route answered **200 with all login metrics at zero**. That is
preserved by substituting an empty array — the two routes must not be "fixed" the same way,
because they did not behave the same way.

Reviving the dead one means deciding what replaces `level_id` and whether login history is
recreated at all. Product decision, not a migration task.

