import { prisma } from './db'

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
 * The `supabase` parameter is retained only so existing call sites keep
 * compiling while the route batches are converted one at a time (PLAN.md §2.7).
 * It is unused and is removed, along with every caller's argument, in Batch 9.
 */
type LegacyClientArg = unknown

export async function awardPoint(
  _supabase: LegacyClientArg,
  tenantId: string,
  userId: string,
  actionType: string,
  opts?: { refType?: string; refId?: string; description?: string }
) {
  // point_config has a unique constraint on (tenant_id, action_type), so
  // findUnique is exactly equivalent to the previous .single(): at most one row.
  // A missing row previously surfaced as a PGRST116 error with `config` left
  // null, which fell through to `return 0` — findUnique returns null and takes
  // the same branch (PLAN.md §5.3).
  const config = await prisma.point_config.findUnique({
    where: { tenant_id_action_type: { tenant_id: tenantId, action_type: actionType } },
    select: { points: true, cap_per_day: true, is_active: true },
  })

  if (!config || !config.is_active || config.points <= 0) return 0

  if (config.cap_per_day !== null) {
    const today = new Date().toISOString().split('T')[0]
    const count = await prisma.point_events.count({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        action_type: actionType,
        earned_at: {
          gte: new Date(`${today}T00:00:00.000Z`),
          lte: new Date(`${today}T23:59:59.999Z`),
        },
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
    },
  })

  return config.points
}
