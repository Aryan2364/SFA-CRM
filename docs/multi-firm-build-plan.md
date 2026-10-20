# Multi-firm single user — build plan

**Status:** proposed, not started. No code written.
**Inputs:** `docs/multi-firm-user-audit.md` (our current state), `docs/v2e-multi-org-research.md`
(V2E's production implementation and its scars).
**Approach:** Membership table (Audit §B2), built in independently shippable phases.

---

## 0. What we are building, in one paragraph

One human gets one login. Behind that login sits an explicit **membership row per firm**. The
session cookie names an **active firm**, and that name is a *claim the server re-verifies against
the database on every request* — never a grant. A person with one membership sees exactly today's
UI. A person with several gets a firm switcher in the pinned sidebar header. No historical record
ever moves between firms.

---

## 1. Invariants — the things that must never break

These outrank every deadline. Any phase that cannot demonstrate them does not ship.

**I1. `active_tenant_id` is a claim, not a grant.**
Every authenticated request resolves `(person_id, active_tenant_id)` against
`user_tenant_memberships` before doing anything else. No row → throw. Not "fall back to the first
membership"; not "fall back to the session role". The fallback branch is the one nobody tests.

**I2. Identity flows one way: membership row → request context. Never cookie → request context.**
The `user_id`, `role` and `profile` used for authorisation come from the membership row. The
cookie's copies are a display cache and are treated as untrusted input.

**I3. The existing `catch` in `requireUser()` must not swallow the membership query.**
Today's fallback to the session role is benign — worst case is a stale role inside a firm the user
certainly belongs to. Extending it to the membership check would let a transient DB error grant
whatever firm the cookie names. The role refresh may keep its fallback; **the membership check
throws.**

**I4. Enforcement is mechanical, not documentary.**
The biggest lesson from V2E: their guard was opt-in per controller and a complete no-op on any
route without an `:orgId` segment, and their audit found 14 Critical / 6 High findings, mostly
cross-tenant. Our equivalent protections — a single choke point plus `npm run audit:tenant` — are
exactly what V2E never had. Not negotiable, and not to be silenced with a broad allowlist pattern.

**I5. No token does two jobs.**
V2E signs a 10-minute org-selection token with the production `JWT_SECRET`, and their JWT strategy
accepts it as a full session token (only their WebSocket layer rejects it). If we need an
intermediate "picked a firm yet?" state, it carries an explicit `purpose` claim that the session
verifier rejects. Preferably we need no such token at all.

**I6. A switch invalidates client state.**
V2E clears nothing on switch and relies entirely on org ids appearing in every API path. We have no
such path convention, and `useMe` holds a module-level cache that survives all client navigation.
Switch = invalidate + hard navigate. Never a soft transition that leaves a half-filled form alive
under a new firm.

**I7. No historical row changes `tenant_id` or `user_id`. Ever.**
Visits, orders, expenses and weekly plans stay bound to the firm they were created in. We unify the
login in front of the data, not the data itself.

---

## 2. Schema

Additive only. `users` keeps one row per (person, firm) and is not restructured.

```
people
  id                   uuid pk
  contact              text   -- login identifier, UNIQUE globally
  email                text
  name                 text
  password             text   -- global, per Decision D1
  credentials_version  int
  status               text
  created_at / updated_at

user_tenant_memberships
  id          uuid pk
  person_id   uuid -> people.id
  tenant_id   uuid -> tenants.id
  user_id     uuid -> users.id    -- the existing per-firm row
  profile     text                -- role name within THIS firm
  status      text                -- Active | Suspended | Removed
  joined_at / removed_at
  UNIQUE (person_id, tenant_id)
  UNIQUE (user_id)
```

We adopt the `people` table rather than electing a "primary" `users` row (Audit §B2.1). An identity
row that is also a tenant row is exactly the kind of ambiguity that produces a silent authorisation
bug.

The session payload gains `personId` and `activeTenantId` **alongside** today's claims, all of
which keep their current names and meanings. **`getTenantId()` does not change** — that single
property is what keeps this work off ~139 route files.

**We explicitly do NOT build** V2E's `OrganizationGroup` (a super-admin holding record that grants
zero access — nothing in their permission engine reads `group_id`) or `OrgIdentity` (not an identity
at all; it is the org's vision/mission text). Neither has a job here. If a firm-group concept is
wanted later for shared masters or roll-up reporting, that is a separate project with its own
access story.

---

## 3. Phases

Each phase is independently shippable and revertible. Phase N does not begin before Phase N-1's
acceptance criteria pass.

### Phase 0 — Measure (blocking, human-run, no code)

Count `contact` values appearing in more than one tenant, and how many of those pairs are genuinely
the same human. **Agents cannot do this** — the standing rule is that no agent reads the live
database. A human runs a read-only query or pulls it from reporting. Also answers: is anyone
**currently locked out** by the bug in Phase 0.5?

*Acceptance:* a number, written into this file.

### Phase 0.5 — Fix the live login bug (ship immediately, independent)

`users` is unique on `(tenant_id, contact)`, but login looks up by `contact` with **no tenant
filter**, via `findFirst` ordered by `created_at` ascending. If one phone exists in two firms, that
person can only ever log into the **older** row; the newer password silently returns a generic
`401`. Nothing prevents creating the duplicate — the tenant-admin create route catches only the
per-tenant uniqueness violation.

This is a live support issue with no dependency on the rest of the plan.

*Acceptance:* a user whose phone exists in two firms authenticates deterministically; creating a
second user with an existing phone is refused with a clear message.

**D3 — the ambiguous case (decided 2026-09-24).** When the same phone *and* the same password match
more than one firm, login authenticates into the **oldest** match and emits a loud server log for
support, rather than refusing with a 409.

Rationale: a 409 would have locked out the one cohort that was not already broken — two live
accounts sharing a password — and it is **not self-recoverable**, because `forgot-password` and
`reset-password` both scope by `getTenantId()`, which with no session is `DEFAULT_TENANT_ID`
(PLAN.md §13.2). Recovery would need an admin, gated on support first reading the log. The affected
population is unknown (Phase 0 unanswered), so it had to be assumed non-zero.

*Accepted risk:* oldest-wins can silently place a person in a firm they did not choose, and a
wrong-firm order is expensive to unwind. This is retained **only as an interim** and is superseded
by the Phase 3 switcher, which gives that person an explicit, visible choice of firm. The log line
is the cleanup signal feeding Phase 4.

### Phase 1 — Additive schema + backfill

Create both tables. Backfill one `people` row per distinct human, one membership per existing
`users` row. **Nothing reads them yet.** Every existing session keeps working.

`prisma db push` is blocked for AI agents in this repo — a human runs the migration.

*Acceptance:* row counts reconcile (memberships == users); `npm run verify:data-layer` clean; app
behaviour provably unchanged.

### Phase 2 — Dual-read login + enforcement choke point

Login resolves through `people` when a membership exists and falls back to today's path otherwise.
The token gains `personId` / `activeTenantId`. `requireUser()` enforces membership **only when
`personId` is present**, so the check cannot break a legacy cookie mid-flight.

This phase builds I1–I3. It is the security core and gets the most review.

*Acceptance:* write-path suite proves a forged or stale `activeTenantId` is rejected; legacy cookies
still work for their remaining lifetime; `npm run audit:tenant` clean on the batch.

### Phase 3 — Switcher (first user-visible change)

`POST /api/auth/switch-tenant`:

1. `getCurrentUser()` → `personId`, **from the verified token, never the request body**.
2. Membership for `(personId, tenantId)` must exist and be `Active`.
3. Re-check firm health — `is_active`, `payment_status !== 'Suspended'` — by **reusing the existing
   login gate, not re-typing it**, or the switcher becomes a way into a suspended firm.
4. Re-mint the cookie with login's exact `maxAge` and flags. Switching must not silently extend a
   session.
5. Client invalidates the `useMe` cache and **hard-navigates to the dashboard**.

UI per the global rules: replace the static tenant subtitle in the pinned sidebar header with a real
control; full-contrast active-firm text (today's muted small type fails the squint test for a value
that now decides which firm an order is filed against); **one membership → no control at all,
exactly today's plain text**; styled popover portalled to `<body>`, never `confirm()`; unsaved-form
confirmation with an explicit Cancel; 200–300ms animation; failure states resolve inline with a way
back; mobile full-width sheet, ≥44px targets. `/api/auth/me` returns the membership list so the menu
can show role per firm.

*Acceptance:* switch works both directions; Firm A data invisible **and un-writable** after
switching to B; revoked membership and suspended firm both fail gracefully; a single-membership user
sees no UI change whatsoever.

### Phase 4 — Duplicate merge (per human, with customer confirmation)

Point a human's memberships at one `people` row, choose one password, retire the others. **No
historical row moves.** Needs a conversation per affected person, which is why Phase 0 comes first.

### Phase 5 — Enforce

Drop the legacy login fallback; add the global unique index on `people.contact`; reject a phone
already claimed by another person; repoint forgot-password at `people` — which incidentally fixes
the `DEFAULT_TENANT_ID` password-reset bug in PLAN.md §13.2.

---

## 4. Verification

Per repo convention — no unit-test framework; verification is script-based.

- **`npm run audit:tenant -- --batch multi-firm`** after Phases 2, 3 and 5. New membership queries
  get individual allowlist entries with written reasons. **Never a broad pattern for
  `user_tenant_memberships`** — the allowlist's own preamble forbids exactly that.
- **New write-path suite** (`SCRATCH_DATABASE_URL`, `TZ=UTC`): switch to Firm B and assert a Firm A
  row is invisible and un-writable; assert a revoked membership fails closed; assert a stale cookie
  naming a firm the person has left is rejected.
- **`npm run verify:data-layer`** after every schema phase.
- **Manual pass on `npm run dev:local`** (port 3007, local DB) for the switcher UX.

Deferred, to be decided separately: a Prisma `$extends` runtime guard asserting a `tenant_id`
predicate on tenant-scoped models. Attractive — it is the mechanical enforcement I4 asks for — but
it is a large change to `src/lib/db.ts` and does not belong on this project's critical path.

---

## 5. Build sequencing for agents

Phases are mostly serial by nature; the parallelism available is within a wave.

| Wave | Agent | Scope | Depends on |
|---|---|---|---|
| A | `login-bugfix` | Phase 0.5, standalone | — |
| A | `schema-builder` | Phase 1 migration + backfill script (human runs the push) | — |
| B | `auth-core` | Phase 2: session payload, login dual-read, `requireUser()` choke point | Phase 1 |
| C | `switch-api` | Phase 3 endpoint + `/api/auth/me` membership list | Phase 2 |
| C | `switch-ui` | Phase 3 sidebar switcher, `useMe` invalidation, dialogs | Phase 2 + agreed contract |
| D | `verifier` | Write-path suite + `audit:tenant` batch; adversarial review against I1–I7 | Phases 2–3 |

Wave A runs concurrently. Wave C's two agents share an API contract agreed up front so they can run
concurrently. `verifier` is deliberately a *separate* agent from the builders — it reviews
adversarially against the invariants rather than confirming its own work.

---

## 6. Decisions (resolved 2026-09-24)

**D1 — One global password.** `password` and `credentials_version` live on `people`. One human, one
credential, across every firm. Switching never re-prompts.

*Accepted risk, stated plainly:* this is the design V2E regretted. Any firm admin who can reset a
person's password thereby holds the keys to every other firm that person belongs to. The decision
was taken with that trade-off on the table, in favour of a seamless switch and a single reset path.

*Required mitigations, in scope:*
- Every admin-initiated password reset writes an **audit-log entry** naming the actor, the target
  person and the firms affected.
- The person receives an **email notification** on any credential change they did not initiate, so
  a cross-firm reset is visible to them even if it happened in a firm they rarely open.
- The reset UI **warns the acting admin** when the target belongs to more than one firm, naming the
  count (not the firm names — that would leak the person's other employers to this admin).

**D2 — Deactivate the login when the last membership is removed.** Removing a person's final
membership sets `people.status = 'Inactive'` and login is refused outright. Re-hiring requires an
explicit reactivation step. The `people` row and all history are retained; only access is withdrawn.

Implementation note: the deactivation must be driven by the membership count, not by the removal
call site, or a second removal path added later will silently leave a live login behind. Derive it
in one place.
