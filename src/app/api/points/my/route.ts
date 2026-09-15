import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json({ total: 0, events: [] })

  const tid = getTenantId()
  const period = req.nextUrl.searchParams.get('period') ?? 'month'

  // Determine date range
  let fromDate: Date | null = null
  const now = new Date()
  if (period === 'month') {
    fromDate = new Date(now.getFullYear(), now.getMonth(), 1)
  } else if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    fromDate = new Date(now.getFullYear(), q * 3, 1)
  }
  // period === 'all' -> no date filter

  try {
    const events = await prisma.point_events.findMany({
      where: {
        tenant_id: tid,
        user_id: user.userId,
        ...(fromDate ? { earned_at: { gte: fromDate } } : {}),
      },
      orderBy: { earned_at: 'desc' },
      take: 500,
    })

    const total = events.reduce((sum, e) => sum + e.points, 0)

    // Breakdown by action type
    const breakdown: Record<string, { count: number; points: number; label: string }> = {}
    for (const e of events) {
      if (!breakdown[e.action_type]) breakdown[e.action_type] = { count: 0, points: 0, label: e.action_type }
      breakdown[e.action_type].count++
      breakdown[e.action_type].points += e.points
    }

    // Fetch labels from config
    const configs = await prisma.point_config.findMany({
      where: { tenant_id: tid },
      select: { action_type: true, label: true },
    })
    for (const c of configs) {
      if (breakdown[c.action_type]) breakdown[c.action_type].label = c.label
    }

    // `events` carries earned_at (timestamptz) and must be serialised; total and
    // breakdown are plain numbers and strings.
    return NextResponse.json({ total, events: serialize(events, 'point_events'), breakdown })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
