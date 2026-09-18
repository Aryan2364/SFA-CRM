# 00 — Codebase Map

**Purpose:** orient a new implementation agent in ten minutes. Everything here was read from
the code on 18 Sep 2026, read-only. Where this file and `REBUILD-PLAN.md` disagree, **this file
is the fact and REBUILD-PLAN.md is the intent.**

**Snapshot:** repo `D:\RGB_Software\sfacrm`, branch `main`. Written across `6e2cec6` → `221f47e`;
final state verified at **`221f47e`, 18 Sep 01:17**. See §0 — the tree was moving while this was
written.

> **Provenance caveat — read before citing this file as authority.**
> Every claim here traces to a file someone opened directly. But one inspection agent's
> **route-by-route inventory was largely name-inference** (it opened 9 of 115 route files), so
> that table was **not** used and does not appear here. What *is* used: the canonical route
> pattern in §4 and the dead-code list in §8 (both from direct reads), the schema in §3 (read by
> three agents independently, with matching blob hashes), the permissions and visibility detail in
> §6 (read in full, line-cited), and the `src/lib` signatures in §7.
> **Not covered by anyone:** route-level behaviour for `notifications`, `superadmin`, `points`,
> and most individual `masters/*` route files. None is on a critical path — read them before
> touching them. Full accounting in `09-OPEN-QUESTIONS.md` E4.
> **Nothing here was verified against the running app or the live database** — see E2 and E3.

---

## 0. Read this first — the tree is not stable

A second automated run (a peer Claude session, logged in `overnight-queue-2026-09-18.md`) was
**committing to this repo while this map was produced**, converting list screens onto a shared
`list-page` template. Commits landed seconds apart:

```
4af0952            Make the shell's content wrapper the scroll container
f61e3a9  23:21:19  Move every list screen's shared machinery into list-page
3ca5a52  23:21:34  Reduce orders to what is actually about orders
6e2cec6  00:41:20  Put conversations on list-page
d07462b  00:46:24  Put leads on list-page: nine colours become nine icons
8dfb88e  00:48:38  Give weekly-plan statuses words instead of palette colours
ecc8614  00:49:04  (follow-up)
```

That run's declared scope, in order, is **leads, weekly-plan, masters/users, review,
conversations**, with `orders` as the already-converted worked example.

**Consequences for tomorrow:**

1. `REBUILD-PLAN.md` §0.1 says "the frontend has already been migrated to [rgb-kit v2]".
   That is **intent, not fact** — the migration was still running as of 00:49 on 18 Sep.
2. Page-level line numbers for those five screens are unreliable. Anchor on the `list-page`
   template's API, which is stable, not on a screen's current contents.
3. **Task 0 tomorrow is a reconciliation step** (see `08-EXECUTION-SEQUENCE.md`): `git log`,
   `git status`, and confirm which screens finished converting before dispatching anything.

---

## 1. Stack — what REBUILD-PLAN.md §0.2 gets wrong

| REBUILD-PLAN §0.2 says | Reality |
|---|---|
| Frontend: Next.js | **Correct.** Next.js 14.2 App Router, React 18, TypeScript 5. |
| Backend: **NestJS** | **Wrong. There is no NestJS anywhere.** No monorepo, no `apps/`, no `packages/`, no controllers/services/DTOs. The backend is **118 route files under `src/app/api/`** in the same Next.js app. |
| Database: PostgreSQL | **Correct.** AWS RDS, via Prisma 7 + `@prisma/adapter-pg` (driver adapter, no query-engine binary). |

Other stack facts:

- **Styling:** Tailwind CSS v4 (`@tailwindcss/postcss`), not v3. No `tailwind.config.js`; tokens
  live in `src/app/globals.css`.
- **UI deps:** `@base-ui/react` 1.8, `lucide-react`, `cmdk`, `sonner` (toasts), `recharts`
  (charts — for Phase 5), `react-day-picker`, `exceljs` (XLSX import/export).
- **Files:** Cloudflare R2, private bucket (`src/lib/r2.ts`).
- **Auth:** custom JWT-ish HMAC cookie. **No NextAuth.**
- **Tests:** no unit-test framework. Script-based only, in `scripts/`. See §9.
- **Dev server:** `npm run dev` → **port 3007 is the live one** (confirmed listening, PID 11480).
  Login `7878038514` / `Admin@123` — but note `overnight-queue-2026-09-18.md` N2 records this
  password as **stale**; an existing browser session cookie still works.

---

## 2. Repository layout

```
D:\RGB_Software\sfacrm
├── prisma/schema.prisma        ← 599 lines, 35 models. SOURCE OF TRUTH for the DB.
├── src/
│   ├── middleware.ts           ← cookie-presence UX guard ONLY (see §5)
│   ├── app/
│   │   ├── (protected)/        ← every authenticated page
│   │   │   ├── page.tsx        ← dashboard
│   │   │   ├── leads/          ← THE Phase 1 file
│   │   │   ├── orders/  daily-activity/  weekly-plan/  review/
│   │   │   ├── conversations/  points/  settings/  masters/
│   │   ├── api/                ← 118 route files = "the backend"
│   │   ├── login/  reset-password/  superadmin/  kitchen-sink/
│   │   └── globals.css         ← Tailwind v4 tokens + type scale
│   ├── components/
│   │   ├── templates/list-page.tsx   ← the shared list screen (see §6)
│   │   ├── ui/                 ← primitives (CrudPage, Modal, dialog, Sidebar, …)
│   │   ├── masters/            ← BusinessPartnerForm and friends
│   │   ├── shell/nav.ts        ← THE navigation registry
│   │   └── status-badge.tsx    ← the shared status vocabulary
│   ├── contexts/ToastContext.tsx
│   ├── hooks/                  ← useCrud.ts, useMe.ts
│   └── lib/                    ← db, auth, session, permissions, visibility, tenant, r2, points
└── scripts/                    ← all verification lives here
```

Sibling repos on the same drive (not part of this app's build):
`D:\RGB_Software\rgb-kit-v2` — the design system. Its bible is **`AGENTS.md` (110 KB)**, plus
`SYNC.md` (77 KB) tracking migration state. Note the file is `AGENTS.md`, **not** `agent.md` as
REBUILD-PLAN §0.1 calls it.

---

## 3. THE most important structural fact: there is no `leads` table

`prisma/schema.prisma` has 35 models and **none of them is `leads`**. Everything the app calls a
Lead is a row in **`business_partners`**, discriminated by two *free-text string* columns:

| column | meaning | values in use |
|---|---|---|
| `type` | what kind of account | `Dealer`, `Distributor`, `Institution`, `End Consumer` |
| `stage` | how far along | `Prospect`, `Contacted`, `Interested`, `Qualified`, `Proposal`, `Negotiation`, `Existing` |

Those values are seeded into the `lead_types` and `lead_stages` masters — but
**`type`/`stage`/`temperature` are NOT foreign keys.** They store the master's *name string*,
matched by name at write time only. Renaming a master row orphans every row that used it. There
is no cascade and no constraint.

The whole "Leads vs Masters" split in the UI is **one table filtered five different ways**:

| API | `where` on `business_partners` |
|---|---|
| `GET /api/leads` | `tenant_id` + optional `type` + optional `name contains q`. **NO `stage` filter** |
| `GET /api/masters/dealers` | `type:'Dealer', stage:'Existing'` |
| `GET /api/masters/distributors` | `type:'Distributor', stage:'Existing'` |
| `GET /api/masters/institutions` | `type in ['Institution','End Consumer'], stage:'Existing'` |
| `GET /api/business-partners` | `is_active:true`, `stage: status==='lead' ? {not:'Existing'} : 'Existing'` |

So **`GET /api/leads` returns every business partner in the tenant**, existing dealers and
distributors included. The Leads *page* hides them by filtering **client-side** after the fetch.

`'Existing'` is a sentinel meaning *"this is a master record, not a lead"*. It is not a funnel
position. `Prospect` and `Existing` are `is_fixed: true` in `lead_stages` and are protected from
rename/delete; both strings are hardcoded in six route files.

**Four screens share this one table and one form component** (`BusinessPartnerForm.tsx`):
Leads, and Masters → Dealers / Distributors / Institutions. Changing the Leads list's `where`
changes what Masters shows. This is the central constraint on Phase 1.

---

## 4. The canonical API route pattern — copy this verbatim

Every route follows a fixed order. From `src/app/api/masters/dealers/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'dealers', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const tid = getTenantId()

  try {
    const rows = await prisma.business_partners.findMany({
      where: {
        tenant_id: tid,
        type: 'Dealer',
        stage: 'Existing',
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      include: { states: { select: { name: true } } /* … */ },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(serialize(rows, 'business_partners') as Record<string, unknown>[])
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
```

**Rules this encodes — follow all of them:**

- **Fixed order:** `requireUser()` → `checkPermission()`/`forbidden()` → read params →
  `getTenantId()` → `try { prisma … } catch { 500 }`.
- **Tenant** comes from `getTenantId()` (verified cookie) — **never** from a header. `tenant_id`
  goes in the `where` of every read and the `data` of every create. Updates/deletes use
  `where: { id, tenant_id }`. *Dropping a tenant filter leaks data across tenants with nothing
  crashing.*
- **No response envelope.** Lists return a **bare JSON array**; single rows the bare object;
  errors `{ error: string }`. There is no `{data,total}` anywhere. Do not invent one.
- **Status codes:** 200 read/update, **201 create**, 400 validation, 403 `{error:'Forbidden'}`,
  404 rare, 500 `{error: dbErrorMessage(err)}`.
- **Serialisation:** `serialize(rows, '<model>')` before `NextResponse.json`, **always** when the
  model has a `Decimal` or a date. Always pass the model name.
- **No validation library.** `zod` is not a dependency. Every route hand-writes early-return
  checks after `await req.json()`. Shared regexes (GSTIN, mobile, pincode) are **copy-pasted per
  file**, not imported.
- **Pagination is essentially absent server-side.** Only `notifications` and two `points` routes
  use `take`/`skip`. **Every other list route returns all rows**; the client paginates 15/page.
  This is a real scalability problem for Phase 1's Companies list and Phase 2's Deals list.
- **Search** is always `{ name: { contains: q, mode:'insensitive' } }` on one column.
- **Filtering** composes with spread-conditionals: `...(x ? { col: x } : {})`.

---

## 5. Auth, tenancy and the logged-in user

**`CLAUDE.md` is stale here — do not code against it.** It claims middleware injects
`x-tenant-id` and that routes read that header. **That design was removed.** Both
`src/middleware.ts` and `src/lib/tenant.ts` carry explicit "DO NOT reintroduce" comments.

Actual flow:

- `src/middleware.ts` — a **cookie-presence UX guard only**. It cannot read `SESSION_SECRET` in
  the edge runtime on EC2, so it does not verify anything. It redirects/401s unauthenticated
  requests and keeps SuperAdmin and tenant routes apart.
- `src/lib/tenant.ts` → `getTenantId(): string` — **synchronous**, reads the cookie, verifies via
  `verifySessionSync`, returns `payload.tenantId`; falls back to `DEFAULT_TENANT_ID`. ~158 call
  sites depend on it staying sync.
- `src/lib/session.ts` (edge, Web Crypto): `signSession`, `verifySession`, `COOKIE_NAME =
  'rgb_session'`. Token = `base64(JSON) + "." + base64url(HMAC-SHA256)`.
- `src/lib/session-node.ts` (Node only, **must never reach the edge bundle**):
  `verifySessionSync`.
- `src/lib/auth.ts`:
  ```ts
  type SessionUser = { phone: string; userId: string | null; name: string;
                       role: string; tenantId: string; cv?: number }
  getCurrentUser(): Promise<SessionUser | null>
  requireUser():    Promise<SessionUser>   // THROWS 'Unauthorized'; nothing catches it
  ```
  `requireUser()` re-resolves `role` from the DB, so a forged cookie role does not take effect:
  `status==='Inactive'` → `'Deactivated'`; `profile==='Administrator'` → `'Administrator'`;
  else `roles.name` ?? `'NoRole'`.

**Client side:** there is **no user provider**. `src/hooks/useMe.ts` exports
`useMe(): Me | null` with a module-level cache, fetching `/api/auth/me` once per page load.

```ts
type Me = { name, phone, role, tenantName, hasSubordinates: boolean, permissions: MePermissions }
type SectionPerm = { view: boolean; edit: boolean; delete: boolean }
```

⚠️ **`Me` does not expose `userId`, and `permissions` omits `data_scope`.** Any UI that needs the
current user's id or their scope requires extending `/api/auth/me` first.

---

## 6. Permissions and data scoping

`src/lib/permissions.ts`:

```ts
type MasterSection   = 'states'|'districts'|'talukas'|'villages'|'territory_mapping'
                     | 'dealers'|'distributors'|'institutions'
                     | 'product_categories'|'product_subcategories'|'products'
                     | 'departments'|'designations'|'expense_categories'
                     | 'lead_types'|'lead_stages'|'lead_temperatures'      // 17
type OperationSection = 'meetings'|'expenses'|'weekly_plan'|'orders'|'leads'|'users'
type PointsSection    = 'leaderboard'|'points_config'
type PermAction       = 'view'|'create'|'edit'|'delete'
type DataScope        = 'own'|'team'|'all'

checkPermission(user, section, action): Promise<boolean>
getDataScope(user, section):            Promise<DataScope>
forbidden(): NextResponse                // { error:'Forbidden' }, 403
```

- Administrator short-circuits to `true` / `'all'` **without touching the DB**.
- Master sections always get `'all'`.
- `'create'` **falls back to `can_edit`** when `can_create` is null.
- ⚠️ **`role_permissions.profile` holds a ROLE NAME (`roles.name`), matched against
  `SessionUser.role` — not `users.profile`.** The column name is a trap.
- `role_permissions.section` is a **string column with a 23-value allowlist in code**. Adding or
  renaming a section means editing `ALL_SECTIONS` in `settings/role-permissions/route.ts`, the
  union types in `permissions.ts`, **and back-filling a row for every existing
  `(tenant_id, profile)` pair** — a missing row reads as `false`, silently revoking access for
  every non-Administrator.

**Self / Team / Company already exists** (`role_permissions.data_scope`, default `"team"`), and
it already resolves the **full manager chain** — but not at query time. The chain is
*materialised* into a closure table:

- `users.manager_user_id` — self-referencing FK, the only hierarchy source. Prisma relation
  `"usersTousers"`: `users` = my manager, `other_users` = my direct reports.
- `user_visibility (viewer_user_id, target_user_id)` — the derived closure.
- `cascadeVisibilityUp()` walks **upward to the root** with cycle protection, writing a row per
  ancestor. Duplicated at `masters/users/route.ts:140` and `masters/users/[id]/route.ts:228`;
  a whole-tenant rebuild lives in `access-control/visibility/bulk-import/route.ts:28`.
- `src/lib/visibility.ts` — only two exports:
  `getVisibleUserIds(viewerUserId, tenantId): Promise<string[]>` (**excludes the viewer**) and
  `canView(viewer, target, tenantId): Promise<boolean>`.

⚠️ **There is no downward/descendant walk anywhere**, and **no raw SQL anywhere in the repo**
(`$queryRaw`/`$executeRaw`: zero hits).

**Today only `/api/orders` honours the scope setting.** See `01-GAP-ANALYSIS.md` for the full
gap table and `02-DATA-MODEL-PLAN.md` for the `cascadeVisibilityUp` re-parenting bug that must
be fixed before the filter is rolled out.

---

## 7. `src/lib` quick reference

| Export | Signature / behaviour |
|---|---|
| `db.prisma` | Lazy `Proxy` — importing during `next build` (no DB) is free. Pool 5, TLS fails closed. |
| `db.serialize<T>(value, model?)` | `Decimal`→number, `@db.Date`→`"YYYY-MM-DD"`, timestamptz→ISO. Returns `unknown`; cast at the call site. **Always pass the model.** |
| `db.dateOnlyString(date)` | Use whenever a date is a `Set` member, object key, or `===`/`<`/`>` operand **server-side**. `serialize()` only fixes the wire. |
| `db.dbErrorMessage(err)` | Thrown Prisma error → the string routes put in `{ error }`. |
| `auth.requireUser()` / `getCurrentUser()` | See §5. |
| `tenant.getTenantId()` | Sync. See §5. |
| `permissions.*` | See §6. |
| `visibility.*` | See §6. |
| `utils.cn(...)` | `clsx` + **extended** `tailwind-merge`. ⚠️ The project type scale (`text-page-title\|section\|card-heading\|body\|label\|meta`) and colours (`text-text-primary\|secondary\|muted`) are registered as class groups here. **Anything added to the type scale in `globals.css` must be added here too**, or `cn()` silently drops the font size. |
| `r2.*` | `isConfigured()`, `putObject(key, body, contentType)`, `getSignedInlineUrl(key, displayName, expires=300)`, `receiptKey(tenantId, photoFile)`. |
| `points.awardPoint(...)` | Fire-and-forget — **always called as `void awardPoint(...)`**, never awaited. |

---

## 8. Known dead code — do not "fix", do not treat failures as regressions

Documented in `PLAN.md` §13 and preserved deliberately:

| § | What |
|---|---|
| 13.1 | `GET /api/masters/users/audit-log` — backing tables `user_login_logs`/`user_audit_logs` were dropped from live. |
| 13.2 | `forgot-password`/`reset-password` only work for `DEFAULT_TENANT_ID`; live has 5 tenants. Fails silently by design (anti-enumeration). |
| 13.3 | `POST /api/masters/designations` — `designations.department_id` is NOT NULL but the route inserts only `{name, tenant_id}`. **"Add Designation" has never worked.** |
| 13.4 | `POST /api/masters/import/products` — one bad row aborts the whole insert → 500, nothing created. |
| 13.5 | `DELETE /api/settings/roles/[id]` guards on `users.profile` but the FK that blocks is `users.role_id` → raw 500 instead of 400. |
| 13.6 | `GET /api/superadmin/companies/[id]/users` selects a dropped column and a dropped table. Its sibling `usage-summary` is **not** dead — do not "fix" them the same way. |

**Additional inconsistencies found in this pass** (not in PLAN.md) are catalogued in
`01-GAP-ANALYSIS.md` §Defects. The headline ones: `POST /api/leads` checks `'edit'` not
`'create'`; `/api/business-partners` has **no permission check at all**;
`PUT /api/leads/[id]` passes the request body **straight into `prisma.update(data: body)`**
(mass assignment); `business_partners.sub_type` is a dead column; `dashboard/stats` counts
prospects as dealers.

---

## 9. Verification — there is no test framework

All in `scripts/`, all invoked via npm:

| Command | What it does | Safe against production? |
|---|---|---|
| `npm run verify:data-layer` | READ-ONLY data-layer checks | yes |
| `npm run smoke` | Read-path suites against a running server | yes (reads only) |
| `npm run audit:tenant -- --batch <name>` | Static + runtime check that every tenant-scoped query carries a `tenant_id` predicate | yes |
| `npm run test:write*` | Write-path suites | **NO** — localhost-only via `SCRATCH_DATABASE_URL`; they refuse a non-localhost host |
| `npm run verify:r2` | R2 round-trip | scratch only |

Run write-path suites and `verify:r2` with `TZ=UTC` — production runs UTC and some date logic is
timezone-sensitive.

⚠️ `npm run audit:tenant` does a **static scan** for tenant predicates. If anyone introduces the
project's first raw SQL, the scan may not recognise it — check `scripts/` first.

---

## 10a. What Phase 1 has already changed — read this before using §1-§9

Six commits landed on branch `rebuild/phase-1` on 18 Sep. **Several statements earlier in this
file are now out of date because of them.** Corrections:

| Commit | What it changed | What in this map is now stale |
|---|---|---|
| `f83feed` | **NEW `src/lib/format.ts`** — `fmtAmount` (₹, Indian grouping, 2dp), `fmtDate` (`DD Mon YYYY`), `fmtDateTime`, `fmtTime`, `fmtQty`, `fmtNumber`, `parseApiDate` | §7's "no formatting module" is fixed. **Use it; never hand-roll `toLocaleString` again.** `orders` and `review` import it |
| `d941eb5` | 7 new tables (`contacts`, `company_contacts`, `company_addresses`, `contact_types`, `industries`, `custom_field_defs`, `custom_field_values`), 6 new `business_partners` columns, `user_visibility.is_manual` | §3's table list is incomplete. Three CHECK constraints were widened — see `02-DATA-MODEL-PLAN.md` §8.1 |
| `5eb6dbd` | `src/lib/visibility.ts` gains **`rebuildVisibility(tenantId)`**; `cascadeVisibilityUp`/`removeAncestorVisibility` **deleted** | §6's description of the cascade is historical. The closure is now recomputed wholesale, and it produces **the chain closure UNION the manual rows** — not the closure |
| `e543077` | **NEW `src/lib/masters-registry.ts`** — `MASTERS`, `MASTER_SECTION_KEYS`, `OPERATION_SECTIONS`, `ALL_SECTIONS` | **§10's "add a master → ~8 files" is WRONG.** It is now **one registry entry** + a screen + a route pair. Nine consumers derive automatically |
| `538388b` | **NEW `scripts/scratch-push.mjs`**; `package.json` repointed | `npm run scratch:push` used to resolve `DATABASE_URL` (**production**) with `--accept-data-loss`. Now guarded |
| `40b142e` | Contact Type + Industry masters (screens, routes, registry entries) | — |

**Three hard-won rules that are not obvious from the code:**

1. **`prisma db push` cannot be run by an agent.** Prisma detects Claude Code and refuses, requiring
   `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` set to the user's literal words. Do not burn
   sessions on it — ask the user.
2. **A master belongs on `CrudPage`, not `templates/list-page.tsx`.** `list-page` has no reorder,
   selection or sort API, and `sort_order` is part of the master shape. A master on `list-page`
   silently loses its ordering.
3. **Never pass `backHref` to `CrudPage`.** It renders a back arrow AGENTS.md §1 rule 11 forbids.
   13 existing master screens still do; use `src/components/ui/breadcrumb.tsx` instead.

---

## 10. Where to look for what

| I need to… | Go to |
|---|---|
| format money, a date or a quantity | **`src/lib/format.ts`** — never hand-roll it |
| add a master | **one entry in `src/lib/masters-registry.ts`** + screen + route pair. See `40b142e` for a worked example |
| recompute who-can-see-whom | `rebuildVisibility(tenantId)` in `src/lib/visibility.ts` |
| add an API endpoint | copy `src/app/api/masters/dealers/route.ts` (§4) |
| change the DB | `prisma/schema.prisma` — generated by `prisma db pull`. `supabase/migrations.sql` is **obsolete** |
| add a date-only column | register it in `src/lib/generated/date-only-fields.ts` via `npm run prisma:sync`, or the wire contract silently changes |
| add a nav item | `src/components/shell/nav.ts` (the registry) + `src/components/ui/Sidebar.tsx` |
| add a master | see `01-GAP-ANALYSIS.md` — the recipe touches ~8 files |
| build a list screen | `src/components/templates/list-page.tsx` |
| show a status | `src/components/status-badge.tsx` — the single status vocabulary |
| show a toast | `useToast()` from `src/contexts/ToastContext.tsx` |
| know who is logged in (client) | `useMe()` from `src/hooks/useMe.ts` — **no `userId` on it** |
| understand why the data layer looks like this | `PLAN.md` (78 KB, the Supabase→Prisma migration) |
| understand tonight's UI conversion | `overnight-queue-2026-09-18.md` + `rgb-kit-v2/AGENTS.md` |
