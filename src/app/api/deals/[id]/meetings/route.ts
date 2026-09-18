import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
import { findScopedDeal, notFound } from '../../_access'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/deals/[id]/meetings` — the Meetings held on this Deal (§5.6).
 *
 * The other half of `POST /api/deal-meetings`. That route records "this Deal
 * was discussed in this meeting" from inside the meeting; this one reads the
 * same join from the Deal's end, so the cross-link works in both directions off
 * one table rather than two lists that can disagree.
 *
 * ---------------------------------------------------------------------------
 * TWO SCOPES, APPLIED SEPARATELY, AND WHY NEITHER IMPLIES THE OTHER
 *
 * `deal_meetings` joins a record owned by a Deal owner to a record owned by
 * whoever held the meeting, and those are routinely different people. So:
 *
 *   deals     decides whether this Deal may be opened at all — `findScopedDeal`
 *   meetings  decides which of its meetings may be NAMED
 *
 * Inferring the second from the first is the leak: a Sales Executive who owns a
 * Deal would otherwise be handed the party name, the date and the owner of a
 * colleague's meeting simply because that colleague ticked the Deal. The visit
 * rows are therefore re-queried under the meetings scope, and a link that does
 * not survive it is dropped from the list entirely rather than rendered
 * unclickable — §5.6's rule is that a link the viewer cannot follow must not
 * appear, and `/daily-activity/meeting/[id]` already 404s the same request.
 *
 * A caller with no `meetings:view` at all gets `[]`, not a 403: the Deal is
 * theirs to read and only this section of it is not, so the page renders the
 * Deal without a Meetings section. A 403 here would fail the whole screen.
 *
 * ⚠️ An empty array is a NORMAL answer, not a failure. §5.6: a Meeting is not
 * compulsory for a Deal, and the section is absent — not empty — when there
 * are none.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    const deal = await findScopedDeal(user, tid, params.id)
    if (!deal) return notFound()

    if (!await checkPermission(user, 'meetings', 'view')) {
      return NextResponse.json([])
    }

    const links = await prisma.deal_meetings.findMany({
      where: { tenant_id: tid, deal_id: deal.id },
      select: { visit_id: true },
    })
    if (links.length === 0) return NextResponse.json([])

    /*
     * `deal_meetings` carries no relation to `daily_visits` in the schema —
     * only to `deals` — so this is a second query by id rather than an
     * `include`. `tenant_id` is in the `where` beside the ids: an id list is
     * not a tenant filter, and a visit id that leaked in from elsewhere would
     * otherwise resolve.
     */
    const visits = await prisma.daily_visits.findMany({
      where: {
        id: { in: links.map(l => l.visit_id) },
        tenant_id: tid,
        ...scopeWhere(await scopedUserIds(user, 'meetings')),
      },
      select: {
        id: true,
        visit_date: true,
        visit_type: true,
        entity_name: true,
        status: true,
        start_time: true,
        duration_secs: true,
        is_manual_entry: true,
        users: { select: { id: true, name: true } },
      },
      orderBy: [{ visit_date: 'desc' }, { start_time: 'desc' }],
    })

    // `visit_date` is @db.Date and must come back "YYYY-MM-DD"; `start_time` is
    // a timestamp. The model name is what tells `serialize` which is which.
    return NextResponse.json(serialize(visits, 'daily_visits'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
