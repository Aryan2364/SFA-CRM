# One user, many firms — current-state audit and design proposal

**Status:** design document. No application code was written or changed for this report.
**Date:** 2026-09-24
**Scope:** how identity and tenancy work in RGB SFA today, and what it would take to let one
human hold accounts in several firms (tenants) behind a single login with an in-app firm
switcher.

---

## Executive summary

Tenancy in this codebase is **carried entirely by the signed session cookie**. There is no
tenant header, no tenant in the URL, and no per-request tenant negotiation:
`getTenantId()` (`src/lib/tenant.ts:26-40`) reads `tenantId` out of the HMAC-verified JWT payload
and returns it, and ~139 files call it. Change what is in the cookie and the whole application
follows. That is the good news: the switcher is a *session* feature, not a 148-route rewrite.

The bad news is the identity model underneath it. `users` is unique on
**`(tenant_id, contact)`** — `prisma/schema.prisma:405` — so phone numbers are unique *per firm*,
not globally. One human in two firms is already two unrelated rows with two passwords. But login
(`src/app/api/auth/login/route.ts:90-105`) looks a user up by `contact` with **no tenant filter**,
`findFirst` ordered by `created_at` ascending. The consequence is concrete and live today:

> **If the same phone number exists in two tenants, that human can only ever log into the
> oldest of the two rows. The newer account's password silently never works** — the response is
> the generic `401 Invalid phone or password` (line 28), indistinguishable from a typo.

The code even states the opposite invariant in a comment: `src/app/api/superadmin/companies/route.ts:57-59`
says "phone numbers are globally unique for login". Nothing enforces that. The database permits
the duplicate, the SuperAdmin create-company route checks for it by hand, and the tenant-admin
user-create route (`src/app/api/masters/users/route.ts:113-121`) does not — it only catches the
per-tenant unique violation. So the duplicate can be created through the normal UI.

**Recommendation: a `user_tenant_memberships` table with a single global identity row per human**
(Approach B below), phased so that phase 1 — an `active_tenant_id` claim plus a DB-backed
membership check — ships without touching a single one of the 148 route handlers.

---

# Part A — Current-state audit

## A1. Middleware does not inject a tenant, and must not

`src/middleware.ts` does exactly one thing: redirect requests that carry no session cookie
(`src/middleware.ts:34-78`). It **cannot verify the session** — the file's own header comment
(`src/middleware.ts:4-13`) records that a self-hosted `next start` does not inject
`SESSION_SECRET` into the edge sandbox, so `verifySession()` threw, was swallowed to `null`, and
redirected every valid login back to `/login`.

Two explicit prohibitions live here and both matter for this design:

- `src/middleware.ts:25-27` — **do not reintroduce an `x-tenant-id` request header.** Setting it
  from an unverified payload would let anyone forge a cookie naming another tenant. Note that
  CLAUDE.md still describes middleware as injecting `x-tenant-id`; **that documentation is stale**
  and the code is the truth.
- `src/lib/tenant.ts:9-21` — the matching note on the consuming side, adding that a header
  middleware does not set is a header a *client* can send, and that on PUBLIC routes middleware
  returns `next()` without stripping request headers, so trusting it was reachable from outside.

SuperAdmin paths are gated on cookie *presence* only (`src/middleware.ts:52-68`); the real role
check is per-route.

## A2. Where the tenant actually comes from

`src/lib/tenant.ts:26-40`:

```
export function getTenantId(): string {
  const token = cookies().get(COOKIE_NAME)?.value
  if (token) {
    const payload = verifySessionSync(token)
    const tenantId = (payload as { tenantId?: string } | null)?.tenantId
    if (tenantId) return tenantId
  }
  const id = process.env.DEFAULT_TENANT_ID
  ...
}
```

So: **tenant is derived from the token**, with an `DEFAULT_TENANT_ID` env fallback for sessionless
callers. It is synchronous on purpose — the comment at `src/lib/tenant.ts:23-25` notes 158 call
sites that would all have to become async otherwise. **Any multi-firm design must keep
`getTenantId()` synchronous**, or accept a ~139-file change.

The `DEFAULT_TENANT_ID` fallback is a known product bug, not a feature: `PLAN.md` §13.2 records
that it is why **password reset only works for `DEFAULT_TENANT_ID`**. Confirmed in code —
`src/app/api/auth/forgot-password/route.ts:11-14` scopes the user lookup by `tenant_id: tid`,
where `tid` can only be the env default because the caller has no session. A multi-firm world
makes this worse, not better (see Risk R3).

## A3. JWT claim shape and role re-resolution

Token format (`src/lib/session-node.ts:23`): `base64(JSON.stringify(payload)) + "." +
base64url(HMAC-SHA256(secret, base64payload))`. It is **signed, not encrypted** — the payload is
readable by anyone holding the cookie, and `src/lib/tenant.ts:12-14` calls this out explicitly.
There is **no `exp` claim**; expiry is enforced only by the cookie's `maxAge` of 8 hours
(`src/app/api/auth/login/route.ts:77`).

The claim set is minted in exactly two places and typed once:

| Claim | Type | Source |
|---|---|---|
| `phone` | string | `users.contact` |
| `userId` | string \| null | `users.id` (`null` for SuperAdmin) |
| `name` | string | `users.name` |
| `role` | string | effective role name |
| `tenantId` | string | `users.tenant_id`, or `DEFAULT_TENANT_ID` |
| `cv` | number | `users.credentials_version` |

Type: `SessionUser` at `src/lib/auth.ts:5-12`. Minted at `src/app/api/auth/login/route.ts:64-71`
and `src/app/api/superadmin/auth/login/route.ts:19-25` (the latter with `userId: null`,
`role: 'SuperAdmin'`, `tenantId: ''`).

`getCurrentUser()` (`src/lib/auth.ts:14-21`) verifies and returns the payload **as-is** — it is a
pure cookie read, no database.

`requireUser()` (`src/lib/auth.ts:23-56`) re-resolves the role from the database by primary key:
`profile === 'Administrator'` → `'Administrator'`; `status === 'Inactive'` → `'Deactivated'`;
otherwise `roles.name` or `'NoRole'`. On a DB failure it **falls back to the session role**
(`src/lib/auth.ts:50-52`).

**The gap that matters for this project:** `requireUser()` looks the user up by `id` alone
(`src/lib/auth.ts:33-40`) and never compares `users.tenant_id` against `user.tenantId` from the
cookie. Today that is safe because both claims were minted together from one row. The moment a
switcher lets `tenantId` change independently of `userId`, **nothing in the request path notices
a mismatched pair.** This is the single hinge of the whole design (see B4).

## A4. Permissions and data scope

`checkPermission()` (`src/lib/permissions.ts:33-57`) and `getDataScope()`
(`src/lib/permissions.ts:59-76`) both do:

```
const tid = getTenantId()
prisma.role_permissions.findUnique({
  where: { tenant_id_profile_section: { tenant_id: tid, profile: user.role, section } },
})
```

`role_permissions` is unique on `(tenant_id, profile, section)` — `prisma/schema.prisma:269` —
and `profile` here is the **role name string**, not an id. `roles` is itself tenant-scoped
(`prisma/schema.prisma:273-278`).

This is structurally good news: **permissions are already looked up per tenant.** A user who is
`Manager` in Firm A and `Sales Rep` in Firm B needs no change to these two functions *provided
`user.role` is re-resolved per active firm* rather than carried from login. Today it is not —
`requireUser()` resolves it from the single `users` row, which only exists in one tenant.

`Administrator` short-circuits both functions before any tenant lookup
(`src/lib/permissions.ts:38`, `:63`). An `Administrator` claim is therefore tenant-blind at the
permission layer; only the `tenant_id` filters in the routes keep it contained.

Scope composition lives in `src/lib/scope.ts`: `scopedUserIds()` (`src/lib/scope.ts:21-31`) turns
`'own' | 'team' | 'all'` into a user-id list, using `getVisibleUserIds(user.userId, user.tenantId)`
— note it passes the **session tenant**, and `rebuildVisibility()` (`src/lib/visibility.ts:21-25`)
only ever loads one tenant's users, so a manager chain cannot walk across firms. That containment
survives a firm switch as long as `user.tenantId` is correct.

## A5. Login and the uniqueness constraint — the primary finding

`prisma/schema.prisma:405`:

```
@@unique([tenant_id, contact], map: "users_tenant_contact")
```

- `contact` (phone, the login identifier) is unique **per tenant**.
- `email` has **no unique constraint at all** — not globally, not per tenant.
- There is no `users.id`-independent notion of a person.

Login (`src/app/api/auth/login/route.ts:90-105`) is deliberately cross-tenant and derives the
tenant *from* the matched row (`:69`). It is on the tenant-scope allowlist with that reason —
`scripts/tenant-scope-allowlist.json`, entry `login-lookup-by-contact`.

The allowlist's stated justification is: *"a wrong match cannot leak another tenant's data; it
would simply fail the password check."* That is true for confidentiality and false for
availability — a wrong match is precisely how the second-firm account becomes unreachable.

Two routes disagree about the invariant:

- `src/app/api/superadmin/companies/route.ts:57-62` checks `contact` **globally** before creating a
  company admin, with the comment "phone numbers are globally unique for login".
- `src/app/api/masters/users/route.ts:113-121` (tenant admin creating a user) catches only the
  `users_tenant_contact` unique violation and answers *"Number already registered"*. A phone
  already used in a **different** tenant passes straight through and the row is created.

**So the duplicate-human state is reachable through the normal admin UI today, and the human it
belongs to is then locked out of whichever account is newer.** How many real humans are in this
state is an open question (Part C, Q1) — it cannot be answered without reading the production
database, which is out of scope for this report by standing rule.

## A6. How `tenant_id` filtering reaches the 148 routes

There is **no shared query helper**. Every route hand-rolls `where: { tenant_id: tid, ... }` after
calling `getTenantId()`. Measured:

- 148 `route.ts` files under `src/app/api`
- 139 files import/call `getTenantId`
- 484 textual occurrences of `tenant_id` under `src/app/api`

The 21 route files with no `getTenantId` call are: the 7 SuperAdmin routes (deliberately
cross-tenant), `auth/login` and `auth/logout` (pre-session), `daily-activity/reverse-geocode` (no
DB), and the `companies` / `contacts` / `deals` families plus `masters/users/audit-log` and
`reports/meta`, which delegate to shared `_handlers.ts` modules — e.g.
`src/app/api/companies/route.ts:10` is a bare `export { GET, POST } from './_handlers'`.

The safety net is **`scripts/audit-tenant-scope.mjs`**, which checks statically and at runtime
that every query touching a tenant-scoped table carries a `tenant_id` predicate, against
`scripts/tenant-scope-allowlist.json`. That allowlist is the single most valuable asset for this
project: it is a written, reasoned enumeration of every place the tenant filter is legitimately
absent. Any multi-firm work must extend it, never bypass it.

`src/lib/db.ts` itself is tenancy-agnostic — it is the Prisma singleton behind a lazy Proxy
(`src/lib/db.ts:214-221`), plus `serialize()` and `dateOnlyString()`. **No Prisma middleware,
no `$extends`, no global `where` injection.** Nothing today would stop a route that forgot the
filter; only the audit script would.

## A7. SuperAdmin — the existing cross-tenant precedent

SuperAdmin authenticates against `SUPER_ADMIN_PHONE` / `SUPER_ADMIN_PASSWORD` env vars, **not the
database** (`src/app/api/superadmin/auth/login/route.ts:8-17`), and mints a token with
`userId: null`, `role: 'SuperAdmin'`, `tenantId: ''` (`:19-25`). Each route re-checks the role
itself — `requireSuperAdmin()` at `src/app/api/superadmin/companies/route.ts:6-10`.

It is only a *partial* precedent. It shows the codebase can tolerate a session whose `tenantId` is
not a real tenant, and that per-route re-checking is the accepted pattern. It shows nothing about
membership, because SuperAdmin's authority is unconditional and env-derived. It also sets a
pattern worth **not** copying: `tenantId: ''` means `getTenantId()` falls through to
`DEFAULT_TENANT_ID` for any SuperAdmin request that reaches a tenant-scoped helper. That is a
latent hazard, and a firm switcher must never mint an empty or absent `tenantId`.

## A8. Where single-tenant assumptions are baked in hardest

Ranked by how much they resist change:

1. **`SessionUser` is a flat one-tenant record** (`src/lib/auth.ts:5-12`). `tenantId` and `role`
   are siblings with no expressed relationship. Every downstream helper takes `user` and reads
   both. *Hardest, and the thing to change first.*
2. **`getTenantId()` is synchronous and called from ~139 files** (`src/lib/tenant.ts:26`). A
   membership check cannot go inside it without an async conversion of the whole tree. The
   membership check therefore has to live in `requireUser()`, which is already async.
3. **Role is resolved once, from one row** (`src/lib/auth.ts:33-48`). Per-firm roles require this
   lookup to become `(user, active_tenant)`-keyed.
4. **`/api/auth/me` builds one tenant's whole permission map** (`src/app/api/auth/me/route.ts:60-77`)
   and returns a single `tenantName` (`:40-41`). It is the only tenant-identity fact the client
   ever receives.
5. **Client cache: `useMe` holds a module-level `let _cache`** (`src/hooks/useMe.ts:20`) that
   survives all client-side navigation. A firm switch **must** call the existing
   `invalidateMeCache()` (`src/hooks/useMe.ts:22-24`) *and* hard-reload, or the user sees Firm B's
   data under Firm A's permission map. This is the most likely source of a "filed the order
   against the wrong firm" incident.
6. **The tenant name is rendered as static chrome**, not a control:
   `src/components/shell/sidebar.tsx:72` and `src/components/ui/Sidebar.tsx:223` print
   `me?.tenantName` as a small muted subtitle under "RGB SFA". That is where the switcher goes —
   and `text-text-muted` / `text-green-300` on a dark panel is nowhere near enough contrast for a
   value that now determines which firm you are writing to.
7. **R2 object keys are tenant-prefixed and server-derived** —
   `receiptKey()` = `receipts/{tenantId}/{file}` (`src/lib/r2.ts:119-121`), `dealKey()` =
   `deals/{tenantId}/{file}` (`src/lib/r2.ts:135-137`). The read path rebuilds the key from the
   **session** tenant and a validated filename (`src/app/api/expenses/photo/[id]/route.ts:36, :63`).
   **This is the one layer that needs no change at all** — it inherits correctness from the
   session tenant. Existing objects stay where they are; a merged identity does not move a byte.
8. **`useCrud` / `CrudPage` are tenant-blind.** They issue relative `fetch` calls and read whatever
   the cookie implies. No change needed beyond cache invalidation on switch.
9. **`credentials_version` (`cv`)** is per-`users`-row (`prisma/schema.prisma:380`,
   checked at `src/app/api/auth/me/route.ts:30-38`). With N rows per human it is N counters; with
   one identity row it becomes one — which is *better*, but it changes the blast radius of a
   password change from one firm to all of them. Worth stating to the customer, not hiding.

---

# Part B — Design proposal

## B1. Approach A — Duplicate logins (status quo, made honest)

Keep N `users` rows. Fix only the bugs: make `contact` globally unique, and have login
disambiguate when a phone matches more than one row (ask "which firm?" before the password check,
or after it against each candidate).

- **Touches:** `src/app/api/auth/login/route.ts`, `src/app/api/masters/users/route.ts`, the login
  page, one migration adding a global unique index on `users.contact`.
- **Pros:** smallest change; zero risk to the tenant-filter invariant, because nothing about
  sessions or scoping changes. Fixes the live lockout bug (A5) on its own.
- **Cons:** not the requested feature. Switching firms means logging out and back in. N passwords
  to keep in sync, N `credentials_version` counters, N password resets. The global unique index
  **cannot be added until existing duplicates are resolved**, and resolving them means telling a
  real human their phone number now belongs to one firm only.
- **Effort:** ~2–3 dev-days, plus unknown data-cleanup time.

## B2. Approach B — Membership table (recommended)

One global identity, plus an explicit membership row per firm.

```
people                      -- global identity (or: reuse users, see B2.1)
  id, contact (UNIQUE), email, name, password, credentials_version, status

user_tenant_memberships
  id, person_id, tenant_id, user_id, profile, role_id, status
  UNIQUE (person_id, tenant_id)
  UNIQUE (user_id)
```

Critically, **`users` rows stay exactly where they are, one per (person, firm).** The membership
row points at the existing `users.id`. Every historical `visits`/`orders`/`expenses`/`weekly_plans`
row references `user_id` and `tenant_id` and is **never touched**. That is what makes this
migratable without downtime.

Session becomes:

```
{ personId, activeTenantId, userId, name, phone, role, cv }
```

`userId`, `role` and `tenantId` keep their current meanings and shapes — they are now *derived
per active firm* rather than fixed at login. **`getTenantId()` does not change at all**: it still
reads `tenantId` from the verified payload. That is the property that keeps this from becoming a
139-file change.

- **Pros:** correct model; per-firm role falls out for free because `role_permissions` is already
  keyed by `(tenant_id, profile, section)`; one password, one reset, one identity; the switcher is
  a re-mint of the cookie. Invites/offboarding become row-level operations.
- **Cons:** two new tables and a real migration; `requireUser()` grows a mandatory DB check;
  password reset has to be rethought (it is already broken — A2); a bug in the membership check is
  a cross-firm data leak.
- **Effort:** ~8–12 dev-days end to end, but **phaseable** (B5). Touches:
  `prisma/schema.prisma`, `src/lib/auth.ts`, `src/lib/session.ts` (payload type only),
  `src/app/api/auth/login/route.ts`, a new `src/app/api/auth/switch-tenant/route.ts`,
  `src/app/api/auth/me/route.ts`, `src/hooks/useMe.ts`, both Sidebar components,
  `src/app/api/auth/forgot-password|reset-password`, `src/app/api/masters/users/route.ts`,
  `scripts/tenant-scope-allowlist.json`.

### B2.1 Variant — skip the `people` table

Elect one existing `users` row per human as the "primary" and put `primary_user_id` on the
membership table instead of introducing `people`. Saves a table and a migration step; costs
clarity (the identity row is also a tenant row, so deactivating that firm's account deactivates
the login). **Not recommended** — the ambiguity is exactly the kind that produces a silent
authorisation bug.

## B3. Approach C — Linked accounts (`person_id` on `users`)

Add a nullable `person_id` to `users`; rows sharing a `person_id` are the same human. Switching
firms means finding the sibling row and re-minting the cookie from it.

- **Pros:** one nullable column, no new tables; existing rows keep working untouched
  (`person_id IS NULL` = unlinked, behaves exactly as today); trivially reversible.
- **Cons:** passwords stay per-row and can diverge; `status` is per-row, so "is this human
  active?" has no single answer; the membership check becomes a self-join on a nullable column,
  which is a weaker thing to build an authorisation boundary on. And a `NULL` `person_id`
  must never match another `NULL` — one careless `WHERE a.person_id = b.person_id` with SQL's
  NULL semantics is an accident waiting to happen, though in the right direction (no match).
- **Effort:** ~5–7 dev-days.

## B4. Recommendation: Approach B, and the security rule it turns on

**Recommend Approach B (membership table).**

The deciding argument is not elegance — it is that `role_permissions` is *already* keyed by
`(tenant_id, profile, section)` (`prisma/schema.prisma:269`), and `checkPermission` /
`getDataScope` *already* read the tenant from the session. **The permission layer is already
multi-firm.** What is missing is only an authoritative answer to "may this person act as this firm
right now, and as what role", and that is precisely one membership row. Approach C answers the
same question with a self-join on a nullable column; Approach A does not answer it at all.

### The one non-negotiable rule

> `active_tenant_id` in the cookie is a **claim, not a grant.** Every request must confirm it
> against `user_tenant_memberships` in the database, in the same place and for the same reason
> that `requireUser()` already re-resolves the role.

Concretely, `requireUser()` (`src/lib/auth.ts:23-56`) becomes a single query keyed on
`(person_id, active_tenant_id)`, and:

- **No membership row → throw.** Not "fall back to the first membership", not "fall back to the
  session role". Failing closed is the only acceptable behaviour, because the fallback branch is
  the one nobody tests.
- The resolved `user_id`, `role` and `profile` come **from the membership row**, never from the
  cookie. The cookie's copies become a display cache and must be treated as untrusted.
- **The existing `catch` that falls back to the session role (`src/lib/auth.ts:50-52`) must not be
  extended to cover the membership query.** Today that fallback is benign — the worst case is a
  stale role inside a tenant the user definitely belongs to. With a switcher it would mean a
  database blip grants access to whatever firm the cookie names. Keep the role-refresh fallback if
  you like; the membership check throws.

Note that a forged `active_tenant_id` requires `SESSION_SECRET`, since the payload is HMAC-signed
(`src/lib/session-node.ts:46-50`). The membership check is therefore defence against *our own
bugs* — a switch endpoint that skips validation, a stale cookie after a membership is revoked —
which is the likelier failure, not against an outside forger.

### Switching firms

`POST /api/auth/switch-tenant { tenantId }`:

1. `getCurrentUser()` → `personId`.
2. Look up the membership for `(personId, tenantId)`; require `status = 'Active'`.
3. Re-check tenant health — `is_active` and `payment_status !== 'Suspended'`, the same gate login
   already applies at `src/app/api/auth/login/route.ts:41-55`. **Reuse it, don't re-type it**, or
   the switcher becomes a way into a suspended firm.
4. Re-mint the cookie with the same `maxAge` and flags as login
   (`src/app/api/auth/login/route.ts:77`) — do not silently extend the session by switching.
5. Respond `{ ok: true }`; the client calls `invalidateMeCache()` (`src/hooks/useMe.ts:22`) and
   **hard-navigates to the dashboard** rather than staying on the current screen. Staying put is
   the wrong-firm-order bug: a half-filled order form surviving a firm switch is a loaded gun.

### Per-firm roles

No change to `checkPermission` or `getDataScope`. `user.role` arrives already resolved for the
active firm, and the lookup key `(tenant_id = getTenantId(), profile = user.role, section)` is
correct by construction. `Administrator` remains a short-circuit — meaning a person can be an
Administrator of Firm A and a Sales Rep in Firm B, which is the desired behaviour, but also means
**the `Administrator` short-circuit is now reachable under a tenant the cookie chose.** That is
the single line of code the membership check exists to protect.

`user_visibility` and `scopedUserIds()` need no change: `getVisibleUserIds(user.userId,
user.tenantId)` (`src/lib/scope.ts:30`) receives the per-firm `user_id`, and
`rebuildVisibility()` only ever loads one tenant (`src/lib/visibility.ts:22-24`).

### Blast radius

CLAUDE.md is explicit that a dropped `tenant_id` filter leaks data across tenants **with nothing
crashing**. Today the exposure requires a *coding* mistake in one route. After a switcher it can
also come from a *session* mistake — one wrong `active_tenant_id` exposes every tenant-scoped
table at once, through 139 routes that are each individually correct. The mitigations:

- Fail closed in `requireUser()` (above).
- Extend `scripts/tenant-scope-allowlist.json` with the new membership queries, each with its
  written reason, and run `npm run audit:tenant` on the batch. **Never add a broad pattern for
  `user_tenant_memberships` to silence the audit** — the file's own preamble forbids exactly that.
- Add a write-path suite case: switch to Firm B, then assert a Firm A row is invisible *and*
  un-writable. Run with `TZ=UTC` against `SCRATCH_DATABASE_URL`, per CLAUDE.md.
- Consider a Prisma `$extends` guard that asserts a `tenant_id` predicate on tenant-scoped models
  at runtime. Attractive, but it is a large change to `src/lib/db.ts` and out of scope here; note
  it and decide separately.

## B5. Migration path (zero downtime)

Each phase is independently shippable and independently revertible.

**Phase 0 — measure (no code).** Ask the database, via a read-only query on a replica or with the
customer's own reporting, how many `contact` values appear in more than one tenant, and how many
of those pairs are genuinely the same human. Nothing else starts until this number is known.

**Phase 1 — additive schema.** Create `people` and `user_tenant_memberships`. Backfill one
`people` row per distinct human and one membership per existing `users` row. Nothing reads them
yet. `users` is unchanged; every existing session keeps working. Note that `prisma db push` is
blocked for AI agents in this repo — a human runs the migration.

**Phase 2 — dual-read login.** Login resolves through `people` when a membership exists and falls
back to today's `findFirst` otherwise. Token gains `personId` and `activeTenantId` **alongside**
the existing claims, all of which keep their current names and meanings — so old cookies stay
valid for their remaining 8 hours and no route changes. `requireUser()` enforces membership *only
when `personId` is present*, so the check cannot break a legacy session.

**Phase 3 — switcher.** Add `/api/auth/switch-tenant` and the UI. This is the first
user-visible change. At this point a person with one membership sees no switcher at all.

**Phase 4 — duplicate merge.** Per-human, with the customer's confirmation: point all their
memberships at one `people` row, choose one password, retire the others' credentials. **No
historical row moves.** Visits, orders, expenses and weekly plans stay bound to their original
`user_id` and `tenant_id` forever; only the login in front of them is unified. This is the phase
that needs a human conversation per affected person, which is why Phase 0 comes first.

**Phase 5 — enforce.** Drop the legacy login fallback; add the global unique index on
`people.contact`; fix `src/app/api/masters/users/route.ts` to reject a phone already claimed by a
different person; repoint forgot-password at `people` (which incidentally fixes the
`DEFAULT_TENANT_ID` bug of PLAN.md §13.2).

## B6. UX for the switcher

Per the global UI rules:

- **Location:** replace the static tenant subtitle in the sidebar header
  (`src/components/shell/sidebar.tsx:66-75`, `src/components/ui/Sidebar.tsx:223`) with a real
  control — same slot, now a button with a chevron. The sidebar header is already pinned, so the
  active firm is on screen at all times and the switcher is never scrolled away.
- **Make the active firm unmistakable.** Today it is `text-text-muted` / `text-green-300` — muted
  small type, which fails the squint test for a value that now decides which firm an order is
  filed against. Promote it: full-contrast text, and if the person has more than one membership,
  a persistent firm-colour accent or chip that is visible on every screen, not only the sidebar.
  Consider echoing the firm name in the header of any *create* form.
- **One firm → no control.** If the person has a single membership, render exactly what renders
  today — plain text, no chevron, no menu. Permission-aware means membership-aware here: never
  show a firm the person is not a member of, and derive the list from the membership rows the
  server returns, never from a client-side list of tenants.
- **Switching is a styled in-app dialog or popover portalled to `<body>`**, never `confirm()`.
  If there is unsaved form state, confirm in that dialog — "You have unsaved changes in this form.
  Switching to <Firm> will discard them." — with an explicit Cancel.
- **Animate** the menu open/close at ~200–300ms, and show a clear loading state during the
  re-mint. **No dead ends:** if the switch fails (membership revoked, firm suspended), show the
  reason inline with a way back to the current firm — never a blank screen or a raw error overlay.
- **Mobile:** the switcher becomes a full-width sheet; targets ≥44px.
- **`/api/auth/me` returns the membership list** (`{ tenantId, tenantName, role }[]`) so the menu
  can render role per firm. That is also the natural place to make the client aware it is
  multi-firm at all.

## B7. Effort summary

| Approach | Rough dev-days | Delivers the feature? | Principal risk |
|---|---|---|---|
| A — duplicate logins | 2–3 (+ data cleanup) | No | Doesn't solve it; still needs the duplicate merge |
| B — membership table | 8–12, phaseable | Yes | A missed membership check = cross-firm leak |
| C — linked accounts | 5–7 | Yes, partially | Divergent passwords/status; weaker auth boundary |

---

# Part C — Open questions for the human

1. **How many real humans currently hold accounts in more than one firm?** Unanswerable from code
   — it needs a query against production, which this report deliberately did not run. Until it is
   known, the size of Phase 4 is unknown. This is the single blocking question.
2. **Are any of those duplicates currently locked out?** Per A5, anyone with the same phone in two
   tenants can only log into the older row. If such people exist, they have been failing to log in
   and being told "Invalid phone or password". Worth checking support tickets before the schema work.
3. **Is it acceptable for one password to unlock all of a person's firms?** Approach B implies yes.
   If a customer requires per-firm credentials for audit reasons, that is Approach C, not B.
4. **Should a person be able to be an Administrator in one firm and a regular user in another?**
   The design assumes yes. Confirm — it means an Administrator claim is scoped to the active firm
   only, and the `Administrator` short-circuit at `src/lib/permissions.ts:38` is load-bearing.
5. **What is the intended `DEFAULT_TENANT_ID` behaviour after this?** Password reset is currently
   broken for every non-default tenant (PLAN.md §13.2). Phase 5 fixes it as a side effect — is
   that in scope and wanted, or a separate ticket?
6. **What should happen to an in-progress session when a membership is revoked?** The membership
   check catches it on the next request and throws. Should that be a redirect to the firm picker,
   a forced logout, or a silent fall-back to another membership? (Recommendation: firm picker;
   never a silent fall-back.)
7. **Does `credentials_version` unify?** With one identity, a password change invalidates sessions
   across all the person's firms at once. Correct, but a behaviour change worth stating.
8. **Does the SuperAdmin console need to see and manage memberships?** It currently manages
   tenant admins per company (`/api/superadmin/companies/[id]/admins/...`). Memberships would
   change what that screen means.

---

## Appendix — files read for this audit

`src/middleware.ts`, `src/lib/session.ts`, `src/lib/session-node.ts`, `src/lib/tenant.ts`,
`src/lib/auth.ts`, `src/lib/permissions.ts`, `src/lib/db.ts`, `src/lib/scope.ts`,
`src/lib/visibility.ts`, `src/lib/r2.ts`, `src/hooks/useMe.ts`,
`src/components/shell/sidebar.tsx`, `src/components/ui/Sidebar.tsx`,
`src/app/api/auth/{login,logout,me,forgot-password}/route.ts`,
`src/app/api/superadmin/auth/login/route.ts`, `src/app/api/superadmin/companies/route.ts`,
`src/app/api/masters/users/route.ts`, `src/app/api/companies/route.ts`,
`src/app/api/expenses/photo/[id]/route.ts`, `prisma/schema.prisma`,
`scripts/tenant-scope-allowlist.json`, `CLAUDE.md`, `PLAN.md` (§8.2, §13.1, §13.2 references).

No database was contacted. No application file was modified.
