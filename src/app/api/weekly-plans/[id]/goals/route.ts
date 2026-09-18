/**
 * The §5.1 Weekly Goal Checklist, addressable on its own.
 *
 * The checklist also rides along on `GET /api/weekly-plans/my` and on
 * `PUT /api/weekly-plans/[id]`, which is how the plan screen loads and saves it
 * in one round trip. This route exists for the OTHER consumer §5.1 names: the
 * Weekly Review (Phase 4) shows the same checklist and must be able to read and
 * tick it without knowing anything about plan items or the state machine.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { canView } from '@/lib/visibility'
import { loadGoals, migrateWeekGoal, saveGoals } from '../../_goals'

/**
 * Resolve the plan and decide whether the caller may see it: their own plan, or
 * a plan belonging to someone they can view (the same `canView` the approve /
 * reject routes use, so a manager sees exactly what they see everywhere else).
 */
async function authorise(planId: string, tenantId: string, userId: string | null) {
  const plan = await prisma.weekly_plans.findFirst({
    where: { id: planId, tenant_id: tenantId },
    select: { id: true, user_id: true, status: true, week_goal: true },
  })
  if (!plan) return { error: NextResponse.json({ error: 'Plan not found' }, { status: 404 }) }
  if (!userId) return { error: NextResponse.json({ error: 'User not in DB' }, { status: 400 }) }
  if (plan.user_id !== userId && !(await canView(userId, plan.user_id, tenantId))) {
    return { error: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) }
  }
  return { plan }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  const tid = getTenantId()

  try {
    const { plan, error } = await authorise(params.id, tid, user.userId ?? null)
    if (error) return error

    await migrateWeekGoal(plan.id, tid, plan.week_goal)
    return NextResponse.json(await loadGoals(plan.id, tid))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * Replace the checklist's text and order.
 *
 * ⚠️ This is the EDIT verb, so it is gated on the same statuses that gate every
 * other input on the plan screen. Ticking is not edited here — it has its own
 * route precisely because a tick must work on an APPROVED plan, which is the
 * state a plan is in for the whole week the user is working through it.
 */
const EDITABLE = ['Draft', 'Rejected', 'Edited by Manager']

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const tid = getTenantId()

  try {
    const { plan, error } = await authorise(params.id, tid, user.userId ?? null)
    if (error) return error

    if (!EDITABLE.includes(plan.status)) {
      return NextResponse.json(
        { error: 'Plan is not editable in its current status' },
        { status: 400 },
      )
    }

    const { goals } = await req.json()
    await saveGoals(plan.id, tid, goals)
    return NextResponse.json(await loadGoals(plan.id, tid))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
