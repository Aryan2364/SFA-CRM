import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

/**
 * §5.3 rule 1 — "approved plan items appear automatically for the day".
 *
 * Daily Activity used to read `/api/weekly-plans/day`, which answers the
 * caller's OWN plan at ANY status and hands back raw item rows. Three
 * things were missing for the reworked screen and none of them belong in
 * that route, which other screens depend on as it is:
 *
 *  1. **Approved only.** 'Edited by Manager' is NOT an approved plan —
 *     `weekly-plans/[id]/submit` lists it beside 'Draft' and 'Rejected'
 *     as a state the user still has to resubmit from. Auto-populating
 *     the day from it would put a manager's unaccepted edit on the
 *     executive's screen as work to do.
 *  2. **Scope.** `/api/daily-activity` is Self/Team/Company since P4-T1,
 *     so a Team-scoped manager sees the team's meetings. The planned
 *     lines beside them have to follow the same scope or the two halves
 *     of one list disagree about whose day it is.
 *  3. **The party's name.** `weekly_plan_items.party_id` is a bare uuid.
 *     The card cannot say who to meet without resolving it, and the
 *     whole point of rule 1 is that the user never picks that person
 *     from a dropdown.
 *
 * ⚠️ `party_id` is nullable and is NULL on every seeded row. A planned
 * line with no party is a route line (from → to plus goals), not a
 * meeting; the client renders it as context, not as something to start.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'view')) return forbidden()

  const date = req.nextUrl.searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'date is required' }, { status: 400 })

  const tenantId = getTenantId()
  const ids = intersectScope(
    await scopedUserIds(user, 'weekly_plan'),
    req.nextUrl.searchParams.get('userId')
  )

  try {
    // plan_date, week_start_date and week_end_date are all @db.Date.
    const day = new Date(date)

    const plans = await prisma.weekly_plans.findMany({
      where: {
        tenant_id: tenantId,
        ...scopeWhere(ids),
        status: 'Approved',
        week_start_date: { lte: day },
        week_end_date: { gte: day },
      },
      select: {
        id: true,
        user_id: true,
        users_weekly_plans_user_idTousers: { select: { name: true } },
      },
    })
    if (plans.length === 0) return NextResponse.json({ items: [] })

    const byPlan = new Map(plans.map(p => [p.id, { user_id: p.user_id, user_name: p.users_weekly_plans_user_idTousers?.name ?? '' }]))

    const items = await prisma.weekly_plan_items.findMany({
      where: {
        // The parent plan is already tenant-filtered; the item carries its
        // own tenant_id and is filtered on it too, because a query that
        // only inherits its scope stops being scoped the moment someone
        // reuses it.
        tenant_id: tenantId,
        weekly_plan_id: { in: plans.map(p => p.id) },
        plan_date: day,
      },
      orderBy: { created_at: 'asc' },
    })
    if (items.length === 0) return NextResponse.json({ items: [] })

    // Resolve party names in one query. `party_type` is a free-text column;
    // only 'company' has a table behind it today, and anything else keeps a
    // null name rather than guessing.
    const partyIds = items
      .filter(i => i.party_id && (i.party_type === 'company' || i.party_type == null))
      .map(i => i.party_id!)
    const parties = partyIds.length
      ? await prisma.companies.findMany({
          where: { tenant_id: tenantId, id: { in: partyIds } },
          select: { id: true, name: true, type: true },
        })
      : []
    const partyById = new Map(parties.map(p => [p.id, p]))

    // serialize() first — expected_order_value is a Decimal and plan_date a
    // DATE; both are corrupt by the time JSON.stringify sees them otherwise.
    const rows = serialize(items, 'weekly_plan_items') as Record<string, unknown>[]

    return NextResponse.json({
      items: rows.map(r => {
        const owner = byPlan.get(r.weekly_plan_id as string)
        const party = r.party_id ? partyById.get(r.party_id as string) : undefined
        return {
          ...r,
          party_name: party?.name ?? null,
          party_visit_type: party?.type ?? null,
          user_id: owner?.user_id ?? null,
          user_name: owner?.user_name ?? '',
        }
      }),
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
