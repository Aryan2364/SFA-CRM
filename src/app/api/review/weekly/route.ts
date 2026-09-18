import { NextRequest, NextResponse } from 'next/server'
import { dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds } from '@/lib/scope'
import { buildWeeklyReview, mondayOf } from '@/lib/weekly-review'

export const dynamic = 'force-dynamic'

/**
 * Weekly Review — §6.2, P4-T4. Sibling to `/api/review/daily-summary`, same
 * scope pattern: `scopedUserIds` (Self/Team/Company from `role_permissions`)
 * INTERSECTED with the requested `?userId`, never replaced by it — see the
 * long comment in daily-summary/route.ts for why `?userId=` replacing the
 * filter is a cross-user data leak (gap G3).
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()

  const requestedUserId = req.nextUrl.searchParams.get('userId') ?? user.userId
  const weekStartParam = req.nextUrl.searchParams.get('weekStart') ?? new Date().toISOString().slice(0, 10)

  if (!requestedUserId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartParam) || Number.isNaN(Date.parse(`${weekStartParam}T00:00:00.000Z`))) {
    return NextResponse.json({ error: 'weekStart must be YYYY-MM-DD' }, { status: 400 })
  }

  const allowed = intersectScope(await scopedUserIds(user, 'meetings'), requestedUserId)
  if (allowed !== null && allowed.length === 0) {
    return NextResponse.json({ error: 'Not authorized to view this user' }, { status: 403 })
  }

  try {
    const monday = mondayOf(weekStartParam)
    const review = await buildWeeklyReview(getTenantId(), requestedUserId, monday)
    return NextResponse.json(review)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
