import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const { items, day_notes, week_goal } = await req.json()
  const tid = getTenantId()

  try {
    // Update plan-level fields
    const planUpdate: Record<string, unknown> = {}
    if (day_notes !== undefined) planUpdate.day_notes = day_notes
    if (week_goal !== undefined) planUpdate.week_goal = week_goal
    if (Object.keys(planUpdate).length > 0) {
      await prisma.weekly_plans.updateMany({ where: { id: params.id }, data: planUpdate })
    }

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

    // Update carries no status change, so previous_status/new_status stay null.
    await prisma.weekly_plan_audit_logs.create({
      data: {
        tenant_id: tid, weekly_plan_id: params.id,
        actor_user_id: user.userId, actor_role: 'User',
        action_type: 'Update',
        edited_fields: { items: 'updated' },
      },
    })

    const data = await prisma.weekly_plans.findUnique({
      where: { id: params.id },
      include: { weekly_plan_items: true },
    })
    return NextResponse.json(data ? serialize(data, 'weekly_plans') : null)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
