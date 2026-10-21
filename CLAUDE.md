# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Guarded by scripts/dev-guard.mjs; next dev on .env.local's DATABASE_URL (the local database)
npm run dev:local # Start dev server on :3007 against the LOCAL database (see below)
npm run dev:seed  # (Re)seed the local demo tenant — destructive, local-only
npm run build     # Production build
npm run start     # Start production server
npm run lint      # Run ESLint

npm run prisma:sync        # prisma db pull + generate + regenerate the date-only field map
npm run verify:data-layer  # READ-ONLY data-layer checks (safe against any database)
npm run smoke              # Read-path smoke suites against a running server
npm run audit:tenant       # Tenant-scope audit — needs --batch <name>
```

There is no unit-test framework. Verification is script-based and lives in `scripts/`; see
"Testing" below. `PLAN.md` documents the migration to Prisma and is the source of truth
for why the data layer looks the way it does.

### Local development database

**Production is AWS RDS, and only RDS.** Its `DATABASE_URL` exists only in `.env.production` on
the server. `next dev` reads `DATABASE_URL` from `.env.local`, which is the **local database**
(`localhost:5432/sfacrm_local`, the same value as `SCRATCH_DATABASE_URL`), so plain `next dev`
is local too. Agents do not edit `.env.local`. Still prefer `npm run dev:local`
(`scripts/dev-local.mjs`), which also sets the demo tenant: it overrides `DATABASE_URL` with
`SCRATCH_DATABASE_URL` in the child process (an explicit process env wins over a `.env.local`
value, which is what makes the override stick), clears `DATABASE_CA_CERT_PATH` — the local URL
carries no `sslmode`, so no CA is consulted — and points `DEFAULT_TENANT_ID` at the demo tenant.
Like every other scratch script it refuses any non-local host.

`npm run dev:seed` (`scripts/seed-dev.mjs`) fills that local database with a browsable demo
tenant: 5 users (password `dev1234`, phones `9000000100`–`9000000104`), the full location and
product hierarchies, every list master, ~20 business partners and leads with contacts and
addresses, and three weeks of attendance, visits, orders, expenses and weekly plans. It is
deterministic, and it wipes and re-creates **only** tenant `0000000d-…0001` — so it coexists with
`scratch:seed`, whose tenants A and B the write-path suites assert against. The demo tenant has
no R2 objects, so seeded expenses carry no photo.

If `prisma/schema.prisma` has changed since the local database was last built, run
`npm run scratch:push` first. That wrapper runs `prisma db push --accept-data-loss`, which Prisma
blocks for AI agents — a human has to run it.

## Architecture

**RGB SFA** is a Next.js 14 (App Router) + Prisma + PostgreSQL + Tailwind CSS sales force
automation admin panel. Files are stored in Cloudflare R2.

### Key Architectural Patterns

**Multi-Tenancy**: Every route resolves its tenant from the **verified session**, through `requireUser()` / `getTenantId()` in `src/lib/tenant.ts` — never from a request header. (An older design injected an `x-tenant-id` header; it is gone, and reinstating it would let a client choose its tenant.) `getTenantId()` throws `Unauthorized` when there is no valid session; only the public forgot/reset-password routes use `getPublicTenantId()`, which falls back to `DEFAULT_TENANT_ID`. Every DB query filters by `tenant_id`. **Dropping a `tenant_id` filter leaks data across tenants with nothing crashing** — it is the highest-consequence mistake available in this codebase.

**Foreign keys are not tenant-safe.** Every FK in the schema references a bare `id`, not `(tenant_id, id)`, so Postgres accepts a body-supplied id from another tenant — and any `include` then reads that tenant's row back out. Guard the **values**, not just the row: check every body-sourced id with `firstForeignTenantRef()` from `src/lib/tenant-fk.ts` before writing it. A clean `npm run audit:tenant` proves read-side scoping only; it does not catch this. The durable fix is composite FKs (PLAN.md §8.2), which needs a migration.

**Authentication**: Custom JWT in an httpOnly cookie (no NextAuth). `src/lib/session.ts` signs and verifies it; `src/lib/session-node.ts` holds a byte-identical Node verifier — **change both or neither**. The payload is UTF-8 base64url (so non-Latin names work) and carries `iat`, `exp` (`SESSION_MAX_AGE_DAYS`, default 7; `PHONE_SESSION_MAX_AGE_DAYS`, default 30, when sign-in is from a phone per `getRequestLayout()` in `src/lib/layout.server.ts`; the same number sets the cookie maxAge) and `cv` (the user's `credentials_version`). `src/lib/auth.ts` exports `getCurrentUser()` and `requireUser()`. `requireUser()` re-resolves the caller's role from the database (a role forged into a cookie does not take effect), rejects a stale `cv` (password reset, admin password or phone change), and rejects a suspended or inactive tenant (cached 30s per tenant in-process; the SuperAdmin company PUT evicts it). `src/middleware.ts` cannot verify signatures in the edge runtime: it decodes the payload, returns **401 JSON** for a protected `/api/*` call with a missing, expired or malformed cookie, and redirects page navigations to `/login`. `requireUser()` is the real gate. On the client, `src/lib/session-expiry.ts` patches `fetch` so a 401 sends the user to `/login?next=…` (validated by `isSafeReturnPath`), and a 5xx triggers one throttled `/api/auth/me` probe that redirects if the session was revoked.

**Database access**: `src/lib/db.ts` exports a single Prisma client. It is built lazily on first use, so importing it during `next build` (which runs with no database) is free. The connection comes from `DATABASE_URL` at runtime.

Two helpers in that module matter for correctness:

- **`serialize(rows, 'model_name')`** — apply to any response carrying a date or a numeric. Prisma returns `Date` and `Decimal` objects where the client expects ISO strings and JS numbers; a `Decimal` serialises to a *string* through `JSON.stringify`, which silently corrupts totals. `@db.Date` columns serialise to `"YYYY-MM-DD"`, timestamps to full ISO.
- **`dateOnlyString(date)`** — apply whenever a date is used **server-side** as a `Set` member, an object key, or an operand of `===`/`<`/`>`/`localeCompare`. `serialize()` only fixes the wire. See `PLAN.md` §8.4 for the five ways a raw `Date` fails silently.

**RBAC + Data Scoping**: `src/lib/permissions.ts` exports `checkPermission(user, section, action)` and `getDataScope(user, section)`. Scope returns `'own' | 'team' | 'all'`. Permissions live in the `role_permissions` table, keyed by `(tenant_id, profile, section)` — every route's authorisation reads through it. Never gate on a hardcoded role name.

**Route Groups**: All authenticated pages live under `src/app/(protected)/`. Masters (reference data management) live under `src/app/(protected)/masters/`.

**API Routes**: ~142 route files under `src/app/api/`. Pattern: `requireUser()` → `checkPermission` → data scope → tenant-FK checks on body ids → Prisma query → `serialize()` → JSON. Prisma **throws** where the old client returned errors as values; catch and return `dbErrorResult(err)` from `src/lib/db.ts`, which maps Prisma codes to plain messages **and** the right status (409 in use / duplicate, 404 gone, 400 invalid, 503 DB down) and never returns the raw error text. **The UI must gate each control on the exact action its route checks** (`create` vs `edit` differ), and `/api/auth/me` must mirror `checkPermission` action for action.

**File storage**: `src/lib/r2.ts` wraps Cloudflare R2. The bucket is **private** — objects are never public. Uploads go through `/api/expenses/upload`; reads go through `/api/expenses/photo/[id]`, which authorises against `getDataScope` and 302s to a 300-second signed inline URL. `expenses.photo_url` stores the app-relative path, never an R2 address.

### Reusable Patterns

**`useCrud` hook** (`src/hooks/useCrud.ts`): Generic hook for all master data pages. Handles rows, loading, search (300ms debounce), pagination (15 items/page), and CRUD operations with toast notifications.

**`CrudPage` component** (`src/components/ui/CrudPage.tsx`): Reusable data table with search, pagination, edit/delete actions. Used by almost all master pages.

**Toast notifications**: `src/contexts/ToastContext.tsx` wraps the entire app. Use `useToast()` hook anywhere.

### Database

PostgreSQL on AWS RDS, accessed through Prisma 7 with the `@prisma/adapter-pg` driver adapter —
**no query-engine binary**, so there is no `binaryTargets` to set and nothing for Alpine/musl to
mismatch.

`prisma/schema.prisma` is the source of truth, generated by `prisma db pull` from the live
database.

All tables use UUID primary keys and carry a `tenant_id` column, except `tenants` itself (its
primary key *is* the tenant). **Do not enable RLS**: the tables have RLS-capable definitions but
zero policies, so turning it on returns zero rows for every query.

**Hierarchy of location masters**: states → districts → talukas → villages

**Weekly plan workflow**: plans go through state transitions (submit → approve/reject/suggest/hold/edit-by-manager/reopen). See `/api/weekly-plans/` for the endpoints. `weekly_plans.status` has a CHECK constraint permitting seven values, and `weekly_plan_audit_logs.action_type` has none — the code writes thirteen. Read the constraint and the code, never `SELECT DISTINCT`.

### Testing

No unit-test framework. Three script-based layers, all in `scripts/`:

- **Read-path smoke** (`npm run smoke`) runs against a live database — proves real data shapes. `node scripts/smoke-test.mjs --scratch` runs it against `SCRATCH_DATABASE_URL` instead and refuses a non-local host.
- **Write-path suites** (`test:write`, `test:write:plans`, `test:write:ops`, `test:write:activity`) run **only** against a local scratch PostgreSQL via `SCRATCH_DATABASE_URL`; they refuse to start against a non-localhost host. Never point them at production.
- **Tenant-scope audit** (`npm run audit:tenant -- --batch <name>`) checks both statically and at runtime that every query touching a tenant-scoped table carries a `tenant_id` predicate. It proves the **read** side only — body-sourced foreign keys on writes pass it cleanly (see Multi-Tenancy above).

The one-time release scripts (`backfill-can-create`, `rehash-plaintext-passwords`,
`prod-readiness-check`) resolve their database through `scripts/release-db.mjs`: `--use-database-url`
means "DATABASE_URL". The owner reaches RDS with `node --env-file=.env.rds …`; writes need `--host <rds-host>`. See DEPLOYMENT.md. Agents never run them.

Test sessions are minted through the app's own signer (`scripts/test-session.mjs`), never hand-rolled, so they track the real token format.

Run the write-path suites and `verify:r2` with `TZ=UTC` — production runs UTC, and some date logic is timezone-sensitive.

**Dates:** server code must never derive "today" or a day/month boundary from the process clock
(`new Date().toISOString().slice(0,10)` is UTC, which is the wrong day before 05:30 IST). Use
`src/lib/business-date.ts` (`businessDate()`, `businessDayRange()`, …), which applies
`APP_TIMEZONE`.

### Environment Variables

All are server-only and read at runtime. **Never give any of them a `NEXT_PUBLIC_` prefix** —
that inlines the value into the browser bundle at build time.

```
DATABASE_URL=                      # postgresql://…?sslmode=require&connection_limit=5
SESSION_SECRET=                    # 32+ chars for JWT signing; also keys the receipt-photo tags
SESSION_MAX_AGE_DAYS=              # optional; login lifetime in days, default 7
PHONE_SESSION_MAX_AGE_DAYS=        # optional; login lifetime in days for a phone sign-in, default 30
APP_TIMEZONE=                      # optional; business calendar for "today", default Asia/Kolkata
DEFAULT_TENANT_ID=                 # UUID; also the tenant the public auth routes fall back to
APP_URL=                           # public base URL; builds reset links. Required in prod (reset 503s without it)
R2_ACCOUNT_ID= R2_ENDPOINT= R2_BUCKET= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY=
SMTP_HOST= SMTP_PORT= SMTP_SECURE= SMTP_USER= SMTP_PASS= SMTP_FROM=   # required in prod
VAPID_PUBLIC_KEY=                  # phone push: public key, served to the phone by /api/push/vapid-public-key (npx web-push generate-vapid-keys)
VAPID_PRIVATE_KEY=                 # phone push: private key; unset = push is a silent no-op
VAPID_SUBJECT=                     # optional; default mailto:admin@rgbindia.com
CRON_SECRET=                       # Bearer secret for POST /api/cron/follow-up-reminders; unset = 401
```

Password-reset links are built from `APP_URL`, never from the request `Host` header (a forged Host
would email the victim a link to the attacker's domain).

Local-only, never set in production: `SCRATCH_DATABASE_URL` (write-path tests) and
`PRISMA_QUERY_LOG` (tenant audit — it appends every SQL statement to a file, unbounded).

### SuperAdmin

SuperAdmin routes are separate from the tenant app. The separation is enforced **in the routes, not in middleware** (middleware has no role check): a SuperAdmin session carries no tenant, so `getTenantId()` / `requireUser()` refuse it on tenant routes, and SuperAdmin routes check their own session. SuperAdmin API routes are under `/api/superadmin/`, authenticate against `SUPER_ADMIN_PHONE`/`SUPER_ADMIN_PASSWORD` rather than the database, and are deliberately cross-tenant — but a route acting on one company (`/api/superadmin/companies/[id]`) must still filter its writes by `tenant_id: params.id`. Tenant-admin passwords are bcrypt'd (cost 12) like every other password.

### Known dead code

Some routes still exist but cannot succeed, because they depend on tables or columns that are not
in the database. They are preserved deliberately rather than "fixed" — see `PLAN.md` §13 for each
one and why. Do not treat their failures as regressions.
