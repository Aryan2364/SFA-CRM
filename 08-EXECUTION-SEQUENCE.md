# 08 — Execution Sequence

---

## ⛔ PRE-FLIGHT — MANDATORY, BEFORE TASK 1

> **Confirm the data migration has completed. Re-verify the current schema of the Leads-related
> tables against `02-DATA-MODEL-PLAN.md`. Do not start Phase 1 until both are done.**

Phase 1 rewrites the Leads tables. If the migration is still writing to them, the two jobs will
collide, and **the damage will not be obvious immediately**.

### Why this is not a formality

`prisma/schema.prisma` is *generated* by `prisma db pull`. Its last refresh was commit `e58187a`,
**14 Sep 16:38** — four days before this plan. A migration running against the live database
changes nothing in that file. Everything in `02-DATA-MODEL-PLAN.md` is therefore a **three-day-old
snapshot**, and this run was barred from checking (every means — `db pull`, any query,
`npm run smoke` — is write-class or DB-touching).

What this run *could* observe: the schema file did not move (identical blob
`54d1d7c4ad51b35d6effe1e9eae5f2eeb28bd4a8` at two HEADs, 00:36 and 00:59), and every commit landing
overnight touched **frontend files only**. See `07-REVISIT-QUEUE.md` R4 and R6 — **two readings of
what the "migration" is are recorded there and neither was chosen.**

### Pre-flight checklist

```
[ ] 1. Ask Aryan: has the data migration finished? Get a yes, not an assumption.
[ ] 2. git log --oneline -20        # what landed overnight
     git status --porcelain         # nothing mid-change
[ ] 3. npm run prisma:sync          # FIRST WRITE-CLASS COMMAND OF THE DAY.
                                    # Only after step 1 is a confirmed yes.
[ ] 4. git diff prisma/schema.prisma
        → No diff  = the live DB matches 02-DATA-MODEL-PLAN.md §1. Proceed.
        → A diff    = STOP. Re-read 02-DATA-MODEL-PLAN.md §1 against reality and
                      correct it before any task runs.
[ ] 5. The six blocker queries (02-DATA-MODEL-PLAN.md §7), all read-only.
       Read the CHECK bodies of ALL FIVE constraint-carrying models -- `prisma db pull`
       drops them, so no file in this repo has them:
        \d role_permissions                                    -- B-1 ⚠️ see below
        \d contextual_remarks                                  -- B-6 ⚠️ see below
        \d order_items ; \d weekly_plans ; \d daily_visits
        \d business_partners ; \d orders
        SELECT status, count(*) FROM orders GROUP BY 1;        -- B-3
        SELECT stage,  count(*) FROM business_partners GROUP BY 1;  -- B-4
        SELECT count(*) FROM business_partners;                -- B-5
        SELECT count(*) FROM orders;
        SELECT count(*) FROM daily_visits;
        SELECT count(*) FROM business_partners WHERE contact_person_name IS NOT NULL;
        SELECT count(*) FROM business_partners WHERE contact_person_name IS NOT NULL
                                                 AND mobile_1 IS NULL;
[ ] 6. Record every result in 02-DATA-MODEL-PLAN.md under "Pre-flight results".
[ ] 7. Read 09-OPEN-QUESTIONS.md and get answers to Q1, Q5, Q7 and Q8 — those four
       block specific tasks below.
```

### ⚠️ B-1 is a hard blocker

`role_permissions` is marked in `schema.prisma:295` as carrying CHECK constraints, and
`supabase/migrations.sql` lines 16-18 warn its own copy *"allows 5 values while live data holds 23
distinct ones"*. **The real constraint body exists only in the live database and in no file in
this repo.** If it still constrains `section`, **every new permission section fails at runtime** —
and Phase 1 needs `companies`, `contacts`, `contact_types` and `industries`.

If `\d role_permissions` shows a constraint on `section`: **STOP. Report. Do not start P1-T3 or
P1-T9.** The plan changes.

### ⚠️ B-6 is the second hard blocker — it gates two whole phases

`contextual_remarks` is marked at `schema.prisma:48` as carrying CHECK constraints, and the code
writes only four `context_type` values: `meeting`, `expense`, `weekly_plan_day`, `weekly_plan`.

**This plan deliberately reuses that table instead of building three new ones** — Deal Notes
(P2-T6), Minutes of the Meeting (P3-T9) and Manager Comments (P4-T7) are all new `context_type`
values on it. That reuse is the right call: the primitive already has threading, timestamps,
read-tracking (`remark_reads`) and notification fan-out.

**But if the constraint enumerates the existing four, every one of those inserts fails at
runtime.** If `\d contextual_remarks` shows a constrained `context_type`: **STOP and report.**
Either the constraint is widened as part of P2-T6, or the reuse strategy is wrong and three
phases need re-planning. **Cheap to find out now; expensive to discover in Phase 4.**

---

## Start here tomorrow morning — the first five tasks

Fully specified. Dispatch with zero further thinking, **after** the pre-flight is green.

### ① P1-T1 — Pre-flight verification · S · no deps
Run the checklist above. Write results into `02-DATA-MODEL-PLAN.md` under "Pre-flight results".
**Deliverable:** a one-line verdict — *does the live schema match §1 of that file, yes or no* —
plus the `role_permissions` constraint body written down verbatim.
**Blocks everything. Nothing else starts until this is done.**

### ② P1-T2 — Fix the `user_visibility` re-parenting leak · M · no deps · **can run in parallel with ①**
`03-PHASE-1-PLAN.md` P1-T2. Confirmed bug (`01-GAP-ANALYSIS.md` G2): moving a user to a new
manager never re-cascades their subtree, so the old manager keeps seeing grandchildren who left
their chain and the new manager never gets them.

- Add `rebuildVisibility(tenantId)` to `src/lib/visibility.ts`, lifting the whole-tenant rebuild
  that already exists at `src/app/api/access-control/visibility/bulk-import/route.ts:28-48`.
- Call it from `src/app/api/masters/users/[id]/route.ts:83-93` and
  `src/app/api/masters/users/route.ts:140`, replacing the paired
  `removeAncestorVisibility`/`cascadeVisibilityUp`.
- **First**, check for manual overrides: compare `SELECT count(*) FROM user_visibility` with what
  a rebuild would produce. If they differ, **STOP** — manual rows exist, the table needs an
  `is_manual` column, and a rebuild would erase them (Q12).

**Acceptance:** A→B→{C,D}; re-parent B under E; A no longer sees C or D, E now does.

### ③ P1-T4 — Create `src/lib/format.ts` · S · no deps · **can run in parallel**
`03-PHASE-1-PLAN.md` P1-T4. Four functions — `fmtAmount` (₹, Indian digit grouping, 2dp),
`fmtDate` (`DD Mon YYYY`), `fmtDateTime`, `fmtQty` — implementing AGENTS.md §18. Neither the kit
nor sfacrm has this file; `SYNC.md` calls it the single highest-value missing item, and `fmtAmount`
is currently redefined per screen.
Repoint `src/app/(protected)/orders/page.tsx`'s local copy. **Do not restyle that screen.**
**Acceptance:** `grep -rn "function fmtAmount" src` returns exactly one hit.

### ④ P1-T3 — Collapse the seven master registries into one · M · after ①
`03-PHASE-1-PLAN.md` P1-T3. New `src/lib/masters-registry.ts` exporting `MASTERS`; nine files
stop carrying their own copy. Blocked on ① because of B-1.
**Acceptance:** `dealers`/`distributors`/`institutions` finally appear on `/masters` and in the
Access Control matrix (fixes G10); `tsc --noEmit` clean; no permission regression for a
non-Administrator.

### ⑤ P1-T5 + P1-T6 — New tables and columns · M · after ①
`03-PHASE-1-PLAN.md` P1-T5/T6. Create `contacts`, `company_contacts`, `company_addresses`,
`contact_types`, `industries`, `custom_field_defs`, `custom_field_values`; add the six nullable
columns to `business_partners`; backfill `owner_user_id = created_by_user_id`.
**No RLS policies** — the tables are RLS-capable with zero policies and enabling it returns zero
rows for every query.
`npm run prisma:sync`, then confirm `contacts.birthday`/`anniversary` landed in
`src/lib/generated/date-only-fields.ts`.

---

## Full ordered queue

`S` <1 h · `M` 1-3 h · `L` 3 h+. **‖** marks a task that can run in parallel with the one above it.

### Phase 1 — Parties

| # | Task | Size | Depends on |
|---|---|---|---|
| 1 | P1-T1 Pre-flight verification | S | — **BLOCKS ALL** |
| 2 | ‖ P1-T2 Fix `user_visibility` re-parenting leak | M | — |
| 3 | ‖ P1-T4 `src/lib/format.ts` | S | — |
| 4 | P1-T3 Master registry consolidation | M | T1 |
| 5 | ‖ P1-T5 Create the seven new tables | M | T1 |
| 6 | ‖ P1-T6 New `business_partners` columns + owner backfill | S | T1 |
| 7 | P1-T7 Backfill Contacts + Addresses | **L** | T5, T6 |
| 8 | P1-T8 **Rename tables** (`business_partners`→`companies`) | M | T7 |
| 9 | P1-T9 Permission sections + backfill | M | T1, T3 |
| 10 | P1-T10 `/api/leads` → `/api/companies` (+ the missing `GET [id]`) | M | T8, T9 |
| 11 | ‖ P1-T11 `/api/contacts` | M | T5, T9 |
| 12 | ‖ P1-T18 Contact Type + Industry masters | M | T3, T5 |
| 13 | P1-T12 Collapse `/api/business-partners` | S | T10 |
| 14 | P1-T13 **Parties page, two tabs** | **L** | T10, T11 |
| 15 | ‖ P1-T14 Company detail page | **L** | T10 |
| 16 | ‖ P1-T15 Contact detail page | M | T11 |
| 17 | P1-T16 Two-step Company form | **L** | T14 |
| 18 | P1-T17 Quick Create | M | T16 |
| 19 | P1-T19 **Eliminate the word "Lead"** | M | T13-T18 — **do this last** |

### Phase 2 — Deals

| # | Task | Size | Depends on |
|---|---|---|---|
| 20 | P2-T1 **AGENTS.md board pattern proposal** | M | — **start day 1, gates T27** |
| 21 | P2-T2 Deal tables | M | Phase 1 |
| 22 | P2-T3 Deal Stage + Reason for Loss masters | S | T21 |
| 23 | ‖ P2-T12 Order Draft/Placed | M | Phase 1, **Q7** |
| 24 | P2-T13 Discounts | **L** | T23 |
| 25 | P2-T4 Migrate active leads → Deals | **L** | T21 |
| 26 | P2-T5 Deals API | **L** | T21 |
| 27 | P2-T7 Deals list view | M | T26 |
| 28 | P2-T8 **Kanban** | **L** | T20 (gate), T27, **Q1** |
| 29 | ‖ P2-T6 Deal notes via `contextual_remarks` | M | T26 |
| 30 | ‖ P2-T9 Follow-ups | M | T26 |
| 31 | ‖ P2-T11 Attachments | M | T26 |
| 32 | P2-T10 Pipeline header strip | S | T27 |

### Phase 3 — Planning and Activity

| # | Task | Size | Depends on |
|---|---|---|---|
| 33 | P3-T1 `tenant_settings` + settings screen | M | — |
| 34 | ‖ P3-T2 Weekly plan / visit schema additions | S | Phase 1 |
| 35 | ‖ P3-T12 Expenses restyle | M | — (independent throughout) |
| 36 | P3-T3 Weekly Plan screen rework | **L** | T34 |
| 37 | P3-T4 Weekly Plan Approval screen | **L** | T36 |
| 38 | P3-T5 Daily Activity rework | **L** | T36 |
| 39 | P3-T7 Meeting start/stop toggle | M | T38 |
| 40 | ‖ P3-T8 Location-difference flag | M | T33, T39 |
| 41 | ‖ P3-T10 Past / manual meeting entry | M | T39 |
| 42 | ‖ P3-T6 Auto check-out | M | T33, **Q6** |
| 43 | P3-T9 Inside a Meeting | **L** | T39, Phase 2 |
| 44 | P3-T11 Cross-linking + breadcrumbs | M | T43 |

### Phase 4 — Summaries and the access filter

| # | Task | Size | Depends on |
|---|---|---|---|
| 45 | P4-T1 `src/lib/scope.ts` — the shared rule | S | Phase 3, **P1-T2 must be fixed** |
| 46 | P4-T2 Apply scope to every list/summary/report | **L** | T45 |
| 47 | ‖ P4-T3 Daily Summary sheet | **L** | T45 |
| 48 | P4-T4 Weekly Review | **L** | T47 |
| 49 | ‖ P4-T7 Manager comments | M | T47, T48 |
| 50 | ‖ P4-T5 Journaling | M | T48 |
| 51 | P4-T6 Manager summary-of-summaries | **L** | T48 |

### Phase 5 — Reports

| # | Task | Size | Depends on |
|---|---|---|---|
| 52 | P5-T1 Report engine (server) | **L** | Phase 4 |
| 53 | ‖ (raise the §30 report-table pattern with Aryan — day 1 of Phase 5) | S | — |
| 54 | P5-T2 Report builder UI | **L** | T52, T53 |
| 55 | ‖ P5-T7 Data-health alerts | M | T52 |
| 56 | P5-T3 Saved Reports | M | T54 |
| 57 | P5-T4 The ten ready-made reports | **L** | T56 |
| 58 | ‖ P5-T5 Reports page header | S | T54 |
| 59 | ‖ P5-T6 Navigation entry | S | T54 |

---

## Critical path

```
P1-T1 → P1-T5/T6 → P1-T7 → P1-T8 → P1-T10 → P1-T13 → P1-T16 → P1-T19
      → P2-T2 → P2-T5 → P2-T7 → P2-T8
      → P3-T3 → P3-T5 → P3-T7 → P3-T9 → P3-T11
      → P4-T1 → P4-T3 → P4-T4 → P4-T6
      → P5-T1 → P5-T2 → P5-T3 → P5-T4
```

**The longest poles, all of which should start earlier than their phase.** Three are the *same
gate* — AGENTS.md §30: a pattern the design system does not cover must be agreed and written into
`AGENTS.md` **first**, then built. Each needs Aryan and write access to a separate repo.

1. **P2-T1** — the **Kanban board** pattern. Gates Phase 2's headline feature.
2. **P3-T3** — the **Weekly Plan** pattern. It matches no §11 template (§31 was considered and
   explicitly rejected), and the overnight run correctly **refused to convert it**. On Phase 3's
   critical path.
3. **P5-T53** — the **report table** pattern (§34 is spec-only), plus the date-range preset
   control (§27.4, spec-only).
4. **Q1 (mobile)** — affects every screen in every phase. Unresolved.

**Raise all three §30 patterns with Aryan on day 1 of the project**, not on day 1 of their phase.
They are the only items here whose lead time is someone else's calendar.

### Inherited from the overnight conversion run

That run reported **"scope complete"** at 00:57. Four screens converted (`leads`, `conversations`,
`masters/users`, `review`); `weekly-plan` deliberately refused. It left **11 `// OVERNIGHT:`
workaround markers** — 9 in `leads`, 1 in `masters/users`, 1 in `review`.
**`grep -rn "// OVERNIGHT:" src` is a task-zero chore**; resolve the `leads` ones during P1-T13,
which rewrites that file anyway.
It also confirms `list-page.tsx`, `globals.css`, `shell/*` and `(protected)/layout.tsx` are
**byte-identical to its run start** — so the `list-page` API documented here is solid.

## Parallel tracks that never collide

- **Track α (machinery):** P1-T2, P1-T4, P1-T3 — touch `lib/` and registries, not screens.
- **Track β (data):** P1-T5 → T6 → T7 → T8 — DDL and scripts, no UI.
- **Track γ (orders):** P2-T12 → P2-T13 — independent of the entire Deal track.
- **Track δ (expenses):** P3-T12 — a restyle with no functional change; fits anywhere.

## Standing rules for every task

1. **Re-read a file before editing it.** Another agent was writing to this repo overnight; five
   screens moved between 23:21 and 00:58.
2. **`prisma/schema.prisma` is generated.** DDL first, then `npm run prisma:sync`. Never hand-edit.
3. **Never drop a `tenant_id` filter.** It leaks across tenants with nothing crashing.
4. **`serialize(rows, '<model>')` on every response** carrying a `Decimal` or a date.
5. **Bare arrays, not envelopes.** No `{data,total}` exists anywhere — do not introduce one.
6. **Do not add props to `list-page`** to make a screen fit. Stop and ask.
7. **Never `try/catch` inside a `load`** and return `[]` — a rejection *is* the failed state.
8. **A workaround is fine; a silent workaround is not.** Write both halves down.
9. **Never invent a requirement.** A gap in REBUILD-PLAN.md is a question for Aryan —
   `09-OPEN-QUESTIONS.md`, not a blank to fill.
10. **Behaviour is preserved.** A plan that drops something the software does today is wrong.
11. After each phase, **leave working, testable software.**
