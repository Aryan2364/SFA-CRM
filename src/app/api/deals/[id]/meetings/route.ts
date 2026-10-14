import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
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
 * ⚠️ RULE CHANGED, Aryan, 2026-10-13: "if an opportunity is shared then
 * meetings against that opportunity should also be shared — else what is the
 * meaning of sharing an opportunity."
 *
 * `findScopedDeal(…, 'read')` already proves the caller may read THIS Deal —
 * owner-scope, an account member, or a deal member (`src/lib/sharing.ts`).
 * Once that is true, EVERY meeting linked to the Deal is listed, whoever held
 * it: the caller's own `meetings` data scope is no longer applied to this
 * list at all. That used to be the second gate (see the old header below, kept
 * because the reasoning about WHY a fully separate test existed still applies
 * to any similar join); sharing replaces it, because the whole point of
 * sharing a Deal is that the people it is shared with see its history.
 *
 * `can_open` is always `true` for a row that reaches this response: reading
 * the Deal is exactly what also makes `GET /api/daily-activity/[id]` readable
 * for the same meeting (`canReadVisitViaSharing`), so every linked meeting
 * named here can be opened — read-only, if the viewer is not its holder and
 * has no other scope over it. The field stays on the wire so the UI never has
 * to re-derive that rule.
 *
 * A caller with no `meetings:view` at all gets `[]`, not a 403: the Deal is
 * theirs to read and only this section of it is not, so the page renders the
 * Deal without a Meetings section. A 403 here would fail the whole screen.
 *
 * ⚠️ An empty array is a NORMAL answer, not a failure. §5.6: a Meeting is not
 * compulsory for a Deal, and the section is absent — not empty — when there
 * are none.
 *
 * ---------------------------------------------------------------------------
 * The old gate, for context: `deal_meetings` joins a record owned by a Deal
 * owner to a record owned by whoever held the meeting, and those are
 * routinely different people — which is exactly why "the caller may read the
 * Deal" was not enough on its own before sharing existed, and why it is enough
 * now: sharing is the explicit act of widening that reach.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    const deal = await findScopedDeal(user, tid, params.id, 'read')
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
     * otherwise resolve. No `meetings` scope filter here any more — see the
     * header: read access to the Deal is now the whole gate.
     */
    const visits = await prisma.daily_visits.findMany({
      where: {
        id: { in: links.map(l => l.visit_id) },
        tenant_id: tid,
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
    const rows = serialize(visits, 'daily_visits') as Record<string, unknown>[]
    return NextResponse.json(rows.map(row => ({ ...row, can_open: true })))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
