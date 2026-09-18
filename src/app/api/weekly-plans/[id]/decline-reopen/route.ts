import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { canView } from '@/lib/visibility'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  const tid = getTenantId()

  try {
    const plan = await prisma.weekly_plans.findUnique({
      where: { id: params.id },
      select: { status: true, user_id: true, reopen_requested: true },
    })

    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (!plan.reopen_requested) return NextResponse.json({ error: 'No reopen request pending' }, { status: 400 })

    const authorized = await canView(user.userId!, plan.user_id, tid)
    if (!authorized) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

    const now = new Date()
    await prisma.weekly_plans.updateMany({
      where: { id: params.id },
      data: { reopen_requested: false, reopen_request_message: null, last_status_changed_at: now },
    })

    await prisma.weekly_plan_audit_logs.create({
      data: {
        tenant_id: tid, weekly_plan_id: params.id,
        actor_user_id: user.userId, actor_role: 'Manager',
        action_type: 'DeclineReopen',
        previous_status: plan.status, new_status: plan.status,
        comment: 'Reopen request declined by manager',
      },
    })

    try {
      await prisma.notifications.create({
        data: {
          tenant_id: tid,
          recipient_id: plan.user_id,
          actor_id: user.userId,
          section: 'weekly_plan',
          context_type: 'weekly_plan',
          context_id: params.id,
          redirect_path: '/weekly-plan',
          message: 'Your reopen request was declined by the manager.',
        },
      })
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
