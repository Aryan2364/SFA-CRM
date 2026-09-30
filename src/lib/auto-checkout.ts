import { prisma, dateOnlyString } from './db'
import { getTenantSettings } from './settings'
import { addDays, businessDate, businessDayStart } from './business-date'

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
 * A check-in later than a non-zero clock time (checked in at 19:00 with an
 * 18:00 setting) is closed at the END OF ITS OWN business day, 23:59:59 on its
 * date — never before the check-in, and never carried to the next day's clock
 * time. Carrying it (the old rule) left the row open until 18:00 the next day:
 * all that morning the rep's card showed yesterday's session and offered only
 * Check out, which would have recorded ~14 hours before they could check in.
 *
 * With every rule above, the stamp is at or before the midnight that ends the
 * row's day — so by the time the sweep sees a row (it only reads rows from
 * previous days) its stamp has always passed.
 *
 * TIMEZONE: the clock time is read in the business timezone (`APP_TIMEZONE`,
 * default Asia/Kolkata — see ./business-date.ts), the same calendar the rep's
 * screen and check-in use. It used to be UTC, which put "midnight" at 05:30
 * IST and a 21:30 setting at 03:00 IST the next morning. The zone comes from
 * configuration, never from the server's local zone, so the dev machine and
 * production write the same instant for identical data. If tenants in
 * different timezones ever matter, that needs a column on `tenants`, and this
 * is the function that would read it.
 */
function checkoutInstant(dateOnly: string, minutes: number, checkInTime: Date): Date {
  const checkIn = checkInTime.getTime()
  const sameDay = businessDayStart(dateOnly).getTime() + minutes * 60_000
  const nextDayStart = businessDayStart(addDays(dateOnly, 1)).getTime()
  const computed =
    sameDay >= checkIn ? sameDay
    // 0 = the midnight that ends the day, exactly as before.
    : minutes === 0 ? nextDayStart
    // Checked in after the cutoff: 23:59:59 on the row's own business date.
    : nextDayStart - 1000
  /*
    Never before the check-in, on any branch. A check-in in the final second
    of the day needs this, and so does a row whose stored date is a day behind
    its check-in: rows written under the old UTC rule dated a 00:00-05:30 IST
    check-in to the previous day, so "the midnight ending that day" can fall
    before the check-in. Clamped, such a row closes at its check-in (zero
    hours) instead of recording negative hours.
  */
  return new Date(Math.max(computed, checkIn))
}

/**
 * Tenants already swept today, so the work is not repeated on every request.
 * `dueAt` is set when the sweep left a row open because its check-out time had
 * not arrived yet (see below): the guard then lets the next request after that
 * instant through, rather than leaving the row open until tomorrow's sweep.
 * A sweep that throws sets it too, a minute ahead, so a transient failure is
 * retried soon rather than tomorrow.
 *
 * In-memory and per-process, which is the right trade here rather than a
 * shortcoming: the guard is an optimisation, not the correctness mechanism.
 * The UPDATE itself is what makes this safe — it matches only rows that are
 * still open, so a second sweep finds nothing and changes nothing. A restart,
 * or a second app instance, costs one extra no-op query.
 *
 * Keyed by `tenantId` and holding the business date it was last swept, so the entry
 * naturally expires at the day boundary instead of growing without bound.
 */
const lastSweptOn = new Map<string, { day: string; dueAt: number | null }>()

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
  const now = Date.now()
  const today = businessDate(new Date(now))
  const last = lastSweptOn.get(tenantId)
  if (!force && last?.day === today && (last.dueAt === null || now < last.dueAt)) {
    return { closed: 0, skipped: true }
  }

  // Marked before the work, not after, so requests arriving while the sweep
  // runs skip it. A sweep that throws is retried by the first request after
  // RETRY_AFTER_FAILURE_MS (see the catch below), not by every request.
  lastSweptOn.set(tenantId, { day: today, dueAt: null })

  try {
    return await sweepOpenRows(tenantId, today, now)
  } catch (err) {
    lastSweptOn.set(tenantId, { day: today, dueAt: now + RETRY_AFTER_FAILURE_MS })
    throw err
  }
}

/**
 * How long a failed sweep waits before the next request tries again. Long
 * enough that a database outage is not hit with a retry on every request, short
 * enough that a transient failure does not leave rows open until tomorrow.
 */
const RETRY_AFTER_FAILURE_MS = 60_000

async function sweepOpenRows(tenantId: string, today: string, now: number): Promise<SweepResult> {
  const open = await prisma.attendance.findMany({
    where: {
      tenant_id: tenantId,
      // `date` is @db.Date and holds the business date, so comparing against
      // today's business date (as a @db.Date value) keeps today's rows out —
      // their day has not ended.
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
  let dueAt: number | null = null
  for (const row of open) {
    if (!row.check_in_time) continue // narrowed for TypeScript; the where excludes it
    const stamp = checkoutInstant(dateOnlyString(row.date), auto_checkout_minutes, row.check_in_time)

    /*
      Never a check-out in the future. `checkoutInstant` now always lands at
      or before the midnight ending the row's day, and only previous days'
      rows reach here, so this should not fire. It stays as the backstop the
      rule is worth: a clock skew between app servers, or a check-in time
      written in the future, must not produce a check-out ahead of the clock.

      Such a row is LEFT OPEN rather than stamped "now": until its time comes
      the tenant's own setting says the session is still running, so the rep
      can still check out by hand (the attendance read offers it), and when
      the time does come a later sweep writes exactly the configured stamp —
      the same value an on-time sweep would have, so nothing drifts.
    */
    if (stamp.getTime() > now) {
      dueAt = dueAt === null ? stamp.getTime() : Math.min(dueAt, stamp.getTime())
      continue
    }

    // updateMany with the null predicate repeated, so two processes sweeping
    // at once cannot both write: the second matches zero rows.
    const result = await prisma.attendance.updateMany({
      where: { id: row.id, tenant_id: tenantId, check_out_time: null },
      data: { check_out_time: stamp, updated_at: new Date() },
    })
    closed += result.count
  }

  if (dueAt !== null) lastSweptOn.set(tenantId, { day: today, dueAt })
  return { closed, skipped: false }
}

/** Exported for the verification script; not part of the runtime surface. */
export const __testables = { checkoutInstant }
