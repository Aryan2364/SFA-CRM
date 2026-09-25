import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'
import { attachVisitContacts, readVisitContacts, VISIT_SELECT } from '@/lib/visit-contact'

export const dynamic = 'force-dynamic'

/**
 * R-15 (07-REVISIT-QUEUE.md), decided by P3-T5 which owns this file.
 *
 * This route gated on `canView(manager, target)`, a bare existence check
 * on `user_visibility`. That table is the manager closure and holds ZERO
 * self rows, so `canView(me, me)` is false for every user in the system
 * and a Sales Executive asking for his OWN daily activity got 403.
 * `canView()` also ignores `role_permissions.data_scope` entirely, so a
 * Self-scoped role sitting above someone still read downward.
 *
 * **Decision: gate on `checkPermission` + `scopedUserIds`/`intersectScope`**,
 * which is what `/api/review/daily-summary`, `remarks/_access.ts` and
 * Weekly Review already do. Two routes on one screen disagreeing about
 * who may read what is the defect; this is the side they agree on.
 *
 * Rejected alternatives:
 *  - Special-casing `userId === user.userId` in front of `canView()`.
 *    It fixes the 403 and leaves the data_scope blindness untouched, and
 *    it would have to be repeated in every future caller.
 *  - Seeding self rows into `user_visibility`. Explicitly forbidden by
 *    R-15: that table is the closure, and widening it silently widens
 *    every other `canView()` caller, the weekly-plan transition routes
 *    included.
 *
 * Net effect on who can read what: a user can now read their own day
 * (was 403); a manager still reads their team, because `scopedUserIds`
 * builds the same closure `canView` consulted; a Self-scoped user who
 * happens to sit above someone can no longer read downward, which is the
 * data_scope setting finally being honoured.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()

  const userId = req.nextUrl.searchParams.get('userId')
  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  // intersectScope NARROWS: an id outside the caller's scope collapses to
  // [], never to a wider set. [] is the 403 this route always returned.
  const ids = intersectScope(await scopedUserIds(user, 'meetings'), userId)
  if (ids && ids.length === 0) {
    return NextResponse.json({ error: 'Not authorized to view this user' }, { status: 403 })
  }

  const tid = getTenantId()
  try {
    const data = await prisma.daily_visits.findMany({
      where: {
        tenant_id: tid,
        ...scopeWhere(ids),
        // visit_date is @db.Date, so the "YYYY-MM-DD" query parameter becomes a Date.
        visit_date: new Date(date),
      },
      // Explicit, not the default whole row: see VISIT_SELECT for why an
      // unselected read breaks the moment the client learns about contact_id.
      select: VISIT_SELECT,
      orderBy: { created_at: 'asc' },
    })
    const rows = serialize(data, 'daily_visits') as (Record<string, unknown> & { id: string })[]
    const contacts = await readVisitContacts(tid, rows.map(r => r.id))
    return NextResponse.json(attachVisitContacts(rows, contacts))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
