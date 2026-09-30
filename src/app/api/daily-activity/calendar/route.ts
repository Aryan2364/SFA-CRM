import { NextRequest, NextResponse } from 'next/server'
import { prisma, dateOnlyString, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'
import { businessMonth } from '@/lib/business-date'

export const dynamic = 'force-dynamic'

// Returns a map of date -> boolean (has any visit for that date)
// Query param: month=YYYY-MM (defaults to current month)
// Optionally: userId=X (manager looking at subordinate's calendar)
export async function GET(req: NextRequest) {
  const user = await requireUser()
  // `?userId=` used to be taken at its word, with no permission and no scope,
  // so anyone could read which days any colleague held meetings. Gated the
  // same way as `/api/expenses/calendar`: it can only NARROW the caller's
  // `meetings` scope, and an out-of-scope id is a 403.
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  if (!user.userId) return NextResponse.json({ filledDates: [] })
  const params = req.nextUrl.searchParams
  const monthParam = params.get('month') ?? businessMonth()
  const requested = params.get('userId')
  const ids = requested
    ? intersectScope(await scopedUserIds(user, 'meetings'), requested)
    : [user.userId]
  if (ids && ids.length === 0) {
    return NextResponse.json({ error: 'Not authorized to view this user' }, { status: 403 })
  }

  const [year, month] = monthParam.split('-').map(Number)
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  try {
    const data = await prisma.daily_visits.findMany({
      where: {
        tenant_id: getTenantId(),
        ...scopeWhere(ids),
        // visit_date is @db.Date, so the month bounds become Date objects.
        visit_date: { gte: new Date(from), lte: new Date(to) },
      },
      select: { visit_date: true },
    })

  // Deduplicate and return as a set of filled dates
    // The client compares these against "YYYY-MM-DD" strings. Left as Dates the
    // Set would hold distinct objects per row and JSON.stringify would emit full
    // ISO timestamps, so no calendar day would ever match (PLAN.md 5.1).
    const filledDates = [...new Set(data.map(r => dateOnlyString(r.visit_date)))]
    return NextResponse.json({ filledDates })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
