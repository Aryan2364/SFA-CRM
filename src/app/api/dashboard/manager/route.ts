import { NextRequest, NextResponse } from 'next/server'
import { prisma, dateOnlyString, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { getVisibleUserIds } from '@/lib/visibility'
import { checkPermission, PermSection } from '@/lib/permissions'
import { scopedUserIds } from '@/lib/scope'
import { addDays, businessDate } from '@/lib/business-date'
import { mondayOf } from '@/lib/weekly-review'
import { countMissedByUser, countOutcomesByUser, repeatedCouldntMeetFlags } from '@/lib/missed-todos'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  const tid = getTenantId()

  // Default: the Monday of the current BUSINESS week — the convention
  // `week_start_date` is written in. The server's local clock put it on the
  // previous week from 00:00 to 05:30 IST every Monday on a UTC host.
  const weekStart = req.nextUrl.searchParams.get('weekStart') ?? mondayOf(businessDate())
  const weekEnd = addDays(weekStart, 6)

  if (!user.userId) return NextResponse.json({ isManager: false })
  const subIds = await getVisibleUserIds(user.userId, tid)
  if (!subIds.length) return NextResponse.json({ isManager: false })

  try {
  // Active users only, the same population the Team Summary counts — an
  // inactive report would otherwise inflate "Team Members" and add an empty row.
  const subordinates = await prisma.users.findMany({
    where: { id: { in: subIds }, tenant_id: tid, status: 'Active' },
    select: { id: true, name: true },
  })

  if (subordinates.length === 0) {
    return NextResponse.json({ isManager: false })
  }

  const activeSubIds = subordinates.map(s => s.id)

  /*
   * Four sections, four independent gates. The visibility chain says who the
   * caller manages; it does not say they may read those people's plans,
   * meetings, orders or expenses. Each dataset is read only with `view` on its
   * own section, and only for the reports inside that section's data scope —
   * the same answer the section's own list gives. A section the caller may not
   * read contributes nothing rather than failing the whole dashboard.
   */
  const idsFor = async (section: PermSection): Promise<string[]> => {
    if (!await checkPermission(user, section, 'view')) return []
    const scoped = await scopedUserIds(user, section)
    return scoped ? activeSubIds.filter(id => scoped.includes(id)) : activeSubIds
  }
  const [planIds, visitIds, orderIds, expenseIds] = await Promise.all([
    idsFor('weekly_plan'), idsFor('meetings'), idsFor('orders'), idsFor('expenses'),
  ])
  // Sections whose data the caller cannot read for ANY of these reports —
  // denied outright, or scoped to their own rows. Their numbers below are
  // zeros that mean "unavailable", not "nothing happened"; this says which.
  const denied = ([
    ['weekly_plan', planIds], ['meetings', visitIds], ['orders', orderIds], ['expenses', expenseIds],
  ] as const).filter(([, ids]) => activeSubIds.length > 0 && ids.length === 0).map(([section]) => section)

  // Parallel data fetch for the week. All four date columns are @db.Date, so the
  // "YYYY-MM-DD" bounds become Date objects.
  const weekStartDate = new Date(weekStart)
  const weekEndDate = new Date(weekEnd)
  const [planRows, visitRows, orderRows, expenseRows] = await Promise.all([
    prisma.weekly_plans.findMany({
      where: { tenant_id: tid, week_start_date: weekStartDate, user_id: { in: planIds } },
      select: {
        id: true, user_id: true, status: true, submitted_at: true,
        reopen_requested: true, reopen_request_message: true, week_start_date: true,
      },
    }),
    prisma.daily_visits.findMany({
      where: { tenant_id: tid, user_id: { in: visitIds }, visit_date: { gte: weekStartDate, lte: weekEndDate } },
      select: { id: true, user_id: true, status: true, visit_date: true },
    }),
    prisma.orders.findMany({
      where: { tenant_id: tid, user_id: { in: orderIds }, order_date: { gte: weekStartDate, lte: weekEndDate } },
      select: { user_id: true, order_date: true, total_amount: true, status: true },
    }),
    prisma.expenses.findMany({
      where: { tenant_id: tid, user_id: { in: expenseIds }, expense_date: { gte: weekStartDate, lte: weekEndDate } },
      select: { user_id: true, expense_date: true, amount: true },
    }),
  ])

  // The per-day loops below compare these date columns against "YYYY-MM-DD"
  // STRINGS built by addDays(). The old client returned strings; Prisma returns
  // Date objects, and `date === Date` is always false — every daily cell would
  // silently read zero. Reduce them to date-only strings up front (PLAN.md 5.1).
  const plans = planRows.map(p => ({ ...p, week_start_date: dateOnlyString(p.week_start_date) }))
  const visits = visitRows.map(v => ({ ...v, visit_date: dateOnlyString(v.visit_date) }))
  const orders = orderRows.map(o => ({ ...o, order_date: dateOnlyString(o.order_date) }))
  const expenses = expenseRows.map(e => ({ ...e, expense_date: dateOnlyString(e.expense_date) }))

  // Plan stats
  const planStats = { approved: 0, submitted: 0, rejected: 0, draft: 0, onHold: 0, notSubmitted: 0 }
  const planByUserId: Record<string, typeof plans[0]> = {}
  for (const p of plans) {
    planByUserId[p.user_id] = p
    if (p.status === 'Approved') planStats.approved++
    else if (p.status === 'Submitted' || p.status === 'Resubmitted') planStats.submitted++
    else if (p.status === 'Rejected') planStats.rejected++
    else if (p.status === 'Draft' || p.status === 'Edited by Manager') planStats.draft++
    else if (p.status === 'On Hold') planStats.onHold++
  }
  // Over the reports whose plans the caller may read — not the whole team,
  // or a caller denied plans sees every report as "not submitted".
  planStats.notSubmitted = planIds.length - plans.length

  // Pending plans (submitted + reopen requests)
  const pendingPlans = plans
    .filter(p => ['Submitted', 'Resubmitted'].includes(p.status) || p.reopen_requested)
    .map(p => {
      const sub = subordinates.find(s => s.id === p.user_id)
      return {
        id: p.id,
        userId: p.user_id,
        userName: sub?.name ?? 'Unknown',
        weekStartDate: p.week_start_date,
        status: p.status,
        reopen_requested: p.reopen_requested,
        reopen_request_message: p.reopen_request_message,
      }
    })

  // Build per-member daily activity
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  // Missed to-dos for the week, gated the same way as the visits/plan/order
  // reads above: `visitIds` is already the subset of `activeSubIds` the
  // caller may see meetings for (checkPermission + scope on `meetings`), and
  // Missed is itself a "meetings" concept (a to-do that never became one).
  const missedByUser = await countMissedByUser(tid, visitIds, weekStart, weekEnd)
  // Outcome breakdown (Met / Met late / Couldn't meet / Missed) and the
  // repeated-"couldn't meet" flag, same gating as missedByUser above.
  const outcomesByUser = await countOutcomesByUser(tid, visitIds, weekStart, weekEnd)
  const repeatedFlags = await repeatedCouldntMeetFlags(tid, visitIds)

  const teamPerformance = subordinates.map(sub => {
    const plan = planByUserId[sub.id] ?? null

    const dailyActivity = weekDays.map(date => {
      const dayVisits = visits.filter(v => v.user_id === sub.id && v.visit_date === date)
      const dayOrders = orders.filter(o => o.user_id === sub.id && o.order_date === date)
      const dayExpenses = expenses.filter(e => e.user_id === sub.id && e.expense_date === date)
      return {
        date,
        meetingsCompleted: dayVisits.filter(v => v.status === 'Completed').length,
        meetingsTotal: dayVisits.length,
        orderValue: dayOrders.reduce((s, o) => s + Number(o.total_amount), 0),
        expenseAmount: dayExpenses.reduce((s, e) => s + Number(e.amount), 0),
      }
    })

    const weekTotals = dailyActivity.reduce(
      (acc, day) => ({
        meetingsCompleted: acc.meetingsCompleted + day.meetingsCompleted,
        meetingsTotal: acc.meetingsTotal + day.meetingsTotal,
        orderValue: acc.orderValue + day.orderValue,
        expenseAmount: acc.expenseAmount + day.expenseAmount,
      }),
      { meetingsCompleted: 0, meetingsTotal: 0, orderValue: 0, expenseAmount: 0 }
    )

    return {
      userId: sub.id,
      userName: sub.name,
      planStatus: plan?.status ?? null,
      planId: plan?.id ?? null,
      dailyActivity,
      weekTotals,
      // null, not 0, when the caller cannot see this person's meetings at
      // all — "unavailable" must not read as "nothing missed".
      missedCount: visitIds.includes(sub.id) ? (missedByUser.get(sub.id) ?? 0) : null,
      outcomeCounts: visitIds.includes(sub.id)
        ? (outcomesByUser.get(sub.id) ?? { met: 0, metLate: 0, couldntMeet: 0, missed: 0 })
        : null,
      // Parties (name may be null if deleted) this person has couldn't-met
      // 3+ times in the last 30 days — a small warning badge, not a count.
      repeatedCouldntMeet: visitIds.includes(sub.id) ? (repeatedFlags.get(sub.id) ?? []) : null,
    }
  })

  return NextResponse.json({
    isManager: true,
    weekStart,
    weekEnd,
    teamSize: subordinates.length,
    planStats,
    pendingPlans,
    teamPerformance,
    denied,
  })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
