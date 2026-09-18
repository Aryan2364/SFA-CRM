import { Prisma } from '@prisma/client'
import { readPath, type SourceKey } from './sources'

/**
 * THE MEASURE REGISTRY — REBUILD-PLAN.md §7.3, declared as data.
 *
 * A measure says which SOURCE it counts or sums over, what extra columns that
 * needs selected, and how to turn one fetched row into a number. `run.ts`
 * never names a measure; it looks one up and applies it.
 *
 * ⚠️ Every money figure is a `Decimal`, and every accumulator here is a
 * `Decimal` too. Summing `Number(row.total_amount)` would be a float sum of
 * money; running the result through `serialize()` at the end is what turns the
 * exact Decimal into the JS number the client expects (PLAN.md §5.1). A
 * `Decimal` that reaches `JSON.stringify` becomes a STRING and silently
 * corrupts every total downstream of it.
 */

export type MeasureFormat = 'amount' | 'number' | 'hours' | 'percent'

export type MeasureDef = {
  key: string
  label: string
  source: SourceKey
  format: MeasureFormat
  /** Extra columns this measure needs, merged into the query's `select`. */
  select?: Record<string, unknown>
  /** Extra predicate, relative to the source model. */
  where?: Record<string, unknown>
} & (
  | { kind: 'count' }
  | { kind: 'sum'; value: (row: Record<string, unknown>) => Prisma.Decimal }
  | {
      kind: 'ratio'
      /** `numerator / denominator × 100`, both summed as Decimals. */
      numerator: (row: Record<string, unknown>) => Prisma.Decimal
      denominator: (row: Record<string, unknown>) => Prisma.Decimal
    }
)

const D = (v: unknown): Prisma.Decimal => {
  if (v === null || v === undefined) return new Prisma.Decimal(0)
  if (v instanceof Prisma.Decimal) return v
  return new Prisma.Decimal(String(v))
}

/** A column read through its declared path, as a Decimal. */
const col = (...path: string[]) => (row: Record<string, unknown>) => D(readPath(row, path))

export const MEASURES = {
  // ── Orders ──────────────────────────────────────────────────────────────
  order_amount: {
    key: 'order_amount', label: 'Order Amount', source: 'orders',
    kind: 'sum', format: 'amount',
    select: { total_amount: true }, value: col('total_amount'),
  },
  order_count: {
    key: 'order_count', label: 'Number of Orders', source: 'orders',
    kind: 'count', format: 'number',
  },
  gross_order_value: {
    key: 'gross_order_value', label: 'Gross Order Value', source: 'orders',
    kind: 'sum', format: 'amount',
    select: { gross_amount: true }, value: col('gross_amount'),
  },
  net_order_value: {
    key: 'net_order_value', label: 'Net Order Value', source: 'orders',
    kind: 'sum', format: 'amount',
    select: { total_amount: true }, value: col('total_amount'),
  },
  /** §7.3 keeps the two discounts apart: the ones typed on a line, and the one
   *  applied to the order as a whole. Both are stored, so both are measurable. */
  item_discount_total: {
    key: 'item_discount_total', label: 'Discount Amount (item-wise)', source: 'orders',
    kind: 'sum', format: 'amount',
    select: { item_discount_total: true }, value: col('item_discount_total'),
  },
  order_discount_amount: {
    key: 'order_discount_amount', label: 'Discount Amount (overall)', source: 'orders',
    kind: 'sum', format: 'amount',
    select: { order_discount_amount: true }, value: col('order_discount_amount'),
  },
  total_discount: {
    key: 'total_discount', label: 'Total Discount', source: 'orders',
    kind: 'sum', format: 'amount',
    select: { item_discount_total: true, order_discount_amount: true },
    value: row => D(readPath(row, ['item_discount_total'])).add(D(readPath(row, ['order_discount_amount']))),
  },
  discount_percentage: {
    key: 'discount_percentage', label: 'Discount Percentage', source: 'orders',
    kind: 'ratio', format: 'percent',
    select: { item_discount_total: true, order_discount_amount: true, gross_amount: true },
    numerator: row => D(readPath(row, ['item_discount_total'])).add(D(readPath(row, ['order_discount_amount']))),
    denominator: col('gross_amount'),
  },
  order_quantity: {
    key: 'order_quantity', label: 'Order Quantity', source: 'order_items',
    kind: 'sum', format: 'number',
    select: { qty: true }, value: col('qty'),
  },
  order_line_amount: {
    key: 'order_line_amount', label: 'Order Amount (by line)', source: 'order_items',
    kind: 'sum', format: 'amount',
    select: { amount: true }, value: col('amount'),
  },

  // ── Meetings ────────────────────────────────────────────────────────────
  meeting_count: {
    key: 'meeting_count', label: 'Number of Meetings', source: 'visits',
    kind: 'count', format: 'number',
  },
  /**
   * §7.3 wants system-captured and manual meeting hours SEPARATELY, and means
   * it: a manual entry's duration is what the rep typed, a captured one is what
   * the clock recorded. Averaging them together hides exactly the difference
   * the report exists to show. Two measures, one `where` apart.
   */
  meeting_hours_system: {
    key: 'meeting_hours_system', label: 'Meeting Hours (system-captured)', source: 'visits',
    kind: 'sum', format: 'hours',
    where: { is_manual_entry: false },
    select: { duration_secs: true },
    value: row => D(readPath(row, ['duration_secs'])).div(3600),
  },
  meeting_hours_manual: {
    key: 'meeting_hours_manual', label: 'Meeting Hours (manual)', source: 'visits',
    kind: 'sum', format: 'hours',
    where: { is_manual_entry: true },
    select: { duration_secs: true },
    value: row => D(readPath(row, ['duration_secs'])).div(3600),
  },

  // ── Expenses ────────────────────────────────────────────────────────────
  expense_amount: {
    key: 'expense_amount', label: 'Expense Amount', source: 'expenses',
    kind: 'sum', format: 'amount',
    select: { amount: true }, value: col('amount'),
  },
  expense_count: {
    key: 'expense_count', label: 'Number of Expenses', source: 'expenses',
    kind: 'count', format: 'number',
  },

  // ── Deals ───────────────────────────────────────────────────────────────
  deal_count: {
    key: 'deal_count', label: 'Number of Deals', source: 'deals',
    kind: 'count', format: 'number',
  },
  deal_expected_value: {
    key: 'deal_expected_value', label: 'Deal Expected Value', source: 'deals',
    kind: 'sum', format: 'amount',
    select: { expected_value: true }, value: col('expected_value'),
  },
  weighted_deal_value: {
    key: 'weighted_deal_value', label: 'Weighted Deal Value', source: 'deals',
    kind: 'sum', format: 'amount',
    select: { expected_value: true, probability: true },
    value: row => D(readPath(row, ['expected_value'])).mul(D(readPath(row, ['probability']))).div(100),
  },
  deals_won: {
    key: 'deals_won', label: 'Deals Won', source: 'deals',
    kind: 'count', format: 'number',
    where: { outcome: 'won' },
  },
  deals_lost: {
    key: 'deals_lost', label: 'Deals Lost', source: 'deals',
    kind: 'count', format: 'number',
    where: { outcome: 'lost' },
  },
  won_value: {
    key: 'won_value', label: 'Won Deal Value', source: 'deals',
    kind: 'sum', format: 'amount',
    where: { outcome: 'won' },
    select: { expected_value: true }, value: col('expected_value'),
  },

  // ── Parties ─────────────────────────────────────────────────────────────
  companies_added: {
    key: 'companies_added', label: 'Companies Added', source: 'companies',
    kind: 'count', format: 'number',
  },
  contacts_added: {
    key: 'contacts_added', label: 'Contacts Added', source: 'contacts',
    kind: 'count', format: 'number',
  },

  // ── Follow-ups (§7.4 #9 Follow-up Compliance) ───────────────────────────
  follow_ups_due: {
    key: 'follow_ups_due', label: 'Follow-ups Due', source: 'follow_ups',
    kind: 'count', format: 'number',
  },
  follow_ups_done: {
    key: 'follow_ups_done', label: 'Follow-ups Done', source: 'follow_ups',
    kind: 'count', format: 'number',
    where: { status: 'done' },
  },
  /**
   * "Missed" is due, not done, and the due date has passed. A measure cannot
   * see the spec, so it declares only the OPEN half; the report's date range is
   * what makes it "missed", and a range ending in the future counts follow-ups
   * that are merely still open. Pair it with a `dateTo` of today or earlier.
   */
  follow_ups_missed: {
    key: 'follow_ups_missed', label: 'Follow-ups Missed', source: 'follow_ups',
    kind: 'count', format: 'number',
    where: { status: { not: 'done' } },
  },

  // ── Weekly plan (§7.4 #6 Plan vs Actual) ────────────────────────────────
  planned_visits: {
    key: 'planned_visits', label: 'Planned Meetings', source: 'plan_items',
    kind: 'count', format: 'number',
  },
  planned_order_value: {
    key: 'planned_order_value', label: 'Planned Order Value', source: 'plan_items',
    kind: 'sum', format: 'amount',
    select: { expected_order_value: true }, value: col('expected_order_value'),
  },
} as const satisfies Record<string, MeasureDef>

export type MeasureKey = keyof typeof MEASURES

export const MEASURE_KEYS = Object.keys(MEASURES) as MeasureKey[]

export function getMeasure(key: string): MeasureDef | null {
  return (MEASURES as Record<string, MeasureDef>)[key] ?? null
}
