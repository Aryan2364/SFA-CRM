import { createHash } from 'node:crypto'

import { prisma } from '@/lib/db'

/**
 * THE REMARK CONTEXT VOCABULARY — what a remark can be attached to, and who
 * owns the thing it is attached to.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO NOTES TABLE
 *
 * `contextual_remarks` is already a tenant-scoped, timestamped, threaded note
 * keyed by `(context_type, context_id)`, with read tracking in `remark_reads`
 * and notification fan-out. Deal notes (§4.4), Minutes of the Meeting (§5.5)
 * and Manager comments (§6.5) are three names for that one primitive. Each
 * gets a `context_type`, not a table.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ THE CHECK CONSTRAINT IS NOT THE SAME IN DEV AND IN PRODUCTION
 *
 * Production carries `contextual_remarks_context_type_check`, and at the time
 * of writing it permits FOUR values: meeting, expense, weekly_plan_day,
 * weekly_plan. It does NOT permit `deal`, `daily_summary` or `weekly_summary`.
 *
 * **The local database has no CHECK on this column at all** — Prisma does not
 * model CHECK constraints, so `db push` never created one. Verified:
 * `SELECT ... FROM pg_constraint WHERE conname='contextual_remarks_context_type_check'`
 * returns zero rows on localhost. Local therefore accepts every value below
 * and proves nothing about production, exactly as with `orders.status` and
 * `role_permissions.section`.
 *
 * So `CONTEXT_TYPES` below is the application's vocabulary and this module
 * validates against it. Until production's constraint is widened to match,
 * writing a `deal` note there will fail at the database. That widening is
 * tracked separately; do not infer from a green local run that it has happened.
 */
export const CONTEXT_TYPES = [
  'meeting',
  'expense',
  'weekly_plan_day',
  'weekly_plan',
  'deal',
  /*
   * P3-T9, §5.5: "A note written here can be **linked** to a specific Deal or
   * Order." `deal` was already here; `order` is its other half and arrives the
   * same way — a context type, not a table — because an order note is the same
   * threaded, tenant-scoped, timestamped primitive as every other note.
   *
   * ⚠️ The production CHECK constraint warning above applies to this value
   * exactly as it applies to `deal`: production permits four values and this is
   * not one of them, the local database has no CHECK at all, and a green local
   * run therefore proves nothing about production.
   */
  'order',
  'daily_summary',
  'weekly_summary',
] as const

export type ContextType = (typeof CONTEXT_TYPES)[number]

export function isContextType(v: unknown): v is ContextType {
  return typeof v === 'string' && (CONTEXT_TYPES as readonly string[]).includes(v)
}

/**
 * The two context types whose `context_id` is DERIVED rather than a row id.
 *
 * A Daily Summary and a Weekly Summary are computed views over a person's
 * meetings, expenses and plans for a period. Neither is a row, so neither has
 * an id — and `contextual_remarks.context_id` is `uuid NOT NULL`, so "the
 * user's id plus a date" cannot simply be stored.
 *
 * `summaryContextId()` closes that gap with a deterministic UUIDv5 over
 * (kind, user, period). It is stable, unique per person per period, and needs
 * no schema change. See the warning on that function about what it costs.
 */
export const SUMMARY_CONTEXTS = ['daily_summary', 'weekly_summary'] as const
export type SummaryContext = (typeof SUMMARY_CONTEXTS)[number]

export function isSummaryContext(v: unknown): v is SummaryContext {
  return typeof v === 'string' && (SUMMARY_CONTEXTS as readonly string[]).includes(v)
}

/**
 * A fixed namespace for this product's derived ids. Any constant UUID works;
 * this one must never change, because changing it orphans every summary
 * comment ever written — they would still be in the table, attached to a
 * `context_id` nothing computes any more.
 */
const SUMMARY_NAMESPACE = '6f1d3c22-0f1a-4a3e-9c5b-2f7d8a41e0b3'

/** UUIDv5 (SHA-1, name-based), per RFC 4122 §4.3. No dependency needed. */
function uuidv5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest()
  const b = Buffer.from(hash.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50 // version 5
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * The `context_id` for one person's summary for one period.
 *
 * ⚠️ **This id is opaque and NOT reversible.** You cannot look at a
 * `daily_summary` row in `contextual_remarks` and recover whose summary it is.
 * That is why every summary route below takes `userId` and `date` on the wire
 * and derives the id here, rather than accepting a raw `contextId`:
 * authorisation is done against the SUPPLIED user id, before the derivation.
 * Accepting a raw id for these two types would be an authorisation bypass —
 * anyone holding the uuid could read the thread and nothing could tell whose
 * it was. `assertReadable()` enforces that split.
 *
 * `period` is `YYYY-MM-DD`: the day for a daily summary, the week-start date
 * for a weekly one. It is used as a plain string and never as a Date, so no
 * timezone can shift it (PLAN.md §8.4).
 */
export function summaryContextId(
  kind: SummaryContext,
  userId: string,
  period: string
): string {
  return uuidv5(`${kind}:${userId}:${period}`, SUMMARY_NAMESPACE)
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
export function isPeriod(v: unknown): v is string {
  return typeof v === 'string' && DATE_ONLY.test(v)
}

/**
 * Who owns the thing a remark is attached to, or `null` when the context is
 * not owned by one person (or does not exist).
 *
 * The caller compares this to the session user and, when they differ, requires
 * `canView()`. Before this task only four of the types resolved here; `deal`
 * fell through to `null`, which meant NO authorisation ran for it at all.
 */
export async function resolveContextOwner(
  contextType: ContextType,
  contextId: string,
  tenantId: string
): Promise<string | null> {
  switch (contextType) {
    case 'meeting': {
      const visit = await prisma.daily_visits.findFirst({
        where: { id: contextId, tenant_id: tenantId },
        select: { user_id: true },
      })
      return visit?.user_id ?? null
    }
    case 'expense': {
      const expense = await prisma.expenses.findFirst({
        where: { id: contextId, tenant_id: tenantId },
        select: { user_id: true },
      })
      return expense?.user_id ?? null
    }
    case 'weekly_plan_day': {
      const item = await prisma.weekly_plan_items.findFirst({
        where: { id: contextId, tenant_id: tenantId },
        select: { weekly_plan_id: true },
      })
      if (!item) return null
      const plan = await prisma.weekly_plans.findFirst({
        where: { id: item.weekly_plan_id, tenant_id: tenantId },
        select: { user_id: true },
      })
      return plan?.user_id ?? null
    }
    case 'weekly_plan': {
      const plan = await prisma.weekly_plans.findFirst({
        where: { id: contextId, tenant_id: tenantId },
        select: { user_id: true },
      })
      return plan?.user_id ?? null
    }
    case 'deal': {
      // §4.4. `owner_user_id` is nullable on `deals` — an unassigned deal has
      // no owner, so there is nobody to check visibility against and the
      // section permission is the only gate. That is the same answer the four
      // types above give for a context that does not exist, and it is the
      // honest one: null means "not owned by a person", not "allowed".
      const deal = await prisma.deals.findFirst({
        where: { id: contextId, tenant_id: tenantId },
        select: { owner_user_id: true },
      })
      return deal?.owner_user_id ?? null
    }
    case 'order': {
      // §5.5. `orders.user_id` is NOT NULL — it is the rep the order belongs
      // to — so unlike a Deal an Order always has an owner, and the visibility
      // check below always has somebody to run against.
      const order = await prisma.orders.findFirst({
        where: { id: contextId, tenant_id: tenantId },
        select: { user_id: true },
      })
      return order?.user_id ?? null
    }
    case 'daily_summary':
    case 'weekly_summary':
      // Not resolvable from the id — that is the whole point of the derivation
      // warning above. The owner is the `userId` the caller supplied, and the
      // caller's route has already checked it.
      return null
  }
}
