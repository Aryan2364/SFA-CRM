import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'users', 'edit')) return forbidden()

  const tid = getTenantId()

  // Four `count: 'exact', head: true` totals.
  //
  // The last one used to be `notIn: ['Delivered','Cancelled','Rejected']` —
  // the codebase's only .not(...,'in',...). None of those three words was
  // ever written to `orders.status`, so it excluded nothing and "open
  // orders" reported EVERY order the user had ever raised. REBUILD-PLAN
  // §4.10 leaves two states, and the one that is genuinely still open — not
  // yet placed, and so blocking a deactivation — is Draft.
  const [directReports, activeMeetings, pendingPlans, openOrders] = await Promise.all([
    prisma.users.count({ where: { tenant_id: tid, manager_user_id: params.id, status: 'Active' } }),
    prisma.daily_visits.count({ where: { tenant_id: tid, user_id: params.id, status: 'In Progress' } }),
    prisma.weekly_plans.count({ where: { tenant_id: tid, user_id: params.id, status: 'Submitted' } }),
    prisma.orders.count({
      where: { tenant_id: tid, user_id: params.id, status: 'Draft' },
    }),
  ])

  // All four are plain integers — no serialize() needed.
  return NextResponse.json({
    direct_reports: directReports,
    active_meetings: activeMeetings,
    pending_plans: pendingPlans,
    open_orders: openOrders,
  })
}
