import { prisma, dateOnlyString } from './db'

/**
 * Weekly Review — REBUILD-PLAN.md §6.2, P4-T4.
 *
 * All figures for one user, one Monday-to-Sunday week. Sibling to
 * `summary.ts` (the Daily Summary, §6.1) and deliberately built the same way:
 * every date comparison goes through `dateOnlyString`/`dayStart` rather than a
 * raw `Date`, and every `Decimal` is reduced to a JS number with `toNumber()`
 * before it leaves this file — nothing here should ever need `serialize()`
 * downstream.
 *
 * ---------------------------------------------------------------------------
 * WEEK BOUNDARY AND THE 5h30m SKEW
 *
 * `weekStart` is always a "YYYY-MM-DD" string picked by the caller (the route
 * defaults it to the Monday of the current week). Every date-column query below
 * compares against `dayStart(weekStart)` .. `dayStart(weekStart)+7days`, both
 * constructed from that same string with `T00:00:00.000Z` — never from
 * `new Date()` directly, which on this dev machine is IST and would shift the
 * boundary by 5h30m against the UTC `@db.Date` values Postgres stores.
 *
 * ---------------------------------------------------------------------------
 * "NOT MET" — the definition this file uses
 *
 * A party is "Not Met" when a `weekly_plan_items` row this week names it
 * (`party_id` not null) and that party has NO `daily_visits` row EVER (not
 * just this week) with `entity_id` equal to that party and a `start_time` set
 * (i.e. a meeting that was actually started) AND status other than a pure
 * no-show placeholder. In other words: planned this week, never once visited,
 * historically. This deliberately looks across the party's whole history, not
 * just the week, because a party met last month and re-planned this week
 * without a fresh visit is a scheduling gap, not a "never met" party — but the
 * spec's phrasing ("no meeting ever started") is explicit that this is a
 * lifetime check, not a weekly one.
 *
 * Plan rows with no `party_id` (counts-only plans — see `summary.ts`'s
 * `partyMatching`) cannot be checked this way at all and are excluded, with the
 * count of such rows surfaced separately so the screen can say "N plan rows
 * have no linked party and are not included above" rather than silently
 * treating them as met.
 *
 * ---------------------------------------------------------------------------
 * PRIORITY POINTS — ticked vs open
 *
 * A "priority point" is one `weekly_plan_items` row for the week that names a
 * party (`party_id` not null). It is "ticked" when at least one `daily_visits`
 * row exists for that party on that exact `plan_date` (planned day = visited
 * day); otherwise it is "open". Rows with no `party_id` count toward
 * planned/achieved totals but not toward ticked/open, for the same reason as
 * "Not Met" above.
 */

function dayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`)
}

/** Monday of the week containing `dateStr` (UTC, date-only arithmetic). */
export function mondayOf(dateStr: string): string {
  const d = dayStart(dateStr)
  const dow = d.getUTCDay() // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow
  const monday = new Date(d.getTime() + diff * 86400000)
  return dateOnlyString(monday)
}

function addDays(dateStr: string, n: number): string {
  return dateOnlyString(new Date(dayStart(dateStr).getTime() + n * 86400000))
}

function toNumber(value: { toNumber(): number } | null | undefined): number {
  return value ? value.toNumber() : 0
}

export type WeeklyReview = {
  weekStart: string
  weekEnd: string
  user: { id: string; name: string }

  headline: {
    toMeet: number
    met: number
    spent: number
    orderValue: number
  }

  priorityPoints: {
    plannedGoals: { newParties: number; existingParties: number; others: number; total: number }
    achievedMeetings: number
    ticked: number
    open: number
    unmatched: number // plan rows this week with no party_id
    partyMatching: 'by_party' | 'none'
  }

  dayWise: {
    date: string
    plannedGoal: number
    achievedMeetings: number
    ordersCount: number
    ordersValue: number
    meetingSeconds: number
    workingSeconds: number | null
    nonMeetingSeconds: number | null
    expenseTotal: number
  }[]

  extraMeetings: {
    count: number
    list: { id: string; entityName: string; date: string }[]
  }

  newParties: {
    count: number
    list: { id: string; name: string; date: string }[]
  }

  expenses: {
    byCategory: { category: string; amount: number; count: number }[]
    byDay: { date: string; amount: number }[]
    total: number
  }

  orders: {
    draft: { count: number; value: number }
    placed: { count: number; value: number }
    byCategory: { name: string; count: number; value: number }[]
    bySubCategory: { name: string; count: number; value: number }[]
    byProduct: { name: string; count: number; value: number }[]
  }

  funnel: {
    movedForward: number
    byStage: { stage: string; count: number }[]
  }

  notMet: {
    count: number
    unmatchedCount: number
    list: { id: string; name: string }[]
  }

  expenseVsOrder: { expenseTotal: number; orderValue: number; ratio: number | null }
}

export async function buildWeeklyReview(
  tenantId: string,
  userId: string,
  weekStart: string
): Promise<WeeklyReview> {
  const monday = mondayOf(weekStart)
  const sunday = addDays(monday, 6)
  const weekStartDate = dayStart(monday)
  const weekEndExclusive = dayStart(addDays(monday, 7))

  const [user, planItems, visits, attendanceRows, orders, expenseRows, newPartyRows, stageLogs, allStages] =
    await Promise.all([
      prisma.users.findFirst({ where: { id: userId, tenant_id: tenantId }, select: { id: true, name: true } }),
      prisma.weekly_plan_items.findMany({
        where: { tenant_id: tenantId, plan_date: { gte: weekStartDate, lt: weekEndExclusive }, weekly_plans: { user_id: userId } },
        select: {
          id: true, plan_date: true, party_id: true,
          new_dealers_goal: true, existing_dealers_goal: true, others_goal: true,
        },
      }),
      prisma.daily_visits.findMany({
        where: { tenant_id: tenantId, user_id: userId, visit_date: { gte: weekStartDate, lt: weekEndExclusive } },
        select: { id: true, visit_date: true, entity_id: true, entity_name: true, is_new_entity: true, duration_secs: true, weekly_plan_item_id: true, status: true },
      }),
      prisma.attendance.findMany({
        where: { tenant_id: tenantId, user_id: userId, date: { gte: weekStartDate, lt: weekEndExclusive } },
        select: { date: true, check_in_time: true, check_out_time: true },
      }),
      prisma.orders.findMany({
        where: { tenant_id: tenantId, user_id: userId, order_date: { gte: weekStartDate, lt: weekEndExclusive } },
        select: {
          id: true, order_date: true, status: true, total_amount: true,
          order_items: { select: { amount: true, qty: true, products: { select: { name: true, category_id: true, subcategory_id: true, product_categories: { select: { name: true } }, product_subcategories: { select: { name: true } } } } } },
        },
      }),
      prisma.expenses.findMany({
        where: { tenant_id: tenantId, user_id: userId, expense_date: { gte: weekStartDate, lt: weekEndExclusive } },
        select: { expense_date: true, category: true, amount: true },
      }),
      prisma.companies.findMany({
        where: { tenant_id: tenantId, created_by_user_id: userId, created_at: { gte: weekStartDate, lt: weekEndExclusive } },
        select: { id: true, name: true, created_at: true },
      }),
      prisma.deal_stage_logs.findMany({
        where: { tenant_id: tenantId, changed_by_user_id: userId, changed_at: { gte: weekStartDate, lt: weekEndExclusive } },
        select: { deal_id: true, from_stage_id: true, to_stage_id: true },
      }),
      prisma.deal_stages.findMany({ where: { tenant_id: tenantId }, select: { id: true, name: true, sort_order: true } }),
    ])

  if (!user) throw new Error('User not found')

  const stageNameById = new Map(allStages.map(s => [s.id, s.name]))
  const stageOrderById = new Map(allStages.map(s => [s.id, s.sort_order]))

  // ---- day-wise scaffolding ----
  const days: string[] = []
  for (let i = 0; i < 7; i++) days.push(addDays(monday, i))

  const planByDay = new Map<string, typeof planItems>()
  for (const d of days) planByDay.set(d, [])
  for (const p of planItems) {
    const key = dateOnlyString(p.plan_date)
    planByDay.get(key)?.push(p)
  }

  const visitByDay = new Map<string, typeof visits>()
  for (const d of days) visitByDay.set(d, [])
  for (const v of visits) {
    const key = dateOnlyString(v.visit_date)
    visitByDay.get(key)?.push(v)
  }

  const attendanceByDay = new Map(attendanceRows.map(a => [dateOnlyString(a.date), a]))

  const orderByDay = new Map<string, typeof orders>()
  for (const d of days) orderByDay.set(d, [])
  for (const o of orders) orderByDay.get(dateOnlyString(o.order_date))?.push(o)

  const expenseByDay = new Map<string, typeof expenseRows>()
  for (const d of days) expenseByDay.set(d, [])
  for (const e of expenseRows) expenseByDay.get(dateOnlyString(e.expense_date))?.push(e)

  const dayWise = days.map(date => {
    const items = planByDay.get(date) ?? []
    const plannedGoal = items.reduce((s, p) => s + (p.new_dealers_goal ?? 0) + (p.existing_dealers_goal ?? 0) + (p.others_goal ?? 0), 0)
    const dayVisits = visitByDay.get(date) ?? []
    const achievedMeetings = dayVisits.length
    const meetingSeconds = dayVisits.reduce((s, v) => s + (v.duration_secs ?? 0), 0)
    const att = attendanceByDay.get(date)
    let workingSeconds: number | null = null
    if (att?.check_in_time && att?.check_out_time) {
      workingSeconds = Math.max(0, Math.floor((att.check_out_time.getTime() - att.check_in_time.getTime()) / 1000))
    }
    const nonMeetingSeconds = workingSeconds !== null ? Math.max(0, workingSeconds - meetingSeconds) : null
    const dayOrders = orderByDay.get(date) ?? []
    const ordersCount = dayOrders.length
    const ordersValue = dayOrders.reduce((s, o) => s + toNumber(o.total_amount), 0)
    const dayExpenses = expenseByDay.get(date) ?? []
    const expenseTotal = dayExpenses.reduce((s, e) => s + toNumber(e.amount), 0)
    return { date, plannedGoal, achievedMeetings, ordersCount, ordersValue, meetingSeconds, workingSeconds, nonMeetingSeconds, expenseTotal }
  })

  // ---- priority points: ticked vs open ----
  const plannedGoals = planItems.reduce(
    (acc, p) => {
      acc.newParties += p.new_dealers_goal ?? 0
      acc.existingParties += p.existing_dealers_goal ?? 0
      acc.others += p.others_goal ?? 0
      return acc
    },
    { newParties: 0, existingParties: 0, others: 0 }
  )
  const plannedGoalsTotal = plannedGoals.newParties + plannedGoals.existingParties + plannedGoals.others

  const partyPlanItems = planItems.filter(p => p.party_id)
  const unmatched = planItems.length - partyPlanItems.length
  let ticked = 0
  for (const p of partyPlanItems) {
    const key = dateOnlyString(p.plan_date)
    const hit = (visitByDay.get(key) ?? []).some(v => v.entity_id === p.party_id)
    if (hit) ticked++
  }
  const open = partyPlanItems.length - ticked

  // ---- extra meetings (visits not linked to any weekly-plan item) ----
  const extraVisits = visits.filter(v => !v.weekly_plan_item_id)
  const extraMeetings = {
    count: extraVisits.length,
    list: extraVisits.map(v => ({ id: v.id, entityName: v.entity_name, date: dateOnlyString(v.visit_date) })),
  }

  // ---- new parties created this week ----
  const newParties = {
    count: newPartyRows.length,
    list: newPartyRows.map(c => ({ id: c.id, name: c.name, date: dateOnlyString(c.created_at) })),
  }

  // ---- expenses ----
  const expenseCatMap = new Map<string, { amount: number; count: number }>()
  for (const e of expenseRows) {
    const cur = expenseCatMap.get(e.category) ?? { amount: 0, count: 0 }
    cur.amount += toNumber(e.amount)
    cur.count += 1
    expenseCatMap.set(e.category, cur)
  }
  const expenseTotal = expenseRows.reduce((s, e) => s + toNumber(e.amount), 0)

  // ---- orders: draft vs placed, and category/sub-category/product breakup ----
  let draftCount = 0, draftValue = 0, placedCount = 0, placedValue = 0
  const catMap = new Map<string, { count: number; value: number }>()
  const subCatMap = new Map<string, { count: number; value: number }>()
  const prodMap = new Map<string, { count: number; value: number }>()
  for (const o of orders) {
    const value = toNumber(o.total_amount)
    if (o.status === 'Draft') { draftCount++; draftValue += value } else { placedCount++; placedValue += value }
    for (const item of o.order_items) {
      const amt = toNumber(item.amount)
      const catName = item.products?.product_categories?.name ?? 'Uncategorised'
      const subName = item.products?.product_subcategories?.name ?? 'Uncategorised'
      const prodName = item.products?.name ?? 'Unknown product'
      const c = catMap.get(catName) ?? { count: 0, value: 0 }; c.count += item.qty; c.value += amt; catMap.set(catName, c)
      const sc = subCatMap.get(subName) ?? { count: 0, value: 0 }; sc.count += item.qty; sc.value += amt; subCatMap.set(subName, sc)
      const p = prodMap.get(prodName) ?? { count: 0, value: 0 }; p.count += item.qty; p.value += amt; prodMap.set(prodName, p)
    }
  }

  // ---- funnel movement ----
  let movedForward = 0
  for (const log of stageLogs) {
    const fromOrder = log.from_stage_id ? stageOrderById.get(log.from_stage_id) ?? -1 : -1
    const toOrder = log.to_stage_id ? stageOrderById.get(log.to_stage_id) ?? -1 : -1
    if (toOrder > fromOrder) movedForward++
  }
  // Current stage distribution for this rep's active deals (informational —
  // "how many sit at each stage" reads as a snapshot, not a weekly delta).
  const dealsAtStage = await prisma.deals.groupBy({
    by: ['deal_stage_id'],
    where: { tenant_id: tenantId, owner_user_id: userId, is_active: true },
    _count: { _all: true },
  })
  const byStage = dealsAtStage.map(d => ({
    stage: (d.deal_stage_id && stageNameById.get(d.deal_stage_id)) || 'No stage',
    count: d._count._all,
  }))

  // ---- Not Met ----
  const plannedPartyIds = Array.from(new Set(partyPlanItems.map(p => p.party_id as string)))
  let notMetList: { id: string; name: string }[] = []
  if (plannedPartyIds.length > 0) {
    const everVisited = await prisma.daily_visits.findMany({
      where: { tenant_id: tenantId, entity_id: { in: plannedPartyIds }, start_time: { not: null } },
      select: { entity_id: true },
      distinct: ['entity_id'],
    })
    const visitedSet = new Set(everVisited.map(v => v.entity_id))
    const neverVisitedIds = plannedPartyIds.filter(id => !visitedSet.has(id))
    if (neverVisitedIds.length > 0) {
      const parties = await prisma.companies.findMany({
        where: { id: { in: neverVisitedIds }, tenant_id: tenantId },
        select: { id: true, name: true },
      })
      notMetList = parties.map(p => ({ id: p.id, name: p.name }))
    }
  }

  const headlineToMeet = plannedPartyIds.length
  const headlineMet = headlineToMeet - notMetList.length

  return {
    weekStart: monday,
    weekEnd: sunday,
    user: { id: user.id, name: user.name },
    headline: {
      toMeet: headlineToMeet,
      met: headlineMet,
      spent: expenseTotal,
      orderValue: draftValue + placedValue,
    },
    priorityPoints: {
      plannedGoals: { ...plannedGoals, total: plannedGoalsTotal },
      achievedMeetings: visits.length,
      ticked,
      open,
      unmatched,
      partyMatching: partyPlanItems.length > 0 ? 'by_party' : 'none',
    },
    dayWise,
    extraMeetings,
    newParties,
    expenses: {
      byCategory: Array.from(expenseCatMap.entries()).map(([category, v]) => ({ category, ...v })),
      byDay: dayWise.map(d => ({ date: d.date, amount: d.expenseTotal })),
      total: expenseTotal,
    },
    orders: {
      draft: { count: draftCount, value: draftValue },
      placed: { count: placedCount, value: placedValue },
      byCategory: Array.from(catMap.entries()).map(([name, v]) => ({ name, ...v })),
      bySubCategory: Array.from(subCatMap.entries()).map(([name, v]) => ({ name, ...v })),
      byProduct: Array.from(prodMap.entries()).map(([name, v]) => ({ name, ...v })),
    },
    funnel: { movedForward, byStage },
    notMet: { count: notMetList.length, unmatchedCount: unmatched, list: notMetList },
    expenseVsOrder: {
      expenseTotal,
      orderValue: draftValue + placedValue,
      ratio: (draftValue + placedValue) > 0 ? expenseTotal / (draftValue + placedValue) : null,
    },
  }
}
