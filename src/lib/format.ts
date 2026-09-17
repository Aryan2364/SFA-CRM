/**
 * Section 18 of AGENTS.md, as code.
 *
 * | Type          | Format                | Example              |
 * |---------------|-----------------------|----------------------|
 * | Date          | `DD Mon YYYY`         | 12 Aug 2026          |
 * | Date and time | `DD Mon YYYY, h:mm A` | 12 Aug 2026, 3:45 PM |
 * | Number        | Indian grouping       | 12,45,680            |
 * | Amount        | Two decimals always   | 4,200.00             |
 * | Currency      | Symbol before, no gap | ₹4,200.00            |
 *
 * Every screen that writes a date or a rupee figure calls into here. The rules
 * live in one place so "never a numeric-only date" and "two decimals always"
 * are properties of the system rather than of whoever wrote the screen.
 *
 * Pure functions. No React, no `'use client'`, nothing Node-only — this file is
 * imported by API routes and by client components alike.
 */

import { format, isValid, parse } from 'date-fns'

/**
 * What every formatter renders when it has nothing to render. An em dash, which
 * is what the screens already reach for when a value is absent (orders line 387,
 * superadmin/companies line 112, review/[userId] line 214).
 *
 * The point is that `null`, `undefined`, `NaN` and an unparseable string all
 * land here rather than reaching a user as "NaN" or "Invalid Date".
 */
export const EMPTY = '—'

/** `date-fns` pattern for section 18's date. Shared with `date-picker.tsx`. */
export const DATE_FORMAT = 'dd MMM yyyy'

/** `date-fns` pattern for section 18's date and time. */
export const DATE_TIME_FORMAT = 'dd MMM yyyy, h:mm a'

/** `date-fns` pattern for the time half on its own. */
export const TIME_FORMAT = 'h:mm a'

/** What arrives from the API: `serialize()` turns dates into strings, never `Date`. */
type DateInput = string | Date | null | undefined

/**
 * What arrives from the API for a money or quantity column. Prisma hands back
 * `Decimal`; `serialize()` turns it into a `number`, but an un-serialised route
 * or a form field yields the string, so both are accepted.
 */
type NumberInput = number | string | null | undefined

// ─────────────────────────────────────────────────────────────
// Numbers
// ─────────────────────────────────────────────────────────────

/** `null` for anything that is not a real, finite number — including `NaN`. */
function toFinite(v: NumberInput): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return Number.isFinite(v) ? v : null
}

/**
 * `Intl` does Indian digit grouping — 2,2,3 rather than 3,3,3 — correctly for
 * the `en-IN` locale. Hand-rolling it is how you get 1,234,567 in a rupee column.
 */
const amountFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
})

const qtyFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 3,
})

/**
 * Money. Rupee symbol before the digits with no gap, Indian grouping, and two
 * decimals always — `₹4,200.00`, never `₹4,200` and never `₹4200.00`.
 *
 * "Two decimals always" is the rule that makes a column of amounts read as a
 * column: the decimal points line up.
 */
export function fmtAmount(v: NumberInput): string {
  const n = toFinite(v)
  if (n === null) return EMPTY
  return amountFormatter.format(n)
}

/**
 * A plain count — Indian grouping, no decimals, no symbol. `12,45,680`.
 */
export function fmtNumber(v: NumberInput): string {
  const n = toFinite(v)
  if (n === null) return EMPTY
  return numberFormatter.format(n)
}

/**
 * A quantity. Grouped like any number, but a fractional quantity keeps its
 * fraction (up to three places) instead of being rounded to a whole unit —
 * 2.5 kg is a quantity someone typed, not a rounding error.
 */
export function fmtQty(v: NumberInput): string {
  const n = toFinite(v)
  if (n === null) return EMPTY
  return qtyFormatter.format(n)
}

// ─────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Turn whatever the API handed us into a `Date`, or `null` if it is not one.
 *
 * A bare `"2026-09-18"` — what `serialize()` produces for a `@db.Date` column —
 * is parsed **by its parts**, not by `new Date(string)`. `new Date("2026-09-18")`
 * is UTC midnight, which in any negative-offset timezone renders as the 17th.
 * The date on a `@db.Date` column has no timezone; it is the day someone wrote
 * down, and it must survive the trip to the screen unshifted.
 */
export function parseApiDate(value: DateInput): Date | null {
  if (value === null || value === undefined) return null

  if (value instanceof Date) return isValid(value) ? value : null

  const text = value.trim()
  if (text === '') return null

  if (DATE_ONLY.test(text)) {
    // Local midnight of that calendar day — no timezone shift.
    const parsed = parse(text, 'yyyy-MM-dd', new Date())
    return isValid(parsed) ? parsed : null
  }

  const parsed = new Date(text)
  return isValid(parsed) ? parsed : null
}

/** `DD Mon YYYY` — `18 Sep 2026`. Never `18/09/2026`; see section 18. */
export function fmtDate(iso: DateInput): string {
  const date = parseApiDate(iso)
  if (!date) return EMPTY
  return format(date, DATE_FORMAT)
}

/** `DD Mon YYYY, h:mm A` — `18 Sep 2026, 3:45 PM`. */
export function fmtDateTime(iso: DateInput): string {
  const date = parseApiDate(iso)
  if (!date) return EMPTY
  return format(date, DATE_TIME_FORMAT)
}

/**
 * `h:mm A` — `3:45 PM`. For rows that already carry their date in a heading and
 * would only repeat it on every line.
 */
export function fmtTime(iso: DateInput): string {
  const date = parseApiDate(iso)
  if (!date) return EMPTY
  return format(date, TIME_FORMAT)
}
