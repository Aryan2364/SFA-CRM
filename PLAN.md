# PLAN.md — Migrate sfacrm off Supabase onto PostgreSQL (AWS RDS) + Prisma + Cloudflare R2

**Status:** Not started
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

**Database:** 35 tables, all UUID PKs with `uuid_generate_v4()` defaults, all carrying
`tenant_id`. Schema lives in `supabase/migrations.sql`.

Tables: `states, districts, talukas, villages, distributors, dealers, product_categories,
product_subcategories, products, departments, designations, levels, users, daily_visits,
user_territory_mappings, weekly_plans, weekly_plan_items, weekly_plan_audit_logs, expenses,
orders, order_items, contextual_remarks, remark_reads, notifications, user_visibility,
role_permissions, institutions, business_partners, tenants, lead_types, lead_stages,
lead_temperatures, roles, user_login_logs, user_audit_logs`

**RLS:** `migrations.sql` has 31 x `ENABLE ROW LEVEL SECURITY` and **0 x `CREATE POLICY`**.
Everything ran through the service-role key, which bypasses RLS, so RLS was doing nothing.
**Do not enable RLS on RDS.** With RLS on, zero policies, and a non-`BYPASSRLS` role, every
query silently returns zero rows.

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

The schema has **100 timestamp/date columns and 15 numeric/decimal columns**, and the code
relies on the string behaviour in real places:

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
- [ ] Set `connection_limit` in `DATABASE_URL` sized to the RDS instance.
      RDS `max_connections` ~= `DBInstanceClassMemory/9531392` — roughly **85 on db.t3.micro**,
      **~150 on db.t3.small**. Budget for other clients and any future second container.
      **Start at 10–15 unless the instance size says otherwise.** Instance size is an OPEN
      QUESTION (section 10) — do not guess silently; if unanswered, use 10 and flag it.
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
    - The returned `url` is now the **app-relative path** `/api/expenses/photo/<expenseId>`
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

| # | Batch | Routes | Notes |
|---|---|---|---|
| 1 | `auth` | 5 | Do first. Login, session, password reset. Depends on Phase A libs. |
| 2 | `masters` — location & product | ~20 | states, districts, talukas, villages, product-categories, product-subcategories, products, distributors, dealers |
| 3 | `masters` — org, users, leads | ~23 | departments, designations, roles, users, institutions, lead-types, lead-stages, lead-temperatures, territory-mapping, expense-categories, import. **Heaviest embeds live here** (`users` with departments/designations/roles/manager). |
| 4 | `weekly-plans` | 17 | 12+ state-transition endpoints (submit -> approve/reject/suggest). Verify every transition, and `weekly_plan_audit_logs` writes. |
| 5 | `leads` + `business-partners` + `orders` | 9 | `orders` uses `order_items(*)`, `order_items(count)`, and the `users!orders_user_id_fkey` hint — the trickiest embeds in the codebase. |
| 6 | `daily-activity` + `attendance` + `expenses` | 10 | Do **after** Phase B. `daily-activity/[id]/route.ts:25` has the `.slice(0,10)` date trap. |
| 7 | `points` + `review` + `dashboard` + `notifications` + `remarks` + `conversations` | 16 | `conversations/route.ts:121` has the `localeCompare` date trap. Dashboard has aggregate counts. |
| 8 | `access-control` + `settings` | 7 | Touches `role_permissions` — re-verify permissions still resolve identically after. |
| 9 | `superadmin` + teardown | 7 + cleanup | See section 9. |

### 8.2 Tenant-scope audit — build this in Batch 1, run every batch

- [ ] A script that enumerates every Prisma call touching a tenant-scoped table and flags any
      without a `tenant_id` predicate. Simplest robust version: enable Prisma query logging,
      exercise the routes, and assert every emitted `SELECT/UPDATE/DELETE` against a
      tenant table contains a `tenant_id` condition.
- [ ] Cross-check: `git show <supabase-version>` of each converted file and confirm every
      `.eq('tenant_id', tid)` has a Prisma counterpart. Do this per batch while the diff is small.
- [ ] Any table intentionally not tenant-scoped (e.g. `tenants`) goes on an explicit allowlist
      **with a written reason**.

### 8.3 Smoke tests — build in Batch 1, extend every batch

- [ ] A script that logs in and hits at least one route per group as a real session, asserting
      2xx and non-empty payloads
- [ ] Explicit coverage for: every weekly-plan state transition; every route using
      `count: 'exact', head: true` for pagination totals; expense upload + photo view
- [ ] Record which routes could **not** be exercised and why — that list goes in the final report

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

| # | Question | Blocks | Owner |
|---|---|---|---|
| 1 | **RDS instance size / class?** | 6.2 connection pool cap | User |
| 2 | **Is the RDS schema loaded yet** — empty, partial, or full? | 6.1 `db pull` source | Server agent |
| 3 | **Is there production data to copy** from Supabase, or start clean? | Phase E | Server agent |
| 4 | **Has `CREATE EXTENSION "uuid-ossp"` been run on RDS?** Needs `rds_superuser`. Every table depends on `uuid_generate_v4()` defaults. | 6.1 | Server agent |
| 5 | **Confirm RLS is NOT enabled on RDS** (or the app role is `BYPASSRLS`). 31 tables, 0 policies means RLS on returns zero rows for every query. | All | Server agent |
| 6 | Are RDS automated backups on, with a sensible retention window? (Supabase's backup UI is going away.) | Sign-off | User |

If #2 is "empty", proceed by pulling the schema from Supabase and re-pull against RDS before
sign-off (6.1). Do not block the whole project on it.

---

## 11. Phase E — Data migration (server agent, not this repo)

Listed here so it is not forgotten; execution is on the server side.

- [ ] Load the schema into RDS, including the `uuid-ossp` extension
- [ ] Copy production data from Supabase -> RDS
- [ ] **Copy expense photos** from the Supabase `expense-photos` bucket into the R2 `sfacrm`
      bucket under `receipts/{tenantId}/`
- [ ] **Rewrite `expenses.photo_url`** to the new `/api/expenses/photo/<id>` form.
      Existing rows hold **absolute Supabase Storage URLs** rendered directly by `<img src>`.
      They break the moment the Supabase project is deleted.
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
