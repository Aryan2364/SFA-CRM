import { NextRequest, NextResponse } from 'next/server'

import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden, getDataScope } from '@/lib/permissions'
import { intersectScope, scopedUserIds } from '@/lib/scope'
import { getVisibleUserIds } from '@/lib/visibility'
import { buildWeeklyReview, mondayOf, type WeeklyReview } from '@/lib/weekly-review'

export const dynamic = 'force-dynamic'

/**
 * Team / Company summary-of-summaries — §6.4, P4-T6.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REUSES `buildWeeklyReview` PER PERSON RATHER THAN RE-AGGREGATING
 *
 * §6.2's figures are not sums of raw columns. "Met" is a lifetime check against
 * `daily_visits.start_time`; "ticked" pairs a plan row's `plan_date` with a
 * visit to that same party on that same day; "moved forward" compares
 * `deal_stages.sort_order` across a stage log. A second implementation of those
 * rules — a GROUP BY that looked right — would drift from the individual screen
 * the moment either side changed, and a manager comparing the team row against
 * the person's own Weekly Review would see two different numbers with no way to
 * tell which lies. So the team tier is defined as the sum of exactly the
 * per-person reviews it drills into, and there is only one place the rules live.
 *
 * The cost is ~12 queries per person. That is why `MAX_PEOPLE` exists and why
 * the fan-out runs in batches rather than all at once: a company tier over a
 * few hundred users would otherwise open a few thousand concurrent queries
 * against a pool configured for five.
 *
 * ---------------------------------------------------------------------------
 * THE TWO TIERS
 *
 * `team`    — the caller's own scope set: themselves plus the FULL chain below
 *             them, which is what `scopedUserIds` returns because
 *             `user_visibility` materialises the whole closure, not direct
 *             reports only (§12, closed decision).
 * `company` — every active user in the tenant. Only reachable by a caller whose
 *             `role_permissions.data_scope` for `meetings` is `all`; asking for
 *             it with `team` scope is a 403, not a silent downgrade, because a
 *             downgrade would show a manager a page headed "Company" holding
 *             their own team's numbers.
 *
 * A caller with `own` scope has no team: they get 403 and the nav entry does
 * not render for them. That is the sales executive case.
 *
 * `?userId=` narrows to one person through `intersectScope`, never replaces the
 * filter — a requested id outside the caller's set collapses to `[]`, which
 * this route answers as 403 rather than as an empty page (gap G3).
 *
 * ---------------------------------------------------------------------------
 * SERIALISATION
 *
 * `buildWeeklyReview` reduces every `Decimal` with `.toNumber()` and every date
 * with `dateOnlyString()` before returning, so everything below is already a JS
 * number or a "YYYY-MM-DD" string. Nothing here needs `serialize()`, and
 * nothing here may introduce a raw Prisma row into the response without it.
 */

/** Above this, the fan-out is refused rather than silently truncated. */
const MAX_PEOPLE = 120
/** Concurrent per-person reviews. Each is ~12 queries against a pool of 5. */
const BATCH = 4

export type TeamSummaryMember = {
  userId: string
  name: string
  managerUserId: string | null
  managerName: string | null
  toMeet: number
  met: number
  notMet: number
  plannedGoal: number
  meetings: number
  ticked: number
  open: number
  extraMeetings: number
  newParties: number
  expenseTotal: number
  orderCount: number
  orderValue: number
  draftOrderCount: number
  dealsMovedForward: number
  unmatchedPlanRows: number
}

export type TeamSummary = {
  weekStart: string
  weekEnd: string
  tier: 'team' | 'company'
  scope: 'own' | 'team' | 'all'
  canSeeCompany: boolean
  viewer: { id: string | null; name: string }
  totals: {
    people: number
    toMeet: number
    met: number
    notMet: number
    plannedGoal: number
    meetings: number
    ticked: number
    open: number
    extraMeetings: number
    newParties: number
    expenseTotal: number
    orderCount: number
    orderValue: number
    draftOrderCount: number
    dealsMovedForward: number
    unmatchedPlanRows: number
  }
  byDay: {
    date: string
    plannedGoal: number
    achievedMeetings: number
    ordersCount: number
    ordersValue: number
    expenseTotal: number
  }[]
  members: TeamSummaryMember[]
  byManager: { managerUserId: string | null; managerName: string; people: number; meetings: number; orderValue: number; expenseTotal: number }[]
  notMetParties: { id: string; name: string; owners: string[] }[]
}

async function mapWithConcurrency<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  }
  return out
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!(await checkPermission(user, 'meetings', 'view'))) return forbidden()

  const tenantId = getTenantId()
  const scope = await getDataScope(user, 'meetings')

  if (scope === 'own') {
    return NextResponse.json(
      { error: 'The Team Summary is for users whose data scope covers other people. Your scope is your own records only.' },
      { status: 403 }
    )
  }

  const tierParam = req.nextUrl.searchParams.get('tier')
  if (tierParam && tierParam !== 'team' && tierParam !== 'company') {
    return NextResponse.json({ error: 'tier must be team or company' }, { status: 400 })
  }
  const tier: 'team' | 'company' = (tierParam as 'team' | 'company' | null) ?? (scope === 'all' ? 'company' : 'team')
  if (tier === 'company' && scope !== 'all') {
    return NextResponse.json({ error: 'The company summary needs Company data scope.' }, { status: 403 })
  }

  const weekStartParam = req.nextUrl.searchParams.get('weekStart') ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartParam) || Number.isNaN(Date.parse(`${weekStartParam}T00:00:00.000Z`))) {
    return NextResponse.json({ error: 'weekStart must be YYYY-MM-DD' }, { status: 400 })
  }
  const monday = mondayOf(weekStartParam)

  try {
    // The population, before any narrowing. Company tier is "everyone in the
    // tenant"; team tier is the caller's own scope closure.
    let memberIds: string[] | null
    if (tier === 'company') {
      memberIds = null
    } else {
      memberIds = await scopedUserIds(user, 'meetings')
      // `scopedUserIds` answers `null` — no user predicate — for Company scope,
      // which is right for the company tier and wrong for this one: an
      // Administrator switching to "My team" would get the company list under a
      // team heading, and the two tabs would be identical. On the team tab the
      // set is the caller's own visibility closure whatever their scope, which
      // is the same closure `scopedUserIds` builds for a `team`-scoped caller.
      if (memberIds === null && user.userId) {
        memberIds = [user.userId, ...(await getVisibleUserIds(user.userId, tenantId))]
      }
    }

    // `?userId=` is a narrowing filter, never a replacement (gap G3).
    const requestedUserId = req.nextUrl.searchParams.get('userId')
    const narrowed = intersectScope(memberIds, requestedUserId)
    if (narrowed !== null && requestedUserId && narrowed.length === 0) {
      return NextResponse.json({ error: 'Not authorized to view this user' }, { status: 403 })
    }

    const people = await prisma.users.findMany({
      where: {
        tenant_id: tenantId,
        status: 'Active',
        ...(narrowed ? { id: { in: narrowed } } : {}),
      },
      select: { id: true, name: true, manager_user_id: true, users: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    })

    if (people.length > MAX_PEOPLE) {
      return NextResponse.json(
        { error: `This view covers ${people.length} people; it is capped at ${MAX_PEOPLE}. Narrow it with ?userId= or use the report builder.` },
        { status: 400 }
      )
    }

    const reviews = await mapWithConcurrency(people, BATCH, async p => ({
      person: p,
      review: await buildWeeklyReview(tenantId, p.id, monday),
    }))

    const members: TeamSummaryMember[] = reviews.map(({ person, review }) => toMember(person, review))

    const totals = members.reduce(
      (acc, m) => {
        acc.toMeet += m.toMeet
        acc.met += m.met
        acc.notMet += m.notMet
        acc.plannedGoal += m.plannedGoal
        acc.meetings += m.meetings
        acc.ticked += m.ticked
        acc.open += m.open
        acc.extraMeetings += m.extraMeetings
        acc.newParties += m.newParties
        acc.expenseTotal += m.expenseTotal
        acc.orderCount += m.orderCount
        acc.orderValue += m.orderValue
        acc.draftOrderCount += m.draftOrderCount
        acc.dealsMovedForward += m.dealsMovedForward
        acc.unmatchedPlanRows += m.unmatchedPlanRows
        return acc
      },
      {
        people: members.length,
        toMeet: 0, met: 0, notMet: 0, plannedGoal: 0, meetings: 0, ticked: 0, open: 0,
        extraMeetings: 0, newParties: 0, expenseTotal: 0, orderCount: 0, orderValue: 0,
        draftOrderCount: 0, dealsMovedForward: 0, unmatchedPlanRows: 0,
      }
    )

    // Day-wise, summed across the population. The seven dates come from the
    // first review rather than being recomputed, so the team row and the
    // person's own row are the same seven days by construction.
    const dayIndex = new Map<string, TeamSummary['byDay'][number]>()
    for (const { review } of reviews) {
      for (const d of review.dayWise) {
        const cur = dayIndex.get(d.date) ?? { date: d.date, plannedGoal: 0, achievedMeetings: 0, ordersCount: 0, ordersValue: 0, expenseTotal: 0 }
        cur.plannedGoal += d.plannedGoal
        cur.achievedMeetings += d.achievedMeetings
        cur.ordersCount += d.ordersCount
        cur.ordersValue += d.ordersValue
        cur.expenseTotal += d.expenseTotal
        dayIndex.set(d.date, cur)
      }
    }
    const byDay = Array.from(dayIndex.values()).sort((a, b) => a.date.localeCompare(b.date))

    // Who reports to whom, for the company tier's grouping. A person with no
    // manager is grouped under "No manager" rather than dropped.
    const managerIndex = new Map<string | null, TeamSummary['byManager'][number]>()
    for (const m of members) {
      const key = m.managerUserId
      const cur = managerIndex.get(key) ?? {
        managerUserId: key,
        managerName: m.managerName ?? 'No manager',
        people: 0, meetings: 0, orderValue: 0, expenseTotal: 0,
      }
      cur.people += 1
      cur.meetings += m.meetings
      cur.orderValue += m.orderValue
      cur.expenseTotal += m.expenseTotal
      managerIndex.set(key, cur)
    }
    const byManager = Array.from(managerIndex.values()).sort((a, b) => b.people - a.people)

    // Parties planned this week that nobody has ever met, de-duplicated across
    // the team — two reps planning the same never-visited party is one problem,
    // not two, and the owners column says who to ask.
    const notMetIndex = new Map<string, { id: string; name: string; owners: string[] }>()
    for (const { person, review } of reviews) {
      for (const p of review.notMet.list) {
        const cur = notMetIndex.get(p.id) ?? { id: p.id, name: p.name, owners: [] }
        if (!cur.owners.includes(person.name)) cur.owners.push(person.name)
        notMetIndex.set(p.id, cur)
      }
    }

    const body: TeamSummary = {
      weekStart: monday,
      weekEnd: reviews[0]?.review.weekEnd ?? monday,
      tier,
      scope,
      canSeeCompany: scope === 'all',
      viewer: { id: user.userId, name: user.name },
      totals,
      byDay,
      members: members.sort((a, b) => b.meetings - a.meetings || a.name.localeCompare(b.name)),
      byManager,
      notMetParties: Array.from(notMetIndex.values()).sort((a, b) => a.name.localeCompare(b.name)),
    }

    return NextResponse.json(body)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

function toMember(
  person: { id: string; name: string; manager_user_id: string | null; users: { id: string; name: string } | null },
  review: WeeklyReview
): TeamSummaryMember {
  return {
    userId: person.id,
    name: person.name,
    managerUserId: person.manager_user_id,
    managerName: person.users?.name ?? null,
    toMeet: review.headline.toMeet,
    met: review.headline.met,
    notMet: review.notMet.count,
    plannedGoal: review.priorityPoints.plannedGoals.total,
    meetings: review.priorityPoints.achievedMeetings,
    ticked: review.priorityPoints.ticked,
    open: review.priorityPoints.open,
    extraMeetings: review.extraMeetings.count,
    newParties: review.newParties.count,
    expenseTotal: review.expenses.total,
    orderCount: review.orders.draft.count + review.orders.placed.count,
    orderValue: review.headline.orderValue,
    draftOrderCount: review.orders.draft.count,
    dealsMovedForward: review.funnel.movedForward,
    unmatchedPlanRows: review.priorityPoints.unmatched,
  }
}
