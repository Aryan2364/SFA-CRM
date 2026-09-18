/**
 * ORDER ARITHMETIC. One module, imported by `POST /api/orders` and by the
 * Orders screen, so a line total is computed once and not twice.
 *
 * ---------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * Before REBUILD-PLAN §4.10, an order total was computed in two places:
 * server-side in `POST /api/orders` from the `qty`/`rate` the browser
 * posted, and independently in the browser for the figure on screen.
 * Two copies of `qty * rate` agree by luck. Discounts — item-wise AND
 * overall, per §4.10 — would have made it three, with rounding and
 * clamping decisions in each.
 *
 * So the arithmetic lives here and nowhere else. The route imports it;
 * the modal imports it; the numbers on screen and the numbers in the
 * row are the same numbers by construction.
 *
 * ---------------------------------------------------------------------
 * WHAT THIS FILE IS NOT
 *
 * It is NOT the authority on `rate`. The route is: it re-reads
 * `products.price` and passes THAT in, because §7.4 reports "Discount
 * Given by Sales Person" and a report over a number the sales person
 * typed measures nothing. This module takes whatever rate it is handed
 * and does honest arithmetic with it — keeping it pure is what lets the
 * browser call it too, and the browser has no database.
 *
 * ---------------------------------------------------------------------
 * THE SHAPE OF THE ANSWER
 *
 *   line.gross_amount    = qty × rate
 *   line.discount_amount = resolved from the line's type/value
 *   line.amount          = gross − discount            ← the NET line total
 *
 *   order.gross_amount          = Σ line.gross_amount
 *   order.item_discount_total   = Σ line.discount_amount
 *   order.order_discount_amount = resolved from the order's type/value,
 *                                 against (gross − item_discount_total)
 *   order.total_amount          = gross − item_discounts − order_discount
 *                                                      ← the NET payable
 *
 * `amount` and `total_amount` staying NET is deliberate: every existing
 * reader of those two columns — the list's Amount column, the dashboard
 * rollups, the deactivation summary — keeps working without knowing
 * discounts exist. The gross is the NEW column, not the changed one.
 *
 * `has_discount` is returned here but STORED on the row rather than
 * derived at read time: §7.2 wants "Discount Applied (Yes/No)" as a
 * report dimension, and a dimension you cannot index is a table scan.
 *
 * Pure functions. No React, no Prisma, no `'use client'`.
 */

/**
 * How a discount is expressed. `none` is a real value rather than a
 * null: the columns are NOT NULL with a `'none'` default, so a row
 * always says which of the three it is instead of leaving a reader to
 * infer it from a zero.
 */
export const DISCOUNT_TYPES = ['none', 'percent', 'amount'] as const
export type DiscountType = (typeof DISCOUNT_TYPES)[number]

export function isDiscountType(v: unknown): v is DiscountType {
  return typeof v === 'string' && (DISCOUNT_TYPES as readonly string[]).includes(v)
}

/** Human labels for the two pickers. Keyed so one word never gets two spellings. */
export const DISCOUNT_TYPE_LABELS: Record<DiscountType, string> = {
  none: 'No discount',
  percent: '% off',
  amount: '₹ off',
}

/**
 * Every money column is `Decimal(12,2)`, so every figure this module
 * produces is rounded to two places BEFORE it is summed. Rounding at
 * the end instead lets a column of lines add up to something the
 * database cannot store, and the row then disagrees with the screen by
 * a paisa — which is exactly the class of bug the shared module exists
 * to remove.
 *
 * `Math.round(x * 100) / 100` on a value that is already the product of
 * two user figures is accurate well past any realistic order value; the
 * `EPSILON` nudge stops 1.005 rounding down through float representation.
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON * Math.sign(n) * Math.abs(n)) * 100) / 100
}

/** `null`/`''`/`NaN`/`-3` all become 0. Nothing here accepts a negative. */
function nonNegative(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n
}

/**
 * Resolve a discount against a base.
 *
 * Both directions are CLAMPED, and the clamping is the point:
 *   - a percent above 100 would make the discount exceed the base,
 *   - a flat amount above the base would make the line negative.
 * Either way the order becomes a credit note, which is not a thing this
 * product has. A nonsense input is clamped to the largest sensible
 * value rather than rejected, because this function is also called on
 * every keystroke in the browser, where a half-typed number is normal.
 * The ROUTE validates and rejects; this only has to stay coherent.
 */
export function resolveDiscount(
  base: number,
  type: DiscountType | string | null | undefined,
  value: unknown
): number {
  const safeBase = Math.max(0, round2(nonNegative(base)))
  if (safeBase === 0) return 0
  const v = nonNegative(value)
  if (v === 0) return 0

  if (type === 'percent') {
    const pct = Math.min(100, v)
    return round2((safeBase * pct) / 100)
  }
  if (type === 'amount') {
    return round2(Math.min(safeBase, v))
  }
  return 0
}

/** What a caller hands in for one line. `rate` is the AUTHORITATIVE rate. */
export type LineInput = {
  qty: number
  rate: number
  discount_type?: DiscountType | string | null
  discount_value?: number | string | null
}

/** What one line is worth. The three money columns on `order_items`, plus `amount`. */
export type LineTotals = {
  gross_amount: number
  discount_type: DiscountType
  discount_value: number
  discount_amount: number
  /** The NET line total — what goes in `order_items.amount`. */
  amount: number
}

export function lineTotals(line: LineInput): LineTotals {
  const gross = round2(nonNegative(line.qty) * nonNegative(line.rate))
  const type: DiscountType = isDiscountType(line.discount_type) ? line.discount_type : 'none'
  const value = type === 'none' ? 0 : round2(nonNegative(line.discount_value))
  const discount = resolveDiscount(gross, type, value)
  return {
    gross_amount: gross,
    discount_type: type,
    discount_value: value,
    discount_amount: discount,
    amount: round2(gross - discount),
  }
}

/** Every money figure on `orders`, plus the per-line breakdown that produced it. */
export type OrderTotals = {
  lines: LineTotals[]
  gross_amount: number
  item_discount_total: number
  order_discount_type: DiscountType
  order_discount_value: number
  order_discount_amount: number
  /** The NET payable — what goes in `orders.total_amount`. */
  total_amount: number
  has_discount: boolean
}

/**
 * The whole order.
 *
 * The order-level discount is taken against the subtotal AFTER the line
 * discounts, not against the gross. That is the only reading under
 * which the two discounts compose without double-counting: a 10% line
 * discount and a further 10% off the order is 19% off, which is what
 * "and a further 10% off" means to the person granting it.
 */
export function orderTotals(
  lines: LineInput[],
  orderDiscountType?: DiscountType | string | null,
  orderDiscountValue?: number | string | null
): OrderTotals {
  const resolvedLines = lines.map(lineTotals)

  const gross = round2(resolvedLines.reduce((s, l) => s + l.gross_amount, 0))
  const itemDiscountTotal = round2(resolvedLines.reduce((s, l) => s + l.discount_amount, 0))
  const subtotal = round2(gross - itemDiscountTotal)

  const type: DiscountType = isDiscountType(orderDiscountType) ? orderDiscountType : 'none'
  const value = type === 'none' ? 0 : round2(nonNegative(orderDiscountValue))
  const orderDiscount = resolveDiscount(subtotal, type, value)

  return {
    lines: resolvedLines,
    gross_amount: gross,
    item_discount_total: itemDiscountTotal,
    order_discount_type: type,
    order_discount_value: value,
    order_discount_amount: orderDiscount,
    total_amount: round2(subtotal - orderDiscount),
    has_discount: itemDiscountTotal > 0 || orderDiscount > 0,
  }
}

/**
 * ORDER STATES — REBUILD-PLAN §4.10: an order is a Draft or it is
 * Placed, and there is no third thing.
 *
 * Here rather than in `status-badge.tsx` because that file owns how a
 * word LOOKS and this one owns what is legal to write. The route
 * validates against this; the badge map renders these two keys.
 */
export const ORDER_STATUSES = ['Draft', 'Placed'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v)
}
