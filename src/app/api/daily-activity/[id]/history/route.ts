import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

/** Earlier meetings per page. The newest is the one read in full ("Last time"). */
const PAGE_SIZE = 5

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
 * "Earlier" means before the current meeting — an earlier date, or the same
 * date and created first — so opening an old meeting never lists later ones as
 * "previous". A meeting with no company has no history: free text and
 * `contact_id` (not yet in the database) are not reliable identities.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  const tid = getTenantId()
  const offset = Math.max(0, Number.parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10) || 0)

  try {
    const scope = await scopedUserIds(user, 'meetings')
    const current = await prisma.daily_visits.findFirst({
      where: { id: params.id, tenant_id: tid, ...scopeWhere(scope) },
      select: { id: true, entity_id: true, visit_date: true, created_at: true },
    })
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!current.entity_id) {
      return NextResponse.json({ company_linked: false, total: 0, items: [], next_offset: null })
    }

    const where = {
      tenant_id: tid,
      entity_id: current.entity_id,
      id: { not: current.id },
      OR: [
        { visit_date: { lt: current.visit_date } },
        { visit_date: current.visit_date, created_at: { lt: current.created_at } },
      ],
    }
    const [visits, total] = await Promise.all([
      prisma.daily_visits.findMany({
        where,
        // Explicit fields only — never the whole row (location, addresses) and
        // never `contact_id`, which is not in the database yet.
        select: {
          id: true, user_id: true, visit_date: true, start_time: true,
          duration_secs: true, status: true, is_manual_entry: true, notes: true,
          users: { select: { name: true } },
        },
        orderBy: [
          { visit_date: 'desc' },
          { start_time: { sort: 'desc', nulls: 'last' } },
          { created_at: 'desc' },
        ],
        skip: offset,
        take: PAGE_SIZE,
      }),
      prisma.daily_visits.count({ where }),
    ])

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
