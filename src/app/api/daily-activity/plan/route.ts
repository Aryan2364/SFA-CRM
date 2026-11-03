import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { attachPlanItemContacts } from '@/lib/plan-item-contact'
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
 *  2. **Whose day.** `/api/daily-activity` answers the caller's own
 *     meetings (Self by default). The planned lines beside them have to
 *     follow the same rule or the two halves of one list disagree about
 *     whose day it is.
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

  if (!user.userId) return NextResponse.json({ items: [] })
  const tenantId = getTenantId()
  // Self by default, like `/api/daily-activity` beside it: Daily Activity is
  // the caller's own entry screen, so its planned lines are the caller's own
  // plan. `?userId=` can only narrow the `weekly_plan` scope.
  const requested = req.nextUrl.searchParams.get('userId')
  const ids = requested
    ? intersectScope(await scopedUserIds(user, 'weekly_plan'), requested)
    : [user.userId]

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

    // Resolve names in two queries. `party_type` is free text: 'company' (or
    // null, on old rows) means `party_id` is an ACCOUNT and `contact_id` (raw
    // column, may be null / unavailable) is the person on it; 'contact' means a
    // person with no account - `party_id` IS the contact.
    const rows = await attachPlanItemContacts(
      tenantId,
      serialize(items, 'weekly_plan_items') as (Record<string, unknown> & { id: string })[],
    )
    const isContactOnly = (r: Record<string, unknown>) => r.party_type === 'contact'
    const accountIds = rows
      .filter(r => r.party_id && !isContactOnly(r))
      .map(r => r.party_id as string)
    const contactIds = rows
      .flatMap(r => [isContactOnly(r) ? r.party_id : r.contact_id])
      .filter((id): id is string => typeof id === 'string' && id !== '')
    const [accounts, people] = await Promise.all([
      accountIds.length
        ? prisma.companies.findMany({
            where: { tenant_id: tenantId, id: { in: accountIds } },
            select: { id: true, name: true, type: true },
          })
        : [],
      contactIds.length
        ? prisma.contacts.findMany({
            where: { tenant_id: tenantId, id: { in: contactIds } },
            select: { id: true, name: true, is_active: true },
          })
        : [],
    ])
    const accountById = new Map(accounts.map(a => [a.id, a]))
    const personById = new Map(people.map(p => [p.id, p]))
    // "Start" hands contact_id to the meeting, and resolveVisitContact refuses a
    // contact that is inactive or no longer linked to the account. Hand over only
    // what it will accept, or Start dead-ends in a 400.
    const linkable = rows.filter(r => !isContactOnly(r) && r.party_id && r.contact_id)
    const links = linkable.length
      ? await prisma.company_contacts.findMany({
          where: {
            tenant_id: tenantId,
            company_id: { in: linkable.map(r => r.party_id as string) },
            contact_id: { in: linkable.map(r => r.contact_id as string) },
          },
          select: { company_id: true, contact_id: true },
        })
      : []
    const linkSet = new Set(links.map(l => `${l.company_id}:${l.contact_id}`))

    return NextResponse.json({
      items: rows.map(r => {
        const owner = byPlan.get(r.weekly_plan_id as string)
        const contactOnly = isContactOnly(r)
        const account = r.party_id && !contactOnly ? accountById.get(r.party_id as string) : undefined
        const contactId = contactOnly ? (r.party_id as string | null) : r.contact_id
        const found = contactId ? personById.get(contactId as string) : undefined
        // Inactive, or (on an account line) no longer linked: drop it.
        const person =
          found && found.is_active !== false &&
          (contactOnly || !account || linkSet.has(`${account.id}:${found.id}`))
            ? found
            : undefined
        // "Person · Company" is what a meeting started from this line is named.
        const entityName =
          [person?.name, account?.name].filter(Boolean).join(' · ') || null
        return {
          ...r,
          // The meeting handoff: entity_id is the ACCOUNT (null for a person
          // with none), contact_id the person.
          account_id: account ? account.id : null,
          account_name: account?.name ?? null,
          contact_id: (person ? person.id : null) as string | null,
          contact_name: person?.name ?? null,
          entity_name: entityName,
          // party_name keeps its old meaning for the card, now also resolving a
          // contact-only party instead of leaving it null.
          party_name: entityName,
          party_visit_type: account?.type ?? null,
          user_id: owner?.user_id ?? null,
          user_name: owner?.user_name ?? '',
        }
      }),
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
