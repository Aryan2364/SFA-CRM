# 05 — Phase 3 Plan: Planning and Activity

Source: `REBUILD-PLAN.md` §5. Depends on Phase 1 (Parties) and Phase 2 (Deals must exist before
Meetings can update Deal stages — §11).

## Scope
Weekly Plan rework, the Manager approval screen, Daily Activity, Meetings, and the Expenses
restyle.

## Explicit NON-scope
- **Expenses logic** — §5.7: *"Logic works exactly as it does today. No functional change."*
  Look and feel only.
- Summaries and Manager views — Phase 4.
- Anything in §9.

---

## What already exists (do not rebuild)

`daily_visits` **is** the Meeting entity and is further along than §5.4 implies:
`start_time`, `end_time`, `duration_secs`, `latitude`/`longitude`/`address` (start) **and**
`end_latitude`/`end_longitude`/`end_address` (end), `status` CHECK
`('Pending','Active','Completed')`, `notes`, plus a 1:1 `orders` relation.

Location capture works today via `navigator.geolocation.getCurrentPosition({timeout:8000})` in
`src/app/(protected)/daily-activity/page.tsx` — `handleStart` PATCHes `{action:'start',…}`,
`handleStop` PATCHes `{action:'stop',…}`.

**Missing:** a link to a planned line (no `weekly_plan_item_id`), a Planned/Unplanned/Past-Entry
marker, manual time entry, and a real distance flag.

---

## Tasks

### **P3-T1 · `tenant_settings` + the §8 settings screen** · M · first

`01-GAP-ANALYSIS.md` C4. There is **no settings store at all**. Follow the literal file list in
Agent F's notes §6.3:

1. DDL: `tenant_settings(tenant_id uuid PK, auto_checkout_time, location_flag_threshold_m int
   default 500, deal_stage_ageing_days int default 15, updated_at, updated_by_user_id)`.
   Model it on `tenant_point_settings`, where `tenant_id` **is** the PK. No RLS policies.
2. `npm run prisma:sync`.
3. **NEW** `src/app/api/settings/system/route.ts` — GET with a defaults fallback, PUT with an
   `upsert` and **server-side validation**. Copy `src/app/api/points/settings/route.ts`.
4. **NEW** `src/lib/settings.ts` → `getTenantSettings(tenantId)`. **The single reader.** Nothing
   else touches the table.
5. `src/app/(protected)/settings/page.tsx` — add a card with a
   `visible: me => me?.permissions?.system_settings?.view ?? false` predicate.
6. **NEW** `src/app/(protected)/settings/system/page.tsx`. Copy `settings/points/page.tsx`.

⚠️ Store the threshold as an **`integer` in metres, not a `Decimal`** — a `Decimal`
JSON-stringifies to a string and silently poisons arithmetic that forgets `serialize()`.
⚠️ For `auto_checkout_time`, prefer **minutes-past-midnight as an `integer`** unless the
serialiser's handling of a `time` column has been verified first.

**Acceptance:** all three values persist per tenant and are read through `getTenantSettings`.

---

### **P3-T2 · Weekly Plan schema additions** · S · after Phase 1

`weekly_plan_items` + `party_id uuid`, `party_type text` (`company`|`contact`),
`expected_order_value Decimal(12,2)?`. New `weekly_goals` table (§5.1 checklist).
`daily_visits` + `is_manual_entry boolean default false`, `location_flagged boolean default false`,
`weekly_plan_item_id uuid?`.

⚠️ `weekly_plan_items` has **no party reference today** — only `from_place`/`to_place` free text.
§5.1's Parties dropdown is **additive**, not a rename.

---

### **P3-T3 · Weekly Plan screen rework** · L · after P3-T2 · ⚠️ **HAS A §30 GATE**

`src/app/(protected)/weekly-plan/page.tsx` — **740 lines, unchanged, still fully legacy.**

⚠️ **Confirmed by the overnight run's own report (`overnight-report-2026-09-18.md`): weekly-plan
was deliberately REFUSED, and not one byte was changed.** Its reasoning matters to this task:

> It loads ONE record, has a week navigator, an editable grid (`Add Place`, in-place edits),
> free-text week goal and per-day notes, and a save/submit/undo/reopen state machine. `ListPage`
> renders read-only cells over an array. Converting it would destroy the editing, the navigator
> and the workflow.

It matches **no** AGENTS.md §11 template. The nearest is §11.3 for the editing; the week navigator
and the state machine are covered by nothing. §31 ("Data entry grid") was considered and
**explicitly rejected** — its own preamble says *"A list of records with editable fields is not a
grid… One axis is not a matrix."*

**So this is a §30 "still to be decided" item: agree the pattern, write it into `AGENTS.md`, then
build.** Same gate as Phase 2's Kanban (P2-T1) and Phase 5's report table.
**Raise it with Aryan early — it sits on Phase 3's critical path.**

**Do not put this screen on `list-page`.** That was evaluated overnight and correctly refused.

### Verified facts for this screen — measured 18 Sep, code + live data

**⚠️ LIVE DATA-LOSS BUG — fix this first, before any rework.**
The per-row **"Others"** value is written but never read back.
- Write (`dayDataToPlanItems`, ~line 92): `notes: entry.others > 0 ? String(entry.others) : ''`
- Read (`planItemsToDayData`, ~line 74): `others: 0` — **hardcoded, unconditionally**

A user types Others = 5, saves, reloads the week, and sees 0, while `"5"` sits in
`weekly_plan_items.notes`. **Confirmed in live data: 78 of 455 `weekly_plan_items` have a purely
numeric `notes`, and that is 100% of all non-empty `notes`** — so the column carries no real notes
at all, only orphaned numbers. Every one of those 78 is lost user input.
⇒ §5.1's new **per-line expected order value must get a real column**, never `notes`. And the
rework must not treat `notes` as free text until these 78 rows are dealt with.

**⚠️ The page-scroll bug STILL EXISTS after `4af0952`.** Measured live at 1280: the page itself
does not scroll (`scrollHeight 800 / clientHeight 800`), while an inner
`div.flex-1.overflow-y-auto.space-y-4.pb-4` at **line 504** holds **2131px of content in a 369px
window** — all seven day-cards crammed into it.
`4af0952` made the shell's content wrapper the scroll container, but this screen keeps its own
`overflow-y-auto`, so the fix could not reach it. It is now also an **AGENTS.md §10 rule 3
violation** (never nest a scrollable area inside another on the same axis), since
`app-shell.tsx:119` is a vertical scroller too.
**Likely a one-line fix: delete `overflow-y-auto` (and probably `flex-1`) at line 504** and let
the shell own the scroll. Two other `overflow-y-auto` are legitimate and must stay: line 136
(place-picker dropdown, `max-h-56`) and line 667 (audit-log modal body).

**Removing Location is cheaper than the schema implies.** Verified live: **`to_place` populated on
0 rows, `mode_of_travel` populated on 0 rows** — the UI always writes `null` for both
(lines 89, 92). The only live location surface is the **`place` picker**, a searchable dropdown
fed by `/api/masters/territory-mapping/places`. Nothing reads `to_place` or `mode_of_travel`, so
dropping them from the UI breaks no read path.

**The row mapping is lossy and misnamed** — `PlaceEntry = {id, place, dist, dealer, others}`
(line 47), mapped at 64-95:

| UI | DB column | Note |
|---|---|---|
| `place` | `from_place` | the only live location |
| `dist` | `existing_dealers_goal` | **name/meaning mismatch** |
| `dealer` | `new_dealers_goal` | |
| `others` | `notes` | **never read back — the bug above** |
| — | `to_place`, `mode_of_travel` | always `null` |

**The free-text box §5.1 replaces**, by name: label **"Upcoming week I want to Achieve"**
(line 414), state `weekGoal`, API field **`week_goal`** (`String?`), `<textarea rows={3}>` at
416-424 inside a card at **412-425**. That card is the whole surface to replace.
⚠️ **A structured checklist cannot fit a single `String?` column** — this is why P3-T2 adds a
`weekly_goals` table.
⚠️ There is a **second**, distinct free-text per day: **"Day Focus / Remarks"** (label line 618),
state `dayNotes`, API field `day_notes`. **Do not conflate it with the week goal.**

**Load-bearing for the state machine — preserve all of it:**
- **`canEdit = !plan || ['Draft','Rejected','Edited by Manager'].includes(plan.status)`** (line
  324) gates **every** input on the screen. Changing it changes the whole screen's editability.
- `isSubmittedAwaitingReview = ['Submitted','Resubmitted']` (325).
- `canRequestReopen = plan && !canEdit && !plan.reopen_requested && undoSecondsLeft === 0` (326) —
  note the **time-boxed undo window** after submit.
- Handlers: `handleSaveDraft` (243), `handleSubmit` (262 — saves first, then POSTs `/submit`),
  `handleUndo` (299), `handleRequestReopen` (308).
- **Submit-time validation to preserve:** blocks rows with an empty place (263-265); blocks
  submitting an empty week (274).
- **A three-map in-memory week cache** (`weekCache`/`notesCache`/`goalCache`, refs at 174+, written
  at 367) keyed by `weekStart`, invalidated by `loadPlan(clearCache)`. Week navigation reads from
  it. **Easy to break silently in a rework.**
- Five status-conditional banner blocks at 428/443/452/461/476.

Section inventory: week navigator (~395-410) · status badge + Remarks (382-388) · week goal
(412-425) · status banners (428-480) · **day cards ×7 (504-640, the broken scroller)** · footer
actions (after 640) · audit-log modal (~660-700).

1. **Remove Location completely** (§5.1) — `from_place`, `to_place`, `mode_of_travel` come off the
   screen. Keep the columns in the DB for one release; do not drop them.
2. Add a **Parties dropdown** (Companies or Contacts) backed by `/api/companies` and
   `/api/contacts`.
3. On selection, fetch Company Type from the master and show it **locked / read-only** — the
   master value is final and cannot be edited here.
4. Optional per-line **expected order value**.
5. Replace the free-text description box with the **Weekly Goal Checklist** — 5 blank rows by
   default, "Add" below, no upper limit. Same data as the Weekly Review's copy (Phase 4), ticking
   in either place reflecting in the other.
6. **Fix the page scroll** (§5.1). ⚠️ Commit `4af0952` "Make the shell's content wrapper the scroll
   container" may already have fixed this — **verify before changing anything**. The related trap
   is `list-page` consumer rule 5: never wrap `ListPage` in a plain `div`, or the *page* scrolls
   instead of the content zone.

**Acceptance:** the plan page scrolls top to bottom at 1280 and 768; a party can be selected and
its Company Type shows locked; five goal rows appear by default.

---

### **P3-T4 · Weekly Plan Approval screen** · L · after P3-T3

§5.2. **The state machine already exists** — 17 routes covering submit / undo-submit / approve /
reject / suggest / hold / edit-by-manager / request-reopen / accept-reopen / decline-reopen, plus
`logs`, `my`, `day`, `review`, `summary`.

**Verbatim, from `supabase/migrations.sql:329` (Prisma drops CHECK bodies):**
`weekly_plans.status` ∈ `('Draft','Submitted','Approved','Rejected','On Hold','Edited by Manager','Resubmitted')` — **7 values**.
`weekly_plan_audit_logs.action_type` has **no constraint**; the code writes **13** values:
`Create, Update, Submit, Resubmit, UndoSubmit, Approve, Reject, Hold, Suggest, EditByManager,
RequestReopen, AcceptReopen, DeclineReopen`.

⚠️ **7 statuses, 13 action types, 12 route files.** Casing is load-bearing (`EditByManager` in the
log vs `Edited by Manager` in the status). **Never derive either list from `SELECT DISTINCT`** —
PLAN.md is explicit that live holds only four of the seven statuses.

Build the dedicated manager screen: modify the plan (add/remove items), write Notes, approve/
reject/hold/suggest.

⚠️ **"The User must be able to see what changes his Manager made" is NEW.** Agent F confirmed the
audit log **cannot render this today**. Either `weekly_plan_audit_logs.edited_fields` (a `Json`
column) starts carrying a before/after payload on `EditByManager`, or a diff is computed from
stored snapshots. Decide and write it down — do not leave it implicit.

⚠️ **None of the 17 weekly-plan routes calls `checkPermission`**, despite a `weekly_plan` section
existing in `role_permissions` and driving nav visibility. Adding the Phase 4 scope filter to
these routes without also adding `checkPermission` would be half a fix.

---

### **P3-T5 · Daily Activity rework** · L · after P3-T3

§5.3, `src/app/(protected)/daily-activity/page.tsx` — **1685 lines, the largest page in the app**
and not in the overnight conversion's scope, so it is still fully legacy.

1. Approved plan items appear automatically for the day; **remove the manual selection step**.
2. **Remove the old Plan section** — Meetings cover it now.
3. Check-in marks Present; update its look so the meaning is clear. Check-out closes the day.
4. **After Check-out nothing is locked** (§12, closed) — Meetings, Orders and Expenses can all
   still be added. Check-in/out is **only** attendance and working hours.

---

### **P3-T6 · Auto check-out** · M · after P3-T1

§5.3, default midnight, from Settings, **not hard-coded**.

⚠️ **There is no scheduler of any kind in this codebase** — no cron, no job runner, no queue. This
mechanism is entirely new and is a deployment concern, not just code (Q6). Options, in order of
how well they fit what exists:
- a lazy sweep on the next authenticated request of the following day (no infrastructure, but
  fires late and unpredictably);
- a Next.js route hit by an external scheduler (systemd timer / cron on the EC2 host);
- a node process alongside the app.

**Pick one with Aryan before building.** Whichever it is, it must read
`getTenantSettings(tenantId).auto_checkout_time` and run **per tenant** — the app is multi-tenant
and midnight is the tenant's midnight.

---

### **P3-T7 · Meeting start/stop, one toggle** · M · after P3-T5

§5.4. Single button showing **Start**, becoming **Stop**. Both already PATCH
`/api/daily-activity/[id]` with `action: 'start' | 'stop'` and write the two location pairs — the
work is the toggle UI and wiring it to planned lines via `weekly_plan_item_id`.

⚠️ On `PERMISSION_DENIED` the start/stop is **aborted** and a `locationDenied` dialog shows; on
timeout it proceeds with **nulls**. So lat/long are nullable in practice and every distance rule
must handle nulls.

⚠️ The address is reverse-geocoded **client-side by calling
`https://nominatim.openstreetmap.org/reverse` directly from the browser** — unkeyed third party,
no rate-limit handling, failures swallowed. Worth replacing with a server-side call; flag if out
of scope rather than leaving it undocumented.

---

### **P3-T8 · Location-difference flag** · M · after P3-T1, P3-T7

§5.4, default 500 m from Settings. **Display only — no action is triggered.**

⚠️ A flag exists today **in the UI only and hardcoded**, in `review/[userId]/page.tsx` →
`ReviewVisitCard`:
```js
Math.abs(v.latitude - v.end_latitude) > 0.001 || Math.abs((v.longitude ?? 0) - (v.end_longitude ?? 0)) > 0.001
```
0.001° ≈ 111 m of latitude — **not metres, not Haversine, not from Settings**, and not shown on
the user's own screen. Replace it with a real Haversine distance computed **server-side** onto
`daily_visits.location_flagged`, read from `getTenantSettings`.

---

### **P3-T9 · Inside a Meeting** · L · after P3-T7, Phase 2

§5.5. Minutes of the Meeting (during or after); the Company's **open Deals** and its **last few
Orders** (not all); mark which Deals were discussed (all, one, or none); **update Deal Stage from
inside the meeting**; create a new Deal or Order from here; **inline order taking** against the
meeting row (products from the Product Master, user enters Qty, system picks the Rate from
`products.price`, Amount shown); show an existing unplaced Draft order for that party; **View All**
goes to Orders with the Company filter pre-applied and other filters still available.

Notes here can be **linked** to a Deal or an Order — write `deal_meetings` rows and use
`contextual_remarks` with the right `context_type` (Phase 2 P2-T6 added `'deal'`).

---

### **P3-T10 · Past / manual meeting entry** · M · after P3-T7

§5.4. The user **can** type Start and End time by hand — they are tentative. Set
`is_manual_entry = true`. Display visibly distinct from system-captured. The summary shows a
**count** of how many were entered this way (Phase 4 consumes it).

---

### **P3-T11 · Cross-linking and breadcrumbs** · M · after P3-T9

§5.6. Meeting → Deal, Deal → Meeting, Meeting → Order, Order → Meeting, both directions.
Breadcrumbs required (`src/components/ui/breadcrumb.tsx`); Back returns where the user came from.
**A Meeting is not compulsory** for an Order or a Deal — if meetings exist, links appear; if not,
nothing appears. Do not render an empty "Meetings" section.

---

### **P3-T12 · Expenses restyle** · M · independent

§5.7 — **look and feel only, no functional change.** Verify by diffing behaviour, not by reading
the diff.

---

## Parallelism

```
P3-T1 settings ─┬─ P3-T6 auto-checkout (needs Q6)
                └─ P3-T8 location flag
P3-T2 schema ─ P3-T3 weekly plan ─┬─ P3-T4 approval screen
                                  └─ P3-T5 daily activity ─ P3-T7 meeting toggle ─┬─ P3-T9 inside meeting ─ P3-T11 cross-links
                                                                                  └─ P3-T10 manual entry
P3-T12 expenses restyle ───────────────────────────────── independent throughout
```
**Critical path:** T2 → T3 → T5 → T7 → T9 → T11.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | No scheduler exists for auto check-out | Q6 decided before P3-T6; it is a deployment choice |
| R2 | `visit_type` CHECK vs the user-defined master **can drift** | See Phase 1 risk R11 — widen or drop the constraint when Company Type becomes user-defined |
| R3 | The 0.001° flag is mistaken for metres | P3-T8 replaces it with Haversine + the setting |
| R4 | Nulls in lat/long break the distance rule | Explicitly handled; geolocation fails open with nulls |
| R5 | `daily-activity/page.tsx` is 1685 legacy lines | Budget for it; convert only what the tasks require |
| R6 | Deriving plan statuses from live data | Use the verbatim 7/13 lists; never `SELECT DISTINCT` |
| R7 | Browser-side Nominatim calls | Flag; replace server-side if in scope |
| R8 | **Weekly Plan has no AGENTS.md pattern** and was correctly refused by the overnight run | §30 gate raised with Aryan on day 1 of the project, not day 1 of Phase 3. It is on the critical path |
| R9 | 11 `// OVERNIGHT:` workaround markers left in converted screens | `grep -rn "// OVERNIGHT:" src` — 9 in `leads`, 1 in `masters/users`, 1 in `review`. Resolve the `leads` ones during P1-T13 |
