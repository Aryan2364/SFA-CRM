import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { StaleStatus, notifyAfterCommit, canReview, claimStatus, isPlanId, planNotFound } from '../../_transition'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  const tid = getTenantId()
  if (!isPlanId(params.id)) return planNotFound()

  try {
    // tenant_id, not the id alone: the id is a global key.
    const plan = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { status: true, user_id: true, reopen_requested: true },
    })

    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (!plan.reopen_requested) return NextResponse.json({ error: 'No reopen request pending' }, { status: 400 })

    // The approval queue's rule — see `canReview`.
    const authorized = await canReview(user, plan.user_id, tid)
    if (!authorized) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

    const now = new Date()
    // Conditional on the status AND the pending flag: of an accept and a
    // decline (or a decision) racing, exactly one lands.
    try {
      await prisma.$transaction(async tx => {
        await claimStatus(
          tx,
          { id: params.id, tenant_id: tid, status: plan.status, reopen_requested: true },
          { status: 'Draft', reopen_requested: false, reopen_request_message: null, last_status_changed_at: now },
        )

        await tx.weekly_plan_audit_logs.create({
          data: {
            tenant_id: tid, weekly_plan_id: params.id,
            actor_user_id: user.userId, actor_role: 'Manager',
            action_type: 'AcceptReopen',
            previous_status: plan.status, new_status: 'Draft',
            comment: 'Reopen request accepted by manager',
          },
        })
      })
    } catch (err) {
      if (err instanceof StaleStatus) {
        return NextResponse.json({ error: 'This reopen request has already been answered' }, { status: 409 })
      }
      throw err
    }

    // After commit, best-effort: see `notifyAfterCommit`.
    await notifyAfterCommit({
      tenant_id: tid,
      recipient_id: plan.user_id,
      actor_id: user.userId,
      section: 'weekly_plan',
      context_type: 'weekly_plan',
      context_id: params.id,
      redirect_path: '/weekly-plan',
      message: 'Your reopen request was accepted. You can now edit your weekly plan.',
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
