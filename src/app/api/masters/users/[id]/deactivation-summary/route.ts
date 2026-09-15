import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'users', 'edit')) return forbidden()

  const tid = getTenantId()

  // Four `count: 'exact', head: true` totals. The last one is the codebase's
  // only .not(...,'in',...) — it becomes notIn (PLAN.md 8.4).
  const [directReports, activeMeetings, pendingPlans, openOrders] = await Promise.all([
    prisma.users.count({ where: { tenant_id: tid, manager_user_id: params.id, status: 'Active' } }),
    prisma.daily_visits.count({ where: { tenant_id: tid, user_id: params.id, status: 'In Progress' } }),
    prisma.weekly_plans.count({ where: { tenant_id: tid, user_id: params.id, status: 'Submitted' } }),
    prisma.orders.count({
      where: { tenant_id: tid, user_id: params.id, status: { notIn: ['Delivered', 'Cancelled', 'Rejected'] } },
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
