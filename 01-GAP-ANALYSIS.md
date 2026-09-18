# 01 — Gap Analysis

Every requirement in `REBUILD-PLAN.md`, classified. Produced 18 Sep 2026 between 00:35 and 01:05
IST, read-only, against HEAD `6e2cec6` → `221f47e`.

**Classification**

| Code | Meaning |
|---|---|
| **EXISTS** | Works as required. No change. |
| **PARTIAL** | Exists but needs modification. The change is stated exactly. |
| **NEW** | Must be built from scratch. |
| **CONFLICT** | The requirement clashes with the existing code. The clash and a proposed resolution are stated. Resolution is *proposed*, not taken — requirement decisions are Aryan's. |

**Provenance rule.** Every row cites a file path, table or function. Where a finding came from a
grep rather than opening the file, it is marked ⚠️*inferred*. Where it rests on the schema
snapshot rather than the live DB, it is marked ⚠️*provisional* (see `07-REVISIT-QUEUE.md` R4).

---

## A. CONFLICTS — read these first

These are not gaps. They are places where REBUILD-PLAN.md and the codebase disagree, and a
decision is needed before or during the work.

### A1 — "Backend: NestJS" · §0.2 · **CONFLICT**
There is no NestJS. No monorepo, no controllers/services/DTOs. The backend is 118 route files
under `src/app/api/` in the same Next.js 14 app.
**Resolution:** read §0.2 as naming the *tiers*, not the frameworks. Every "backend" task in this
plan resolves to a route file following the pattern in `00-CODEBASE-MAP.md` §4. No migration to
NestJS is proposed or implied.

### A2 — "The frontend has already been migrated to rgb-kit v2" · §0.1 · **CONFLICT**
**Half true, and the misleading half matters.**
- *True:* all 41 files of `rgb-kit-v2/components/ui/` are present at `src/components/ui/` and are
  byte-identical modulo CRLF. `lib/utils.ts` and the kit's `globals.css` are in, with this
  product's `--primary: #3d3a6e`.
- *Not true:* the **screens** have not moved. `src/app/globals.css` ~line 23 says so in the app's
  own words: *"The 36 existing screens still use raw Tailwind palette classes; the colour
  migration is a later phase and has not started."*
- Nine home-grown PascalCase components still serve real screens: `CrudPage.tsx` (**14** master
  pages), `Modal.tsx` (**17** pages), `SearchableSelect.tsx` (8), `RemarksPanel.tsx` (4),
  `StatusBadge.tsx` (2), `CalendarPicker.tsx` (2), `Header/Sidebar/Toggle`.
- **Two toast systems are mounted at once** in `src/app/layout.tsx`: the kit's sonner `<Toaster/>`
  (used only by `/kitchen-sink`) and the legacy `ToastContext` (used by all 21 real screens).
**Resolution:** plan every *new* screen on the kit + `list-page`. Do **not** schedule a global
restyle of the 36 legacy screens — that is a separate programme and is not in REBUILD-PLAN.md.
Convert a legacy screen only when a phase already requires touching it.

### A3 — Mobile is mandatory, but the design system's narrowest target is 768 · §0.4 · **CONFLICT**
§0.4: *"Primary users are field sales people working on phones. Mobile usability is not optional."*
But `list-page.tsx`'s column tiers stop at `hide-below-768`; AGENTS.md §9 rule 6 defers "dedicated
mobile screens"; legacy screens (`daily-activity` 1685 lines, `review/[userId]` 656,
`access-control` 889) carry fixed multi-column layouts never checked below 1024; and **nothing was
verified at any width during the overnight run**.
**This cannot be resolved by putting more screens on a template whose narrowest declared target is
768.** Either a phone tier is agreed into AGENTS.md via its §30 process (pattern first, then
build), or the phone experience is the dedicated-mobile-screens work §9 rule 6 defers.
**Escalated to `09-OPEN-QUESTIONS.md` Q1. It affects every screen in every phase.**

### A4 — `role_permissions.section` may be CHECK-constrained in live · **CONFLICT / BLOCKER**
`prisma/schema.prisma:295` marks `role_permissions` as carrying check constraints.
`supabase/migrations.sql` (lines 16-18) warns its own copy *"allows 5 values while live data holds
23 distinct ones"*. **The real constraint exists only in the live database and in no file in this
repo.** If it still constrains `section`, every new permission section fails at runtime.
Phase 1 alone needs `companies`, `contacts` and three master sections.
**Resolution:** `\d role_permissions` against live is a **mandatory pre-flight**, in
`08-EXECUTION-SEQUENCE.md` step 0. Do not plan around a constraint nobody has read.

### A5 — Phase 2's Kanban has a process gate before any code · §4.2 · **CONFLICT**
rgb-kit ships **no kanban, board, or drag-and-drop component**, and AGENTS.md never mentions one.
AGENTS.md §30 requires a pattern the file does not cover be *agreed and written into AGENTS.md
first, then built*. REBUILD-PLAN §0.4 independently says "Do not invent new component patterns."
**Resolution:** Phase 2 opens with an AGENTS.md pattern-proposal task for the board, gated on
Aryan, before the Kanban build. Planned as task P2-T1 in `04-PHASE-2-PLAN.md`.

### A6 — `list-page` pagination is client-side; server returns every row · **CONFLICT**
`list-page.tsx` paginates **client-side** over the array `load` returns, and its own comment says
the `{rows, total}` server-paging shape is *"deliberately unbuilt. Do not invent it. Stop and
ask."* Meanwhile **every list route returns all rows** (`00-CODEBASE-MAP.md` §4) — only
`notifications` and two `points` routes use `take`/`skip`.
Today's Leads page additionally filters `stage`/`temperature`/`is_active` **in JS after the
fetch**.
**This works until a tenant has real volume, then it breaks everywhere at once.** Companies (every
business partner) and Deals are the two biggest lists in the rebuild.
**Escalated to `09-OPEN-QUESTIONS.md` Q2.** Assumption for planning: keep client-side paging for
Phases 1-2 (matching every existing screen) and treat server-side paging as its own task, not
smuggled into a screen task.

### A7 — "Lead Status master is re-pointed to Deals as Deal Stage" · §3.1 · **CONFLICT**
`lead_stages` holds seven seeded values, of which **`Existing` is not a funnel stage at all** — it
is the sentinel meaning *"this is a master record (Dealer/Distributor/Institution), not a lead"*.
`Prospect` and `Existing` are both `is_fixed: true`. Migrating `stage` straight into Deal Stage
would **open a bogus Deal against every dealer in the tenant**.
**Resolution:** re-point `lead_stages` minus `Existing` to Deal Stage; treat `Existing` as "no
Deal". Detailed in `02-DATA-MODEL-PLAN.md` §4. **This is the single highest-risk step in Phase 1.**

### A8 — "Temperature" and "distributor_id" have no home in the target model · **CONFLICT**
REBUILD-PLAN never mentions `business_partners.temperature` (Cold/Warm/Hot, with a
`lead_temperatures` master and a master screen) or `distributor_id` (the dealer→distributor link,
load-bearing for `/api/masters/distributors`, which back-joins dealers).
§"Behaviour is preserved" forbids silently dropping either.
**Escalated to `09-OPEN-QUESTIONS.md` Q3 and Q4.** Planning assumption: **keep both columns and
both behaviours untouched** in Phase 1. Dropping data is not a default.

---

## B. Phase 1 — Parties (§3)

⚠️ Every table shape below is **provisional** — `prisma/schema.prisma` is a `prisma db pull`
snapshot last refreshed 14 Sep (`e58187a`); the live DB was not queried.

### B1 — Migration from Leads (§3.1)

| Requirement | Class | Evidence / what must change |
|---|---|---|
| Migrate Lead records into Companies, nothing deleted | **PARTIAL** | Rows exist in `business_partners`, but that table **also** holds Dealers/Distributors/Institutions. There is no clean "which rows are Leads" predicate. See A7 and `02-DATA-MODEL-PLAN.md` §3 |
| Lead's person name/number becomes a Contact linked to the Company | **NEW** | `business_partners.contact_person_name` is a *text column*, not a record. No contact entity exists |
| Lead Type values carry over as Company Type | **EXISTS** | `lead_types` (schema:171). Rename only. Seeded Dealer/Distributor/Institution/End Consumer — these **are** Company Types |
| Lead Status master re-pointed to Deal Stage, not deleted | **CONFLICT** | See A7 |
| Active Leads in the funnel open as Deals | **NEW** | No deals table exists |
| **Convert the Leads page**, do not build a parallel module | **PARTIAL** | `src/app/(protected)/leads/page.tsx` — rewritten onto `list-page` at `d07462b` (00:46 tonight). Convert this file; do not create a new one |
| Rename tables/columns/routes rather than create new | **PARTIAL** | Table rename is cheap at DB level (no FK points at `business_partners` from anywhere). It is **expensive at the string level** — see B6 |
| Remove every "Lead" reference | **PARTIAL** | 280 real hits across 32 files (310/44 raw, incl. `leading-*` CSS false positives). See B6 |

### B2 — Parties screen, two tabs (§3.2)

| Requirement | Class | Evidence |
|---|---|---|
| One Parties page, two tabs | **NEW**, with a slot ready | `list-page.tsx` declares `sectionTabs?: ReactNode` (zone 1a, AGENTS.md §33) — *"Not built in this product yet; the slot exists so the first screen that needs one puts it where §33.2 allows"*. `ui/section-tabs.tsx` exists with **zero** real-screen usage. This is the intended first consumer |
| Each tab has its own list, search, filters | **EXISTS via template** | `ListPage` owns search (300 ms debounce), filters, pagination |
| Clicking a Company opens the Company page showing its Contacts | **NEW** | **There is no detail page and no `GET /api/leads/[id]`** — `leads/[id]/route.ts` exports only PUT and DELETE |
| Clicking a Contact opens the Contact page showing its Companies | **NEW** | — |

### B3 — Company form (§3.3)

| Field | Class | Evidence |
|---|---|---|
| Company Name, compulsory | **EXISTS** | `business_partners.name` NOT NULL |
| Company Type from master, **not** compulsory | **PARTIAL** | `type` exists but is **currently compulsory** — `POST /api/leads` returns 400 without it. The rule *inverts*: make it optional on client and server |
| Owner from Employee Master, defaults to logged-in user, editable | **PARTIAL → effectively NEW** | Only `created_by_user_id`: set on create, never editable, never shown on the form, **null for every bulk-imported row**. Needs a real `owner_user_id` column + backfill |
| Industry / Segment dropdown from master | **NEW** | No column, no table, no master screen |
| **Multiple addresses**, each with Line/City/State/Pincode/coords, one Primary | **NEW** | One `address` text, one `pincode`, one lat/long, one geography path per row. **There is no `city` column anywhere** — geography is states→districts→talukas→villages. Needs a new table *and* a City reconciliation decision (→ Q5) |
| Phone Number | **EXISTS** | `mobile_1`, `mobile_2` |
| Email | **NEW** | No column. ⚠️ The bulk-import template **already collects Email and silently discards it** (`bulk-import/route.ts` never writes it) |
| Website | **NEW** | — |
| GST Number | **EXISTS** | `gst_number` + GSTIN regex. ⚠️ Validated on PUT and in masters routes, **not on `POST /api/leads`** |
| Notes | **EXISTS** | `description` (rename) |
| **Custom Fields** | **NEW** | Nothing supports this. The only `Json` columns in the whole schema are `weekly_plan_audit_logs.edited_fields` and `weekly_plans.day_notes` — neither is a custom-field mechanism |
| Status Active/Inactive, at the **end** of the form | **PARTIAL** | `is_active` exists; the form does not render it at all (it is only the list's Switch column) |
| Two-step form: Next saves, then contacts | **NEW** | Today one `Modal`, one `onSave` |

### B4 — Contact form (§3.4)

| Field | Class | Evidence |
|---|---|---|
| Contact Person Name, compulsory | **NEW as a record** | `contact_person_name` is a string on the company row |
| **Contact linked to multiple Companies** | **NEW** | Nothing like it exists. The only join tables are `user_territory_mappings` (user↔geo) and `user_visibility` (user↔user) — useful as a *pattern* only |
| Designation | **NEW** | The `designations` master exists but belongs to `users` (employees), unrelated |
| Contact Type from master | **NEW** | New master |
| Owner, defaults to the Company's Owner | **NEW** | Depends on B3's `owner_user_id` |
| Mobile compulsory / Alternate / WhatsApp / Birthday / Anniversary | **PARTIAL / NEW** | `mobile_1`,`mobile_2` exist on the company row; the rest are new |
| Custom Fields, Status at end | **NEW / PARTIAL** | as B3 |
| Multi-company ⇒ ask which Company a Deal is for | **NEW** | Phase 2 dependency |

### B5 — Quick Create and completeness (§3.5)

| Requirement | Class | Evidence |
|---|---|---|
| Quick Create (Name, Phone, Company) | **PARTIAL precedent** | Daily Activity's "New Prospect" mode already creates a partner from name+mobile+place inline (`api/daily-activity/route.ts:40-60`). Not a feature, not marked, not reusable — but it proves the flow and should be folded in rather than duplicated |
| Record marked **Incomplete** | **NEW** | No completeness column, no derived flag, nothing in the UI |
| Order bookable against an Incomplete Party | **EXISTS** | `orders.entity_id/entity_type/entity_name` is a soft polymorphic link with no constraint |
| Order stays **Draft** and cannot be **Placed** until details filled | **NEW** | Nothing reads a party's completeness. Depends on Phase 2's Draft/Placed |
| Full-record compulsory: Primary Address, City, State, Pincode, GST | **PARTIAL** | State/Pincode/GST exist; **City does not exist**; Primary Address needs B3's new table |

### B6 — "The word Lead appears nowhere" (§3.7) — the rename blast radius

Command: `grep -rniE "lead" src --include=*.ts --include=*.tsx`, minus false positives
(`leading-*`, `leader`/`leaderboard`, `already`, `misleading`). **280 hits across 32 files.**

Top files: `leads/page.tsx` 86 · `orders/page.tsx` 32 · `daily-activity/page.tsx` 17 ·
`BusinessPartnerForm.tsx` 14 · `status-badge.tsx` 11 · `leads/bulk-import` 10 ·
`leads/bulk-template` 8 · `shell/nav.ts` 7 · `settings/access-control/page.tsx` 7.

Split by kind:
- **Prisma models (3):** `lead_stages`, `lead_temperatures`, `lead_types` — no relations, so a
  model rename is structurally cheap.
- **API route paths (8):** `/api/leads/*` (5), `/api/masters/lead-{types,stages,temperatures}` (3 dirs).
- **Page routes (4):** `/leads`, `/masters/lead-{types,stages,temperatures}`.
- **Permission section values (4):** `'leads'`, `'lead_types'`, `'lead_stages'`,
  `'lead_temperatures'` — **these are DATA in `role_permissions.section`, duplicated across seven
  hardcoded lists.** See A4 and C3.
- **UI strings and types:** the remainder.

⚠️ **Two API surfaces cover the same table** — `/api/leads/*` and `/api/business-partners` — so
the plan must *collapse* them, not rename both.

### B7 — Phase 1 masters (§3.6)

| Master | Class | Evidence |
|---|---|---|
| Company Type | **EXISTS** | `lead_types` + page + CRUD routes. Rename |
| Contact Type | **NEW** | Full 10-11 file recipe (C3) |
| Industry / Segment (pre-loaded, editable) | **NEW** | Full recipe **plus** a seed in `api/superadmin/companies/route.ts:100-127`, or every new tenant starts empty |

---

## C. Cross-cutting machinery

### C1 — Access filter, Self/Team/Company (§6.6) · **PARTIAL — the mechanism already exists**

| Requirement | Class | Evidence |
|---|---|---|
| Three levels on the Employee Master | **EXISTS** | `role_permissions.data_scope` (`'own'\|'team'\|'all'`, default `"team"`), read by `getDataScope()` |
| Team derived from the existing Manager selection | **EXISTS** | `users.manager_user_id`, self-FK, relation `"usersTousers"`. Set at `masters/users/page.tsx` ("Manager" / "Reporting Manager") |
| **Team means the full chain below** | **EXISTS** | `cascadeVisibilityUp()` walks upward to the root with cycle protection, materialising `user_visibility`. Read in all three copies: `masters/users/route.ts:140`, `masters/users/[id]/route.ts:228`, `access-control/visibility/bulk-import/route.ts:28` |
| Written **once** as a shared rule, reused everywhere | **NEW (small)** | No such helper exists. `getDataScope` + `getVisibleUserIds` are composed by hand in **exactly one route**. Proposed: `src/lib/scope.ts` with `scopedUserIds()` + `scopeWhere()` (~30 lines) |
| Applied to every list, summary and report | **NEW (broad)** | See C2 |
| A company-level summary sheet | **NEW** | Phase 4 |
| Do not build access-control screens | **n/a** | `/api/access-control/*` and `settings/access-control/page.tsx` already exist and are Administrator-only. **Leave them alone** — they are §9 item 2's deferred work |

### C2 — Which endpoints honour the scope today · **the real gap**

Only **`/api/orders`** honours the Self/Team/Company setting. Of the six §6.6 data types:

| Data type | Today |
|---|---|
| Orders | scoped ✓ (but `?userId=` **overrides the filter entirely** — `orders/route.ts:57`) |
| Plans | hard-wired "manager sees chain" (`weekly-plans/review`, `…/summary`) |
| Summaries | same |
| Meetings (`daily-activity`) | hard-wired **Self** — `user_id: user.userId` ⚠️*inferred from grep* |
| Expenses | hard-wired **Self** ⚠️*inferred* |
| Attendance | hard-wired **Self** ⚠️*inferred* |
| Leads | hard-wired **Company** — `/api/leads` never calls `getDataScope` or `getVisibleUserIds` |
| Deals | does not exist |

⚠️ Agent D marked `weekly-plans/my`, `weekly-plans/day` and `notifications` as **assumed from the
route name, not opened**. Verify before relying on them.

### C3 — Adding a master costs 10-11 files across seven duplicated lists · **PARTIAL**

There is **no registry**. A master's permission key is duplicated across seven hardcoded arrays,
all hand-maintained:
1. `src/lib/permissions.ts:8` (`MasterSection` union) **and** `:24` (`MASTER_SECTIONS` Set)
2. `src/app/api/auth/me/route.ts:9` (`ALL_SECTIONS`) — omit it and `me.permissions[key]` is `undefined` everywhere
3. `src/app/api/settings/role-permissions/route.ts:6`
4. `src/app/api/settings/roles/route.ts:41`
5. `src/app/(protected)/settings/access-control/page.tsx` ~95-145 — omit it and **no admin can ever grant the permission**
6. `src/components/shell/nav.ts:96`
7. `src/components/ui/Sidebar.tsx:132` — **already divergent**, it omits `dealers`/`distributors`/`institutions`

Plus `masters/page.tsx:6` (`SECTIONS` card grid — which **also** already omits those three) and
the tenant seed in `api/superadmin/companies/route.ts:100-127`.

**Five new masters are needed across Phases 1-2 ⇒ ~55 file touches.**
**Resolution:** one task, early in Phase 1, collapsing these into a single `MASTERS` config array
every consumer derives from. Planned as P1-T3. This pays for itself on master #2.

### C4 — Settings store · **NEW**
No generic key/value store, and no `app_settings`/`tenant_settings`/`system_settings` table.
Closest precedent is `tenant_point_settings` (`tenant_id` **is** the PK). §8's three settings need
a new `tenant_settings` table + `src/lib/settings.ts` reader + a `/settings/system` screen.
⚠️ **There is no scheduler of any kind in this codebase**, so §5.3's auto-checkout has nothing to
hang off — that mechanism is itself NEW (→ Q6).

### C5 — Note threads · **EXISTS — reuse it**
`contextual_remarks` (+ `remark_reads`, `notifications`) is already a tenant-scoped, timestamped,
threaded note primitive keyed by `(context_type, context_id)`, with read-tracking and
notification fan-out. Context types written today: `meeting`, `expense`, `weekly_plan_day`,
`weekly_plan`. **No remark points at a lead today.**
Phase 2 Deal Notes, Phase 3 Minutes of the Meeting and Phase 4 Manager Comments should all be new
`context_type` values on this table, **not three new tables**.

### C6 — `lib/format.ts` does not exist · **NEW**
Neither in the kit nor in sfacrm. AGENTS.md §18's `DD Mon YYYY`, Indian digit grouping, `₹` and
two-decimal amounts are hand-written at each call site (`fmtAmount` redefined per screen).
`SYNC.md` calls this *"the single highest-value item"*. Phases 2, 4 and 5 are money- and
date-heavy. Planned as a shared task, P1-T4.

---

## D. Phase 2 — Deals (§4)

**The Deal entity is 100% greenfield.** No `deals` table, no routes, no pages.

| Requirement | Class | Notes |
|---|---|---|
| Deal fields (§4.1) | **NEW** | Product/Product Category come from the existing `products` hierarchy — **EXISTS** |
| Probability slider, 11 stops of 10 | **NEW** | No slider component in the kit's 41 → §30 gate or an `input[type=range]` decision |
| Company/Contact creatable from inside the Deal form | **NEW** | Depends on Phase 1 Quick Create |
| List view | **NEW**, on `list-page` | — |
| **Kanban view + drag-and-drop** | **NEW + CONFLICT** | See A5. No component, no AGENTS.md pattern |
| Deal card, fixed six-item layout | **NEW** | — |
| Notes and Logs | **PARTIAL** | Reuse `contextual_remarks` (C5) for notes; stage-change logs are new |
| Follow-ups, multiple per Deal | **NEW** | Today `business_partners.next_follow_up_date` is a single date column |
| Closing Won/Lost, Reason for Loss master | **NEW** | New master (C3 recipe) |
| Ageing / days in stage / alert | **NEW** | Needs the §8 ageing-limit setting (C4) |
| Attachments | **NEW** | R2 plumbing **EXISTS** (`src/lib/r2.ts`, `/api/expenses/upload`, `/api/expenses/photo/[id]` with a 302 to a 300 s signed URL). **No file-upload component exists** in the kit — AGENTS.md §29 is a rule with no code |
| Filters, Pipeline header strip | **NEW** | `ListPage.filters` covers the filter UI |

### D1 — Order module change (§4.10)

| Requirement | Class | Evidence |
|---|---|---|
| Two states, Draft and Placed | **PARTIAL + data decision** | ✅ **CORRECTED 18 Sep 01:30 against live.** `orders.status` **DOES** have `CHECK (status IN ('Draft','Submitted','Confirmed'))`. An earlier draft of this row said it did not and called `status-badge.tsx`'s comment false — **that was my error; the comment is correct.** It came from inferring absence from Prisma's `/// contains check constraints` doc comment, which is **not emitted for `orders`** — the marker is not a reliable signal for absence. The constraint must be **ALTERed** to `('Draft','Placed')`; see `02-DATA-MODEL-PLAN.md` §8.1. Live data: **all 8 orders are `Confirmed`**. `Delivered`/`Cancelled`/`Rejected` are not even legal values, yet `masters/users/[id]/deactivation-summary/route.ts:19` filters `notIn` them — so its "open orders" count returns *all* orders (G7). **`Submitted` has no home in a two-state model** → Q7 |
| ⚠️ **NEW BLOCKER — `orders.entity_type`** | **CONFLICT** | `CHECK (entity_type IN ('Dealer','Distributor'))` — **only two values**, while the tenant already holds 45 Institutions and 74 End Consumers. An order against either **fails at write time**; it has not surfaced only because all 8 orders have `entity_type` NULL. Phase 1 makes Company Type user-defined, so **any** new type breaks order creation. The constraint must be dropped in **Phase 1**, not Phase 2. See `02-DATA-MODEL-PLAN.md` §8.4 |
| Orders creatable without a Deal | **EXISTS** | `order_source: 'direct'` flow already exists |
| Product Master carries the Rate | **EXISTS** | `products.price Decimal(12,2)` |
| Item-wise and overall discounts | **NEW** | **Zero discount support at any layer**, proved twice: `grep -rni "discount" src prisma scripts -l` → zero files; and the complete column lists of all six candidate tables contain nothing discount-shaped |
| Discounted orders flagged | **NEW** | Proposed stored `orders.has_discount boolean` so it is indexable and serves §7.2's Yes/No dimension |

⚠️ **Order totals are computed twice today** — server-side in `POST /api/orders` from
client-supplied `qty`/`rate`, and independently in the browser. Discounts triple that duplicated
arithmetic. The calculation must move to one shared module, with the **route** as the authority
re-reading `products.price`; otherwise §7.4's "Discount Given by Sales Person" reports over
numbers a rep typed.

---

## E. Phase 3 — Planning and Activity (§5)

**Better news than the plan assumes.**

| Requirement | Class | Evidence |
|---|---|---|
| **A Meeting entity** | **EXISTS** | `daily_visits` (schema:69) — `start_time`, `end_time`, `duration_secs`, `latitude`/`longitude`, **`end_latitude`/`end_longitude`/`end_address`**, `status`, `notes`, and a 1:1 `orders` relation |
| Start/Stop toggle capturing two locations (§5.4) | **PARTIAL** | Both location pairs already exist and are written. Needs the single-toggle UI |
| Flag when start/end locations are far apart, default 500 m | **PARTIAL** | A distance check exists as a **hardcoded `0.001`** in `review/[userId]/page.tsx`'s `ReviewVisitCard`. Needs a real distance function (server-side on `daily_visits`) + the §8 setting |
| Unplanned meetings + Quick Create | **PARTIAL** | The "New Prospect" inline-create path already exists (B5) |
| Past/manual meeting entry, marked Tentative, counted | **NEW** | No manual-entry marker column |
| Minutes of the Meeting | **PARTIAL** | `daily_visits.notes` exists; richer threads → reuse `contextual_remarks` (C5) |
| Remove Location from Weekly Plan (§5.1) | **PARTIAL** | `weekly_plan_items` has `from_place`/`to_place` free text, `mode_of_travel`, `new_dealers_goal`, `existing_dealers_goal` |
| Add a Parties dropdown to the plan | **NEW** | `weekly_plan_items` has **no party reference at all** — this is additive, not a rename |
| Weekly goal checklist, 5 blank rows | **NEW** | Replaces the existing free-text description box |
| Per-line expected order value | **NEW** | — |
| Fix the page scroll | **PARTIAL / verify** | Commit `4af0952` "Make the shell's content wrapper the scroll container" may already have fixed it. `list-page` consumer rule 5 (never wrap `ListPage` in a plain div) is the related trap |
| Weekly Plan Approval screen (§5.2) | **PARTIAL** | The full state machine exists — 17 routes, submit/approve/reject/suggest/hold/edit-by-manager/request-reopen/accept/decline. ⚠️ **None calls `checkPermission`** despite a `weekly_plan` section existing |
| "See what changes my Manager made" | **NEW** | Agent F: the audit log **cannot** render this today |
| Daily Activity: approved items pre-loaded, manual selection removed | **PARTIAL** | — |
| Check-in/out, auto check-out at a configurable time | **PARTIAL + NEW** | `attendance` table and check-in/check-out routes exist. **No scheduler exists anywhere** → the auto-checkout mechanism is new (→ Q6) |
| Expenses: logic unchanged, restyle only | **EXISTS** | Confirmed — no functional change |

---

## F. Phase 4 — Summaries (§6) and Phase 5 — Reports (§7)

| Area | Class | Notes |
|---|---|---|
| Daily Summary sheet (§6.1) | **PARTIAL** | `/api/review/*` and `/api/dashboard/*` compute some of it. Item-by-item mapping is in Agent F's notes §5.2 |
| Weekly Review (§6.2) | **PARTIAL** | as above |
| Journaling (§6.3) | **NEW** | — |
| Manager Summary-of-summaries + drill-down (§6.4) | **PARTIAL** | `/api/weekly-plans/summary` and `/api/dashboard/manager` are the seed |
| Manager comments, one + one reply (§6.5) | **PARTIAL** | **Reuse `contextual_remarks`** (C5). Do not build a new table |
| **Report engine (§7.1)** | **NEW — ~95% greenfield** | No report infrastructure. `recharts` and `exceljs` are dependencies already in use elsewhere |
| Ten ready-made reports (§7.4) | **NEW** | Pre-configured combinations over the engine |
| Data-health alerts (§7.7) | **NEW** | Depends on Phase 1 completeness flag |

---

## G. Defects found in passing — cheap to fix during the work they touch

Not requirements. Recorded so they are fixed deliberately rather than discovered.

| # | Defect | Where | Fix during |
|---|---|---|---|
| G1 | `leads/page.tsx` reads `me.permissions.business`, **a section that does not exist** — so every non-Administrator sees the Leads list with Add/Bulk/Edit/Delete/Active all hidden regardless of grants | `leads/page.tsx:481-482` | Phase 1 |
| G2 | **Re-parenting data leak.** Moving a user to a new manager never re-cascades their subtree: the old manager keeps seeing the grandchildren, the new manager never gets them. **CONFIRMED from code** — both calls take only `params.id`; there is no descendant walk anywhere | `masters/users/[id]/route.ts:83-93`, `:228`, `:253` | **Before** C1 rolls out, else the filter faithfully enforces wrong data |
| G3 | `?userId=` overrides the orders scope filter entirely — any caller can name another user's id | `orders/route.ts:57` | Phase 4 (C1). Intersect, never replace |
| G4 | `/api/business-partners` has **no permission check at all** | `api/business-partners/route.ts` | Phase 1 |
| G5 | `PUT /api/leads/[id]` passes the request body straight into `prisma.update(data: body)` — mass assignment | `leads/[id]/route.ts` | Phase 1 |
| G6 | `POST /api/leads` checks `'edit'`, not `'create'` | `leads/route.ts` | Phase 1 |
| G7 | `deactivation-summary`'s `notIn: ['Delivered','Cancelled','Rejected']` excludes nothing | `masters/users/[id]/deactivation-summary/route.ts:19` | Phase 2 (D1) |
| G8 | `status-badge.tsx` twice claims `orders.status` is CHECK-constrained. **False** | `status-badge.tsx` | Phase 2 (D1) |
| G9 | `dashboard/stats` counts dealers/distributors with no `stage` filter, so prospects inflate the numbers and disagree with the Masters pages | `api/dashboard/stats` | Phase 4 |
| G10 | `Sidebar.tsx`'s `MASTER_SECTIONS` and `masters/page.tsx`'s `SECTIONS` both already omit `dealers`/`distributors`/`institutions` | both files | Phase 1 (C3) |
| G11 | `leaderboard` and `points_config` exist in `permissions.ts` but are missing from `ALL_SECTIONS`, so they can never be granted | `settings/role-permissions/route.ts` | opportunistic |
| G12 | Two toast systems mounted at once | `src/app/layout.tsx` | opportunistic |
| G13 | `business_partners.sub_type` is read and written by **no route and no page** — dead column | schema:10 | Phase 1 (confirm against live data first) |
| G14 | `business_partners.updated_at` is **never written** by any route | schema:10 | Phase 1 — any logic trusting it is trusting `created_at`'s twin |
