import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json({ error: 'User not in DB' }, { status: 400 })

  const weekStart = req.nextUrl.searchParams.get('weekStart')
  if (!weekStart) return NextResponse.json({ error: 'weekStart required' }, { status: 400 })

  try {
    // The original tolerated PGRST116 (no rows) and returned null; every other
    // error became a 500. findUnique on the real @@unique([tenant_id, user_id,
    // week_start_date]) returns null for the no-row case and throws only on
    // genuine failures, so both branches are preserved.
    const data = await prisma.weekly_plans.findUnique({
      where: {
        tenant_id_user_id_week_start_date: {
          tenant_id: getTenantId(),
          user_id: user.userId,
          week_start_date: new Date(weekStart),
        },
      },
      include: { weekly_plan_items: true },
    })

    return NextResponse.json(data ? serialize(data, 'weekly_plans') : null)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
