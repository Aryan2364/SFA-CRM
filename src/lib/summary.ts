import { prisma, dateOnlyString } from './db'

/**
 * The Daily Summary sheet — REBUILD-PLAN.md §6.1, P4-T3.
 *
 * One day, one user: what was planned against what happened, where the time
 * went, what it cost and what it brought in.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS §6.1 EXPLICITLY EXCLUDES. Do not add them here.
 *
 *  1. **Travelling Time is not calculated.** Dropped in §12, closed. There is
 *     no field for it below and there should not be one.
 *  2. **No expense-to-order-value ratio.** §6.1: on a normal prospecting day
 *     that ratio looks terrible and showing it daily demoralises the rep. Both
 *     numbers are here; the ratio belongs in the Weekly Review and nowhere else.
 *  3. Nothing that assumes a Meeting exists — §5.6, a meeting is not
 *     compulsory. Every meeting-derived figure has a zero or null form.
 *
 * ---------------------------------------------------------------------------
 * TIME ARITHMETIC AND THE 5h30m SKEW
 *
 * This is the first feature that subtracts timestamps at scale, so it is the
 * first that can be silently wrong about them. The rule established while
 * building auto check-out: the app's own write/read round-trip through Prisma
 * is self-consistent, and the 5h30m discrepancy appears only when a value
 * crosses between psql and the app. Everything below therefore works from
 * values Prisma read, and never from a hand-written SQL literal.
 *
 * `duration_secs` is the safest number in the whole sheet: it is an integer the
 * stop handler computed, not a difference taken here. Working hours ARE a
 * difference (`check_out_time - check_in_time`), which is why they are the one
 * figure that can come back null.
 *
 * ---------------------------------------------------------------------------
 * "UNKNOWN" IS A VALUE, NOT ZERO
 *
 * A rep with meetings but no attendance row has no working hours, so
 * Non-Meeting Time is UNKNOWN. Reporting it as zero would say "this person was
 * in meetings every minute they worked", which is a claim the data does not
 * support. Those fields are `number | null`, and the null carries a reason for
 * the screen to print.
 */

/** Use this wording. Never "Idle Time" — §6.1 is explicit. */
export const NON_MEETING_TIME_LABEL = 'Non-Meeting Time'

export type CategoryTotal = { category: string; amount: number; count: number }

export type DailySummary = {
  /** "YYYY-MM-DD". */
  date: string
  user: { id: string; name: string }

  plan: {
    /** Null when the day has no weekly-plan item at all. */
    goals: { newParties: number; existingParties: number; others: number; total: number } | null
    route: { from: string | null; to: string | null } | null
    notes: string | null
    /** Actual meetings held, for the plan-vs-actual line. */
    actualMeetings: number
    /**
     * Planned parties that got no meeting, and meetings held against parties
     * that were not planned. Both are `null` when the plan carries no
     * `party_id` — see `partyMatching` below.
     */
    missedParties: { id: string; name: string }[] | null
    extraParties: { id: string | null; name: string }[] | null
    /**
     * Whether "what was missed / what extra was done" could be answered by
     * PARTY at all. `weekly_plan_items.party_id` is nullable and is null for
     * every migrated and seeded plan, in which case the only honest comparison
     * is counts — so the screen must say that rather than print an empty
     * "nothing missed", which would read as a clean day.
     */
    partyMatching: 'by_party' | 'counts_only'
  }

  meetings: {
    total: number
    /** §6.1 wants the count of meetings entered as Past Meetings. */
    manualEntryCount: number
    systemCapturedCount: number
    /** Total meeting time, split the two ways §6.1 asks for. */
    systemCapturedSeconds: number
    manualEntrySeconds: number
    totalSeconds: number
    /** Meetings with no `duration_secs` — excluded from the sums above. */
    withoutDuration: number
    /** P3-T8's flag. Display only; no action follows from it. */
    locationFlaggedCount: number
    /** Distinct places, in first-seen order. */
    locationsCovered: string[]
  }

  workingTime: {
    checkIn: string | null
    checkOut: string | null
    /** Null when there is no attendance row, or it is still open. */
    workingSeconds: number | null
    meetingSeconds: number
    /** Null whenever `workingSeconds` is. Never negative — see the note. */
    nonMeetingSeconds: number | null
    /** Why the figure is missing or clamped. Null when it is simply correct. */
    note: string | null
  }

  expenses: { total: number; count: number; byCategory: CategoryTotal[] }

  /** Order value brought. No ratio against expenses — see the header. */
  orders: { count: number; totalValue: number; byStatus: { status: string; count: number; value: number }[] }

  deals: {
    stagesMoved: number
    won: number
    lost: number
    movements: { dealId: string; dealName: string; fromStage: string | null; toStage: string }[]
  }

  followUps: {
    dueToday: number
    notDone: { id: string; dealId: string; dealName: string; mode: string; notes: string | null }[]
  }

  /** The short strip at the bottom. */
  nextDay: {
    date: string
    goals: { newParties: number; existingParties: number; others: number; total: number } | null
    route: { from: string | null; to: string | null } | null
    notes: string | null
  }
}

/** Midnight UTC for a "YYYY-MM-DD", which is how @db.Date columns compare. */
function dayStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/** The day after `date`, as "YYYY-MM-DD". */
function nextDayOf(date: string): string {
  return dateOnlyString(new Date(dayStart(date).getTime() + 24 * 60 * 60 * 1000))
}

/** Decimal | null -> number. A Decimal left alone JSON-stringifies to a string. */
function toNumber(value: { toNumber(): number } | null | undefined): number {
  return value ? value.toNumber() : 0
}

export async function buildDailySummary(
  tenantId: string,
  userId: string,
  date: string
): Promise<DailySummary> {
  const day = dayStart(date)
  const tomorrow = nextDayOf(date)

  // deal_stage_logs.changed_at is a timestamptz, so it needs a half-open range
  // rather than an equality on a date.
  const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000)

  const [user, visits, attendance, expenseRows, orderRows, planItem, nextPlanItem, stageLogs, closedDeals, followUps] =
    await Promise.all([
      prisma.users.findFirst({
        where: { id: userId, tenant_id: tenantId },
        select: { id: true, name: true },
      }),
      prisma.daily_visits.findMany({
        where: { tenant_id: tenantId, user_id: userId, visit_date: day },
        select: {
          id: true, entity_id: true, entity_name: true, address: true,
          latitude: true, longitude: true,
          duration_secs: true, is_manual_entry: true, location_flagged: true,
          start_time: true,
        },
        orderBy: { start_time: 'asc' },
      }),
      prisma.attendance.findFirst({
        where: { tenant_id: tenantId, user_id: userId, date: day },
        select: { check_in_time: true, check_out_time: true },
      }),
      prisma.expenses.findMany({
        where: { tenant_id: tenantId, user_id: userId, expense_date: day },
        select: { amount: true, category: true },
      }),
      prisma.orders.findMany({
        where: { tenant_id: tenantId, user_id: userId, order_date: day },
        select: { total_amount: true, status: true },
      }),
      prisma.weekly_plan_items.findFirst({
        where: { tenant_id: tenantId, plan_date: day, weekly_plans: { user_id: userId } },
        select: {
          from_place: true, to_place: true, notes: true, party_id: true,
          new_dealers_goal: true, existing_dealers_goal: true, others_goal: true,
        },
      }),
      prisma.weekly_plan_items.findFirst({
        where: { tenant_id: tenantId, plan_date: dayStart(tomorrow), weekly_plans: { user_id: userId } },
        select: {
          from_place: true, to_place: true, notes: true,
          new_dealers_goal: true, existing_dealers_goal: true, others_goal: true,
        },
      }),
      prisma.deal_stage_logs.findMany({
        where: {
          tenant_id: tenantId,
          changed_by_user_id: userId,
          changed_at: { gte: day, lt: dayEnd },
        },
        select: { deal_id: true, from_stage_id: true, to_stage_id: true },
      }),
      prisma.deals.findMany({
        where: {
          tenant_id: tenantId,
          owner_user_id: userId,
          closed_at: { gte: day, lt: dayEnd },
          outcome: { in: ['won', 'lost'] },
        },
        select: { outcome: true },
      }),
      prisma.deal_follow_ups.findMany({
        where: { tenant_id: tenantId, due_date: day, deals: { owner_user_id: userId } },
        select: {
          id: true, deal_id: true, mode: true, status: true, notes: true,
          deals: { select: { name: true } },
        },
      }),
    ])

  // ---- Meetings -----------------------------------------------------------
  let systemCapturedSeconds = 0
  let manualEntrySeconds = 0
  let systemCapturedCount = 0
  let manualEntryCount = 0
  let withoutDuration = 0
  let locationFlaggedCount = 0

  // A Set of place strings for de-duplication, plus an array to keep the order
  // they happened in — a Set alone would lose that.
  const seenPlaces = new Set<string>()
  const locationsCovered: string[] = []

  for (const v of visits) {
    if (v.is_manual_entry) manualEntryCount++
    else systemCapturedCount++

    if (v.duration_secs == null) withoutDuration++
    else if (v.is_manual_entry) manualEntrySeconds += v.duration_secs
    else systemCapturedSeconds += v.duration_secs

    if (v.location_flagged) locationFlaggedCount++

    // Prefer the human address; fall back to coordinates so a fix with no
    // reverse-geocode still counts as a place visited rather than vanishing.
    const place =
      v.address?.trim() ||
      (v.latitude != null && v.longitude != null
        ? `${v.latitude.toNumber()}, ${v.longitude.toNumber()}`
        : null)
    if (place && !seenPlaces.has(place)) {
      seenPlaces.add(place)
      locationsCovered.push(place)
    }
  }

  const meetingSeconds = systemCapturedSeconds + manualEntrySeconds

  // ---- Working time and Non-Meeting Time ----------------------------------
  let workingSeconds: number | null = null
  let nonMeetingSeconds: number | null = null
  let note: string | null = null

  if (!attendance) {
    note = 'No check-in recorded for this day, so working hours are unknown.'
  } else if (!attendance.check_in_time) {
    note = 'No check-in time recorded, so working hours are unknown.'
  } else if (!attendance.check_out_time) {
    note = 'Still checked in, so working hours are not final.'
  } else {
    workingSeconds = Math.round(
      (attendance.check_out_time.getTime() - attendance.check_in_time.getTime()) / 1000
    )
    const remainder = workingSeconds - meetingSeconds
    if (remainder < 0) {
      // Possible with manually-entered meetings that overlap or run outside the
      // recorded working window. Reporting a negative would be nonsense and
      // silently clamping without saying so would hide a real data problem.
      nonMeetingSeconds = 0
      note = 'Meeting time exceeds recorded working hours, so Non-Meeting Time is shown as zero.'
    } else {
      nonMeetingSeconds = remainder
    }
  }

  // ---- Expenses -----------------------------------------------------------
  const categoryMap = new Map<string, CategoryTotal>()
  let expenseTotal = 0
  for (const e of expenseRows) {
    const amount = toNumber(e.amount)
    expenseTotal += amount
    const key = e.category ?? 'Uncategorised'
    const row = categoryMap.get(key) ?? { category: key, amount: 0, count: 0 }
    row.amount += amount
    row.count += 1
    categoryMap.set(key, row)
  }
  const byCategory = [...categoryMap.values()].sort((a, b) => b.amount - a.amount)

  // ---- Orders -------------------------------------------------------------
  const statusMap = new Map<string, { status: string; count: number; value: number }>()
  let orderValue = 0
  for (const o of orderRows) {
    const value = toNumber(o.total_amount)
    orderValue += value
    const row = statusMap.get(o.status) ?? { status: o.status, count: 0, value: 0 }
    row.count += 1
    row.value += value
    statusMap.set(o.status, row)
  }

  // ---- Deals --------------------------------------------------------------
  const dealIds = [...new Set(stageLogs.map(l => l.deal_id))]
  const stageIds = [
    ...new Set(stageLogs.flatMap(l => [l.from_stage_id, l.to_stage_id]).filter((s): s is string => !!s)),
  ]
  const [dealNames, stageNames] = await Promise.all([
    dealIds.length
      ? prisma.deals.findMany({ where: { id: { in: dealIds }, tenant_id: tenantId }, select: { id: true, name: true } })
      : Promise.resolve([]),
    stageIds.length
      ? prisma.deal_stages.findMany({ where: { id: { in: stageIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ])
  const dealNameById = new Map(dealNames.map(d => [d.id, d.name]))
  const stageNameById = new Map(stageNames.map(s => [s.id, s.name]))

  const movements = stageLogs.map(l => ({
    dealId: l.deal_id,
    dealName: dealNameById.get(l.deal_id) ?? 'Unknown deal',
    fromStage: l.from_stage_id ? stageNameById.get(l.from_stage_id) ?? null : null,
    toStage: l.to_stage_id ? stageNameById.get(l.to_stage_id) ?? 'Unknown stage' : 'Unknown stage',
  }))

  // ---- Plan vs actual -----------------------------------------------------
  const goals = planItem
    ? {
        newParties: planItem.new_dealers_goal ?? 0,
        existingParties: planItem.existing_dealers_goal ?? 0,
        others: planItem.others_goal ?? 0,
        total: (planItem.new_dealers_goal ?? 0) + (planItem.existing_dealers_goal ?? 0) + (planItem.others_goal ?? 0),
      }
    : null

  /*
   * Per-party missed/extra needs the plan to name a party. `party_id` is
   * nullable and null for every seeded and migrated plan, so on that data the
   * only truthful comparison is counts. Returning empty arrays instead would
   * render as "nothing missed, nothing extra" — a clean day that was never
   * measured.
   */
  const partyMatching: 'by_party' | 'counts_only' = planItem?.party_id ? 'by_party' : 'counts_only'

  let missedParties: { id: string; name: string }[] | null = null
  let extraParties: { id: string | null; name: string }[] | null = null

  if (partyMatching === 'by_party' && planItem?.party_id) {
    const plannedIds = new Set<string>([planItem.party_id])
    const visitedIds = new Set(visits.map(v => v.entity_id).filter((id): id is string => !!id))

    const missedIds = [...plannedIds].filter(id => !visitedIds.has(id))
    const missedCompanies = missedIds.length
      ? await prisma.companies.findMany({
          where: { id: { in: missedIds }, tenant_id: tenantId },
          select: { id: true, name: true },
        })
      : []
    missedParties = missedCompanies.map(c => ({ id: c.id, name: c.name }))

    const extraSeen = new Set<string>()
    extraParties = []
    for (const v of visits) {
      if (v.entity_id && plannedIds.has(v.entity_id)) continue
      const key = v.entity_id ?? `name:${v.entity_name}`
      if (extraSeen.has(key)) continue
      extraSeen.add(key)
      extraParties.push({ id: v.entity_id, name: v.entity_name })
    }
  }

  return {
    date,
    user: { id: userId, name: user?.name ?? 'Unknown user' },
    plan: {
      goals,
      route: planItem ? { from: planItem.from_place, to: planItem.to_place } : null,
      notes: planItem?.notes ?? null,
      actualMeetings: visits.length,
      missedParties,
      extraParties,
      partyMatching,
    },
    meetings: {
      total: visits.length,
      manualEntryCount,
      systemCapturedCount,
      systemCapturedSeconds,
      manualEntrySeconds,
      totalSeconds: meetingSeconds,
      withoutDuration,
      locationFlaggedCount,
      locationsCovered,
    },
    workingTime: {
      checkIn: attendance?.check_in_time?.toISOString() ?? null,
      checkOut: attendance?.check_out_time?.toISOString() ?? null,
      workingSeconds,
      meetingSeconds,
      nonMeetingSeconds,
      note,
    },
    expenses: { total: expenseTotal, count: expenseRows.length, byCategory },
    orders: {
      count: orderRows.length,
      totalValue: orderValue,
      byStatus: [...statusMap.values()].sort((a, b) => b.value - a.value),
    },
    deals: {
      stagesMoved: stageLogs.length,
      won: closedDeals.filter(d => d.outcome === 'won').length,
      lost: closedDeals.filter(d => d.outcome === 'lost').length,
      movements,
    },
    followUps: {
      dueToday: followUps.length,
      notDone: followUps
        .filter(f => f.status !== 'done')
        .map(f => ({
          id: f.id,
          dealId: f.deal_id,
          dealName: f.deals?.name ?? 'Unknown deal',
          mode: f.mode,
          notes: f.notes,
        })),
    },
    nextDay: {
      date: tomorrow,
      goals: nextPlanItem
        ? {
            newParties: nextPlanItem.new_dealers_goal ?? 0,
            existingParties: nextPlanItem.existing_dealers_goal ?? 0,
            others: nextPlanItem.others_goal ?? 0,
            total:
              (nextPlanItem.new_dealers_goal ?? 0) +
              (nextPlanItem.existing_dealers_goal ?? 0) +
              (nextPlanItem.others_goal ?? 0),
          }
        : null,
      route: nextPlanItem ? { from: nextPlanItem.from_place, to: nextPlanItem.to_place } : null,
      notes: nextPlanItem?.notes ?? null,
    },
  }
}
