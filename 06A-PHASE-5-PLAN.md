# 06A — Phase 5 Plan: Reports

Source: `REBUILD-PLAN.md` §7. Depends on Phases 1-4 — every dimension and measure reads tables
those phases create.

*(Numbered `06A` because `07` is `07-REVISIT-QUEUE.md`. It sorts directly after Phase 4.)*

## Scope
A report **engine** (Measure × Dimensions × Date Range × Filters → table or chart, saveable), the
ten ready-made reports as pre-configured combinations, the four headline numbers, and the
data-health alerts.

## Explicit NON-scope
- **Do not build 41 report screens.** §7.1 is explicit: build the engine, then ship §7.4's ten as
  pre-configured combinations.
- **Do not feature** the §7.6 reports: Order by Location and Product Demand by Location (need
  clean address data first); Conversion Funnel and Average Deal Cycle Time (need months of
  history); and **Attendance, Location Flag and Working Hours Utilisation** — §7.6 is blunt about
  why: *"these are monitoring reports. Leading with them makes the sales team see the software as
  a spying tool, and adoption dies. Let the Manager find them himself."* They work through the
  engine; they are not on the front page.
- **Data health is not a report** (§7.7) — it is an alert on the relevant screen.

---

## Starting position

**~95% greenfield.** There is no report infrastructure, no aggregation layer, no saved-view
concept. Two dependencies are already in the project and in use elsewhere, so no new packages are
needed:
- `recharts` — charts
- `exceljs` — already used by the leads bulk-import/template routes, so the export path has a
  precedent to copy

---

## Tasks

### **P5-T1 · Report engine — server** · L · first

**New:** `src/app/api/reports/run/route.ts` (POST — a report spec, returns rows) and
`src/lib/reports/` (the registry).

The spec shape:
```ts
type ReportSpec = {
  measure: MeasureKey
  dimensions: [DimensionKey] | [DimensionKey, DimensionKey]   // one or two
  dateFrom: string; dateTo: string                             // YYYY-MM-DD
  filters: Record<string, string>
}
```

`src/lib/reports/dimensions.ts` and `measures.ts` declare each one as a data structure — the
table it reads, its join path, its SQL/Prisma grouping expression, and its label. **A report is a
lookup over those registries, never a bespoke query per report.**

⚠️ **Apply `scopedUserIds` (P4-T1) to every report query.** §6.6's filter applies to *"every list,
summary and report"*. A report that skips it is a cross-tenant-shaped data leak within a tenant.
⚠️ **Intersect** any explicit `userId` filter with the allowed ids — never replace (G3).
⚠️ Every `Decimal` must go through `serialize()` with the model name, or totals reach the client
as strings and silently corrupt.
⚠️ Dates used server-side as `Set` members, object keys, or `===`/`<`/`>` operands must go through
`dateOnlyString()`. `serialize()` only fixes the wire.

⚠️ **This is where raw SQL is most tempting** — grouping by two dimensions over joins is awkward
in Prisma. There is **no raw SQL anywhere in this repo today**, and `npm run audit:tenant` does a
**static scan** for `tenant_id` predicates that may not recognise a raw string. If raw SQL is
introduced, check `scripts/audit-tenant-scope.mjs` first and extend it. Flagged as Q14.

**Dimensions** (§7.2): Party (Company, Company Type, Industry, Contact Person, Contact Type,
Completeness) · Geography (City, State, Pincode, captured meeting location) · People (Sales
Person, Manager/Team) · Product (Product, Category, Sub-Category) · Deal (Stage, Probability band
0-30/40-60/70-100, Won/Lost, Reason for Loss, Source, ageing band) · Order (Status Draft/Placed,
Discount Applied Y/N, Blocked Reason) · Activity (Meeting type Planned/Unplanned/Past Entry,
Follow-up Mode, Follow-up Status) · Expense Category · Time (Day, Week, Month, Quarter, Year).

⚠️ **City** does not exist as a column until Phase 1's `company_addresses` lands, and is NULL for
every migrated row (Q5). **Pincode** and **captured meeting location** are the reliable geography
dimensions on day one.

**Measures** (§7.3): Order Amount · Order Quantity · Number of Orders · Gross Order Value · Net
Order Value · Discount Amount (item-wise) · Discount Amount (overall) · Total Discount · Discount
Percentage · Deal Expected Value · Weighted Deal Value · Number of Deals · Number of Meetings ·
**Meeting Hours (system-captured and manual, separately)** · Non-Meeting Hours · Working Hours ·
Expense Amount · Companies and Contacts added · Follow-ups due/done/missed · Planned vs Actual
counts.

**All master values are user-defined** (§2). Reports must read whatever exists in the master —
**nothing hard-coded**, including the probability bands, which are a §10 default (0-30/40-60/
70-100) and must be configurable in the registry rather than inlined.

---

### **P5-T2 · Report builder UI** · L · after P5-T1

`src/app/(protected)/reports/page.tsx`. Pick a Measure, one or two Dimensions, a Date Range,
Filters → table, with a toggle to chart.

⚠️ rgb-kit ships **no report-table component** (AGENTS.md §34 is spec-only), **no date-range preset
control** (§27.4, spec-only), and **no data-entry grid** (§31, spec-only). Per AGENTS.md §30, a
pattern the file does not cover is **agreed and written into AGENTS.md first, then built** — the
same gate Phase 2's Kanban hits. Raise the report-table pattern early; it is on the critical path.

`recharts` is already a dependency. Chart type per report is a §10 item — *"Choose what suits the
data; Aryan will review"*.

---

### **P5-T3 · Saved Reports** · M · after P5-T2

§7.1 — save a combination for repeat use. New `saved_reports` table
(`user_id`, `name`, `config jsonb`). Scope saved reports to their owner.

---

### **P5-T4 · The ten ready-made reports** · L · after P5-T3

§7.4, as **pre-configured combinations that open with settings already filled**, so a user who
does not want to build anything still gets value on day one:

1. Sales Person Performance · 2. Top Customers by Order Value · 3. Pipeline Summary ·
4. Reason for Loss Analysis · 5. Deal Ageing · 6. Plan vs Actual ·
7. Discount Given by Sales Person · 8. Order by Product Category and Sub-Category ·
9. Follow-up Compliance · 10. Expense vs Order Value.

Each is a `ReportSpec` literal in `src/lib/reports/presets.ts` — **not a bespoke page**.

---

### **P5-T5 · Reports page header** · S · after P5-T2

§7.5. Four numbers across the top for the selected period: **Order Value, Number of Meetings,
Deals Won, Expense**. Everything else sits below.
*"If a client logs in, sees those four numbers and closes the app, he has still got value that
day."* Use `fmtAmount` from `src/lib/format.ts` (P1-T4).

---

### **P5-T6 · Navigation** · S · after P5-T2

§10: Reports is a **top-level menu item**. Add it to `src/components/shell/nav.ts` (the registry)
and `src/components/ui/Sidebar.tsx`. ⚠️ Those two have already drifted apart once — see G10.

---

### **P5-T7 · Data-health alerts** · M · after P5-T1

§7.7 — **alerts on the relevant screen, not reports.** *"An owner does not open a report to learn
his data is incomplete."*

| Alert | Where it belongs |
|---|---|
| Incomplete Parties (and **what** is missing) | the Parties list and each Company/Contact page |
| Pending Draft Orders (**with the reason each is stuck**) | the Orders list — reads `orders.blocked_reason` |
| Parties Without Any Deal | the Parties list |
| Deals Without Follow-up | the Deals list / Kanban |
| Contacts Without Company | the Contacts tab |

---

## Parallelism

```
P5-T1 engine ─┬─ P5-T2 builder UI ─┬─ P5-T3 saved ─ P5-T4 ten reports
              │                    ├─ P5-T5 header
              │                    └─ P5-T6 nav
              └─ P5-T7 data-health alerts        (independent of the builder)
```
**Critical path:** T1 → T2 → T3 → T4. Raise the §30 report-table pattern on day 1.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Reports skip the scope filter | P4-T1's helper applied in T1; review every query |
| R2 | `?userId=` replaces rather than intersects | Fixed in P4-T2 before Phase 5 copies the pattern |
| R3 | Raw SQL bypasses the tenant audit | Q14. Extend `scripts/audit-tenant-scope.mjs` first |
| R4 | `Decimal` totals reach the client as strings | `serialize(rows, model)` on every path |
| R5 | No report-table / date-range component exists | §30 gate, raised on day 1 |
| R6 | Hard-coded master values in reports | §2: all masters are user-defined. Registry-driven |
| R7 | Monitoring reports on the front page kill adoption | §7.6. Engine-reachable, not featured |
| R8 | City dimension is empty | Q5. Lead with Pincode and State |
