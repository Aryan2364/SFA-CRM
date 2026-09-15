import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json({ error: 'User not in DB' }, { status: 400 })

  const { week_start_date, week_end_date, items, day_notes, week_goal } = await req.json()
  if (!week_start_date) return NextResponse.json({ error: 'week_start_date required' }, { status: 400 })

  const tid = getTenantId()

  try {
    // Look up manager
    const dbUser = await prisma.users.findUnique({
      where: { id: user.userId },
      select: { manager_user_id: true },
    })

    const plan = await prisma.weekly_plans.create({
      data: {
        tenant_id: tid, user_id: user.userId,
        // @db.Date columns: Prisma wants Date objects, not the ISO strings the
        // client sends.
        week_start_date: new Date(week_start_date),
        week_end_date: new Date(week_end_date),
        status: 'Draft',
        current_manager_id: dbUser?.manager_user_id ?? null,
        last_status_changed_at: new Date(),
        day_notes: day_notes ?? {},
        week_goal: week_goal ?? null,
      },
    })

    if (items?.length) {
      await prisma.weekly_plan_items.createMany({
        data: items.map((item: Record<string, unknown>) => ({
          ...item,
          plan_date: new Date(item.plan_date as string),
          weekly_plan_id: plan.id,
          tenant_id: tid,
        })),
      })
    }

    await prisma.weekly_plan_audit_logs.create({
      data: {
        tenant_id: tid, weekly_plan_id: plan.id,
        actor_user_id: user.userId, actor_role: 'User',
        action_type: 'Create', new_status: 'Draft',
      },
    })

    return NextResponse.json(serialize(plan, 'weekly_plans'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
