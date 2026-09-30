import { NextRequest, NextResponse } from 'next/server'
import { prisma, dateOnlyString, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'
import { businessMonth } from '@/lib/business-date'

export const dynamic = 'force-dynamic'

/**
 * Returns dates in a month that have at least one expense entry.
 * Query params: month=YYYY-MM, userId=X (optional, defaults to current user).
 *
 * ⚠️ `?userId=` USED TO BE TAKEN AT ITS WORD. The line was
 * `const userId = params.get('userId') ?? user.userId`, fed straight into the
 * `where` with no permission check and no scope, so any authenticated user
 * could name any id in the tenant and learn which days that person filed an
 * expense — someone on another team included. The dots on a calendar are less
 * than the rows behind them, but "who was out spending on which days" is still
 * that person's data, and nothing here had decided the caller could have it.
 *
 * Gated now exactly as `/api/review/expenses` is — the sibling route that
 * fills the SAME tab from the SAME `userId` on the review screen. It already
 * required `expenses.view` and already 403'd an out-of-scope target, so the
 * two routes on that screen now agree instead of one guarding the list while
 * the other handed out the calendar. Section is `expenses`, not `meetings`:
 * the two hold independent `role_permissions` rows, and borrowing one for the
 * other grants access nobody configured.
 *
 * `intersectScope` can only NARROW — a requested id outside the allowed set
 * collapses to `[]`, never to that person's rows. With no `?userId=` at all
 * the target stays Self (as it always was), so a Company-scoped caller does
 * not silently get the whole tenant's dates smeared onto their own calendar.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'expenses', 'view')) return forbidden()
  // A session with no user row owns no expenses; an empty month is the honest
  // answer, and `[undefined]` in the `where` would not be.
  if (!user.userId) return NextResponse.json({ filledDates: [] })

  const params = req.nextUrl.searchParams
  const monthParam = params.get('month') ?? businessMonth()
  const requested = params.get('userId')
  const ids = requested
    ? intersectScope(await scopedUserIds(user, 'expenses'), requested)
    : [user.userId]
  // 403, not an empty calendar: `/api/review/expenses` answers the same
  // request the same way, and a manager who may not read this person should
  // be told so once rather than shown a convincingly blank month.
  if (ids && ids.length === 0) {
    return NextResponse.json({ error: 'Not authorized to view this user' }, { status: 403 })
  }

  const [year, month] = monthParam.split('-').map(Number)
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  try {
    const data = await prisma.expenses.findMany({
      where: {
        tenant_id: getTenantId(),
        ...scopeWhere(ids),
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
