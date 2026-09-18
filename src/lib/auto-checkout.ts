import { prisma, dateOnlyString } from './db'
import { getTenantSettings } from './settings'

/**
 * Auto check-out — REBUILD-PLAN.md §5.3, P3-T6.
 *
 * Anyone who checked in and never checked out has an `attendance` row left
 * open for ever. This closes those rows, stamping them at the tenant's
 * configured `auto_checkout_minutes` (default 0 = midnight).
 *
 * ---------------------------------------------------------------------------
 * WHY A LAZY SWEEP AND NOT A SCHEDULED JOB
 *
 * There is no scheduler in this codebase — no cron, no job runner, no queue —
 * so a scheduled job is a deployment change, not just code. This runs instead
 * on authenticated requests: cheap, no new infrastructure, and it degrades
 * safely. A tenant nobody logs into simply gets swept whenever someone next
 * does; the stamp is computed from the row's own date, so a late sweep writes
 * exactly the same value an on-time one would have. Nothing drifts.
 *
 * The cost is that the close is not visible until someone makes a request. If
 * that becomes a problem, `POST /api/attendance/auto-checkout` runs the same
 * function and can be driven by an external scheduler (a systemd timer or cron
 * on the EC2 host) without changing any of this.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CHECK-OUT LOCKS NOTHING
 *
 * §5.3 is explicit: after check-out, meetings, orders and expenses can still be
 * added. Check-in/out is attendance and working hours, nothing else. This
 * function sets a timestamp. It must never gate, block or reject anything, and
 * nothing should start reading `check_out_time` as permission to refuse work.
 */

/**
 * WHICH INSTANT GETS STAMPED — the one genuinely ambiguous decision here.
 *
 * `auto_checkout_minutes` is a clock time, so "midnight" (0) and "9:30 PM"
 * (1290) sit on opposite sides of the working day:
 *
 *   - 21:30 on the row's own date is AFTER a normal check-in. Correct.
 *   - 00:00 on the row's own date is BEFORE it — stamping that would record a
 *     check-out that happened hours before the check-in, which is nonsense and
 *     would produce negative working hours anywhere that subtracts the two.
 *
 * Midnight means the midnight that ENDS the day, not the one that starts it.
 * The rule that covers both: take the first occurrence of that clock time at or
 * after the check-in. So 00:00 lands on the following calendar day and 21:30
 * lands on the same evening, with no special-casing of zero.
 *
 * A check-in later than the clock time (checked in at 23:00 with a 21:30
 * setting) rolls to the next day for the same reason — the stamp is never
 * before the check-in.
 *
 * TIMEZONE: built in UTC from the row's `@db.Date`. Production runs UTC, so
 * the tenant's midnight IS UTC midnight there. There is no per-tenant timezone
 * column, and inventing one from the server's local zone would make the value
 * depend on where the process happens to run — the dev machine is IST and would
 * write a different instant from production for identical data. If tenants in
 * different timezones ever matter, that needs a column on `tenants`, and this
 * is the function that would read it.
 */
function checkoutInstant(dateOnly: string, minutes: number, checkInTime: Date): Date {
  const midnightUtc = Date.parse(`${dateOnly}T00:00:00.000Z`)
  const sameDay = new Date(midnightUtc + minutes * 60_000)
  if (sameDay.getTime() >= checkInTime.getTime()) return sameDay
  return new Date(midnightUtc + 24 * 60 * 60_000 + minutes * 60_000)
}

/**
 * Tenants already swept today, so the work is not repeated on every request.
 *
 * In-memory and per-process, which is the right trade here rather than a
 * shortcoming: the guard is an optimisation, not the correctness mechanism.
 * The UPDATE itself is what makes this safe — it matches only rows that are
 * still open, so a second sweep finds nothing and changes nothing. A restart,
 * or a second app instance, costs one extra no-op query.
 *
 * Keyed by `tenantId` and holding the UTC date it was last swept, so the entry
 * naturally expires at the day boundary instead of growing without bound.
 */
const lastSweptOn = new Map<string, string>()

export type SweepResult = {
  /** Rows closed by this call. 0 is the normal, healthy answer. */
  closed: number
  /** True when the per-process guard skipped the query entirely. */
  skipped: boolean
}

/**
 * Close every attendance row for this tenant that was left open on a previous
 * day. Safe to call on any authenticated request.
 *
 * Idempotent: the `check_out_time: null` predicate means a second run matches
 * nothing. Today's open rows are deliberately untouched — the day is not over.
 *
 * @param force skip the once-per-day guard (used by the route and by tests).
 */
export async function sweepAutoCheckout(
  tenantId: string,
  { force = false }: { force?: boolean } = {}
): Promise<SweepResult> {
  const today = dateOnlyString(new Date())
  if (!force && lastSweptOn.get(tenantId) === today) {
    return { closed: 0, skipped: true }
  }

  // Marked before the work, not after. If the query throws, the next request
  // retries rather than every request retrying a failing query all day.
  lastSweptOn.set(tenantId, today)

  const open = await prisma.attendance.findMany({
    where: {
      tenant_id: tenantId,
      // `date` is @db.Date; comparing against UTC midnight of today keeps
      // today's rows out, which is the intent — their day has not ended.
      date: { lt: new Date(`${today}T00:00:00.000Z`) },
      check_in_time: { not: null },
      check_out_time: null,
    },
    select: { id: true, date: true, check_in_time: true },
  })

  if (open.length === 0) return { closed: 0, skipped: false }

  // Read the setting only once there is something to close — the common case
  // is zero rows, and this keeps the hot path to a single indexed query.
  const { auto_checkout_minutes } = await getTenantSettings(tenantId)

  let closed = 0
  for (const row of open) {
    if (!row.check_in_time) continue // narrowed for TypeScript; the where excludes it
    const stamp = checkoutInstant(dateOnlyString(row.date), auto_checkout_minutes, row.check_in_time)

    // updateMany with the null predicate repeated, so two processes sweeping
    // at once cannot both write: the second matches zero rows.
    const result = await prisma.attendance.updateMany({
      where: { id: row.id, tenant_id: tenantId, check_out_time: null },
      data: { check_out_time: stamp, updated_at: new Date() },
    })
    closed += result.count
  }

  return { closed, skipped: false }
}

/** Exported for the verification script; not part of the runtime surface. */
export const __testables = { checkoutInstant }
