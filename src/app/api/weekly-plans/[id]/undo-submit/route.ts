import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { StaleStatus, claimStatus, staleConflict, isPlanId, planNotFound } from '../../_transition'

const UNDO_WINDOW_MS = 15 * 60 * 1000

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  const tid = getTenantId()
  if (!isPlanId(params.id)) return planNotFound()

  try {
    // tenant_id, not the id alone: the id is a global key.
    const plan = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { status: true, submitted_at: true, user_id: true },
    })

    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (plan.user_id !== user.userId) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    if (!['Submitted', 'Resubmitted'].includes(plan.status)) {
      return NextResponse.json({ error: 'Plan is not in a submitted state' }, { status: 400 })
    }
    if (!plan.submitted_at) return NextResponse.json({ error: 'No submission timestamp' }, { status: 400 })

    // submitted_at is already a Date; .getTime() works directly.
    const elapsed = Date.now() - plan.submitted_at.getTime()
    if (elapsed > UNDO_WINDOW_MS) {
      return NextResponse.json({ error: 'Undo window has expired (15 minutes)' }, { status: 400 })
    }

    const now = new Date()
    // Conditional on the status read: a manager who decided in the meantime
    // wins, and the undo is a 409 naming what they decided.
    try {
      await prisma.$transaction(async tx => {
        await claimStatus(
          tx,
          { id: params.id, tenant_id: tid, status: plan.status },
          { status: 'Draft', last_status_changed_at: now },
        )
        await tx.weekly_plan_audit_logs.create({
          data: {
            tenant_id: tid, weekly_plan_id: params.id,
            actor_user_id: user.userId, actor_role: 'User',
            action_type: 'UndoSubmit',
            previous_status: plan.status, new_status: 'Draft',
            comment: 'Submission undone by user within 15-minute window',
          },
        })
      })
    } catch (err) {
      if (err instanceof StaleStatus) return staleConflict(params.id, tid)
      throw err
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
