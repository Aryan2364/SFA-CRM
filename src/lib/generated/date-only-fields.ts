// GENERATED FILE — do not edit by hand.
// Regenerate with: npm run prisma:sync  (or: node scripts/generate-date-only-fields.mjs)
// Source: prisma/schema.prisma — every column declared @db.Date.
//
// These are the columns PostgREST sent as "YYYY-MM-DD" rather than a full ISO
// timestamp. serialize() in src/lib/db.ts uses this to preserve that contract.

/** "model.field" keys for every date-only (`@db.Date`) column. */
export const DATE_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'attendance.date',
  'business_partners.next_follow_up_date',
  'contacts.anniversary',
  'contacts.birthday',
  'daily_visits.visit_date',
  'expenses.expense_date',
  'orders.order_date',
  'tenants.payment_due_date',
  'weekly_plan_items.plan_date',
  'weekly_plans.week_end_date',
  'weekly_plans.week_start_date',
])

/**
 * Bare field names that are date-only in at least one model. Used only when a
 * caller does not tell serialize() which model a row came from.
 */
export const DATE_ONLY_FIELD_NAMES: ReadonlySet<string> = new Set([
  'anniversary',
  'birthday',
  'date',
  'expense_date',
  'next_follow_up_date',
  'order_date',
  'payment_due_date',
  'plan_date',
  'visit_date',
  'week_end_date',
  'week_start_date',
])

/**
 * Field names that are date-only on one model but a timestamp on another.
 * Serialising such a field without model context is ambiguous, so serialize()
 * throws rather than guessing. Empty today; it is a tripwire for future schema
 * changes, which is the whole point of generating this file.
 */
export const AMBIGUOUS_DATE_FIELD_NAMES: ReadonlySet<string> = new Set([

])
