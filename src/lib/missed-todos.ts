import { prisma } from './db'
import { businessDate, businessDaysAgo, recentBusinessDays } from './business-date'
import { listCouldntMeet, partiesWithRepeatedCouldntMeetForUsers } from './todo-outcomes'

/**
 * The single "Missed" rule, shared by the rep's own Daily Activity screen
 * (§ Missed section) and the manager's per-person counts (Home dashboard /
 * Team Summary). An item — a plan line, an Opportunity follow-up, or an
 * account's own next-meeting date — is MISSED once its own day has passed
 * and nobody started a meeting for it (or, for a follow-up / next-meeting,
 * moved it to a later date).
 *
 * Resolution, per kind:
 *  - Opportunity follow-up: `status !== 'not_done'` (done or otherwise
 *    closed) OR `visit_id` set (started) OR `due_date` moved forward of the
 *    date we are checking against (Move) — all three are visible on the row
 *    itself, so no extra bookkeeping is needed.
 *  - Account next-meeting: resolved once the account has ANY visit on or
 *    after the original due date (Start), or once `next_follow_up_date`
 *    itself has moved past the date we are checking (Move) — same "visit
 *    exists with this entity_id" rule the to-do route already uses to hide
 *    a same-day card once met.
 *  - Approved plan line: Move is never offered for these, and starting one
 *    late deliberately does NOT re-link the old line (it creates a plain
 *    meeting with the party instead — see POST /api/daily-activity). So a
 *    plan line resolves once the caller has ANY visit, on or after the
 *    plan's own date, with that line's party as the entity — the same
 *    "met this account" signal a late Start naturally produces, not a new
 *    column.
 *
 * This file does the database-aware counting; the two UI surfaces call it
 * with different `(userIds, from, to)` windows.
 */

const MISSED_WINDOW_BUSINESS_DAYS = 7

export type MissedTodo = {
  kind: 'plan' | 'followup' | 'next-meeting'
  id: string
  user_id: string
  /** For `kind: 'followup'` only — the Opportunity this follow-up belongs
   *  to. Move's PATCH route is nested under it (`/api/deals/[id]/follow-ups/[fid]`). */
  deal_id: string | null
  party_id: string | null
  party_name: string
  /** The party's own `companies.type`, for Start to file the meeting the
   *  same way a same-day card would. Null for a plan line (Start never
   *  creates a visit_type-typed row for one — see the module comment). */
  visit_type: string | null
  original_date: string
  label: string
}

/**
 * Missed items for `userIds`, due strictly between `fromDate` and `toDate`
 * (inclusive on both ends), as of `asOf` ("today" for the caller viewing
 * them). Dates are `"YYYY-MM-DD"`.
 */
export async function listMissedTodos(
  tenantId: string,
  userIds: string[],
  fromDate: string,
  toDate: string,
  asOf: string = businessDate()
): Promise<MissedTodo[]> {
  if (userIds.length === 0) return []
  const range = { gte: new Date(fromDate), lte: new Date(toDate) }
  const out: MissedTodo[] = []

  // ---- Plan lines ----------------------------------------------------
  // `weekly_plan_items` carries no `party_name` column — only `party_id`
  // (a bare uuid, resolved against `companies` below) — the same shape
  // `/api/daily-activity/plan` already resolves against.
  const planItems = await prisma.weekly_plan_items.findMany({
    where: {
      tenant_id: tenantId,
      plan_date: { ...range, lt: new Date(asOf) },
      party_id: { not: null },
      weekly_plans: { tenant_id: tenantId, user_id: { in: userIds }, status: 'Approved' },
    },
    select: {
      id: true, plan_date: true, party_id: true,
      weekly_plans: { select: { user_id: true } },
    },
  })
  if (planItems.length) {
    const partyIds = planItems.map(p => p.party_id!).filter(Boolean)
    const [parties, metPairs] = await Promise.all([
      prisma.companies.findMany({
        where: { tenant_id: tenantId, id: { in: partyIds } },
        select: { id: true, name: true },
      }),
      prisma.daily_visits.findMany({
        where: { tenant_id: tenantId, user_id: { in: userIds }, entity_id: { in: partyIds } },
        select: { user_id: true, entity_id: true, visit_date: true },
      }),
    ])
    const partyName = new Map(parties.map(p => [p.id, p.name]))
    for (const p of planItems) {
      const planDate = p.plan_date.toISOString().slice(0, 10)
      const resolved = metPairs.some(
        v => v.user_id === p.weekly_plans.user_id && v.entity_id === p.party_id &&
          v.visit_date.toISOString().slice(0, 10) >= planDate
      )
      if (resolved) continue
      const name = partyName.get(p.party_id!) ?? 'Unnamed'
      out.push({
        kind: 'plan', id: p.id, user_id: p.weekly_plans.user_id, deal_id: null,
        party_id: p.party_id, party_name: name, visit_type: null,
        original_date: planDate, label: `Planned visit: ${name}`,
      })
    }
  }

  // ---- Opportunity follow-ups -----------------------------------------
  const followUps = await prisma.deal_follow_ups.findMany({
    where: {
      tenant_id: tenantId,
      status: 'not_done',
      visit_id: null,
      due_date: { ...range, lt: new Date(asOf) },
      deals: { tenant_id: tenantId, owner_user_id: { in: userIds } },
    },
    select: {
      id: true, due_date: true, notes: true, deal_id: true,
      deals: { select: { owner_user_id: true, name: true, company_id: true, companies: { select: { name: true, type: true } } } },
    },
  })
  for (const f of followUps) {
    out.push({
      kind: 'followup', id: f.id, user_id: f.deals.owner_user_id!,
      deal_id: f.deal_id,
      party_id: f.deals.company_id,
      party_name: f.deals.companies?.name || f.deals.name,
      visit_type: f.deals.companies?.type ?? null,
      original_date: f.due_date.toISOString().slice(0, 10),
      label: `Follow-up: ${f.notes || f.deals.name}`,
    })
  }

  // ---- Accounts' next-meeting date ------------------------------------
  const nextMeetings = await prisma.companies.findMany({
    where: {
      tenant_id: tenantId,
      owner_user_id: { in: userIds },
      is_active: true,
      next_follow_up_date: { ...range, lt: new Date(asOf) },
    },
    select: { id: true, name: true, type: true, next_follow_up_date: true, owner_user_id: true },
  })
  if (nextMeetings.length) {
    const visits = await prisma.daily_visits.findMany({
      where: {
        tenant_id: tenantId,
        user_id: { in: userIds },
        entity_id: { in: nextMeetings.map(c => c.id) },
      },
      select: { user_id: true, entity_id: true, visit_date: true },
    })
    for (const c of nextMeetings) {
      const dueDate = c.next_follow_up_date!.toISOString().slice(0, 10)
      const resolved = visits.some(
        v => v.user_id === c.owner_user_id && v.entity_id === c.id &&
          v.visit_date.toISOString().slice(0, 10) >= dueDate
      )
      if (resolved) continue
      out.push({
        kind: 'next-meeting', id: c.id, user_id: c.owner_user_id!, deal_id: null,
        party_id: c.id, party_name: c.name, visit_type: c.type || null,
        original_date: dueDate, label: `Next meeting: ${c.name}`,
      })
    }
  }

  return out
}

/**
 * The rep's own Missed section: items due in the last
 * `MISSED_WINDOW_BUSINESS_DAYS` business days (older ones simply stop
 * showing — they are not escalated or specially marked, per spec).
 */
export async function listMissedTodosForRep(
  tenantId: string,
  userId: string,
  asOf: string = businessDate()
): Promise<MissedTodo[]> {
  const window = recentBusinessDays(asOf, MISSED_WINDOW_BUSINESS_DAYS)
  const oldest = window[window.length - 1]
  const newest = window[0]
  const items = await listMissedTodos(tenantId, [userId], oldest, newest, asOf)
  return items.filter(i => businessDaysAgo(i.original_date, asOf) <= MISSED_WINDOW_BUSINESS_DAYS)
}

/**
 * Manager counts: how many to-dos were due in the business week
 * `[weekStart, weekEnd]` and never started or moved, per user id. Returns a
 * map so a caller merges it into whatever row shape it already has.
 */
export async function countMissedByUser(
  tenantId: string,
  userIds: string[],
  weekStart: string,
  weekEnd: string
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (userIds.length === 0) return counts
  // asOf = the day after the week ends, so an item due on the week's own last
  // day (which may still be "today" while the week is in progress) counts as
  // missed only once its own day has actually passed.
  const items = await listMissedTodos(tenantId, userIds, weekStart, weekEnd, businessDate())
  for (const item of items) counts.set(item.user_id, (counts.get(item.user_id) ?? 0) + 1)
  return counts
}

export type OutcomeCounts = { met: number; metLate: number; couldntMeet: number; missed: number }

/**
 * Every to-do's end state (Met / Met late / Couldn't meet / Missed),
 * per user, for to-dos due in `[weekStart, weekEnd]`.
 *
 *  - Met / Met late: the same resolution signal `listMissedTodos` already
 *    uses (a visit against the item's party, on or after the item's own
 *    date) — "on time" when it is on the item's own day, "late" otherwise.
 *  - Couldn't meet: a `todo_outcomes` row for that exact item (empty when
 *    the table isn't pushed yet — see src/lib/todo-outcomes.ts — so every
 *    tenant without it simply shows zero here, not an error).
 *  - Missed: resolved as neither of the above, and more than
 *    `MISSED_WINDOW_BUSINESS_DAYS` business days have passed since the
 *    item's own day (or, for a week still in progress, still unresolved
 *    as of today).
 *
 * This re-derives the same three sources `listMissedTodos` reads (plan
 * lines, follow-ups, next-meetings) rather than calling it, because that
 * function only returns the UNRESOLVED ones — Met/Met late need the
 * resolution date, not just "resolved or not".
 */
export async function countOutcomesByUser(
  tenantId: string,
  userIds: string[],
  weekStart: string,
  weekEnd: string,
  asOf: string = businessDate()
): Promise<Map<string, OutcomeCounts>> {
  const out = new Map<string, OutcomeCounts>()
  if (userIds.length === 0) return out
  const get = (uid: string) => {
    let c = out.get(uid)
    if (!c) { c = { met: 0, metLate: 0, couldntMeet: 0, missed: 0 }; out.set(uid, c) }
    return c
  }

  const range = { gte: new Date(weekStart), lte: new Date(weekEnd) }
  const couldntMeetRows = await listCouldntMeet(tenantId, userIds, weekStart, weekEnd)
  const couldntMeetKey = (kind: string, ref: string) => `${kind}:${ref}`
  const couldntMeetSet = new Set(
    couldntMeetRows.map(r => couldntMeetKey(r.todo_kind === 'next_meeting' ? 'next-meeting' : r.todo_kind, r.todo_ref))
  )

  type Candidate = { user_id: string; kind: string; ref: string; original_date: string; party_id: string | null }
  const candidates: Candidate[] = []

  const planItems = await prisma.weekly_plan_items.findMany({
    where: {
      tenant_id: tenantId, plan_date: range, party_id: { not: null },
      weekly_plans: { tenant_id: tenantId, user_id: { in: userIds }, status: 'Approved' },
    },
    select: { id: true, plan_date: true, party_id: true, weekly_plans: { select: { user_id: true } } },
  })
  for (const p of planItems) {
    candidates.push({
      user_id: p.weekly_plans.user_id, kind: 'plan', ref: p.id,
      original_date: p.plan_date.toISOString().slice(0, 10), party_id: p.party_id,
    })
  }

  const followUps = await prisma.deal_follow_ups.findMany({
    where: { tenant_id: tenantId, due_date: range, deals: { tenant_id: tenantId, owner_user_id: { in: userIds } } },
    select: { id: true, due_date: true, deals: { select: { owner_user_id: true, company_id: true } } },
  })
  for (const f of followUps) {
    candidates.push({
      user_id: f.deals.owner_user_id!, kind: 'followup', ref: f.id,
      original_date: f.due_date.toISOString().slice(0, 10), party_id: f.deals.company_id,
    })
  }

  const nextMeetings = await prisma.companies.findMany({
    where: { tenant_id: tenantId, owner_user_id: { in: userIds }, next_follow_up_date: range },
    select: { id: true, owner_user_id: true, next_follow_up_date: true },
  })
  for (const c of nextMeetings) {
    candidates.push({
      user_id: c.owner_user_id!, kind: 'next-meeting', ref: c.id,
      original_date: c.next_follow_up_date!.toISOString().slice(0, 10), party_id: c.id,
    })
  }

  const partyIds = [...new Set(candidates.map(c => c.party_id).filter(Boolean) as string[])]
  const visits = partyIds.length
    ? await prisma.daily_visits.findMany({
        where: { tenant_id: tenantId, user_id: { in: userIds }, entity_id: { in: partyIds } },
        select: { user_id: true, entity_id: true, visit_date: true },
      })
    : []

  for (const cand of candidates) {
    const bucket = get(cand.user_id)
    const metVisit = cand.party_id
      ? visits
          .filter(v => v.user_id === cand.user_id && v.entity_id === cand.party_id &&
            v.visit_date.toISOString().slice(0, 10) >= cand.original_date)
          .sort((a, b) => a.visit_date.getTime() - b.visit_date.getTime())[0]
      : undefined
    if (metVisit) {
      const visitDate = metVisit.visit_date.toISOString().slice(0, 10)
      if (visitDate === cand.original_date) bucket.met++
      else bucket.metLate++
      continue
    }
    if (couldntMeetSet.has(couldntMeetKey(cand.kind, cand.ref))) {
      bucket.couldntMeet++
      continue
    }
    if (businessDaysAgo(cand.original_date, asOf) > MISSED_WINDOW_BUSINESS_DAYS || cand.original_date < asOf) {
      bucket.missed++
    }
  }

  return out
}

/** The manager-view "repeated couldn't-meet" flag: parties where a user has
 *  3+ couldn't-meet outcomes within the last 30 days. Chosen window: a
 *  rolling 30 days, so the flag reflects current behaviour rather than one
 *  that scrolls off a history the manager cannot see on this screen. */
export async function repeatedCouldntMeetFlags(
  tenantId: string,
  userIds: string[],
  asOf: string = businessDate()
): Promise<Map<string, { party_id: string; party_name: string | null }[]>> {
  const out = new Map<string, { party_id: string; party_name: string | null }[]>()
  if (userIds.length === 0) return out
  const since = new Date(asOf)
  since.setDate(since.getDate() - 30)
  const sinceStr = since.toISOString().slice(0, 10)
  const rows = await partiesWithRepeatedCouldntMeetForUsers(tenantId, userIds, sinceStr)
  for (const r of rows) {
    const list = out.get(r.user_id) ?? []
    list.push({ party_id: r.party_id, party_name: r.party_name })
    out.set(r.user_id, list)
  }
  return out
}
