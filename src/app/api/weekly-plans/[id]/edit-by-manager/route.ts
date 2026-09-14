import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const { items, comment } = await req.json()
  const tid = getTenantId()

  try {
    const now = new Date()

    const plan = await prisma.weekly_plans.findUnique({
      where: { id: params.id },
      select: { status: true },
    })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    // Replace items. deleteMany is required anyway (the original .delete() never
    // errored on zero matches), and plan_date is @db.Date so the incoming
    // "YYYY-MM-DD" strings must become Date objects.
    await prisma.weekly_plan_items.deleteMany({ where: { weekly_plan_id: params.id } })
    if (items?.length) {
      await prisma.weekly_plan_items.createMany({
        data: items.map((item: Record<string, unknown>) => ({
          ...item,
          plan_date: new Date(item.plan_date as string),
          weekly_plan_id: params.id,
          tenant_id: tid,
        })),
      })
    }

    await prisma.weekly_plans.updateMany({
      where: { id: params.id },
      data: { status: 'Edited by Manager', manager_comment: comment || null, last_status_changed_at: now },
    })

    await prisma.weekly_plan_audit_logs.create({
      data: {
        tenant_id: tid, weekly_plan_id: params.id,
        actor_user_id: user.userId, actor_role: 'Manager',
        action_type: 'EditByManager',
        previous_status: plan.status, new_status: 'Edited by Manager',
        comment: comment || null,
        edited_fields: { items: 'manager edited' },
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
