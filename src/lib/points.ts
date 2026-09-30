import { prisma } from './db'
import { businessDate, businessDayRange } from './business-date'

export const POINT_ACTIONS = [
  'weekly_plan_submitted',
  'weekly_plan_approved',
  'daily_checkin',
  'daily_checkout',
  'meeting_logged',
  'expense_submitted',
  'weekly_streak',
] as const

export type PointActionType = typeof POINT_ACTIONS[number]

/**
 * What an action earns when the tenant has no `point_config` row for it.
 *
 * Nothing seeds `point_config` for a new company, so these are the live values
 * until an admin saves the settings screen — which shows exactly these. Both
 * `awardPoint` and `GET /api/points/config` read this one constant, so what the
 * screen claims is active and what is actually awarded cannot drift apart.
 */
export const POINT_DEFAULTS: Record<PointActionType, { label: string; points: number; cap_per_day: number | null }> = {
  weekly_plan_submitted: { label: 'Weekly Plan Submitted On Time', points: 10, cap_per_day: null },
  weekly_plan_approved:  { label: 'Weekly Plan Approved (No Rejection)', points: 5, cap_per_day: null },
  daily_checkin:         { label: 'Daily Check-In', points: 3, cap_per_day: 1 },
  daily_checkout:        { label: 'Daily Check-Out', points: 3, cap_per_day: 1 },
  meeting_logged:        { label: 'Meeting / Visit Logged', points: 2, cap_per_day: 5 },
  expense_submitted:     { label: 'Expense Submitted', points: 2, cap_per_day: 1 },
  weekly_streak:         { label: 'Full Week Consistency Bonus', points: 15, cap_per_day: null },
}

/** Log, never throw: callers fire `awardPoint` without awaiting it. */
export function logAwardFailure(actionType: string) {
  return (err: unknown) => console.error(`[points] awardPoint(${actionType}) failed:`, err)
}

export async function awardPoint(
  tenantId: string,
  userId: string,
  actionType: string,
  opts?: {
    refType?: string
    refId?: string
    description?: string
    /**
     * The business date the action belongs to, when it is not today — closing
     * yesterday's attendance session after midnight is yesterday's check-out.
     * The daily cap is counted against that day, and the event is dated inside
     * it, so it neither spends nor is blocked by today's allowance.
     */
    forDate?: string
  }
) {
  // point_config has a unique constraint on (tenant_id, action_type), so
  // findUnique returns at most one row. No row means the tenant never saved
  // this action, and the default the settings screen shows applies — it used
  // to fall through to `return 0`, so a new company earned nothing while the
  // screen said otherwise.
  const row = await prisma.point_config.findUnique({
    where: { tenant_id_action_type: { tenant_id: tenantId, action_type: actionType } },
    select: { points: true, cap_per_day: true, is_active: true },
  })
  const fallback = POINT_DEFAULTS[actionType as PointActionType]
  const config = row ?? (fallback ? { ...fallback, is_active: true } : null)

  if (!config || !config.is_active || config.points <= 0) return 0

  const today = businessDate()
  const forDate = opts?.forDate && opts.forDate < today ? opts.forDate : today
  const day = businessDayRange(forDate)

  if (config.cap_per_day !== null) {
    // The cap is per business day, not per UTC day: a rep checking in at
    // 08:00 IST and again at 04:00 IST the next morning is two days.
    const count = await prisma.point_events.count({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        action_type: actionType,
        earned_at: day,
      },
    })

    if (count >= config.cap_per_day) return 0
  }

  await prisma.point_events.create({
    data: {
      tenant_id: tenantId,
      user_id: userId,
      action_type: actionType,
      points: config.points,
      ref_type: opts?.refType ?? null,
      ref_id: opts?.refId ?? null,
      description: opts?.description ?? null,
      // A past day's action is dated in its final millisecond, so the cap
      // count above — and any later count for that day — sees it there and
      // not in today's window. Today's keeps the column default (now).
      ...(forDate !== today ? { earned_at: new Date(day.lt.getTime() - 1) } : {}),
    },
  })

  return config.points
}
