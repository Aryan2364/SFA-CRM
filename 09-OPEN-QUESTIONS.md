# 09 — Open Questions

Everything this run could not resolve from the code or the requirements. For each: the question,
why it matters, **the assumption being proceeded on**, and what changes if that assumption is
wrong.

**No question stopped the work.** Assume, flag, continue — but every assumption here is marked as
an assumption, never buried inside a task description.

**Routing note:** requirement decisions belong to Aryan. `REBUILD-PLAN.md` §12 lists what is
already closed and is not reopened here.

---

## Blocking — answer before the tasks named

### Q1 · Mobile: the design system's narrowest target is 768, but the users are on phones
**Why it matters:** `REBUILD-PLAN.md` §0.4 — *"Primary users are field sales people working on
phones. Mobile usability is not optional."* But `list-page.tsx`'s column tiers stop at
`hide-below-768`; AGENTS.md §9 rule 6 defers "dedicated mobile screens"; the legacy screens
(`daily-activity` 1685 lines, `review/[userId]` 656, `access-control` 889) carry fixed
multi-column layouts never checked below 1024; and **nothing was verified at any width during the
overnight conversion run**. Global UI rules also require ≥44px touch targets and ≥16px inputs,
neither of which has been measured.
**This cannot be fixed by putting more screens on a template whose narrowest declared target is
768.**
**Assumption:** build Phases 1-2 to the 768 tier, and treat phone support as a separate,
explicitly-scoped piece of work.
**If wrong:** every screen in every phase is affected, and Phase 2's drag-and-drop Kanban is the
worst case — touch drag on a phone is a different interaction, not a narrower one.
**Blocks:** P2-T8 (Kanban). **Affects:** everything.

### Q5 · "City" is a required field with no source column
**Why it matters:** §3.3 lists City in the address, and §3.5 makes City compulsory before an order
can be placed. **There is no `city` column anywhere in the schema** — geography is the
states→districts→talukas→villages hierarchy. So City is NULL for every migrated company.
**Assumption:** add a `city text` column to `company_addresses`, leave it NULL on migration, and
**exclude City from the completeness rule for migrated records only**.
**If wrong** (City is genuinely required for everyone): **every migrated company is Incomplete on
day one**, and therefore no order can be placed against any of them until someone types a city for
each. That is a business-stopping outcome, which is why it needs an answer rather than a default.
**Alternative worth considering:** derive City from `talukas.name` or `villages.name` at migration.
**Blocks:** P1-T7.

### Q7 · `orders.status = 'Submitted'` has no home in a two-state model
**Why it matters:** §4.10 requires exactly two states, Draft and Placed. Today's values are
`Draft`, `Submitted` and `Confirmed` — and `Confirmed` is the **DB default**, so every
meeting-sourced order silently has it. `Submitted` is a genuine third state ("sent, awaiting
confirmation").
**Assumption:** `Confirmed` → **Placed**; `Submitted` → **Draft**. Reasoning: §7.7 expects Draft
to be the "stuck, needs processing" bucket (*"Pending Draft Orders… with the reason each is
stuck"*), which is exactly what Submitted means today.
**If wrong:** orders already sent to customers get pulled back into Draft, and §7.7's data-health
alert fills with orders that are not actually stuck. Reversible for one release via the
`status_legacy` column P2-T12 retains.
**Note:** `orders.status` has **no CHECK constraint**, so live may hold values absent from the
code entirely. The pre-flight `SELECT status, count(*)` settles it.
**Blocks:** P2-T12.

### Q8 · What is a Company?
**Why it matters:** the highest-consequence decision in the rebuild. `business_partners` holds
Dealers, Distributors, Institutions **and** leads; `/api/leads` returns all of them and the page
hides non-leads client-side; four screens share the table and the form.
**Assumption:** **every `business_partners` row becomes a Company.** The seeded `lead_types`
values (Dealer, Distributor, Institution, End Consumer) *are* Company Types, which is exactly
what §2's mapping says. Only rows with `stage != 'Existing'` additionally get a Deal.
**If wrong** (a Company is only a funnel row): every dealer and distributor is stranded outside
Parties while three Masters screens still edit them — two contradictory front doors onto one
table. Rejected for that reason, but it is a requirement call.
**Blocks:** conceptually, all of Phase 1. Full reasoning in `02-DATA-MODEL-PLAN.md` §3.

---

## Structural — needed during the phase, not before it

### Q2 · Client-side pagination over every row
`list-page` paginates **client-side** over whatever `load` returns, and its own comment says the
`{rows,total}` server-paging shape is *"deliberately unbuilt. Do not invent it. Stop and ask."*
Meanwhile **every list route returns all rows**. This works until a tenant has volume.
**Assumption:** keep client-side paging for Phases 1-2, matching every existing screen; treat
server-side paging as its own task, never smuggled into a screen task.
**If wrong:** the Companies and Deals lists degrade, and the fix touches `list-page` (used by
every converted screen) plus every list route. The pre-flight row counts (B-5) tell us how urgent
this is.

### Q3 · `temperature` / the `lead_temperatures` master have no home in the target model
Cold/Warm/Hot, with a master and a master screen. `REBUILD-PLAN.md` never mentions it.
**Assumption:** **keep the column, the master and the screen untouched.** "Behaviour is preserved"
— dropping data is not a default.
**If wrong** (it should fold into the Deal, or be dropped): a small, isolated change, safe to make
later.

### Q4 · `distributor_id` has no home in the target model
The dealer→distributor link, load-bearing for `/api/masters/distributors`, which back-joins its
dealers.
**Assumption:** **keep it.** Dropping it breaks that screen.
**If wrong:** Parties may need a company→company relationship concept, which REBUILD-PLAN does not
describe. That would be new requirements, not a gap to fill.

### Q6 · There is no scheduler anywhere in this codebase
§5.3 needs auto check-out at a configurable time. There is **no cron, no job runner, no queue**.
**Assumption:** a lazy sweep on the next authenticated request of the following day — no new
infrastructure — unless Aryan prefers an OS-level timer on the EC2 host.
**If wrong:** it is a deployment change (systemd timer or a sidecar process), not just code.
Whatever is chosen must run **per tenant** — the app is multi-tenant and midnight is the tenant's
midnight.
**Blocks:** P3-T6.

### Q9 · `next_follow_up_date` on a company with no Deal
§4.5 turns the single date into multi-row Follow-ups on the **Deal**. A company with a follow-up
date but no funnel stage has nowhere to put it.
**Assumption:** carry it over only where a Deal is created; **report the count** of rows where it
is dropped.
**If wrong:** follow-ups quietly vanish for those parties. The reported count makes it visible.

### Q10 · Migrated deals have a fictional "days in current stage"
`business_partners.updated_at` is **never written by any route**, so it equals `created_at`. Using
it as `stage_entered_at` makes every migrated Deal look years stale, and §4.7's ageing alert fires
on all of them at once.
**Assumption:** set `stage_entered_at` to the **migration timestamp**, so ageing starts at
go-live.
**If wrong:** genuinely old deals look fresh for their first cycle. The alternative is worse.

### Q11 · Normalise the string master-keys to FKs, or leave them?
`type`, `stage`, `temperature` are free text matched to masters **by name**, with no FK and no
cascade — and the same strings are denormalised into `orders.entity_type` and
`daily_visits.visit_type` as history. **Renaming a master value silently orphans history.**
**Assumption:** leave the strings alone in Phase 1 (rename tables and columns only); normalise to
FKs in Phase 2, when Deal Stage needs `deal_stage_id` as a real FK anyway.
**If wrong:** Phase 1 grows considerably, and every unmatched string must be reported rather than
guessed.
⚠️ Related: `daily_visits.visit_type` has a **CHECK constraint**
(`'Dealer','Distributor','Institution / Consumer'`) while the UI sources its options from the
lead-types master. **A user-defined Company Type can already drift outside that constraint and
fail at write time.** This is a live latent bug, not a new risk.

### Q12 · Manual `user_visibility` overrides would be erased by a rebuild
`POST /api/access-control/visibility` lets an Administrator insert an arbitrary (viewer, target)
pair, with **no marker column** distinguishing it from a cascaded row.
`removeAncestorVisibility`'s own comment admits it cannot tell them apart. P1-T2's rebuild would
delete them.
**Assumption:** none exist. **P1-T2 must check before running** — if any do, the table needs an
`is_manual` column first.
**If wrong:** hand-granted visibility silently disappears, and §6.6's "Team is derived from the
Manager field" is not actually true of this tenant's data.

### Q13 · `BusinessPartnerForm` is shared by four screens
Leads + Masters → Dealers / Distributors / Institutions, all through one component and one table.
**Assumption:** build the new two-step Company form alongside it and **leave
`BusinessPartnerForm` serving the three Masters screens untouched**.
**If wrong:** the Masters screens eventually want the new form too, and the two diverge. A later
consolidation, not a Phase 1 problem.

### Q14 · Raw SQL in the report engine vs the tenant audit
There is **no raw SQL anywhere in this repo** (`$queryRaw`/`$executeRaw`: zero hits). Phase 5's
two-dimension grouping is where it becomes tempting. `npm run audit:tenant` does a **static scan**
for `tenant_id` predicates and may not recognise one inside a raw string.
**Assumption:** prefer Prisma aggregation; if raw SQL is introduced, extend
`scripts/audit-tenant-scope.mjs` **in the same task**.
**If wrong:** the tenant audit silently stops covering the highest-risk queries in the system.

---

## Defaults taken from `REBUILD-PLAN.md` §10 — recorded, not re-decided

| Item | Default used |
|---|---|
| Deal stage ageing limit | **15 days**, settable via `tenant_settings.deal_stage_ageing_days` |
| Follow-up overdue warning | same day it becomes overdue |
| Industry/Segment master values | a reasonable general list, flagged for refinement |
| Contact Type master values | Decision Maker, Influencer, Technical, Purchase, Gatekeeper |
| Probability bands | 0-30 / 40-60 / 70-100, **registry-driven, not inlined** |
| Expense categories | unchanged — use whatever exists |
| Company Type on a Contact with no Company | left blank, never forced |
| Migration edge cases | migrate as-is, flag Incomplete, **report counts** |
| Chart types | chosen per report, for Aryan's review |
| Reports menu position | top-level menu item |

---

## Environment and process

### E1 · The "data migration" — two readings, neither chosen
Aryan states a data migration with write access is running across the software. What this run
could **observe** is a *frontend* list-page conversion run (`overnight-queue-2026-09-18.md`):
eight commits between 23:21 and 00:58, every one touching only `src/app/(protected)/*` and
`src/components/*`.
Against that: **`prisma/schema.prisma` has an mtime of 14 Sep 16:38** and an identical blob hash
(`54d1d7c4…`) read at two different HEADs 23 minutes apart.
- **Reading 1:** the "migration" *is* that frontend run. Evidence: every commit tonight.
- **Reading 2:** a separate DB-level migration is running that leaves no git trace. Evidence:
  Aryan's statement. Invisible to a read-only inspection, since `schema.prisma` only changes when
  someone runs `prisma db pull`.
**Neither was chosen.** The pre-flight in `08-EXECUTION-SEQUENCE.md` is safe under both.

### E2 · The live database was never queried
Barred by the read-only constraint. **Everything about table shapes is a three-day-old snapshot**
and everything about data volume and distribution is unknown: row counts, how many companies carry
a `contact_person_name`, how many carry a `mobile_1`, how many are duplicates, what `type` and
`stage` values actually exist, what the CHECK constraint bodies are, what any real role is granted
in `role_permissions`.
**The Lead→Company+Contact split's difficulty is a function of those distributions, not of the
DDL.** All of it is in the pre-flight.

### E3 · The running app on port 3007 was never opened
Port 3007 was confirmed listening (PID 11480). **No agent contacted it** — deliberately, to honour
the read-only constraint, since logging in creates a session and exercises write paths.
Consequence: **every behavioural conclusion in these documents is from reading code, not from
clicking anything.** Specifically unverified: the `me.permissions.business` bug (G1), the
weekly-plan scroll bug, the two-tab `sectionTabs` slot actually rendering, and all responsive
behaviour (Q1).
`overnight-queue-2026-09-18.md` N2 also records the documented password (`Admin@123`) as **stale**
— an existing browser session cookie works, a fresh login may not.

### E4 · Sub-agent accountability — one real gap, and what covers it
Six inspection agents ran. All six ultimately produced provenance and a stated stop reason, but
two needed re-dispatching to get one, and one failed mid-run.

| Agent | Area | Stop reason | Assessment |
|---|---|---|---|
| A | Backend + schema | Stopped **twice** without a reason. Third attempt gave a full account | ⚠️ **see below** |
| B | Frontend + rgb-kit | Stated | Accepted |
| C | Leads module | **FAILED** mid-run — "API Error: Connection lost mid-response". Recovered, completed, gave a full account | Accepted |
| D | Access Control | Stopped without a reason once; then gave the best account of the six | Accepted |
| E | Orders/Products/Masters | Stated, with per-file fingerprinting | Accepted |
| F | Activity/Settings | Stated, with per-file fingerprinting | Accepted |

**⚠️ Agent A's route inventory is largely inference and must not be trusted as a claim about
behaviour.** By its own account it **opened 9 of 115 route files (8%)**; the "what it does" column
for **78 routes is name-inference**, and **all 17 weekly-plan routes were unread**. Its §2 (schema),
§3 (route patterns), §5 (validation) and §6 (inconsistencies) *do* rest on direct reads and are
used here; its route table is not.

**What covers the hole — overlapping coverage, not luck:** weekly-plans were read route-by-route
by **F**; leads by **C**; orders/products/masters by **E**; access-control/auth/settings by **D**.
Every load-bearing claim in these deliverables traces to one of those direct reads.

**Genuine residue nobody opened deeply:** `notifications` (3 routes), `superadmin` (6),
`points` (5, partial), and most of the 39 individual `masters/*` route files — though E verified
they share one shape, and E read the framework and the lead masters directly. **None is on any
phase's critical path.** If a task reaches into them, read them first.

**Declared gaps in the three agents whose work is otherwise strongest** — all self-reported, and
each one names something tomorrow might touch:

- **B (frontend):** **no rendered evidence of any kind** — the dev server was down and `.next`
  deleted, so *nothing* in the frontend documentation is visually verified: not the four zones,
  not scroll ownership, not the column tiers dropping at 1024/768, not the filter chips. Every
  layout claim is read from source. AGENTS.md was read at ~1,700 of 2,264 lines (§21's chart-colour
  body and §31.2/31.4 unread). **`SYNC.md` was read at ~250 of 1,556 lines — the entire React-18
  compatibility audit and its ref tiers (906–1384) are unread**, so if tomorrow's work touches
  `forwardRef`, Base UI `render={}` props, or `@base-ui/react` version drift, **that guidance has
  not been read by anyone.** B also never opened `prisma/schema.prisma`.
- **E (orders/masters):** did not read every master page — `lead-types`, `products` and `dealers`
  in full; the other eleven confirmed only by their `CrudPage`/`useCrud` import and route pair.
  **`BusinessPartnerForm.tsx` read at surface level only** (~200+ lines) — and it is central to
  Phase 1's Company form and shared by four screens. **It deserves its own pass before P1-T16.**
- **F (activity/settings):** flagged the `contextual_remarks` CHECK constraint (now pre-flight
  B-6) and noted that `weekly-plan/page.tsx`'s frontend is a snapshot at `51f4dc0` — since
  confirmed unchanged, because that screen was never converted.

**Practical tip from B worth acting on:** `src/app/kitchen-sink/page.tsx` renders **every
component in every state** and is the correct-markup reference for anything with a required parent
(`SelectLabel`, `DropdownMenuRadioItem`, `AvatarImage` all throw without theirs). **Nobody read
it.** B calls it the highest-value unread file for tomorrow — open it before building the first
new screen.

**Design-system breach found by B, unqueued:** AGENTS.md §32 (password fields) is binding, and
sfacrm breaches it today. Not in REBUILD-PLAN's scope, so not planned — recorded so it is a
decision rather than an oversight.

**Pattern worth knowing:** two of six agents ended silently on their first pass. Both produced
good work; the silence was the defect, not the study. Brief every future session with the
stop-reason rule **from the first dispatch** — it was added mid-run here and the two earliest
agents never saw it.

### E5 · Deviations from the run's own instructions, recorded
1. **Six parallel inspections were dispatched, not the sanctioned four.** E (Orders/Products) and
   F (Activity/Settings) were extra. They were allowed to finish rather than be killed — both
   cover explicit coverage-checklist items, and both delivered the best provenance of the six.
2. **`00-CODEBASE-MAP.md` was begun before all four inspection areas had reported.** Plan writing
   was then paused until B and C landed and A and D accounted for themselves.
Both are process deviations, not findings. Recorded rather than quietly corrected.

---

## Coverage checklist — final state

| Area | Status |
|---|---|
| Repository structure and conventions | ✅ Covered (A §3/§5, B, E) |
| Leads module, end to end | ✅ Covered (C, direct reads; DB + API + frontend + blast radius) |
| Access Control and Employee Master | ✅ Covered (D, with an explicit READ/INFERRED/ASSUMED split) |
| Product Master | ✅ Covered (E, full column lists) |
| Order module | ✅ Covered (E, full column lists + status/discount proofs) |
| Authentication and user context | ✅ Covered (D §5, A §4) |
| Frontend patterns and API layer | ✅ Covered (B, `list-page` API verbatim) |
| rgb-kit v2 and its `AGENTS.md` | ✅ Covered (B; note the file is `AGENTS.md`, not `agent.md`) |
| Revisit queue — final pass | ✅ Done — `07-REVISIT-QUEUE.md`; 4 settled, 2 promoted here (E1, E2) |
| ⚠️ Route-by-route behaviour for `notifications`/`superadmin`/`points` | ❌ **Not studied.** Off every critical path. Read before touching |
| ⚠️ Anything requiring the live database | ❌ **Not possible this run.** Entirely deferred to the pre-flight |
| ⚠️ Anything requiring the running app | ❌ **Not attempted**, by constraint. See E3 |
