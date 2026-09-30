import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { StaleStatus, notifyAfterCommit, claimStatus, isPlanId, planNotFound } from '../../_transition'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  const body = await req.json().catch(() => ({}))
  const message: string = body.message?.trim() ?? ''

  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  const tid = getTenantId()
  if (!isPlanId(params.id)) return planNotFound()

  try {
    // tenant_id, not the id alone: the id is a global key.
    const plan = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { status: true, user_id: true, reopen_requested: true },
    })

    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (plan.user_id !== user.userId) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    if (plan.reopen_requested) return NextResponse.json({ error: 'Reopen already requested' }, { status: 400 })

    const editableStatuses = ['Draft', 'Rejected', 'Edited by Manager']
    if (editableStatuses.includes(plan.status)) {
      return NextResponse.json({ error: 'Plan is already editable' }, { status: 400 })
    }

    const me = await prisma.users.findFirst({
      where: { id: user.userId, tenant_id: tid },
      select: { manager_user_id: true },
    })

    const now = new Date()
    // Flag and audit row commit together; the manager's notification follows
    // the commit. The claim also requires the flag to still be clear, so a
    // double-click sends one request, not two. It moves the plan's version
    // (see `claimStatus`) on purpose: a manager panel opened before the
    // request should reload and show it, not decide past it.
    try {
      await prisma.$transaction(async tx => {
        await claimStatus(
          tx,
          { id: params.id, tenant_id: tid, status: plan.status, reopen_requested: false },
          { reopen_requested: true, reopen_request_message: message, last_status_changed_at: now },
        )

        // RequestReopen does not change status: previous_status === new_status.
        await tx.weekly_plan_audit_logs.create({
          data: {
            tenant_id: tid, weekly_plan_id: params.id,
            actor_user_id: user.userId, actor_role: 'User',
            action_type: 'RequestReopen',
            previous_status: plan.status, new_status: plan.status,
            comment: message,
          },
        })
      })
    } catch (err) {
      if (err instanceof StaleStatus) {
        return NextResponse.json(
          { error: 'This plan changed a moment ago — reload to see its current state' },
          { status: 409 },
        )
      }
      throw err
    }

    // Notify manager — after commit, best-effort: see `notifyAfterCommit`.
    if (me?.manager_user_id) {
      await notifyAfterCommit({
        tenant_id: tid,
        recipient_id: me.manager_user_id,
        actor_id: user.userId,
        section: 'weekly_plan',
        context_type: 'weekly_plan',
        context_id: params.id,
        redirect_path: `/review/${user.userId}?tab=plans`,
        message: `${user.name} requested to reopen their weekly plan: "${message}"`,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
