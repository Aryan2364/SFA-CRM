import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json([])

  const tid = getTenantId()
  const period = req.nextUrl.searchParams.get('period') ?? 'month'
  const canSeeAll = user.role === 'Administrator' || await checkPermission(user, 'leaderboard', 'view')

  // Determine date range
  let fromDate: Date | null = null
  const now = new Date()
  if (period === 'month') {
    fromDate = new Date(now.getFullYear(), now.getMonth(), 1)
  } else if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    fromDate = new Date(now.getFullYear(), q * 3, 1)
  }

  try {
    // Determine visible user IDs
    let userIds: string[] = []
    if (canSeeAll) {
      const allUsers = await prisma.users.findMany({
        where: { tenant_id: tid, status: 'Active' },
        select: { id: true },
      })
      userIds = allUsers.map(u => u.id)
    } else {
      // Only show team (users visible to current user + self)
      const visRows = await prisma.user_visibility.findMany({
        where: { tenant_id: tid, viewer_user_id: user.userId },
        select: { target_user_id: true },
      })
      userIds = [visRows.map(r => r.target_user_id), user.userId].flat()
    }

    if (userIds.length === 0) return NextResponse.json([])

    // Aggregate points per user
    const events = await prisma.point_events.findMany({
      where: {
        tenant_id: tid,
        user_id: { in: userIds },
        ...(fromDate ? { earned_at: { gte: fromDate } } : {}),
      },
      select: { user_id: true, points: true },
    })

    const totals: Record<string, number> = {}
    for (const e of events) {
      totals[e.user_id] = (totals[e.user_id] ?? 0) + e.points
    }

    // Fetch user names
    const users = await prisma.users.findMany({
      where: { tenant_id: tid, id: { in: userIds } },
      select: { id: true, name: true, profile: true, designations: { select: { name: true } } },
    })

    const ranked = users
      .map(u => ({
        user_id: u.id,
        name: u.name,
        designation: u.designations?.name ?? u.profile ?? '',
        points: totals[u.id] ?? 0,
        is_self: u.id === user.userId,
      }))
      .sort((a, b) => b.points - a.points)
      .map((u, i) => ({ ...u, rank: i + 1 }))

    // Strings, numbers and booleans only — nothing to serialise.
    return NextResponse.json(ranked)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
