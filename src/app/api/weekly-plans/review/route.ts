import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { getVisibleUserIds } from '@/lib/visibility'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'view')) return forbidden()
  if (!user.userId) return NextResponse.json([])

  const status = req.nextUrl.searchParams.get('status')
  const userId = req.nextUrl.searchParams.get('userId')
  const weekStart = req.nextUrl.searchParams.get('weekStart')

  const tenantId = getTenantId()

  const subIds = await getVisibleUserIds(user.userId, tenantId)
  if (subIds.length === 0) return NextResponse.json([])

  // If a specific userId is requested, verify they are a subordinate
  const filterIds = userId ? (subIds.includes(userId) ? [userId] : []) : subIds
  if (filterIds.length === 0) return NextResponse.json([])

  try {
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
    const result = rows.map(({ users_weekly_plans_user_idTousers, ...rest }) => ({
      ...rest,
      users: users_weekly_plans_user_idTousers ?? null,
    }))

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
