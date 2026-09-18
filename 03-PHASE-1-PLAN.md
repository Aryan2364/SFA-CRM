# 03 — Phase 1 Plan: Foundation, Parties

> ## PROGRESS — 18 Sep, 9 of 19 tasks accepted
>
> Branch `rebuild/phase-1`. Production data verified unchanged after every wave: **594 partners /
> 8 orders / 22 users / 29 visibility rows.**
>
> | Task | State |
> |---|---|
> | T1 pre-flight | ✅ `02-DATA-MODEL-PLAN.md` §8 |
> | T2a `is_manual` + backfill | ✅ `d941eb5` |
> | T2b `rebuildVisibility` + guards | ✅ `5eb6dbd` — **closed a live org-chart leak**; re-parent test passes on scratch and the old code reproduces the bug |
> | T3 master registry | ✅ `e543077` — nine lists → one; 3 unreachable masters restored |
> | T4 `src/lib/format.ts` | ✅ `f83feed` — **fixed money rounding on 2 screens** + a latent date shift |
> | T5 + T6 schema | ✅ `d941eb5` — 7 tables, 6 columns, 3 CHECK constraints widened |
> | T18 Contact Type + Industry masters | ✅ `40b142e` |
> | *(unplanned)* scratch-push guard | ✅ `538388b` — `scratch:push` could rewrite **production** |
> | **T7 backfill** | ⛔ **BLOCKED — needs a human to run the live write.** Script final and green under a transactional dry run: `! node scripts/backfill-parties.mjs --commit`, twice |
> | T8-T17, T19 | ⚪ all downstream of T7 |
>
> ### Corrections to this document, found while building it
>
> - **T3's "10-11 files per master" is no longer true.** After `e543077` a master is **one registry
>   entry** + a screen + a route pair. T18 proved it.
> - **T18's warning about `list-page` and `backHref` is now enforced in code comments** on both new
>   screens, so the next person sees the trap before repeating it.
> - **`02-DATA-MODEL-PLAN.md` §1.1 was wrong about `updated_at`** — a trigger maintains it. And
>   T6's owner backfill flattened all 594 values to 2026-09-17, destroying the originals.
> - **Only 19 of 594 companies have a street address.** `completeness_missing` will read
>   *"Primary Address, City, State, Pincode, GST Number"* on 397 rows. Correct, not a bug.
> - **`prisma db push` cannot be run by an agent** — Prisma refuses and needs the user's literal
>   consent string. Three tasks were mis-logged as agent failures before this was understood.
> - **A registry group key is still named `lead_config`** (7 occurrences) — T19 must catch it; a
>   grep for UI strings alone will miss it.

Source requirement: `REBUILD-PLAN.md` §3. Read `00-CODEBASE-MAP.md` and `01-GAP-ANALYSIS.md` §A
before starting. **Do not start any task until the pre-flight in `08-EXECUTION-SEQUENCE.md` is
green.**

---

## Scope

Convert the Leads module into Parties (Companies + Contacts), with the masters and the data
migration that supports it. After Phase 1 the application must be **working and testable** — a
phase is not complete if the app is broken.

## Explicit NON-scope

Do not build, and do not leave placeholders for:

- **Deals** — Phase 2. Migrated funnel rows are *prepared for* Deals (`02-DATA-MODEL-PLAN.md`
  step 13) but the Deal entity is not built here.
- **Draft/Placed order states and discounts** — Phase 2. §3.5's "Order cannot be Placed until the
  Party is complete" is *specified* in Phase 1 (the `is_complete` flag) and *enforced* in Phase 2.
- **Any access-control screen** — §9 item 2. The Self/Team/Company filter itself is Phase 4.
- **Renaming master VALUES** (`Prospect`, `Existing`, `Dealer`, …). Tables and columns only — see
  `02-DATA-MODEL-PLAN.md` §6 and Q11.
- **Restyling the 36 legacy screens.** Convert a screen only when a task here already requires
  touching it.
- **Dropping `temperature`, `distributor_id`, or `sub_type`.** Q3/Q4 — behaviour is preserved.
- **Server-side pagination** — Q2. Keep the existing client-side model.

---

## Task list

Each task is sized for one agent in one session. **Dependencies are stated; tasks with no shared
dependency may run in parallel.** `S` ≈ <1 h, `M` ≈ 1-3 h, `L` ≈ 3 h+.

### Track A — machinery (must land first, unblocks everything)

---

#### **P1-T1 · Pre-flight verification** · S · no deps · **BLOCKS EVERYTHING**

Not a code task. Run the five read-only queries in `02-DATA-MODEL-PLAN.md` §7 (B-1…B-5) plus
`\d business_partners`, `\d role_permissions`, `\d orders` against live.

**Deliverable:** append a "Pre-flight results" section to `02-DATA-MODEL-PLAN.md` with the actual
output, and a one-line verdict: *does the live schema match §1 of that file, yes or no.*

**Acceptance:** the `role_permissions` CHECK constraint body is written down. If it constrains
`section`, **STOP and report** — P1-T3 and P1-T9 cannot proceed as planned (A4).

---

#### **P1-T2 · Fix the `user_visibility` re-parenting leak** · M · no deps

`01-GAP-ANALYSIS.md` G2. Do this now, not in Phase 4, because the data drifts a little more with
every manager change until it is fixed.

**Files:**
- `src/lib/visibility.ts` — add `rebuildVisibility(tenantId: string): Promise<void>`, lifting the
  whole-tenant rebuild that already exists at
  `src/app/api/access-control/visibility/bulk-import/route.ts:28-48` (single `findMany` over
  `users`, in-memory ancestor walk, one `createMany`). Delete the duplicate there and call the
  shared one.
- `src/app/api/masters/users/[id]/route.ts:83-93` — after any `manager_user_id` change, call
  `rebuildVisibility(tid)` instead of the current paired
  `removeAncestorVisibility` / `cascadeVisibilityUp`.
- `src/app/api/masters/users/route.ts:140` — same for create.

**Why a full rebuild:** the existing walk only ever handles `params.id`; enumerating descendants
is more code and more queries. Tenants here are a few hundred users at most; the rebuild is two
queries and is self-healing.

⚠️ `POST /api/access-control/visibility` lets an Administrator insert an **arbitrary** (viewer,
target) pair with no marker column, and a rebuild would erase those manual overrides. **Before
writing this, check whether any exist** (`SELECT count(*) FROM user_visibility` vs. the count the
rebuild would produce). If they do → **STOP and report**; the table needs an `is_manual` column
first. Logged as Q12.

**Acceptance:** create A→B→{C,D}; re-parent B under E; confirm A no longer sees C or D and E now
does.

---

#### **P1-T3 · Collapse the seven duplicated master registries into one** · M · after P1-T1

`01-GAP-ANALYSIS.md` C3. Phase 1 adds two masters and Phase 2 adds two more; at 10-11 files each
this pays for itself immediately. It is also the only way to stop the drift that has **already**
happened (`Sidebar.tsx` and `masters/page.tsx` both silently omit
`dealers`/`distributors`/`institutions`).

**New file:** `src/lib/masters-registry.ts`
```ts
export type MasterDef = {
  key: string            // role_permissions.section value
  label: string
  href: string           // /masters/<slug>
  api: string            // /api/masters/<slug>
  model: string          // Prisma model name, for serialize()
  group: string          // which card on /masters
  icon: string           // lucide name
  seeded?: string[]      // default values for a new tenant
}
export const MASTERS: readonly MasterDef[] = [ … ]        // all 17 existing, then the new ones
export const MASTER_SECTION_KEYS = MASTERS.map(m => m.key)
```

**Files to change so each derives from `MASTERS` instead of its own array:**
| File | What it holds today |
|---|---|
| `src/lib/permissions.ts:8` and `:24` | `MasterSection` union + `MASTER_SECTIONS` Set |
| `src/app/api/auth/me/route.ts:9` | `ALL_SECTIONS` |
| `src/app/api/settings/role-permissions/route.ts:6` | `ALL_SECTIONS` |
| `src/app/api/settings/roles/route.ts:41` | `ALL_SECTIONS` |
| `src/app/(protected)/settings/access-control/page.tsx` ~95-145 | the permission matrix list |
| `src/components/shell/nav.ts:96` | `MASTER_SECTIONS` |
| `src/components/ui/Sidebar.tsx:132` | a second, divergent `MASTER_SECTIONS` |
| `src/app/(protected)/masters/page.tsx:6` | `SECTIONS` card grid |
| `src/app/api/superadmin/companies/route.ts:100-127` | tenant seed |

⚠️ `MasterSection` is a **union type**, and `checkPermission`'s signature depends on it. Derive it
with `typeof MASTERS[number]['key']` and keep `PermSection` compiling — `tsc --noEmit` is the
proof.

**Acceptance:** `dealers`, `distributors` and `institutions` now appear on `/masters` and in the
Access Control matrix (fixing G10); `npm run lint` and `tsc --noEmit` clean; no permission
regressions for a non-Administrator role.

---

#### **P1-T4 · Create `src/lib/format.ts`** · S · no deps

`01-GAP-ANALYSIS.md` C6. `SYNC.md` calls this the single highest-value missing item.
Implements AGENTS.md §18.

```ts
export function fmtAmount(v: number | null | undefined): string   // ₹, Indian grouping, 2dp
export function fmtDate(iso: string | null | undefined): string    // DD Mon YYYY
export function fmtDateTime(iso: string | null | undefined): string
export function fmtQty(v: number): string
```

Replace the per-screen `fmtAmount` redefinitions — start with `orders/page.tsx`, which already has
one. **Do not** restyle those screens; swap the function only.

**Acceptance:** `grep -rn "function fmtAmount" src` returns exactly one hit.

---

### Track B — database and migration (after P1-T1)

---

#### **P1-T5 · Create the five Phase-1 tables** · M · after P1-T1

DDL per `02-DATA-MODEL-PLAN.md` §2.2 steps 1 and 7: `contacts`, `company_contacts`,
`company_addresses`, `contact_types`, `industries`, `custom_field_defs`, `custom_field_values`.

Follow the `lead_types` shape for the two masters exactly (`id`/`tenant_id`/`name`/`sort_order`/
`is_active`/`created_at`). **No RLS policies** — CLAUDE.md: the tables are RLS-capable with zero
policies, and enabling it returns zero rows for every query.

Then `npm run prisma:sync`. Verify `contacts.birthday`/`anniversary` (`@db.Date`) landed in
`src/lib/generated/date-only-fields.ts`.

**Acceptance:** `prisma/schema.prisma` shows all seven models with the expected column types;
date-only map regenerated; `npm run verify:data-layer` passes.

**Rollback:** `DROP TABLE` — nothing references them yet.

---

#### **P1-T6 · Add the new `business_partners` columns + backfill Owner** · S · after P1-T1

Steps 2-3. Add nullable `owner_user_id uuid`, `email text`, `website text`, `industry_id uuid`,
`is_complete boolean default false`, `completeness_missing text`.
Backfill `owner_user_id = created_by_user_id`. `npm run prisma:sync`.

⚠️ Bulk-imported rows have `created_by_user_id = NULL`, so `owner_user_id` stays NULL. **Do not
invent an owner.** Surface as "Unassigned".

**Acceptance:** `SELECT count(*) FROM business_partners WHERE owner_user_id IS NULL` matches the
count where `created_by_user_id IS NULL`.

---

#### **P1-T7 · Backfill Contacts and Addresses** · L · after P1-T5, P1-T6

Steps 4-6, exactly as scripted in `02-DATA-MODEL-PLAN.md` §4.2 and §4.4. Write it as a script in
`scripts/`, following the existing script conventions, **idempotent** (safe to re-run), and with a
`--dry-run` that reports counts without writing.

**It must report, not silently handle:**
- companies with no `contact_person_name` (→ zero contacts — legitimate)
- contacts created with a NULL mobile (→ `is_complete = false`) — **count this**
- duplicate company names / mobiles — **count, do not dedup** (§10)
- rows whose `stage` is not in `lead_stages` — **count, these block P2's Deal migration**

Then compute `is_complete` / `completeness_missing` per §3.5's full-record rule: Primary Address,
City, State, Pincode, GST Number. ⚠️ **`city` will be NULL for every migrated row** (no source
column — Q5), so if City is required, *every* migrated company is Incomplete. **Raise this at
P1-T1 and get a ruling before running the backfill.**

**Acceptance:** `--dry-run` totals reconcile with `SELECT count(*) FROM business_partners`; a
second real run changes nothing.

**Rollback:** `DELETE FROM company_contacts; DELETE FROM contacts; DELETE FROM company_addresses;`
— sources are untouched.

---

#### **P1-T8 · Rename the tables** · M · after P1-T7

Steps 8-10. `ALTER TABLE … RENAME`: `lead_types`→`company_types`, `lead_stages`→`deal_stages`,
`business_partners`→`companies`. Metadata-only, instant, reversible.
Then `npm run prisma:sync` and the code cutover.

**`business_partners.id` values must not change** — `orders.entity_id` and
`daily_visits.entity_id` are soft references with no FK to protect them.

⚠️ Re-register `next_follow_up_date` in `src/lib/generated/date-only-fields.ts` (it is at line 11
today under the old model name) or the wire contract silently changes from `"YYYY-MM-DD"` to full
ISO.

**Acceptance:** `npm run verify:data-layer`, `npm run smoke`, and
`npm run audit:tenant -- --batch phase1-rename` all pass. Masters → Dealers/Distributors/
Institutions still list correctly (their `where` clauses are untouched by a table rename).

---

#### **P1-T9 · Permission sections** · M · after P1-T1, P1-T3

Add `companies` and `contacts` sections; retire `leads`. Via `MASTERS`/`PermSection` from P1-T3.

**⚠️ The backfill is the dangerous half.** `GET /api/settings/role-permissions` returns `false`
for any section with no row, so a rename without a backfill **silently revokes access for every
non-Administrator**:
```sql
INSERT INTO role_permissions (tenant_id, profile, section, can_view, can_edit, can_delete, can_create, data_scope)
SELECT tenant_id, profile, 'companies', can_view, can_edit, can_delete, can_create, data_scope
FROM role_permissions WHERE section = 'leads'
ON CONFLICT DO NOTHING;
```
Same for `contacts`, `contact_types`, `industries`. **Keep the `leads` rows** for one release.

**Acceptance:** log in as a non-Administrator with `leads.view` and confirm Companies is visible
with identical rights. Then confirm a role *without* it cannot see the page.

---

### Track C — API (after P1-T8)

---

#### **P1-T10 · Convert `/api/leads` → `/api/companies`** · M · after P1-T8, P1-T9

**Files:** `src/app/api/leads/route.ts` → `src/app/api/companies/route.ts`;
`leads/[id]/route.ts` → `companies/[id]/route.ts`; the three bulk routes likewise.

Changes beyond the rename:
1. **Add `GET /api/companies/[id]`** — it does not exist today; only PUT and DELETE are exported.
   §3.2's Company page needs it. Include the linked contacts and addresses.
2. **Fix G5:** replace `prisma.update({ data: body })` with an explicit allow-list of columns.
3. **Fix G6:** `POST` must check `'create'`, not `'edit'`.
4. **Make `type` optional** (§3.3) — remove the 400 on missing type, client and server.
5. Add `email`, `website`, `industry_id`, `owner_user_id` to the accepted body.
6. **Move the GSTIN/mobile/pincode regexes into a shared module** — they are copy-pasted in four
   files today. Apply them to POST as well as PUT (POST validates none of them today).
7. Recompute `is_complete` on every write.

**Keep** the response shape: a **bare JSON array** for lists, the bare object for a single row,
`{error}` for errors. There is no envelope in this codebase — do not add one.

**Acceptance:** `GET /api/companies` returns the same rows the Leads list showed;
`GET /api/companies/<id>` returns the company with its contacts and addresses; POST without
`type` succeeds; POST with a malformed GSTIN 400s.

---

#### **P1-T11 · Build `/api/contacts`** · M · after P1-T5, P1-T9

New: `src/app/api/contacts/route.ts` (GET list, POST create) and `contacts/[id]/route.ts`
(GET, PUT, DELETE). Copy the pattern from `masters/dealers/route.ts` verbatim
(`00-CODEBASE-MAP.md` §4).

`GET /api/contacts/[id]` returns the contact **with its linked companies** (§3.2).
POST accepts `company_ids: string[]` and writes `company_contacts` rows — **a Contact may link to
many Companies** (§3.4). Validate `name` and `mobile` as compulsory; Owner defaults to the
Company's owner when exactly one company is linked.

**Acceptance:** create a contact linked to two companies; `GET` returns both; both company pages
show it.

---

#### **P1-T12 · Collapse `/api/business-partners` into the new surface** · S · after P1-T10

`01-GAP-ANALYSIS.md` B6/G4. Two API surfaces cover one table. This one is the lightweight
`{id,name}` picker for the meeting modal and has **no permission check at all**.

Keep the endpoint (the meeting modal depends on it) but: add
`checkPermission(user, 'companies', 'view')`, and repoint its `stage: status==='lead' ? {not:'Existing'} : 'Existing'`
logic at the renamed table. **Do not delete it in Phase 1** — `daily-activity/page.tsx` calls it
and that screen is Phase 3.

**Acceptance:** an authenticated user without `companies.view` gets 403; the meeting modal's party
picker still works for one with it.

---

### Track D — screens (after Track C; P1-T13 and P1-T14 may run in parallel)

---

#### **P1-T13 · Convert the Leads page into the Parties page** · L · after P1-T10, P1-T11

**This is the conversion §3.1 demands. Do not create a new file.**

**File:** `src/app/(protected)/leads/page.tsx` → `src/app/(protected)/parties/page.tsx`.
⚠️ It was rewritten onto `list-page` at commit `d07462b` on 18 Sep 00:46. **Re-read it first** —
this plan describes it structurally, not by line number, for exactly that reason.

1. **Two tabs** (§3.2) via `ListPage`'s `sectionTabs?: ReactNode` prop (zone 1a, AGENTS.md §33).
   Use `src/components/ui/section-tabs.tsx`.
   ⚠️ **Confirmed first consumer.** sfacrm-11 verified `grep -rn "sectionTabs" src/app` returns
   **nothing** — five screens were converted and none tried it. No prior art, no warnings.
   ⚠️ **The height chain is the risk, and there is a known-good recipe.** Whatever renders in that
   slot must be **`shrink-0`** or it eats zone 3's remainder. If you end up putting anything
   *above* `ListPage` rather than in the slot, use the pattern sfacrm-11 verified on two screens:
   wrap both in `className="flex h-full min-h-0 flex-col"`, mark your own element `shrink-0`, and
   pass `className="h-auto min-h-0 flex-1"` to `ListPage`. **The `h-auto` is load-bearing** —
   `cn()` is an extended `tailwind-merge`, so it drops the template's own `h-full` and leaves no
   `height:100%` to fight the flex basis. `masters/users` (breadcrumb) and `review` (banner) are
   the worked examples.
2. **Columns.** Companies: Name (`grow: true, truncate: true`), Company Type, Owner, City,
   Phone, Completeness badge, Actions. Contacts: Name (`grow`), Designation, Contact Type,
   Companies (count + tooltip), Mobile, Actions.
   ⚠️ **`grow` INVERTS on wide tables — corrected by sfacrm-11, which used the template five
   times.** `grow` is `w-full max-w-0`, which only absorbs slack when there *is* slack. On a table
   that already overflows it **collapses the identifier column instead** (measured at 32px).
   **Rule: `grow: true` on exactly one column IF the table fits; no `grow` at all if it
   overflows.** The current `leads` screen sets **no `grow`** for precisely this reason.
   ⚠️ **`truncate: true` narrows `cell` to return `string`** (a discriminated union), so a badge
   *plus* truncation is not expressible. Put badges in a non-truncating column. A clean
   `tsc --noEmit` proves this contract.
   ⚠️ **`list-page` cannot freeze a column and puts no `group` on `tr`.** AGENTS.md §10 rule 2
   mandates freezing past eight columns. `leads` has ten, overflows at 1280 (1177 vs 961), and
   **hand-rolls** `sticky left-0 z-20` with its own `bg-surface` and `[tr:hover_&]:…` row hover.
   It works and is verified — **but sfacrm-11 explicitly asks that it not be copied to a new
   screen before Aryan rules on it.** Keep the Parties tables at **eight columns or fewer** and
   the question does not arise. That is the constraint on the column list above.
   Carry the column-classification comment block (`essential` / `hide-below-1024` /
   `hide-below-768` and *why*) — AGENTS.md §10 rule 4 requires the declaration.
3. **Filters** via `ListPage.filters` — declared, never rendered. `''` means inactive and is also
   the "any" option key; never model a three-way `all|x|y`.
   Set `searchable: options.length > 6` dynamically.
4. **Fix G1:** the page reads `me.permissions.business`, **a section that does not exist**, so
   every non-Administrator currently sees the list with Add/Bulk/Edit/Delete hidden. Point it at
   `me.permissions.companies`.
5. **Incomplete badge** — add a vocabulary to `src/components/status-badge.tsx`, do not invent a
   local badge.

**Hard rules from the template (breaking one is a bug, not a style choice):**
- **Never `try/catch` inside `load` and return `[]`.** A rejection *is* the failed state;
  swallowing it turns a 500 into "nothing found". Named as the single most likely bug —
  `review` and `conversations` both shipped it.
- **Do not memoise `load`** — it is held in a ref; a new identity does not refetch.
- **Never wrap `<ListPage>` in a plain `div`** — it breaks the height chain and the *page* scrolls
  instead of zone 3. If a wrapper is unavoidable it must be
  `className="flex h-full min-h-0 flex-col"` with `ListPage` getting `className="min-h-0 flex-1"`.
  `review/page.tsx` is the worked example.
- **Do not add props to `list-page`** to make this screen fit. The author rejected an escape hatch:
  *"a hole in a template used twenty times is worse than the gap it closes."* If it does not fit,
  **stop and ask**.

**Acceptance:** `/parties` shows both tabs; each searches and filters independently; every row the
old Leads page showed still appears; a non-Administrator with `companies.edit` sees the Add
button.

---

#### **P1-T14 · Company detail page** · L · after P1-T10

**New:** `src/app/(protected)/parties/companies/[id]/page.tsx`. Nothing like it exists — there is
no detail page anywhere in the Parties area today.

Shows: the company header (Name largest, type/owner/status below — global UI rule 1), its
**Contacts** inline (§3.2), its addresses with the Primary marked, custom field values, and an
Incomplete banner naming exactly what is missing.

Breadcrumb via `src/components/ui/breadcrumb.tsx`. Back must return where the user came from.

**Acceptance:** clicking a company on `/parties` opens it; its contacts are listed; Back returns
to the list with filters intact.

---

#### **P1-T15 · Contact detail page** · M · after P1-T11

**New:** `src/app/(protected)/parties/contacts/[id]/page.tsx`. Shows the contact and **the
companies it is linked to** (§3.2) — plural, as a list, because the many-to-many is the point.

**Acceptance:** a contact linked to two companies shows both, each navigating to its company page.

---

#### **P1-T16 · Two-step Company form** · L · after P1-T14

§3.3/§3.4. **No drafts** — the Company is saved before contacts can be added.

Step 1 saves via `POST /api/companies` and returns an id. Step 2 shows "Add Contact", which opens
a dialog with the company name **pre-filled and locked**; on save the dialog closes and the user
returns to the company page, able to add another or finish.

Status (Active/Inactive) goes at the **end** of the form, not in the main field list.

⚠️ `src/components/masters/BusinessPartnerForm.tsx` is shared by **four** screens (Leads +
Masters → Dealers/Distributors/Institutions). **Do not restructure it in place.** Build the new
two-step form as its own component and leave `BusinessPartnerForm` serving the three Masters
screens untouched. Collapsing them is a later decision (Q13).

⚠️ Use `src/components/ui/dialog.tsx` (kit, §24 three widths), not the legacy `Modal.tsx`, for new
dialogs — but note **17 pages still use `Modal.tsx`** and this task does not migrate them.

**Acceptance:** create a company, press Next, add two contacts, finish. No draft row is created at
any point — verify by aborting between steps and confirming no orphan exists.

---

#### **P1-T17 · Quick Create** · M · after P1-T16

§3.5. Name + Mobile only (+ Company for a contact). Marks the record Incomplete.

⚠️ **A precedent already exists** — Daily Activity's "New Prospect" mode creates a partner from
name+mobile+place inline (`src/app/api/daily-activity/route.ts:40-60`). **Reuse that path rather
than adding a second one**; it is Phase 3's screen, so leave its UI alone but point it at the
shared create function.

**Acceptance:** a Quick-Created company appears in the list with an Incomplete badge naming what
is missing.

---

#### **P1-T18 · The two new masters** · M · after P1-T3, P1-T5

Contact Type and Industry/Segment, via the `MASTERS` registry (one entry each, now that P1-T3
exists). Seed per §10's defaults: Contact Type = Decision Maker, Influencer, Technical, Purchase,
Gatekeeper. Industry = a reasonable general list, flagged for Aryan's refinement.
Seeds go in `api/superadmin/companies/route.ts` or every new tenant starts empty.

⚠️ **Build these on `CrudPage`, NOT on `list-page`.** `list-page` has **no reorder capability and
no selection or sort API** (§22 and §27.2 are unimplemented). Four existing masters —
`lead-types`, `lead-stages`, `lead-temperatures`, `expense-categories` — pass **`onReorder`** to
`CrudPage`, and `sort_order` is part of the master table shape these two copy. A master on
`list-page` would silently lose ordering.
This is a **second template gap on the same screens** (the first being `backHref`). Do not solve
it screen-locally — a screen-local reorder is what the next person copies. Record it and move on;
`CrudPage` remains correct for masters until the template grows the capability.

⚠️ **The `backHref` violation:** all 13 small `/masters/*` screens pass `backHref="/masters"` to
`CrudPage`, which renders a back arrow that AGENTS.md **§1 rule 11 forbids**. `masters/users` was
fixed using `breadcrumb.tsx` and is the worked example. **Do not pass `backHref` on the two new
masters** — use a breadcrumb. Fixing the other 13 is out of this task's scope; they are listed in
`09-OPEN-QUESTIONS.md` for a later sweep.

Rename the `lead-types` page/route to `company-types`.

**Acceptance:** both masters CRUD from `/masters`; values appear in the Company form dropdowns;
a new tenant gets the seeds.

---

#### **P1-T19 · Eliminate the word "Lead"** · M · after P1-T13…T18

§3.7. 280 real hits across 32 files. **Do this last**, when the screens have already moved.

`grep -rniE "lead" src --include=*.ts --include=*.tsx`, excluding the CSS false positives
(`leading-none`, `leading-tight`) and `leader`/`leaderboard` (the points feature, unrelated).

Remaining after earlier tasks: `orders/page.tsx` (32 — `leadType` variable names and the
`entity_type` label), `daily-activity/page.tsx` (17), `status-badge.tsx`, `shell/nav.ts`,
`settings/access-control/page.tsx`, the three master pages.

⚠️ **Do not rename master *values*** (`Prospect`, `Existing`, `Dealer`) — `02-DATA-MODEL-PLAN.md`
§6. They are join keys in `orders.entity_type` and `daily_visits.visit_type` with no FK to
cascade, and `'Prospect'`/`'Existing'` are hardcoded in six route files.

**Acceptance:** the filtered grep returns zero hits in `src/`; the app builds; `npm run smoke`
passes.

---

## Parallelism

```
P1-T1 (pre-flight) ─── BLOCKS ALL
   ├── P1-T2  visibility fix      ─┐  independent
   ├── P1-T4  format.ts           ─┤  independent
   ├── P1-T3  master registry ─────┼── P1-T9 permissions ──┐
   └── P1-T5  new tables ──┐       │                       │
       P1-T6  new columns ─┴─ P1-T7 backfill ─ P1-T8 rename ┴─ P1-T10 companies API ─┬─ P1-T13 parties page
                                                             └─ P1-T11 contacts API ─┤   P1-T14 company detail
                                                                P1-T12 bp collapse    └─ P1-T15 contact detail
                                                                                          P1-T16 two-step form
                                                                                          P1-T17 quick create
                                                            P1-T18 masters (after T3,T5)
                                                                                          P1-T19 lead purge (last)
```

**Critical path:** T1 → T5/T6 → T7 → T8 → T10 → T13 → T16 → T19.
**Runs in parallel from the start:** T2, T4.
**Parallel once T8 lands:** T10 and T11; then T13, T14, T15 and T18.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `role_permissions` CHECK constraint blocks new sections | P1-T1 reads it first. If constrained, STOP — the plan changes |
| R2 | The rename silently revokes access for every non-Administrator | P1-T9's backfill, and an explicit non-Administrator login test |
| R3 | Migrating `stage='Existing'` opens a bogus Deal against every dealer | Phase 2's migration excludes it. Called out in `02-DATA-MODEL-PLAN.md` §4.3 |
| R4 | The four screens sharing `BusinessPartnerForm` break | P1-T16 leaves it untouched and builds alongside |
| R5 | City is required for completeness but has no source column | Raise at P1-T1; otherwise every migrated company is Incomplete (Q5) |
| R6 | `list-page`'s `sectionTabs` has never been used | P1-T13 is the first consumer. If it does not fit, **stop and ask** — do not add props |
| R7 | A `load` that swallows errors turns a 500 into "nothing found" | Named explicitly in P1-T13. Review every `load` before merge |
| R8 | Client-side pagination over every company row | Q2. Measure at P1-T1 (B-5 row counts) |
| R9 | The concurrent run touches the same files | Pre-flight `git log`; re-read any file before editing |
| R10 | `updated_at` is never written, so migrated ageing is fiction | `02-DATA-MODEL-PLAN.md` §4.3; set `stage_entered_at` at migration time (Q10) |
