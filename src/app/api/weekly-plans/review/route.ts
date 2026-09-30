import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { getVisibleUserIds } from '@/lib/visibility'
import { migrateWeekGoal } from '../_goals'
import { canReview, readPlanVersionsByOwner, reviewableUserIds } from '../_transition'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'view')) return forbidden()
  if (!user.userId) return NextResponse.json([])

  const status = req.nextUrl.searchParams.get('status')
  const userId = req.nextUrl.searchParams.get('userId')
  const weekStart = req.nextUrl.searchParams.get('weekStart')

  const tenantId = getTenantId()

  const subIds = await getVisibleUserIds(user.userId, tenantId)

  try {
    // One owner: visible OR reviewable — the plan GET's rule (`canReadPlan`),
    // so an Administrator can open the plans of a rep outside their reporting
    // line, which the approval queue already lists for them. The owner must
    // belong to this tenant: `canReview` takes that as given for a plan it was
    // handed, and here the id comes from the URL.
    let filterIds: string[]
    if (userId && subIds.includes(userId)) {
      filterIds = [userId]
    } else if (userId) {
      // Not a uuid → nobody (as before), rather than a Prisma cast error.
      const inTenant = UUID.test(userId)
        && (await prisma.users.count({ where: { id: userId, tenant_id: tenantId } })) > 0
      filterIds = inTenant && (await canReview(user, userId, tenantId)) ? [userId] : []
    } else {
      filterIds = subIds
    }
    if (filterIds.length === 0) return NextResponse.json([])

    // Server-derived, so `/review/[userId]` disables the manager verbs from the
    // same answers the routes give: `canDecide` is the `weekly_plan` EDIT every
    // verb checks first, `canReview` is who may act (see `_transition.ts`).
    const [canDecide, reviewable] = await Promise.all([
      checkPermission(user, 'weekly_plan', 'edit'),
      reviewableUserIds(user, tenantId),
    ])
    const mayReview = (ownerId: string) =>
      ownerId !== user.userId && (reviewable === null || reviewable.includes(ownerId))

    // The legacy `week_goal` fold `/my` and the plan GET do, for any of these
    // plans that still need it — BEFORE the versions: it writes the plan row,
    // which moves the version (see `PLAN_VERSION`), and a version read first
    // would be stale by the time the manager decided.
    const legacy = await prisma.weekly_plans.findMany({
      where: { tenant_id: tenantId, user_id: { in: filterIds }, week_goal: { not: null } },
      select: { id: true, week_goal: true },
    })
    for (const p of legacy) await migrateWeekGoal(p.id, tenantId, p.week_goal)

    // Before the plans, never after: see `readPlanVersion`.
    const versions = await readPlanVersionsByOwner(filterIds, tenantId)
    const data = await prisma.weekly_plans.findMany({
      where: {
        tenant_id: tenantId,
        user_id: { in: filterIds },
        ...(status ? { status } : {}),
        ...(weekStart ? { week_start_date: new Date(weekStart) } : {}),
      },
      include: {
        users_weekly_plans_user_idTousers: { select: { id: true, name: true, contact: true } },
        weekly_plan_items: true,
      },
      orderBy: { week_start_date: 'desc' },
    })

    // `users!user_id(id, name, contact)` arrived under the key `users`; the
    // introspected relation field has a disambiguated name, so rename it back.
    const rows = serialize(data, 'weekly_plans') as Record<string, unknown>[]
    const result = rows.map(({ users_weekly_plans_user_idTousers, ...rest }, i) => ({
      ...rest,
      users: users_weekly_plans_user_idTousers ?? null,
      canDecide,
      canReview: mayReview(data[i].user_id),
      // What `/review/[userId]` sends back with a decision as
      // `expected_version`. Null only for a plan created between the two
      // reads; the route then claims the version it reads itself.
      version: versions.get(data[i].id) ?? null,
    }))

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
