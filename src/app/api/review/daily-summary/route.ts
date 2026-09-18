import { NextRequest, NextResponse } from 'next/server'
import { dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds } from '@/lib/scope'
import { buildDailySummary } from '@/lib/summary'

export const dynamic = 'force-dynamic'

/**
 * The Daily Summary sheet for one user on one day — §6.1, P4-T3.
 *
 * ---------------------------------------------------------------------------
 * SCOPE — §6.6, and the reason this route does not use `canView()`
 *
 * `/api/review/daily-activity` next door authorises with `canView()`, which
 * asks only "is this person in my visibility closure". That is the manager
 * chain, and it ignores `role_permissions.data_scope` entirely — so a Self-
 * scoped role that happens to sit above someone in the hierarchy would still
 * read their rows.
 *
 * This route composes both, through `src/lib/scope.ts`:
 *
 *   scopedUserIds()  -> Self / Team / Company, resolved from data_scope
 *   intersectScope() -> narrows by the requested ?userId, never widens
 *
 * `intersectScope` is the load-bearing half. `orders/route.ts:57` lets
 * `?userId=` REPLACE the filter, which is gap G3 — any caller naming any id
 * reads that person's rows. Intersecting means a requested id outside the
 * allowed set collapses to `[]`, and `[]` is a refusal here rather than an
 * empty sheet: an empty sheet is indistinguishable from "that person did
 * nothing that day", which would leak the fact that the user exists and had a
 * quiet day.
 *
 * A peer therefore gets 403. A manager gets their report. Someone asking for
 * their own summary gets it whatever their scope, because `scopedUserIds`
 * always includes the caller.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()

  const requestedUserId = req.nextUrl.searchParams.get('userId') ?? user.userId
  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  if (!requestedUserId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }
  // A malformed date would otherwise reach `new Date()` and become Invalid
  // Date, which Prisma turns into an opaque 500.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  const allowed = intersectScope(await scopedUserIds(user, 'meetings'), requestedUserId)
  if (allowed !== null && allowed.length === 0) {
    return NextResponse.json({ error: 'Not authorized to view this user' }, { status: 403 })
  }

  try {
    /*
     * No serialize() call, deliberately, and this is the one place it needs
     * saying. serialize() converts the Date and Decimal objects Prisma returns
     * on a ROW; nothing here returns a row. Every figure below has already been
     * reduced to a JS number by `toNumber()` in summary.ts, every timestamp to
     * an ISO string, and `date` never stops being the "YYYY-MM-DD" the caller
     * sent. Running serialize() over the result would be a no-op that implied
     * the raw shapes were still in there.
     */
    const summary = await buildDailySummary(getTenantId(), requestedUserId, date)
    return NextResponse.json(summary)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
