import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { canView } from '@/lib/visibility'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const manager = await requireUser()
  const userId = req.nextUrl.searchParams.get('userId')
  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  const tenantId = getTenantId()

  const allowed = await canView(manager.userId!, userId, null, tenantId)
  if (!allowed) return NextResponse.json({ error: 'Not authorized to view this user' }, { status: 403 })

  try {
    const data = await prisma.daily_visits.findMany({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        // visit_date is @db.Date, so the "YYYY-MM-DD" query parameter becomes a Date.
        visit_date: new Date(date),
      },
      orderBy: { created_at: 'asc' },
    })
    return NextResponse.json(serialize(data, 'daily_visits'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
