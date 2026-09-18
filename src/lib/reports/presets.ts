import type { ReportSpec } from './run'

/**
 * THE READY-MADE REPORTS — REBUILD-PLAN.md §7.4, P5-T4.
 *
 * Each is a `ReportSpec` LITERAL, never a bespoke page and never a bespoke
 * query. That is the whole point of §7.1: ten reports that open with their
 * settings already filled, so a user who does not want to build anything still
 * gets value on day one — and every one of them runs through `runReport()`,
 * scope filter and all.
 *
 * `dateFrom`/`dateTo` are left off: a preset has no opinion about the period,
 * and the screen supplies the range the user has selected. `withRange()` is how
 * a preset becomes a runnable spec.
 *
 * ⚠️ §7.6: the monitoring reports — Attendance, Location Flag, Working Hours —
 * are reachable through the engine and are deliberately NOT in this list.
 * "Leading with them makes the sales team see the software as a spying tool,
 * and adoption dies. Let the Manager find them himself."
 */

export type PresetSpec = Omit<ReportSpec, 'dateFrom' | 'dateTo'>

export type ReportPreset = {
  key: string
  name: string
  /** One line saying what the owner learns from it. Shown on the card. */
  description: string
  spec: PresetSpec
  /** Additional specs shown alongside the first, for a report that is really
   *  two numbers side by side (Plan vs Actual, Expense vs Order Value). */
  companions?: { name: string; spec: PresetSpec }[]
  /**
   * WHAT §7.4 ASKED FOR THAT THIS PRESET DOES NOT YET SHOW, in plain words,
   * shown on the card next to the preset it belongs to.
   *
   * ⚠️ This field exists so that a shortfall is VISIBLE rather than invented.
   * The alternative — quietly computing something adjacent and labelling it
   * with the name §7.4 used — puts a plausible wrong figure in front of an
   * owner who has no way to tell. A named gap costs a line of text; a wrong
   * conversion rate costs a decision. Delete the note on the day the registry
   * can express the thing, not before.
   */
  gap?: string
}

export const PRESETS: ReportPreset[] = [
  {
    key: 'sales_person_performance',
    name: 'Sales Person Performance',
    description: 'Order value booked per person, with meetings, orders and discount alongside.',
    // §7.4 also names CONVERSION RATE. There is no such measure: a rate is one
    // measure divided by another across two different sources (orders per
    // meeting, or deals won per deal), and the registry's `ratio` kind divides
    // two columns of the SAME row. Nothing here is labelled "conversion rate",
    // because the numbers that are here are all exact.
    gap: 'Conversion rate is not shown — the engine cannot yet divide one measure by another across two sources.',
    spec: { measure: 'order_amount', dimensions: ['sales_person'] },
    companions: [
      { name: 'Meetings done', spec: { measure: 'meeting_count', dimensions: ['sales_person'] } },
      { name: 'Orders booked', spec: { measure: 'order_count', dimensions: ['sales_person'] } },
      { name: 'Discount given', spec: { measure: 'total_discount', dimensions: ['sales_person'] } },
    ],
  },
  {
    key: 'top_customers',
    name: 'Top Customers by Order Value',
    description: 'Who is actually paying the most, ranked.',
    spec: { measure: 'order_amount', dimensions: ['company'] },
  },
  {
    key: 'pipeline_summary',
    name: 'Pipeline Summary',
    description: 'How much value sits at each Deal Stage, and how many Deals.',
    spec: { measure: 'deal_expected_value', dimensions: ['deal_stage'] },
    companions: [
      { name: 'Number of Deals', spec: { measure: 'deal_count', dimensions: ['deal_stage'] } },
      { name: 'Weighted value', spec: { measure: 'weighted_deal_value', dimensions: ['deal_stage'] } },
    ],
  },
  {
    key: 'reason_for_loss',
    name: 'Reason for Loss Analysis',
    description: 'Why Deals are dying, ranked. Reads the Reason for Loss master.',
    spec: { measure: 'deal_count', dimensions: ['reason_for_loss'], filters: { deal_outcome: 'lost' } },
  },
  {
    key: 'deal_ageing',
    name: 'Deal Ageing',
    description: 'Deals stuck too long at one stage, by ageing band.',
    // §7.4 says "oldest first". The bands come back in their KEY order, and the
    // keys are compared as text, so "8-14" sorts after "60+". Read the band
    // labels, not the row order, until the engine sorts a band dimension by the
    // band's position in `AGEING_BANDS` rather than by its key.
    gap: 'The ageing bands are not in age order — “8–14 days” sorts after “Over 60 days”. Read the band names, not the row order.',
    spec: { measure: 'deal_count', dimensions: ['deal_ageing_band', 'deal_stage'] },
  },
  {
    key: 'plan_vs_actual',
    name: 'Plan versus Actual',
    description: 'Meetings planned against meetings done, per person.',
    // Planned meetings live in `weekly_plan_items` and done ones in
    // `daily_visits`. A report reads ONE source, so the two cannot share a
    // table; they are the same breakdown run twice and read side by side.
    // Switching the breakdown to a time dimension gives §7.4's "by period".
    gap: 'Planned and done come from two different tables, so they are two reports side by side rather than two columns of one.',
    spec: { measure: 'planned_visits', dimensions: ['sales_person'] },
    companions: [
      { name: 'Meetings done', spec: { measure: 'meeting_count', dimensions: ['sales_person'] } },
    ],
  },
  {
    key: 'discount_by_person',
    name: 'Discount Given by Sales Person',
    description: 'Total discount per person, and what share of gross value it is.',
    spec: { measure: 'total_discount', dimensions: ['sales_person'] },
    companions: [
      { name: 'Discount percentage', spec: { measure: 'discount_percentage', dimensions: ['sales_person'] } },
    ],
  },
  {
    key: 'order_by_category',
    name: 'Order by Product Category and Sub-Category',
    description: 'What is selling and what is not.',
    spec: { measure: 'order_line_amount', dimensions: ['product_category', 'product_subcategory'] },
  },
  {
    key: 'follow_up_compliance',
    name: 'Follow-up Compliance',
    description: 'Follow-ups due against follow-ups done, per person.',
    // "Missed" is the open ones whose due date is in the range. With a range
    // that ends in the future it also counts follow-ups that are merely still
    // ahead of their date — which is why the note says to end the range today.
    gap: '“Missed” counts every follow-up still open in the range, so end the range today or earlier for it to mean missed.',
    spec: { measure: 'follow_ups_due', dimensions: ['sales_person'] },
    companions: [
      { name: 'Done', spec: { measure: 'follow_ups_done', dimensions: ['sales_person'] } },
      { name: 'Missed', spec: { measure: 'follow_ups_missed', dimensions: ['sales_person'] } },
    ],
  },
  {
    key: 'expense_vs_order',
    name: 'Expense versus Order Value',
    description: 'The cost of sales, month by month.',
    spec: { measure: 'expense_amount', dimensions: ['time_month'] },
    companions: [
      { name: 'Order value', spec: { measure: 'order_amount', dimensions: ['time_month'] } },
    ],
  },
]

/**
 * §7.5 — the four numbers across the top of the Reports page. Each is the
 * engine's `total` for a one-dimension spec, so the header needs no separate
 * code path and no separate permission story.
 *
 * "If a client logs in, sees those four numbers and closes the app, he has
 * still got value that day."
 */
export const HEADLINE_SPECS: { key: string; label: string; spec: PresetSpec }[] = [
  { key: 'order_value', label: 'Order Value', spec: { measure: 'order_amount', dimensions: ['time_month'] } },
  { key: 'meetings', label: 'Meetings', spec: { measure: 'meeting_count', dimensions: ['time_month'] } },
  { key: 'deals_won', label: 'Deals Won', spec: { measure: 'deals_won', dimensions: ['time_month'] } },
  { key: 'expense', label: 'Expense', spec: { measure: 'expense_amount', dimensions: ['time_month'] } },
]

export function withRange(spec: PresetSpec, dateFrom: string, dateTo: string): ReportSpec {
  return { ...spec, dateFrom, dateTo }
}

export function getPreset(key: string): ReportPreset | null {
  return PRESETS.find(p => p.key === key) ?? null
}
