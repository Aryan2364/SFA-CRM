import { NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, PermSection } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

/**
 * ⚠️ This route called neither `requireUser()` nor `checkPermission`, and
 * `getTenantId()` falls back to the default tenant, so it answered anyone —
 * signed in or not. No screen calls it today; it is kept for any external
 * client, and now answers only a signed-in user.
 *
 * There is no `dashboard` permission section, so each total is gated on the
 * section it counts: `view` on that section, or the total is `null` ("not
 * yours to know", never a misleading 0). The two operation sections also
 * apply their data scope, so a Self-scoped user counts their own plans, not
 * the tenant's.
 */
export async function GET() {
  const user = await requireUser()
  const tid = getTenantId()
  const may = (section: PermSection) => checkPermission(user, section, 'view')

  try {
    const [canStates, canDistricts, canUsers, canProducts, canPlans] = await Promise.all([
      may('states'), may('districts'), may('users'), may('products'), may('weekly_plan'),
    ])
    // Five `count: 'exact', head: true` totals. The original looped over a table
    // name array; Prisma's client is typed per model, so they are written out.
    const [states, districts, users, products, weeklyPlans] = await Promise.all([
      canStates ? prisma.states.count({ where: { tenant_id: tid } }) : null,
      canDistricts ? prisma.districts.count({ where: { tenant_id: tid } }) : null,
      canUsers
        ? prisma.users.count({ where: { tenant_id: tid, ...scopeWhere(await scopedUserIds(user, 'users'), 'id') } })
        : null,
      canProducts ? prisma.products.count({ where: { tenant_id: tid } }) : null,
      canPlans
        ? prisma.weekly_plans.count({ where: { tenant_id: tid, ...scopeWhere(await scopedUserIds(user, 'weekly_plan')) } })
        : null,
    ])

    // Integers or null — no serialisation needed.
    return NextResponse.json({
      states,
      districts,
      users,
      products,
      weeklyPlans,
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
