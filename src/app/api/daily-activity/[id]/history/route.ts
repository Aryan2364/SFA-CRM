import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser, SessionUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
import { canReadVisitViaSharing, opportunityOnlyDealIds, widenScope } from '@/lib/sharing'
import { listAttendees, listAttendeesForVisits, visitIdsSharingAttendees } from '@/lib/meeting-attendees'

export const dynamic = 'force-dynamic'

/** Earlier meetings per page. The newest is the one read in full ("Last time"). */
const PAGE_SIZE = 5

/**
 * `null` — no narrowing, the full customer history applies (see the header).
 * Otherwise the ids of the visits this opportunity-only member may list: those
 * linked through `deal_meetings` to an opportunity of THIS account that they
 * can access. Every query carries the tenant predicate.
 */
async function opportunityOnlyVisitIds(
  user: SessionUser,
  tid: string,
  companyId: string
): Promise<string[] | null> {
  // Not an opportunity-only member here (always the case until `deal_members`
  // exists; also anyone with access to the account itself) → the full
  // history, as before.
  const memberDeals = await opportunityOnlyDealIds(user, tid, companyId)
  if (memberDeals.length === 0) return null

  // Every opportunity of this account the caller can reach: their own scope
  // plus the ones shared with them directly. (No account membership — that
  // case returned above.)
  const accessible = await prisma.deals.findMany({
    where: {
      tenant_id: tid,
      company_id: companyId,
      ...widenScope(scopeWhere(await scopedUserIds(user, 'deals'), 'owner_user_id'), [
        { id: { in: memberDeals } },
      ]),
    },
    select: { id: true },
  })
  const links = await prisma.deal_meetings.findMany({
    where: { tenant_id: tid, deal_id: { in: accessible.map(d => d.id) } },
    select: { visit_id: true },
  })
  return [...new Set(links.map(l => l.visit_id))]
}

/**
 * `GET /api/daily-activity/[id]/history?offset=N` — "Previous meetings" on the
 * meeting page: what was discussed at earlier meetings with the same company.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ THE RULE: WHOEVER HAS ACCESS TO A CUSTOMER SEES THAT CUSTOMER'S HISTORY
 *
 * Decided by Aryan on 2026-10-12. Anyone who can set up and start a meeting
 * with a customer should know what happened with that customer before, whoever
 * held those earlier meetings. A rep walking into a shop a colleague visited
 * last month needs last month's minutes; hiding them defeats the screen.
 *
 * Access to the customer is reached THROUGH A MEETING THE CALLER MAY OPEN:
 * holding this meeting is what puts the caller in front of this customer, so
 * this customer's history comes with it. That is why the earlier meetings below
 * are matched on the customer and not filtered by the caller's own `meetings`
 * scope. It stays a rule about one customer, bounded three ways:
 *
 *   1. The CURRENT meeting is gated exactly as `GET /api/daily-activity/[id]`
 *      gates it — tenant AND `meetings` scope in the where, 404 otherwise. No
 *      meeting the caller may open, no access to the customer, no history.
 *   2. Only meetings with the SAME customer (`entity_id`, the company, non-
 *      null) as that meeting are listed — never a general list, never a name
 *      match.
 *   3. Only what was discussed goes out: date, time, duration, status, who
 *      held it, the minutes and the legacy note. No location, no address, no
 *      orders, no deals.
 *
 * `can_open` says whether a listed meeting is inside the caller's own scope.
 * The page links to a past meeting only when it is, because
 * `/daily-activity/meeting/[id]` still applies the scope and would 404.
 *
 * "Earlier" means before the current meeting's ACTUAL time — `start_time` when
 * it was recorded, else `visit_date` at midnight — with `created_at` only as a
 * tie-breaker, so a meeting typed in after the fact still sorts by when it
 * happened, not by when it was saved. Computed in JS rather than in the SQL
 * `WHERE`/`ORDER BY`, because `COALESCE(start_time, visit_date)` mixes a
 * timestamptz and a date column in a way Prisma's query builder cannot express;
 * this route already fetches every candidate row before paging (see below), so
 * sorting and slicing the full set in JS costs nothing extra.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ MATCHING (Aryan, 2026-10-16, "Past notes"): same account OR shared attendee
 *
 * An earlier meeting counts when it has the same `entity_id` (account) as
 * today's, OR when it shares at least one attendee contact with today's
 * meeting (`meeting_attendees`, src/lib/meeting-attendees.ts — guarded; if the
 * table does not exist yet, attendee matching silently contributes nothing and
 * only the account rule applies). A meeting with no account AND no attendees on
 * either side has no basis to match anything, so it reports an empty history —
 * never a blank "company_linked: false" distinct from a zero result; the panel
 * says "No meetings exist yet." for every empty reason alike.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ THE ONE NARROWING: OPPORTUNITY-ONLY SHARING (Aryan, 2026-10-13)
 *
 * Someone an OPPORTUNITY was shared with (`deal_members`, src/lib/sharing.ts)
 * may log a meeting at its account from the opportunity page. They were let in
 * to that opportunity, not to the account, so for them this list is only the
 * earlier meetings LINKED (`deal_meetings`) to opportunities of this account
 * they can access — owner-scope or shared — PLUS every earlier meeting at this
 * account they held themselves (never hidden, whatever the sharing level), and
 * not the rest of the account's history.
 *
 * The narrowing applies only when BOTH hold: the caller has no access to the
 * account itself (not owner-scope on `companies`, not an `account_members`
 * row), AND the caller is a direct member of at least one of this account's
 * opportunities. Everyone else keeps the rule above unchanged: account members,
 * owner-scope viewers, and the rep who simply held a meeting with a colleague's
 * customer. Until `deal_members` exists nobody is a direct member, so nobody is
 * narrowed and this route answers exactly as before.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  const tid = getTenantId()
  const offset = Math.max(0, Number.parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10) || 0)

  try {
    const scope = await scopedUserIds(user, 'meetings')
    const currentSelect = {
      id: true, entity_id: true, visit_date: true, start_time: true, created_at: true,
    } as const
    let current = await prisma.daily_visits.findFirst({
      where: { id: params.id, tenant_id: tid, ...scopeWhere(scope) },
      select: currentSelect,
    })
    if (!current) {
      // Outside the caller's own scope — the same sharing fallback as
      // `GET /api/daily-activity/[id]` (src/lib/sharing.ts): someone a Deal
      // or its account is shared with may open "Previous meetings" exactly as
      // they may open the meeting itself, read-only.
      const raw = await prisma.daily_visits.findFirst({
        where: { id: params.id, tenant_id: tid },
        select: currentSelect,
      })
      if (raw && await canReadVisitViaSharing(user, tid, { id: raw.id, entity_id: raw.entity_id })) {
        current = raw
      }
    }
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Today's attendees — the other half of the matching rule, alongside the
    // account. `[]` whenever the table is missing or nobody was recorded.
    const myAttendeeContactIds = (await listAttendees(tid, current.id)).map(a => a.contact_id)
    const attendeeMatchIds = await visitIdsSharingAttendees(tid, myAttendeeContactIds, current.id)

    const matchClauses: Record<string, unknown>[] = []
    if (current.entity_id) matchClauses.push({ entity_id: current.entity_id })
    if (attendeeMatchIds.length > 0) matchClauses.push({ id: { in: attendeeMatchIds } })

    if (matchClauses.length === 0) {
      // No account and no shared attendee on either side — nothing to match
      // against, for any reason. Same empty shape the UI reads for every
      // other empty case; see "No meetings exist yet." above.
      return NextResponse.json({ company_linked: false, total: 0, items: [], next_offset: null })
    }

    // Opportunity-only narrowing only applies to the account rule; it has
    // nothing to say about a meeting matched purely through a shared
    // attendee at a different account, so it is left unnarrowed there.
    const linkedOnly = current.entity_id
      ? await opportunityOnlyVisitIds(user, tid, current.entity_id)
      : null

    const where = {
      tenant_id: tid,
      id: { not: current.id },
      OR: matchClauses,
      // Opportunity-only narrowing — but a person ALWAYS sees the meetings they
      // held themselves, whatever their sharing level: hiding someone's own
      // work from them is never the intent. Only added when narrowing applies,
      // so every other caller's query is exactly as before.
      ...(linkedOnly
        ? {
            AND: [
              {
                OR: [
                  { id: { in: linkedOnly } },
                  ...(user.userId ? [{ user_id: user.userId }] : []),
                ],
              },
            ],
          }
        : {}),
    }

    // Every candidate row, unpaged: "earlier" is decided by an actual-time
    // comparison (see the header) that Prisma cannot express as a WHERE/ORDER
    // BY on mixed date/timestamptz columns, so the sort and the offset/limit
    // slice both happen in JS below instead of in SQL.
    const candidates = await prisma.daily_visits.findMany({
      where,
      // Explicit fields only — never the whole row (location, addresses) and
      // never `contact_id`, which is not in the database yet.
      select: {
        id: true, user_id: true, visit_date: true, start_time: true, created_at: true,
        duration_secs: true, status: true, is_manual_entry: true, notes: true,
        users: { select: { name: true } },
      },
    })

    const effectiveMs = (v: { start_time: Date | null; visit_date: Date }) =>
      (v.start_time ?? v.visit_date).getTime()
    const curEffectiveMs = effectiveMs(current)

    const earlier = candidates
      .filter(v => {
        const ms = effectiveMs(v)
        return ms < curEffectiveMs || (ms === curEffectiveMs && v.created_at.getTime() < current.created_at.getTime())
      })
      .sort((a, b) => {
        const diff = effectiveMs(b) - effectiveMs(a)
        return diff !== 0 ? diff : b.created_at.getTime() - a.created_at.getTime()
      })

    const total = earlier.length
    const visits = earlier.slice(offset, offset + PAGE_SIZE)

    // One query for the page's minutes, not one per meeting.
    const remarks = visits.length
      ? await prisma.contextual_remarks.findMany({
          where: { tenant_id: tid, context_type: 'meeting', context_id: { in: visits.map(v => v.id) } },
          select: {
            id: true, context_id: true, body: true, created_at: true,
            users: { select: { name: true } },
          },
          // Oldest first, as the meeting's own Minutes card reads them.
          orderBy: { created_at: 'asc' },
        })
      : []
    const minutes = serialize(remarks, 'contextual_remarks') as {
      id: string
      context_id: string
      body: string
      created_at: string
      users: { name: string } | null
    }[]

    // The main attendee per listed meeting, when one was marked. Guarded the
    // same way as every other attendees read.
    const attendeesByVisit = await listAttendeesForVisits(tid, visits.map(v => v.id))

    const rows = serialize(visits, 'daily_visits') as (Record<string, unknown> & {
      id: string
      user_id: string
      notes: string | null
      users: { name: string } | null
    })[]

    return NextResponse.json({
      company_linked: true,
      total,
      items: rows.map(({ user_id, notes, users, ...v }) => ({
        ...v,
        held_by: users?.name ?? null,
        earlier_note: notes?.trim() || null,
        main_attendee: attendeesByVisit.get(v.id)?.find(a => a.is_main)?.name ?? null,
        minutes: minutes
          .filter(m => m.context_id === v.id)
          .map(m => ({ id: m.id, body: m.body, created_at: m.created_at, author: m.users?.name ?? null })),
        can_open: scope === null || scope.includes(user_id),
      })),
      next_offset: offset + visits.length < total ? offset + visits.length : null,
    })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
