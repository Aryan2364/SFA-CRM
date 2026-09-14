import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { canView } from '@/lib/visibility'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const { comment } = await req.json()
  if (!comment?.trim()) return NextResponse.json({ error: 'Comment is required for rejection' }, { status: 400 })
  const tid = getTenantId()

  try {
    const now = new Date()

    const plan = await prisma.weekly_plans.findUnique({
      where: { id: params.id },
      select: { status: true, user_id: true },
    })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const authorized = await canView(user.userId!, plan.user_id, null, tid)
    if (!authorized) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

    // updateMany, not update: no .select().single() in the original (PLAN.md 8.4).
    await prisma.weekly_plans.updateMany({
      where: { id: params.id },
      data: { status: 'Rejected', manager_comment: comment, last_status_changed_at: now },
    })

    await prisma.weekly_plan_audit_logs.create({
      data: {
        tenant_id: tid, weekly_plan_id: params.id,
        actor_user_id: user.userId, actor_role: 'Manager',
        action_type: 'Reject',
        previous_status: plan.status, new_status: 'Rejected',
        comment: comment,
      },
    })

    // Notify plan owner
    await prisma.notifications.create({
      data: {
        tenant_id: tid,
        recipient_id: plan.user_id,
        actor_id: user.userId,
        section: 'weekly_plan',
        context_type: 'weekly_plan',
        context_id: params.id,
        redirect_path: '/weekly-plan',
        message: `Your weekly plan has been Rejected. Comment: ${comment}`,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
