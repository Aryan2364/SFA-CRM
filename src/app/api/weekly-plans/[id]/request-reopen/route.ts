import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const body = await req.json().catch(() => ({}))
  const message: string = body.message?.trim() ?? ''

  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  const tid = getTenantId()

  try {
    const plan = await prisma.weekly_plans.findUnique({
      where: { id: params.id },
      select: { status: true, user_id: true, reopen_requested: true },
    })

    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (plan.user_id !== user.userId) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    if (plan.reopen_requested) return NextResponse.json({ error: 'Reopen already requested' }, { status: 400 })

    const editableStatuses = ['Draft', 'Rejected', 'Edited by Manager']
    if (editableStatuses.includes(plan.status)) {
      return NextResponse.json({ error: 'Plan is already editable' }, { status: 400 })
    }

    const now = new Date()
    await prisma.weekly_plans.updateMany({
      where: { id: params.id },
      data: { reopen_requested: true, reopen_request_message: message, last_status_changed_at: now },
    })

    // RequestReopen does not change status: previous_status === new_status.
    await prisma.weekly_plan_audit_logs.create({
      data: {
        tenant_id: tid, weekly_plan_id: params.id,
        actor_user_id: user.userId, actor_role: 'User',
        action_type: 'RequestReopen',
        previous_status: plan.status, new_status: plan.status,
        comment: message,
      },
    })

    // Notify manager
    const me = await prisma.users.findUnique({
      where: { id: user.userId },
      select: { manager_user_id: true },
    })
    if (me?.manager_user_id) {
      try {
        await prisma.notifications.create({
          data: {
            tenant_id: tid,
            recipient_id: me.manager_user_id,
            actor_id: user.userId,
            section: 'weekly_plan',
            context_type: 'weekly_plan',
            context_id: params.id,
            redirect_path: `/review/${user.userId}?tab=plans`,
            message: `${user.name} requested to reopen their weekly plan: "${message}"`,
          },
        })
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
