/**
 * Tick / untick one checklist row.
 *
 * ⚠️ **Deliberately NOT gated on the plan's status.** Every other write on a
 * weekly plan is blocked outside Draft / Rejected / Edited by Manager, because
 * the plan's CONTENT is frozen once a manager has it. A tick is not content —
 * §5.1: "Points can be ticked on the Weekly Plan screen during the week, and
 * also on the Weekly Review page", and during the week the plan is Approved.
 * Gating this on `canEdit` would make the checklist untickable exactly when it
 * is meant to be used.
 *
 * It writes `is_done` and nothing else, so it cannot be used to smuggle a text
 * edit past the status gate — that is what `PUT ../goals` is for, and that one
 * IS gated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { canView } from '@/lib/visibility'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; goalId: string } },
) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  const tid = getTenantId()

  try {
    const plan = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { user_id: true },
    })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (!user.userId) return NextResponse.json({ error: 'User not in DB' }, { status: 400 })
    if (plan.user_id !== user.userId && !(await canView(user.userId, plan.user_id, tid))) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    if (typeof body.is_done !== 'boolean') {
      return NextResponse.json({ error: 'is_done must be true or false' }, { status: 400 })
    }

    // updateMany scoped to plan AND tenant: the goal id comes from the client,
    // so a row belonging to another plan must match nothing rather than be
    // flipped. A zero-row result is a 404, not a silent success.
    const { count } = await prisma.weekly_goals.updateMany({
      where: { id: params.goalId, weekly_plan_id: params.id, tenant_id: tid },
      data: { is_done: body.is_done, updated_at: new Date() },
    })
    if (count === 0) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

    const row = await prisma.weekly_goals.findFirst({
      where: { id: params.goalId, weekly_plan_id: params.id, tenant_id: tid },
    })
    return NextResponse.json(row ? serialize(row, 'weekly_goals') : null)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
