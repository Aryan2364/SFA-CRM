import { NextRequest, NextResponse } from 'next/server'
import { prisma, dateOnlyString, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Returns dates in a month that have at least one expense entry
// Query params: month=YYYY-MM, userId=X (optional, defaults to current user)
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
    const data = await prisma.expenses.findMany({
      where: {
        tenant_id: getTenantId(),
        user_id: userId ?? undefined,
        // expense_date is @db.Date, so the month bounds become Date objects.
        expense_date: { gte: new Date(from), lte: new Date(to) },
      },
      select: { expense_date: true },
    })

    // The client compares these against "YYYY-MM-DD" strings. Left as Dates the
    // Set would hold distinct objects per row and JSON.stringify would emit full
    // ISO timestamps, so no calendar day would ever match (PLAN.md 5.1).
    const filledDates = [...new Set(data.map(r => dateOnlyString(r.expense_date)))]
    return NextResponse.json({ filledDates })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
