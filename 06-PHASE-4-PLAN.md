# 06 — Phase 4 Plan: Summaries, Journaling, Manager Views, Access Filter

Source: `REBUILD-PLAN.md` §6. Depends on Phases 1-3 — the summaries aggregate Meetings, Deals,
Orders and Expenses, so all four must exist first.

## Scope
Daily Summary, Weekly Review, Journaling, Manager summary-of-summaries, Manager comments, and the
**Self / Team / Company data filter**.

## Explicit NON-scope — read §6.6 carefully, this is the one that runs away
- **Full access control** — role-wise permissions, menu visibility, create/edit/delete rights,
  approval rights. §9 item 2, Phase 2 of access work, **deferred**.
- **Do not build any access-control screens.** Only the data filter.
  `/api/access-control/*` and `settings/access-control/page.tsx` already exist and are
  Administrator-only. **Leave them alone.**
- **No manager-comment workflow** — §9 item 5 and §6.5: no approval, no resolved/unresolved
  status, no notification chain.
- Travelling Time — §12, dropped. The term is **Non-Meeting Time**, never "Idle Time".
- Expense-to-order-value ratio on the **daily** sheet — §6.1 excludes it deliberately (it looks
  poor on a normal prospecting day and demoralises the rep). Weekly Review only.

> **§6.6 scope discipline, verbatim:** *"If this work starts growing into a module, it has gone
> out of scope. Stop and report."* P4-T1 below should be ~30 lines of new code plus call sites.
> If it is becoming a subsystem, stop.

---

## Tasks

### **P4-T1 · The shared scope rule** · S · first

§6.6's *"written once as a shared rule and reused everywhere"*.

**The mechanism already exists and already walks the full chain** — see `01-GAP-ANALYSIS.md` C1.
`users.manager_user_id` is the hierarchy; `cascadeVisibilityUp()` materialises the closure into
`user_visibility`; `getDataScope()` reads `role_permissions.data_scope` (`'own'|'team'|'all'`).
**Do not add a recursive CTE** — there is no raw SQL anywhere in this repo, and a CTE would be a
second source of truth for a chain that is already materialised.

**New file:** `src/lib/scope.ts`
```ts
export async function scopedUserIds(user: SessionUser, section: PermSection): Promise<string[] | null> {
  const scope = await getDataScope(user, section)   // 'own' | 'team' | 'all'
  if (scope === 'all') return null                   // null === Company, no user_id predicate
  if (!user.userId)    return []
  if (scope === 'own') return [user.userId]
  return [user.userId, ...await getVisibleUserIds(user.userId, user.tenantId)]
}
export function scopeWhere(ids: string[] | null, column = 'user_id') {
  return ids ? { [column]: { in: ids } } : {}
}
```

⚠️ `getVisibleUserIds` **excludes the viewer** — every existing caller has to remember
`[user.userId, ...]`. Fix that convention **inside this helper**, not at each call site.

⚠️ **P1-T2 (the re-parenting leak) must already be fixed**, or this filter faithfully enforces
drifted data.

---

### **P4-T2 · Apply the scope to every list, summary and report** · L · after P4-T1

Today **only `/api/orders` honours the scope**. Apply `scopeWhere(await scopedUserIds(user, …))`
to each of these:

| Endpoint | Today |
|---|---|
| `/api/leads` → `/api/companies` | tenant-wide, no owner filter |
| `/api/contacts` | new in Phase 1 |
| `/api/deals` | new in Phase 2 |
| `/api/daily-activity` | hard-wired `user_id: user.userId` ⚠️*inferred from grep* |
| `/api/expenses` | hard-wired Self ⚠️*inferred* |
| `/api/attendance` | hard-wired Self ⚠️*inferred* |
| `/api/weekly-plans/my`, `/day` | ⚠️ **assumed from route name — Agent D never opened these. Verify first.** |
| `/api/review/*` | `getVisibleUserIds` only, no `getDataScope` |
| `/api/dashboard/stats` | tenant-wide counts for everyone |
| `/api/orders/team` | `getVisibleUserIds` with **no `getDataScope`** — a Self-scoped role still gets the team list |
| `/api/orders/[id]` | `getVisibleUserIds` with no `getDataScope` |

⚠️ **G3:** `orders/route.ts:57` lets `?userId=` **replace** the scope filter entirely, so any
caller can name another user's id. Every scoped rewrite must **intersect** the param with the
allowed ids, never replace them — and this pattern will be copied into the Phase 5 report
endpoints, so fix it here.

⚠️ Sections `meetings`, `expenses` and `weekly_plan` exist in `role_permissions` and drive nav
visibility but **no route enforces them**. Adding the scope filter without also adding
`checkPermission` is half a fix.

⚠️ `role_permissions.data_scope` defaults to `"team"` in the DB but `"own"` in the settings API.
**Settle this before the filter goes live**, or existing rows behave differently from newly-saved
ones.

**Acceptance:** a Self user sees only their own rows on every list; a Team user sees their full
chain below, including indirect reports; a Company user sees everything. Verified with a
three-level hierarchy.

---

### **P4-T3 · Daily Summary sheet** · L · after P4-T1

§6.1, for a selected day: Plan vs Actual; what was missed and what extra was done; **Total Meeting
Time split into system-captured and manually-entered** (from `daily_visits.is_manual_entry`);
**Non-Meeting Time** (this wording, never "Idle Time"); Total Expense and the split by Category;
order value brought; **Locations Covered**; count of Past Meetings; location-difference flags;
**Deal movement for the day** (stages moved, Won, Lost — from `deal_stage_logs`); follow-ups due
today not done; and a short **next-day plan preview** strip at the bottom.

**Travelling Time is not calculated.** It is dropped (§12).
**No expense-to-order-value ratio here.**

---

### **P4-T4 · Weekly Review** · L · after P4-T3

§6.2, all seven days: weekly priority points from the plan showing ticked vs open (**same data as
P3-T3's checklist** — ticking in either place reflects in the other); planned vs achieved; orders
brought; meetings done; hours in meetings vs not (derived from check-in/check-out); the same
figures day-wise; extra meetings outside the plan shown separately; new Parties created; day-wise
and category-wise expense break-up; orders split **Draft vs Placed**; order break-up by Product
Category, Sub-Category and Product; **Funnel Movement**; **Not Met** (planned parties with no
meeting ever started); **Expense vs Order Value** for the week; and the headline numbers.

---

### **P4-T5 · Journaling** · M · after P4-T4

§6.3. Two boxes inside Weekly Review — **What Went Well** and **Where I Can Improve** — each with
a button opening its **Logs** page listing all past entries one after another.
**No separate menu item** (§12, closed). New table `journal_entries`.

---

### **P4-T6 · Manager summary-of-summaries** · L · after P4-T4

§6.4. A manager with ten or twenty reports cannot open each person's summary individually. Build
the team-level page with **drill-down** into any individual. The per-person screens stay
unchanged; the Team Summary sits one level above them.
`/api/weekly-plans/summary` and `/api/dashboard/manager` are the seed.
A **company-level** summary sheet is needed for whoever holds Company rights.

---

### **P4-T7 · Manager comments** · M · after P4-T3, P4-T4

§6.5. **Keep it simple. Resist adding workflow.**
One comment against a team member's Daily Summary, one against the Weekly Summary. The comment
sits against the **whole summary**, not individual sections. The team member sees it on opening
that summary and can **reply once**. Both stamped with date and time. Both stay visible in the
summary's **Logs**.

**Reuse `contextual_remarks`** — add `'daily_summary'` and `'weekly_summary'` context types in
`src/app/api/remarks/route.ts:68-80`. **Do not create a comments table.** The primitive already
has threading, timestamps, read-tracking (`remark_reads`) and notification fan-out.

> ⚠️ **Depends on pre-flight blocker B-6** (`\d contextual_remarks`). If `context_type` carries a
> CHECK constraint enumerating the four existing values, this task and P2-T6 and P3-T9 all fail at
> runtime. It should already have been settled in Phase 2 — **confirm it was** before starting.

⚠️ Enforce "one comment, one reply" in the route, not just the UI.
⚠️ **No approval, no resolved/unresolved status, no notification chain** (§9 item 5).

---

## Parallelism

```
P4-T1 scope rule ─ P4-T2 apply everywhere
       └─ P4-T3 daily summary ─┬─ P4-T4 weekly review ─┬─ P4-T5 journaling
                               │                       └─ P4-T6 manager summary
                               └─────────────────────────── P4-T7 comments
```
**Critical path:** T1 → T3 → T4 → T6.
T2 runs alongside T3/T4 once T1 lands.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **The access filter grows into a module** | §6.6 says stop and report. T1 is ~30 lines; review it at that size |
| R2 | The filter enforces drifted visibility data | P1-T2 fixed the cascade in Phase 1; re-verify before T2 |
| R3 | `?userId=` bypasses the scope | Intersect, never replace — fix in T2 before Phase 5 copies it |
| R4 | `data_scope` default disagrees between DB (`team`) and API (`own`) | Settle before T2 ships |
| R5 | Three routes were never opened by the study | Named in T2; open them first |
| R6 | Manager comments accrete workflow | §9 item 5 is explicit. One comment, one reply, no status |
| R7 | "Idle Time" or "Travelling Time" appears in the UI | Copy review against §2 and §6.1 |
