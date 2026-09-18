import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

/**
 * R-15, same defect and same decision as `review/daily-activity` — see the
 * comment there for the reasoning and the rejected alternatives. This
 * route gated on `canView()` too, so it returned 403 to a user asking for
 * their own expenses, on a screen whose third route (`daily-summary`)
 * answered 200 for the same request.
 *
 * The section is `expenses`, not `meetings`: the two have independent
 * rows in `role_permissions`, and reusing one section's scope for the
 * other would hand out access nobody granted.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'expenses', 'view')) return forbidden()

  const userId = req.nextUrl.searchParams.get('userId')
  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  const ids = intersectScope(await scopedUserIds(user, 'expenses'), userId)
  if (ids && ids.length === 0) {
    return NextResponse.json({ error: 'Not authorized to view this user' }, { status: 403 })
  }

  try {
    const data = await prisma.expenses.findMany({
      where: {
        tenant_id: getTenantId(),
        ...scopeWhere(ids),
        // expense_date is @db.Date, so the "YYYY-MM-DD" query parameter becomes a Date.
        expense_date: new Date(date),
      },
      orderBy: { created_at: 'asc' },
    })
    // amount is NUMERIC — a Decimal stringifies to a string without this.
    return NextResponse.json(serialize(data, 'expenses'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
