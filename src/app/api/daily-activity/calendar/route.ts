import { NextRequest, NextResponse } from 'next/server'
import { prisma, dateOnlyString, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Returns a map of date -> boolean (has any visit for that date)
// Query param: month=YYYY-MM (defaults to current month)
// Optionally: userId=X (manager looking at subordinate's calendar)
export async function GET(req: NextRequest) {
  const user = await requireUser()
  const params = req.nextUrl.searchParams
  const monthParam = params.get('month') ?? new Date().toISOString().slice(0, 7)
  const userId = params.get('userId') ?? user.userId

  const [year, month] = monthParam.split('-').map(Number)
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  try {
    const data = await prisma.daily_visits.findMany({
      where: {
        tenant_id: getTenantId(),
        user_id: userId ?? undefined,
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
