import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { loadGoals, migrateWeekGoal } from '../_goals'
import { readPlanVersion } from '../_transition'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'view')) return forbidden()
  if (!user.userId) return NextResponse.json({ error: 'User not in DB' }, { status: 400 })

  const weekStart = req.nextUrl.searchParams.get('weekStart')
  if (!weekStart) return NextResponse.json({ error: 'weekStart required' }, { status: 400 })

  const tid = getTenantId()

  try {
    // The original tolerated PGRST116 (no rows) and returned null; every other
    // error became a 500. findUnique on the real @@unique([tenant_id, user_id,
    // week_start_date]) returns null for the no-row case and throws only on
    // genuine failures, so both branches are preserved.
    const key = {
      tenant_id_user_id_week_start_date: {
        tenant_id: tid,
        user_id: user.userId,
        week_start_date: new Date(weekStart),
      },
    }
    const head = await prisma.weekly_plans.findUnique({ where: key, select: { id: true, week_goal: true } })
    if (!head) return NextResponse.json(null)

    // §5.1 replaced the free-text `week_goal` with a checklist. A plan written
    // before that release still carries the sentence, so it is folded into the
    // checklist on first read rather than disappearing when the control changed.
    // The migration clears `week_goal`, so this is a one-shot per plan.
    //
    // FIRST, before the version: clearing `week_goal` writes the plan row,
    // which moves its version (see `PLAN_VERSION`). Read the other way round,
    // the screen was handed a version already stale, and the owner's first
    // Save on an older plan 409'd and threw their edits away.
    await migrateWeekGoal(head.id, tid, head.week_goal)

    // Then the version, then the plan — never the plan first: see `readPlanVersion`.
    const version = await readPlanVersion(head.id, tid)
    const data = await prisma.weekly_plans.findUnique({ where: key, include: { weekly_plan_items: true } })
    if (!data) return NextResponse.json(null)

    return NextResponse.json({
      ...(serialize(data, 'weekly_plans') as Record<string, unknown>),
      // `weekly_goals` has no Prisma relation to `weekly_plans`, so it cannot
      // ride along in the `include` — it is a separate tenant-scoped read.
      weekly_goals: await loadGoals(data.id, tid),
      // What the owner's Save and Submit send back as `expected_version`, so a
      // save from this screen cannot overwrite a manager edit it never showed.
      version,
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
