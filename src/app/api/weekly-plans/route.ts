import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { toItemRows } from './_items'
import { saveGoals } from './_goals'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'create')) return forbidden()
  if (!user.userId) return NextResponse.json({ error: 'User not in DB' }, { status: 400 })

  const { week_start_date, week_end_date, items, day_notes, goals } = await req.json()
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
        // `week_goal` is retired — §5.1's checklist lives in `weekly_goals`. A
        // new plan never writes the column, so nothing new needs migrating.
        week_goal: null,
      },
    })

    // toItemRows whitelists the columns. The old `{ ...item }` spread put
    // whatever the client sent into createMany, where an unknown key is a Prisma
    // throw rather than an ignored field.
    const rows = toItemRows(items, tid, plan.id)
    if (rows.length) await prisma.weekly_plan_items.createMany({ data: rows })

    await saveGoals(plan.id, tid, goals)

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
