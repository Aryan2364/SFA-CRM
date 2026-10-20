# V2E multi-organization model — research extract

*Read-only study of `D:\RGB_Software\v2e` performed 24 September 2026. No file in that
repository was modified, no server, script, seed or migration was run, and no database was
contacted. Every factual claim carries a `file:line` citation; anything inferred rather than
confirmed is labelled **(inferred)**.*

---

## Executive summary

V2E's multi-org capability is deliberately small. **One `User` row is a single global login;
`OrganizationMember` is a plain join table (user × org) carrying only `is_admin`, `is_active`
and `joined_at`; and the *active* organization lives in the access-token JWT as a single
`organizationId` claim.** Every org-scoped route is `/api/v1/org/:orgId/...`, and one guard —
`OrgScopeGuard` — asserts `token.organizationId === :orgId` (`backend/src/common/guards/org-scope.guard.ts:52`).
Switching orgs is not a client-side state change: the client POSTs `/auth/switch-org`, the
server re-verifies membership against the database and **mints a brand-new access + refresh
token pair** (`backend/src/auth/auth.service.ts:128-144`). There is no per-request org header,
no org in the URL host, and no way to act in two orgs at once.

Two of the models the brief named do not mean what their names suggest:

- **`OrgIdentity` is not a user identity.** It is the organization's *vision / mission /
  purpose / values* — a 1:1 content record hanging off `Organization`
  (`backend/prisma/schema.prisma:292-305`). It has nothing to do with multi-org membership and
  has no bearing on the target product's design.
- **`OrganizationGroup` is a super-admin-only bookkeeping parent** (a holding company owning
  several firms), `backend/prisma/schema.prisma:128-138`. Group membership grants **zero**
  access: its controller is `@SuperAdmin()`-only (`backend/src/groups/groups.controller.ts:12-14`),
  and no permission or scope check anywhere reads `group_id`. Its single functional role is
  `getGroupUsers` (`backend/src/groups/groups.service.ts:101-123`), which lists people already
  in the group's orgs so an admin can pick an existing person when creating another firm —
  i.e. it is the *convenience path that produces multi-org users*, not an access path.

Per-org roles work: the access bundle is `SystemRole`, which is org-scoped
(`schema.prisma:3096-3117`) and attached per-org through `EmployeeProfile`, which is unique on
`(organization_id, user_id)` (`schema.prisma:409`). The same human is therefore an
Administrator in firm A and a read-only member in firm B with no conflict, because the JWT
strategy re-resolves the profile, system role and admin flag *for the token's org* on every
single request (`backend/src/auth/strategies/jwt.strategy.ts:37-63`).

Query scoping is **entirely hand-written**. There is no Prisma middleware, no client extension
and no repository layer — `PrismaService` is a bare `PrismaClient` subclass
(`backend/src/prisma/prisma.service.ts:1-25`). Every `where` must carry `organization_id`
by convention, backed only by a written standard (`backend/AUTHORIZATION.md`). The July 2026
audit found **14 Critical and 6 High** findings against that convention, most of them
cross-tenant (`SECURITY_AUDIT.md:39`). That is the single most important lesson in this
document.

---

## 1. The data model

### 1.1 `User` — the login identity (global, not per-org)

`backend/prisma/schema.prisma:206-276`.

| field | note |
|---|---|
| `id` | uuid PK |
| `name` | |
| `email` | `String?`, `@@unique([email])` (`:271`) |
| `country_code` + `phone` | `String?` each; `@@unique([country_code, phone])` (`:275`) |
| `password_hash` | one password per human, globally |
| `is_super_admin` | vendor-level flag, not org-level |
| `is_active` | global account kill switch |
| `refresh_token`, `refresh_token_prev`, `refresh_token_prev_exp` | sha256 hashes + a 60s rotation grace window (`auth.service.ts:332-340`) |
| `google_refresh_token` | AES-256-GCM encrypted; explicitly "global to the user (not per-org)" (`schema.prisma:224-227`) |

**The login identifier is GLOBALLY unique, not per-org.** A user signs in with *either* email
*or* the `(country_code, phone)` pair; at least one must be present, enforced in the service
rather than the database (`schema.prisma:208-217`, `users.service.ts:99-102`). The phone is
deliberately split so the same ten digits under `+91` and `+971` are two different people
(`schema.prisma:212-215`).

This is the load-bearing design decision of the whole model: **one human = one row = one
password across every organization they belong to.** V2E hit the consequences head-on and
documented them — see §6.

### 1.2 `OrganizationMember` — the join, and almost nothing else

`backend/prisma/schema.prisma:190-204`:

```prisma
model OrganizationMember {
  id              String   @id @default(uuid())
  organization_id String
  user_id         String
  is_admin        Boolean  @default(false) // platform-admin flag — governs admin leaves ONLY, never feature access
  is_active       Boolean  @default(true)
  joined_at       DateTime @default(now())
  @@unique([organization_id, user_id])
  @@index([organization_id, is_active])
}
```

That is the entire payload. Notably **absent**: any role or permission column (those live on
`EmployeeProfile` → `SystemRole`), any invite state, any `left_at`, any `invited_by`, any
per-membership status enum. There is no invitation flow at all — an admin creates the person
directly (`employees.service.ts:202-265`).

The real per-org profile is a **separate** model, `EmployeeProfile`
(`schema.prisma:380-413`), unique on `(organization_id, user_id)` (`:409`), carrying
`role_id` (job title), `system_role_id` (the access bundle), `department_id`,
`reporting_to_user_id`, `employee_code`, joining/birth dates, `employment_type` and a
`status` of `active|inactive`. So a membership and a profile are two different rows that can
disagree — a genuine wart **(inferred: nothing reconciles them; `employees.service.ts:219-227`
treats "already has a profile" and "already a member" as independent conditions)**.

### 1.3 Soft delete / deactivation

Three independent switches, at three levels:

1. `User.is_active` — global. Refused at login (`auth.service.ts:77`) and on every request
   (`jwt.strategy.ts:25`). Kills the person everywhere.
2. `OrganizationMember.is_active` — per-org. Set false by
   `users.service.deactivate` (`users.service.ts:146-149`), which refuses to deactivate the
   org's *primary* administrator (oldest `is_admin` membership, `users.service.ts:136-143`).
3. `Organization.status` (`OrgStatus` = `active | inactive | pending_setup`,
   `schema.prisma:9-13`) — the whole firm.

**A user removed from org A but still in org B keeps working in B, with no interruption.**
Login filters memberships to `is_active: true` (`auth.service.ts:82-83`); `getMyOrgs` does the
same (`auth.service.ts:152-158`); `switchOrg` refuses an inactive membership
(`auth.service.ts:130-133`). There is **no hard delete** of a membership anywhere in the
codebase (the only `organizationMember` writes are `create` in
`employees.service.ts:261`, `employee-import.service.ts:172`, `organizations.service.ts:316`,
and `update`/`updateMany` in `users.service.ts:120,146`). Their rows are kept so a firm can be
switched back on without re-provisioning anyone — stated explicitly in the deactivation commit
(`git show 198855b`).

One important asymmetry, and a bug they fixed: deactivating an *org* deliberately leaves both
`is_active` flags intact, so for a long time nothing actually locked anyone out. The fix
routes `Organization.status` through **every** point that mints, refreshes or accepts a
session, with the rule centralised in `backend/src/common/org-status.util.ts`:
login/switchOrg/getMyOrgs filter it out (`auth.service.ts:93-100, 139-140, 156`), refresh
refuses it (`auth.service.ts:196-199`), `JwtStrategy` checks it per request so
already-minted access tokens die immediately (`jwt.strategy.ts:56-58`), and the WebSocket
handshake is refused. Super admins are exempt throughout so support can still enter.

### 1.4 `OrganizationGroup`

`backend/prisma/schema.prisma:128-138`: `id`, `name`, `slug @unique`, `description`,
timestamps, and `organizations Organization[]`. `Organization.group_id` is nullable
(`schema.prisma:147-148`).

- **It does not affect access.** No guard, permission resolver or scope helper reads
  `group_id`. `GroupsController` is `@UseGuards(JwtAuthGuard, RolesGuard) @SuperAdmin()`
  (`groups/groups.controller.ts:12-14`), so ordinary users cannot even see groups.
- **Membership in a group implies nothing.** Access is per-org membership only.
- Its one product-facing use: `getGroupUsers(groupId)` returns each distinct person in the
  group's orgs plus the list of orgs they are in (`groups/groups.service.ts:101-123`), which
  powers the "pick an existing user as this new firm's admin" picker — the deliberate path by
  which someone becomes multi-org.

### 1.5 `OrgIdentity` — **not** what the name suggests

`backend/prisma/schema.prisma:292-305`:

```prisma
model OrgIdentity {
  id              String   @id @default(uuid())
  organization_id String   @unique
  vision          String?  @db.Text
  mission         String?  @db.Text
  purpose         String?  @db.Text
  values          Json?
  ...
}
```

It is the organization's stated vision/mission/purpose/values — culture content, served by
`backend/src/org-identity/`, sibling to `CultureStandard` (`schema.prisma:307-319`). It is 1:1
with `Organization` (`organization_id @unique`), has **no `user_id`**, and therefore has no
relationship whatsoever to per-org user identity. It differs from `OrganizationMember` the way
a company's mission statement differs from its staff list. **There is no model in V2E that is
a "per-org profile of a user's identity" other than `EmployeeProfile`.** The target product
needs no analogue of `OrgIdentity` for multi-org purposes.

---

## 2. Authentication and the active org

### 2.1 What is in the token

`issueFullTokens` (`backend/src/auth/auth.service.ts:342-376`) signs both the access and the
refresh token with the same payload:

```ts
const payload = { sub: userId, email, isSuperAdmin };
if (organizationId) payload.organizationId = organizationId;   // auth.service.ts:349-350
```

So: **the active org is a claim in the JWT.** It is never passed as a header or query param.
It *is* repeated in the URL (`/api/v1/org/:orgId/...`) purely so the guard has something to
compare the claim against — the URL is the assertion, the token is the authority.

`JwtStrategy.validate` (`backend/src/auth/strategies/jwt.strategy.ts:21-78`) does **not** trust
anything else in the token. On every request it re-reads from the database: the user row
(`:22-25`), and — only when `organizationId` is present — the org's `is_test`/`status`, the
caller's `EmployeeProfile` + its `SystemRole.is_admin`, and the membership's `is_admin`
(`:38-51`). `is_admin` is then `membership.is_admin || systemRole.is_admin` (`:63`), and the
resolved `req.user` carries `organizationId`, `is_admin`, `system_role_id`,
`employee_profile_id`, `isTestOrg`. Note it re-resolves **roles**, but does *not* re-verify
that the membership still exists or is active — see §6.

### 2.2 Login: 0, 1, or many orgs

`AuthService.login` (`auth.service.ts:74-126`):

- Resolve the user by email or `(country_code, phone)` (`:75`, helper at `:49-66`), check
  `is_active`, compare bcrypt hash (`:76-79`).
- Load **all** active memberships with their org, ordered by `joined_at asc` (`:81-88`), then
  drop deactivated firms unless the caller is a super admin (`:92-95`).
- **0 orgs** → `UnauthorizedException`, with the message distinguishing "your firm was
  switched off" from "no membership" (`:96-100`).
- **exactly 1** → auto-select. Full tokens minted immediately with that `organizationId`
  (`:102-106`). No picker screen.
- **2+** → no tokens. Returns `{ requires_org_selection: true, selection_token, user,
  organizations[] }`, where each org entry carries `id, name, slug, logo_url, is_admin,
  joined_at` (`:108-125`). The `selection_token` is a 10-minute JWT signed with the *same*
  `JWT_SECRET`, payload `{ sub, email, type: 'org_selection' }` (`:108-112`).

The client stores the selection token **as `access_token`** so the axios interceptor attaches
it (`frontend/lib/auth/context.tsx:150-158`, with the comment saying exactly that), routes to
`/select-org`, and the user picks a card (`frontend/app/select-org/page.tsx:100-148`).
Choosing calls the ordinary `switch-org` endpoint (`context.tsx:170-179`).

This is a real weak point: because the selection token is signed with `JWT_SECRET` and
`JwtStrategy.validate` only looks at `payload.sub` (`jwt.strategy.ts:22-27`), the selection
token **is accepted as a valid session token on every non-org-scoped route** for its ten
minutes. `OrgScopeGuard` blocks it on `/org/:orgId/...` (no `organizationId` claim ⇒ the
`!==` check at `org-scope.guard.ts:52` throws), but routes without an `:orgId` segment — e.g.
`GET /api/v1/my-tasks/collective` (`tasks/tasks-collective.controller.ts:8-17`) — have no such
protection. The WebSocket layer treats this as a known hazard and explicitly rejects it:
`if (payload.type === 'org_selection') return null;` (`backend/src/auth/ws-auth.service.ts:69`).
Nothing on the HTTP side does the same. **(Inferred exploitability: HTTP routes that require
only `JwtAuthGuard` will accept a selection token; I did not run anything to confirm.)**

### 2.3 Org switch, end to end

1. Client calls `apiSwitchOrg(organizationId)` → `POST /api/v1/auth/switch-org`
   (`frontend/lib/api/auth.ts:84-89`), body `{ organizationId }`
   (`backend/src/auth/dto/switch-org.dto.ts:4-9`), guarded by `JwtAuthGuard` only
   (`auth.controller.ts:87-92`).
2. Server `switchOrg(userId, dto)` (`auth.service.ts:128-144`):
   - `organizationMember.findFirst({ user_id: userId, organization_id: dto.organizationId,
     is_active: true })` — **the user id comes from the verified token, never the body**
     (`:129-133`). Not a member ⇒ `ForbiddenException('Not a member of this organization')`.
   - Re-checks `User.is_active` (`:135-136`) and the org's `status` (`:138-140`).
   - **Mints a completely fresh access + refresh pair** carrying the new `organizationId`
     (`:143`), and returns a rebuilt user payload (`buildUserPayload`, `:378-403`).
3. Client overwrites both tokens in `localStorage` and replaces the `user` object
   (`frontend/lib/auth/context.tsx:181-188`), then `router.push('/dashboard')`
   (`components/layout/TopNav.tsx:165-176`, `components/layout/Sidebar.tsx:77-92`).

**What is *not* invalidated:** the TanStack Query cache. `QueryProvider` sets
`staleTime: 60_000` (`frontend/lib/providers/QueryProvider.tsx:7`) and there is **no
`queryClient.clear()` or blanket `invalidateQueries()` anywhere in the frontend** (verified by
grep). The switch relies on the fact that every query key embeds the org id, because every API
path is built as `/api/v1/org/${orgId}/...` (e.g. `frontend/lib/api/tasks.ts:41`) — so a new
org produces new keys and new fetches. Any cached state keyed *without* the org id would leak
across the switch. **(Inferred: I did not enumerate all ~30 API modules' query keys.)**

### 2.4 The enforcement point — can a user forge an org id?

No, on org-scoped routes. The single check is `OrgScopeGuard`
(`backend/src/common/guards/org-scope.guard.ts:44-54`):

```ts
const user = request.user;          // from the verified JWT, via JwtStrategy
const orgId = request.params.orgId;
if (!orgId) return true;            // :49  — NO-OP on any route without :orgId
if (user?.isSuperAdmin) return true;// :50  — super admin bypasses entirely
if (user?.organizationId !== orgId) {
  throw new ForbiddenException('Access denied to this organization');  // :52-54
}
```

The claim is only ever *set* by a server path that has already checked membership against the
database (`login` `:81-105`, `switchOrg` `:129-143`, `refresh` `:188-200`). So a forged org id
in the URL fails the `!==` comparison, and a forged org id in the *token* fails signature
verification.

Three caveats, all real:

- **Line 49 is the whole story for non-`:orgId` routes.** Any controller not mounted under
  `/org/:orgId/` gets no org enforcement at all. `SECURITY_AUDIT.md:29` calls this out as
  ground-truth fact 2.
- **`OrgScopeGuard` is opt-in per controller.** `app.module.ts` wires no global guards —
  "Protection is a convention, not a safety net" (`SECURITY_AUDIT.md:28`). Four Critical
  findings (C2, C3, C6) were exactly a controller that forgot it (`SECURITY_AUDIT.md:57-61, 73`).
- **`is_admin` is not org-bound by itself.** It is resolved from the caller's membership in
  *their* token org (`jwt.strategy.ts:63`), so `@RequireAdmin` passes for an admin of *any*
  org. Only `OrgScopeGuard` ties them together — "a write route with `@RequireAdmin` but no
  `OrgScopeGuard` is cross-org reachable by any org's admin" (`SECURITY_AUDIT.md:32`).

The same guard also enforces a second, unrelated thing: the per-org **module entitlement
ceiling** (`org-scope.guard.ts:56-84`) — `OrgModuleEntitlement.state` of `off` blocks the
module, `preview` makes it read-only, and a **missing row means `off`** (fail-closed, `:77`).

---

## 3. Per-org roles and permissions

**Yes — the same human holds different roles in different orgs, cleanly.**

The access bundle is `SystemRole` (`schema.prisma:3096-3117`): org-scoped
(`organization_id`, `@@unique([organization_id, name])`), with `is_system` (the seeded,
undeletable Administrator), `is_admin` (bypasses the matrix entirely) and `default_scope`.
It is attached to a person **per org** via `EmployeeProfile.system_role_id`, and
`EmployeeProfile` is unique on `(organization_id, user_id)` (`schema.prisma:409`). Nothing
about a role is stored on `User` or on `OrganizationMember`.

The `RoleLevel` enum (`schema.prisma:20-26`: junior/mid/senior/lead/head) belongs to the
*job-title* `Role` model (`schema.prisma:358-378`), not to access rights — the two were
deliberately de-linked (`schema.prisma:3087-3090`). `Role` is also org-scoped and hangs off a
`Department`.

Resolution is a four-layer intersection, stated in the schema
(`schema.prisma:3059-3061`) and implemented in `PermissionsService.hasEffective`
(`backend/src/access-rights/permissions.service.ts:132-...`):

```
effective = org_entitlement ∩ ( systemRole_permissions ∪ user_grants − user_revokes )
```

- Layer 1 `OrgModuleEntitlement` — vendor ceiling, super-admin-set, per org (`schema.prisma:3212-3226`).
- Layer 2 `RolePermission` — per `(organization_id, system_role_id, feature_key, action)`,
  with an optional `DataScope` (`schema.prisma:3136-3154`).
- Layer 3 `UserPermissionOverride` — per `(organization_id, user_id, feature_key, action)`,
  grant or revoke (`schema.prisma:3156-3175`).
- Admin leaves are governed by `is_admin`, never by the matrix
  (`permissions.service.ts:139`).

**Every one of those tables is keyed by `organization_id`**, and every query passes the
`orgId` from the request path. Scoping to the active org is therefore automatic:
`PermissionsGuard` reads `request.params.orgId` and builds the principal from
`req.user` (`common/guards/permissions.guard.ts:34-49`), where `system_role_id` was already
resolved *for the token's org* by the JWT strategy.

Row-level visibility is a second axis: `DataScope` = `own | team | department | org`
(`schema.prisma:3082-3094`), resolved by `PermissionsService.scopeFor`
(`permissions.service.ts:255-...`) through a three-tier cascade (line → module → role default)
and applied by `ScopeService` (`backend/src/access-rights/scope.service.ts`) as either a
Prisma `where` fragment for lists (`listWhere`, `:87-100`) or an assertion for single records
(`assertCanActOn`, `:158-175`). Both fail closed: a denied leaf returns `{ id: { in: [] } }`
(`scope.service.ts:16, 93`). `clampScope` (`:111-113`) guarantees a client-requested
Mine/My Team/Organization filter can only *narrow*, never widen.

**Super admins / cross-org users.** `User.is_super_admin` is global. Their treatment is
deliberately split:

- **Routing:** they bypass `OrgScopeGuard` entirely, for every org (`org-scope.guard.ts:50`).
- **Content:** they are denied. `isVendorOnly(principal)` = super admin **and** not a member
  of this org (`permissions.service.ts:80`), and `hasEffective` returns false for such a
  principal (`:144`); `scopeFor` returns null (`:262`). Comment: "Vendor superadmin is
  METADATA-ONLY: never content/feature access."
- **A super admin who is also a real member of the org falls through and is judged by their
  org role** (`permissions.service.ts:142-144`). This was a bug fix: previously such a person
  was treated as a content-less vendor and locked out of their own firm (`git show 2c2ac39`).

The audit flags the residual hole: any service that gates only by route-reachability rather
than through `hasEffective` remains super-admin-reachable across every tenant
(`SECURITY_AUDIT.md:417`).

---

## 4. Query scoping discipline

**There is no mechanical enforcement. `organization_id` is hand-written in every query.**

`PrismaService` is a 25-line subclass of `PrismaClient` with a pg adapter and nothing else —
no `$extends`, no `$use` middleware, no RLS, no repository layer
(`backend/src/prisma/prisma.service.ts:1-25`). The only shared helpers are:

- `ScopeService.listWhere` / `assertCanActOn` — but these enforce the *row-level data scope*
  (own/team/department/org), **not** the org filter, and they cover only five "scopable"
  content leaves: tasks, goals, meetings, tickets, projects
  (`SECURITY_AUDIT.md:33`, registry at `backend/src/access-rights/scope-registry.ts`).
- `assertActiveOrgMembers(prisma, orgId, userIds, label)` /
  `filterActiveOrgMembers` (`backend/src/common/org-members.ts:10-45`) — validates that
  user-id lists arriving in a request body are active members of the caller's org. A good
  pattern, added in response to the audit, but each caller must remember to call it.
- One genuinely clever fail-loud device: `ScopeService.onApplicationBootstrap` **refuses to
  boot** if any leaf declared `scopable` has no registered list handler
  (`scope.service.ts:44-54`) — modules self-register in their constructor. This is the only
  place in the codebase where forgetting to wire scoping is caught automatically.

Everything else is the written standard `backend/AUTHORIZATION.md`, whose opening line is:
"the single most common and highest-severity bug class here is Broken Object-Level
Authorization", and whose own §"The guards do NOT save you" states that `JwtAuthGuard`,
`OrgScopeGuard` and `RolesGuard` enforce **no** row-level scope. Its Hard Rule 3 is
"`organization_id` belongs in EVERY single-record `where`."

### Did it leak? Yes — repeatedly.

`SECURITY_AUDIT.md` (3 July 2026, controller-by-controller) found **14 Critical and 6 High**
(`:39`). The cross-org ones, with their fixes where the git log shows them closed:

| # | Leak | Root cause | Fixed |
|---|---|---|---|
| C1 (`:53`) | `POST /auth/register` accepted `organization_id` + `is_admin` in the public body — an unauthenticated stranger could join **any** org as its admin | trusting a body field for tenancy | Yes — `59d1829`; `auth.service.ts:39-43` now mints a personal account only, citing C1 |
| C2/C3/C6 (`:57-73`) | `/org/:orgId/users/*` write routes had `@RequireAdmin` but **no `OrgScopeGuard`** → any org's admin could reset any user's global password, mint an admin, or deactivate members in any other org | forgotten opt-in guard + `is_admin` not being org-bound | Yes — `b37abd6` |
| C4/C5 (`:65-69`) | Both WebSocket gateways trusted `handshake.auth.userId` and a client-supplied `orgId`, with `cors:'*'` and no token verification | `@UseGuards` does nothing for a gateway | Yes — `8838423`, `dbc4074`; `WsAuthModule` + handshake middleware now mandated (`AUTHORIZATION.md`, WebSocket section) |
| C7 (`:77`) | `recurringScheduleEntry.delete({ where: { id } })` — bare id, no org, no parent | sub-resource acted on by its own id | Yes — `cef8b81` |
| C8 (`:81`) | policy items updated/deleted by bare id after validating only the parent | same | **(inferred: not confirmed fixed — no commit names it)** |
| C9 (`:85`) | bulletin `deletePost` had no `organization_id`, and the author check was bypassed by `is_admin` (which is any-org) | missing org filter + non-org-bound admin flag | **(inferred: not confirmed fixed)** |
| C10 (`:89`) | project dependency ids stored unvalidated, then read back with no `organization_id` → cross-org task titles | unvalidated foreign key in a request body | **(inferred: partially — `2519466` closes BOLA holes in tasks)** |
| H4 (`:99`) | `GET /api/v1/my-tasks/collective` returns 100 tasks per org with no participant or scope filter | deliberate cross-org route with no `:orgId`, so no guard | **No — still live.** `tasks-collective.controller.ts:8-17` still has only `JwtAuthGuard`; `tasks.service.ts:4243-4269` still queries `{ organization_id, is_deleted: false }, take: 100` with no scope filter |

The audit's own critique of `AUTHORIZATION.md` names the deepest systemic gap: the standard
had **no rule about validating foreign ids arriving in the request body**, which is the root
of roughly eight findings — ticket type/category/template ids, project managers, dependency
task ids, department heads and parents, learning and policy assignee ids
(`SECURITY_AUDIT.md:405`).

---

## 5. Frontend and UX

**Where the switcher lives.** Two places, for the two shells:

- `frontend/components/layout/TopNav.tsx` — the firm shell's blue top bar. Orgs are loaded
  eagerly; the current org name is composed into an identity line
  `name · organization · role` used as the avatar's tooltip and accessible name
  (`TopNav.tsx:147-153`), `otherOrgs` filters out the current one (`:154`), and
  `handleSwitch` (`:165-176`) calls `switchOrg` then `router.push('/dashboard')`.
- `frontend/components/layout/Sidebar.tsx` — the dark sidebar used by the super-admin portal
  shell. Loads orgs eagerly "so the current org name is visible without opening the switcher"
  (`Sidebar.tsx:59-66`), `handleOrgSwitch` short-circuits when the target is already current
  (`:77-81`), and the empty state reads "No other organizations" (`:163`).
- `frontend/app/select-org/page.tsx` — the post-login picker for 2+ orgs. Cards show logo,
  name, an Administrator/Member badge and "Since <month year>" (`:100-143`), a search box
  appears above five orgs (`:81-91`), a single "Entering your workspace…" screen covers the
  whole transition to avoid flashing other auth pages (`:45-55`), and a Sign out escape hatch
  sits at the bottom (`:150-159`). The redirect races are commented in detail (`:26-37`) —
  they clearly got bitten by them.

**How the active org is shown.** Only in the identity line / avatar tooltip in the top bar
(`TopNav.tsx:147-153`) and as the sidebar's `currentOrgName` (`Sidebar.tsx:94`). There is no
persistent org chip, no colour coding, no banner. The top bar itself "no longer prints it"
(`TopNav.tsx:148-149`) — a deliberate regression toward less visibility. For a person who is
Administrator in one firm and a plain member in another, the only always-visible difference
is which nav modules render.

**Cached client state on switch.** As covered in §2.3: nothing is explicitly cleared. Safety
depends entirely on org ids being baked into every API path and therefore into every query
key.

**`DESIGN_RULES.md` says nothing about organizations.** A case-insensitive grep for
"organization", "org switch", "multi-org" and "cross-org" across all 27KB returns **zero
matches**. There is no stated rule about displaying the active tenant, about confirming a
switch, or about what must be re-fetched. The September design audit
(`audit-2026-09-04.md`) is a pure UI/design-system audit — colour, spacing, typography,
components — and contains nothing about org scoping either; its §26 "Permissions in the
interface" (`:665-679`) calls the permission-driven UI V2E's "strongest area" (778 `can*`
call sites, `useEntitlements` gating whole modules, nav failing **closed** while entitlements
load — `TopNav.tsx:79-81`), while noting that disabled controls mostly lack the required
"why" tooltip.

One nice multi-org-aware touch: the cross-firm task feed is hidden unless the person actually
has 2+ memberships, because "for a single firm it just duplicates My Tasks"
(`components/layout/TaskModuleSidebar.tsx:138-150`). And Edit Employee renders a display-only
"this login is shared across firms" notice when the person belongs to more than one
(`app/dashboard/employees/[employeeId]/page.tsx:266, 368`).

---

## 6. Scars and regrets

**The big one: one global password across all orgs.** Because `User` holds a single
`password_hash`, an admin in firm A resetting an employee's password changes their login in
firms B and C too. V2E did not change the model; it papered over it with UX
(`git show 2c2ac39`):

- Add Employee and Create Firm now do a **live email lookup** before the form is filled — an
  existing account locks the name field and hides the password field entirely, because the
  person keeps the login they already have; only a brand-new account asks for a password
  (`employees.service.ts:231-236`: "Existing global account: we NEVER set/overwrite its
  password, name, email or phone here").
- Editing a password shows a confirmation warning that it changes the login **across all** the
  person's organizations.
- New `GET employees/check-account` and `organizations/check-account` endpoints exist purely to
  drive that pre-flight check.
- If an admin types a phone number that does not match the existing account's, the save is
  **rejected with an explanation** rather than silently dropping it, because silent dropping
  was Issue #5 (`employees.service.ts:237-246`).

Also downstream of one global user: an admin must always keep an email, enforced not just for
*this* org but checked against `is_admin` in **any other** org
(`users.service.ts:108-115`) — a genuinely awkward cross-tenant coupling in what should be a
per-org rule.

**The super-admin/member collision.** Treating `is_super_admin` as "vendor, therefore no
content" broke any person who was both the vendor's super admin and a real member of a firm:
denied all firm content and flipped into the empty Super Admin shell after a token refresh.
The fix was `isVendorOnly` = super admin **and not a member of this org**
(`permissions.service.ts:80`, `git show 2c2ac39`). Worth knowing before adding any global
"platform" flag.

**Org deactivation was cosmetic for months.** Setting `Organization.status = 'inactive'` and
having *nothing read it* meant deactivated firms' users kept logging in normally. Fixing it
required touching **five** independent session paths (login, switchOrg, getMyOrgs, refresh,
jwt.strategy, plus ws-auth) — which is exactly the cost of having the org live in a token
rather than being re-derived per request. They centralised the rule in one util afterwards
(`common/org-status.util.ts`), and had to add a Reactivate endpoint that the confirm dialog
had been promising but which never existed (`git show 198855b`).

**Guards as opt-in convention.** `app.module.ts` wires no global guards; every controller
opts in. Three Criticals were one forgotten `OrgScopeGuard`
(`SECURITY_AUDIT.md:28, 57-73`). Layered on top: `PermissionsGuard` is inert without
`@RequirePermission`, and `RolesGuard` is inert without `@RequireAdmin`
(`SECURITY_AUDIT.md:30-31`) — so a controller can *look* protected in its `@UseGuards(...)`
line while enforcing nothing.

**`is_admin` not being bound to the path org** turned a coarse admin gate into a cross-org
skeleton key wherever `OrgScopeGuard` was missing (`SECURITY_AUDIT.md:32`) and let C9's author
check be bypassed entirely.

**Unvalidated foreign ids in request bodies** — the single largest *category* of cross-org
leak, and one the written standard never covered (`SECURITY_AUDIT.md:405`).

**The selection token doubles as a session token.** Signed with the production `JWT_SECRET`
and accepted by `JwtStrategy`; only the WebSocket layer rejects it explicitly
(`ws-auth.service.ts:69`). Storing it under the `access_token` key
(`frontend/lib/auth/context.tsx:153-154`) is convenient and wrong-shaped.

**Cross-org convenience routes are where scoping goes to die.** `my-tasks/collective` was
built with no `:orgId` (correctly — it spans orgs), which means no `OrgScopeGuard`, which
means the author also skipped `ScopeService.listWhere`. It is still leaking every org member's
tasks past the own/team/department model, over two months after the audit named it
(`tasks.service.ts:4243-4269`).

**Membership and profile can disagree.** `OrganizationMember` and `EmployeeProfile` are two
rows about the same relationship with independent lifecycles; `deactivate` flips the
membership's `is_active` but touches neither `EmployeeProfile.status` nor anything else
**(inferred from `users.service.ts:146-149`)**.

### What I would NOT copy

1. **Opt-in, per-controller org enforcement.** Make tenant scoping structurally impossible to
   forget (a shared query helper that takes the tenant as a required argument, or a
   client extension), not a convention plus a document.
2. **A single global password with per-org admins who can reset it.** Either accept it
   explicitly and build the warnings from day one, or keep credentials per-tenant.
3. **A selection/intermediate token signed with the session secret and stored as the session
   token.** Give it a distinct secret or an explicit `type` check in the strategy itself.
4. **Cross-org "collective" endpoints without a first-class scoping story.** Every route that
   deliberately spans tenants needs its scoping designed *first*, precisely because the usual
   guard cannot apply.
5. **Two separate models for "is a member" and "is an employee here"** unless you truly need
   both, and if you do, reconcile them in one service.

---

## 7. Transferability to the SFA CRM target

Target is Next.js 14 App Router + Prisma, `tenant_id` injected as an `x-tenant-id` header by
`src/middleware.ts` after verifying a signed JWT cookie. Brief notes only — a separate agent
owns the design.

| V2E mechanism | Ports? |
|---|---|
| `OrganizationMember` as a thin join with `is_admin` + `is_active` + `joined_at` | **Directly.** Add a `user_tenants` table with the same shape. The single-column-payload discipline is a feature. |
| Globally unique login identifier on `User` | **Directly, but it is the decision to make consciously.** The SFA CRM logs in by phone within a tenant; going global means one password per human across tenants and every scar in §6. |
| Active org as a JWT claim | **Directly, and better.** The target already carries the tenant in a signed httpOnly cookie, which is strictly safer than V2E's `localStorage` bearer token. The claim becomes the tenant the middleware injects. |
| `OrgScopeGuard` comparing `token.org === :orgId` | **Needs adaptation.** The target has no `:orgId` path segment; `src/middleware.ts` already injects `x-tenant-id` from the cookie, so the comparison is unnecessary — the header *is* the claim. The transferable part is V2E's failure mode: a route the middleware does not cover gets nothing. |
| `switch-org` minting a fresh token after a DB membership re-check | **Directly.** Becomes a route handler that re-checks membership and re-issues the session cookie. Server-side re-verification (never trusting the body's user id) is the load-bearing rule. |
| Org-picker screen for 2+ orgs, auto-select for exactly 1 | **Directly.** The UX shape (cards with role badge and joined date, search above five, single loading screen) is worth lifting wholesale. |
| `SystemRole` / `RolePermission` four-layer model | **Doesn't apply as-is.** The target already has `role_permissions` keyed by `(tenant_id, profile, section)` and `getDataScope` returning `own\|team\|all`. Same *idea*, already implemented; the transferable insight is only that every permission table must be keyed by tenant so a per-tenant role is automatic. |
| `DataScope` own/team/department/org + `ScopeService.listWhere` | **Already present** as `getDataScope` + per-route filtering. The one thing worth stealing is the **boot guard** (`scope.service.ts:44-54`): refuse to start if a scopable resource has no wired scoping. |
| `OrgModuleEntitlement` ceiling in the same guard | **Doesn't apply** — no per-tenant module sales in the SFA CRM. |
| `OrganizationGroup` | **Doesn't apply.** Pure super-admin bookkeeping with no access semantics; the target's SuperAdmin portal already covers that ground. |
| `OrgIdentity` | **Doesn't apply.** Unrelated to multi-org — it is the firm's vision/mission content. |
| Hand-written `organization_id` per query | **Already the target's situation**, and already flagged in its `CLAUDE.md` as "the highest-consequence mistake available in this codebase". V2E is the cautionary data point: the same discipline, under audit, produced 14 Criticals. The target's `npm run audit:tenant` (static + runtime `tenant_id` predicate check) is a mechanism V2E never had and should **not** be given up. |
| Org deactivation checked at every session mint/refresh/accept point | **Directly**, and cheaply: the target re-resolves the caller's role from the DB in `requireUser()` already, so a tenant-status check belongs in the same place. |
| No client cache invalidation on switch | **Do not port.** The target should clear its client cache explicitly on tenant switch rather than relying on tenant ids appearing in every key. |
