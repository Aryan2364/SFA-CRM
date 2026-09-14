import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  const date = req.nextUrl.searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'date is required' }, { status: 400 })

  try {
    const day = new Date(date)

    // Find the weekly plan that contains this date. .single() returned an error
    // (leaving `plan` null) when nothing matched, and the route answered null —
    // findFirst's null takes the same branch.
    const plan = await prisma.weekly_plans.findFirst({
      where: {
        tenant_id: getTenantId(),
        user_id: user.userId ?? undefined,
        week_start_date: { lte: day },
        week_end_date: { gte: day },
      },
      select: { id: true, status: true },
    })

    if (!plan) return NextResponse.json(null)

    const items = await prisma.weekly_plan_items.findMany({
      where: { weekly_plan_id: plan.id, plan_date: day },
      orderBy: { created_at: 'asc' },
    })

    return NextResponse.json({
      plan_status: plan.status,
      items: serialize(items, 'weekly_plan_items'),
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
