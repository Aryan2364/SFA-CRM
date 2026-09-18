# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start development server — ⚠ uses DATABASE_URL, i.e. the LIVE database
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
"Testing" below. `PLAN.md` documents the Supabase → Prisma migration and is the source of truth
for why the data layer looks the way it does.

### Local development database

`next dev` reads `DATABASE_URL` from `.env.local`, which is the **live Supabase database** — so a
plain `npm run dev` browses and edits production data. `npm run dev:local`
(`scripts/dev-local.mjs`) exists to avoid that: it overrides `DATABASE_URL` with
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

**Multi-Tenancy**: Every request goes through `src/middleware.ts`, which validates the JWT session cookie, injects `x-tenant-id` into headers, and blocks unauthenticated access. All API routes read `x-tenant-id` from headers and filter all DB queries by `tenant_id`. **Dropping a `tenant_id` filter leaks data across tenants with nothing crashing** — it is the highest-consequence mistake available in this codebase.

**Authentication**: Custom JWT in an httpOnly cookie (no NextAuth). `src/lib/session.ts` handles JWT verification. `src/lib/auth.ts` exports `getCurrentUser()` and `requireUser()` for API routes. `requireUser()` re-resolves the caller's role from the database, so a role forged into a cookie does not take effect.

**Database access**: `src/lib/db.ts` exports a single Prisma client. It is built lazily on first use, so importing it during `next build` (which runs with no database) is free. The connection comes from `DATABASE_URL` at runtime.

Two helpers in that module matter for correctness:

- **`serialize(rows, 'model_name')`** — apply to any response carrying a date or a numeric. Prisma returns `Date` and `Decimal` objects where the client expects ISO strings and JS numbers; a `Decimal` serialises to a *string* through `JSON.stringify`, which silently corrupts totals. `@db.Date` columns serialise to `"YYYY-MM-DD"`, timestamps to full ISO.
- **`dateOnlyString(date)`** — apply whenever a date is used **server-side** as a `Set` member, an object key, or an operand of `===`/`<`/`>`/`localeCompare`. `serialize()` only fixes the wire. See `PLAN.md` §8.4 for the five ways a raw `Date` fails silently.

**RBAC + Data Scoping**: `src/lib/permissions.ts` exports `checkPermission(user, section, action)` and `getDataScope(user, section)`. Scope returns `'own' | 'team' | 'all'`. Permissions live in the `role_permissions` table, keyed by `(tenant_id, profile, section)` — every route's authorisation reads through it. Never gate on a hardcoded role name.

**Route Groups**: All authenticated pages live under `src/app/(protected)/`. Masters (reference data management) live under `src/app/(protected)/masters/`.

**API Routes**: 115 REST endpoints under `src/app/api/`. Pattern: route reads tenant from header, queries via Prisma, applies permission checks, serialises, returns JSON. Prisma **throws** where the old client returned errors as values, so each route catches and returns the status it always returned.

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
database. **`supabase/migrations.sql` is obsolete** and kept only as history — it diverges from
the real schema in both directions.

All tables use UUID primary keys and carry a `tenant_id` column, except `tenants` itself (its
primary key *is* the tenant). **Do not enable RLS**: the tables have RLS-capable definitions but
zero policies, so turning it on returns zero rows for every query.

**Hierarchy of location masters**: states → districts → talukas → villages

**Weekly plan workflow**: plans go through state transitions (submit → approve/reject/suggest/hold/edit-by-manager/reopen). See `/api/weekly-plans/` for the endpoints. `weekly_plans.status` has a CHECK constraint permitting seven values, and `weekly_plan_audit_logs.action_type` has none — the code writes thirteen. Read the constraint and the code, never `SELECT DISTINCT`.

### Testing

No unit-test framework. Three script-based layers, all in `scripts/`:

- **Read-path smoke** (`npm run smoke`) runs against a live database — proves real data shapes.
- **Write-path suites** (`test:write`, `test:write:plans`, `test:write:ops`, `test:write:activity`) run **only** against a local scratch PostgreSQL via `SCRATCH_DATABASE_URL`; they refuse to start against a non-localhost host. Never point them at production.
- **Tenant-scope audit** (`npm run audit:tenant -- --batch <name>`) checks both statically and at runtime that every query touching a tenant-scoped table carries a `tenant_id` predicate.

Run the write-path suites and `verify:r2` with `TZ=UTC` — production runs UTC, and some date logic is timezone-sensitive.

### Environment Variables

All are server-only and read at runtime. **Never give any of them a `NEXT_PUBLIC_` prefix** —
that inlines the value into the browser bundle at build time.

```
DATABASE_URL=                      # postgresql://…?sslmode=require&connection_limit=5
SESSION_SECRET=                    # 32+ chars for JWT signing
DEFAULT_TENANT_ID=                 # UUID; also the tenant the public auth routes fall back to
R2_ACCOUNT_ID= R2_ENDPOINT= R2_BUCKET= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY=
SMTP_HOST= SMTP_PORT= SMTP_SECURE= SMTP_USER= SMTP_PASS= SMTP_FROM=
```

Local-only, never set in production: `SCRATCH_DATABASE_URL` (write-path tests) and
`PRISMA_QUERY_LOG` (tenant audit — it appends every SQL statement to a file, unbounded).

### SuperAdmin

SuperAdmin routes are separate from the tenant app. Middleware blocks SuperAdmin users from accessing tenant routes and vice versa. SuperAdmin API routes are under `/api/superadmin/`, authenticate against `SUPER_ADMIN_PHONE`/`SUPER_ADMIN_PASSWORD` rather than the database, and are deliberately cross-tenant.

### Known dead code

Some routes still exist but cannot succeed, because they depend on tables or columns that are not
in the database. They are preserved deliberately rather than "fixed" — see `PLAN.md` §13 for each
one and why. Do not treat their failures as regressions.
