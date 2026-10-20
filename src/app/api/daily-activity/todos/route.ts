import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { listMissedTodosForRep } from '@/lib/missed-todos'
import { businessDate } from '@/lib/business-date'
import { readFollowUpTimes, readCompanyNextMeetingTimes } from '@/lib/next-meeting-time'

export const dynamic = 'force-dynamic'

/**
 * Daily Activity's two NEW to-do sources, besides the approved weekly-plan
 * lines `/api/daily-activity/plan` already answers:
 *
 *  b) Opportunity follow-ups (`deal_follow_ups`) due on the selected day, on
 *     Opportunities the caller OWNS. Follow-ups carry no assignee of their
 *     own — they belong to the deal, and the deal belongs to its
 *     `owner_user_id` — so this is a direct owner filter, never a scope
 *     widened by `role_permissions.data_scope` the way `/api/daily-activity`
 *     and `/api/daily-activity/plan` widen theirs. This is a personal
 *     to-do list: Self only, always.
 *  c) Accounts (`companies`) whose own `next_follow_up_date` falls on the
 *     selected day, on accounts the caller owns. Same Self-only rule.
 *
 * ONE route for both, not a third variant of `/plan`, because:
 *   - `/plan`'s permission is `weekly_plan:view` and its scope logic is
 *     deliberately untouched (it backs an already-shipped screen); bolting
 *     an unrelated `deals:view` check and an owner-only query onto it would
 *     make one route answer two different authorisation stories.
 *   - b) and c) share the same gate (`meetings:view`, because both are
 *     "things to do today" cards on the meetings list) and the same
 *     Self-only shape, so one new route is less duplication than two.
 *
 * Permission is read PER SECTION and a caller missing it gets that section
 * back empty, not a 403 — the page still has planned lines and logged
 * meetings to show, and a to-do source the caller cannot see is the same as
 * a to-do source that has nothing due, not an error.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  if (!user.userId) return NextResponse.json({ followups: [], nextMeetings: [] })

  const date = req.nextUrl.searchParams.get('date')
  // §41.5/§41.15: the phone Activity screen's "Upcoming" chip ignores the
  // selected day and shows every future item, soonest first — so `date` is
  // not required in this mode, and the comparisons below switch from "on
  // this day" to "today or later".
  const upcoming = req.nextUrl.searchParams.get('upcoming') === '1'
  if (!date && !upcoming) return NextResponse.json({ error: 'date is required' }, { status: 400 })
  const tid = getTenantId()
  const todayStr = businessDate()
  const day = date ? new Date(date) : new Date(todayStr)

  try {
    // The caller's own visits for the day, used by BOTH sections below to
    // decide whether a card has already been acted on. One query, reused,
    // rather than two near-identical ones. Skipped in `upcoming` mode, which
    // spans many days — "already met" there is left to the record itself.
    const dayVisits = upcoming
      ? []
      : await prisma.daily_visits.findMany({
          where: { tenant_id: tid, user_id: user.userId, visit_date: day },
          select: { id: true, entity_id: true },
        })

    // ---- b) Opportunity follow-ups --------------------------------------
    let followups: Record<string, unknown>[] = []
    if (await checkPermission(user, 'deals', 'view')) {
      const rows = await prisma.deal_follow_ups.findMany({
        where: {
          tenant_id: tid,
          status: 'not_done',
          due_date: upcoming ? { gte: new Date(todayStr) } : day,
          deals: { tenant_id: tid, owner_user_id: user.userId },
        },
        ...(upcoming ? { take: 25 } : {}),
        include: {
          deals: {
            select: {
              id: true, name: true, company_id: true,
              companies: { select: { id: true, name: true, type: true } },
            },
          },
        },
        orderBy: { created_at: 'asc' },
      })
      // A follow-up already turned into today's visit (`visit_id` set AND
      // that visit exists for the selected day) is done, not due. `visit_id`
      // is a plain uuid with no FK, so "exists for the day" is checked
      // against the same-day visit set above rather than trusted blindly —
      // a stale `visit_id` from a day that got edited away must not hide a
      // follow-up that is genuinely still open.
      const visitIds = new Set(dayVisits.map(v => v.id))
      const open = rows.filter(r => !(r.visit_id && visitIds.has(r.visit_id)))
      const serialized = serialize(open, 'deal_follow_ups') as Record<string, unknown>[]
      const times = await readFollowUpTimes(tid, open.map(r => r.id))
      followups = serialized.map((r, i) => ({
        ...r,
        due_time: times?.get(open[i].id) ?? null,
        deal_name: open[i].deals.name,
        company_id: open[i].deals.company_id,
        company_name: open[i].deals.companies?.name ?? null,
        company_visit_type: open[i].deals.companies?.type ?? null,
      }))
    }

    // ---- c) Accounts' next follow-up date -------------------------------
    const companies = await prisma.companies.findMany({
      where: {
        tenant_id: tid,
        owner_user_id: user.userId,
        is_active: true,
        next_follow_up_date: upcoming ? { gte: new Date(todayStr) } : day,
      },
      select: { id: true, name: true, type: true, next_follow_up_date: true },
      orderBy: { name: 'asc' },
      ...(upcoming ? { take: 25 } : {}),
    })
    // Hidden once the caller already has ANY meeting that day with that
    // account — no linking is required for this one (unlike b), there is no
    // deal to attach it to), so "a visit exists with this entity_id" is the
    // whole rule.
    const metEntityIds = new Set(dayVisits.map(v => v.entity_id).filter(Boolean) as string[])
    const openCompanies = companies.filter(c => !metEntityIds.has(c.id))
    const companyTimes = await readCompanyNextMeetingTimes(tid, openCompanies.map(c => c.id))
    const nextMeetings = (serialize(openCompanies, 'companies') as Record<string, unknown>[]).map((r, i) => ({
      ...r,
      next_follow_up_time: companyTimes?.get(openCompanies[i].id) ?? null,
    }))

    // Same-day cards sort by time, no-time ones after timed ones. In
    // `upcoming` mode the date sorts first (soonest day first), then time.
    const byTime = (a: { due_time?: unknown }, b: { due_time?: unknown }) => {
      const ta = typeof a.due_time === 'string' ? a.due_time : null
      const tb = typeof b.due_time === 'string' ? b.due_time : null
      if (ta === tb) return 0
      if (ta === null) return 1
      if (tb === null) return -1
      return ta < tb ? -1 : 1
    }
    const byDateThenTime = (
      a: { due_date?: unknown; due_time?: unknown },
      b: { due_date?: unknown; due_time?: unknown }
    ) => {
      const da = typeof a.due_date === 'string' ? a.due_date.slice(0, 10) : ''
      const db = typeof b.due_date === 'string' ? b.due_date.slice(0, 10) : ''
      if (da !== db) return da < db ? -1 : 1
      return byTime(a, b)
    }
    if (upcoming) {
      followups.sort(byDateThenTime as (a: Record<string, unknown>, b: Record<string, unknown>) => number)
      nextMeetings.sort((a, b) => byDateThenTime(
        { due_date: (a as Record<string, unknown>).next_follow_up_date, due_time: a.next_follow_up_time },
        { due_date: (b as Record<string, unknown>).next_follow_up_date, due_time: b.next_follow_up_time }
      ))
    } else {
      followups.sort(byTime)
      nextMeetings.sort((a, b) => byTime(
        { due_time: a.next_follow_up_time },
        { due_time: b.next_follow_up_time }
      ))
    }

    // ---- Missed (last 7 business days, not started or moved) -----------
    // One entry per underlying item; the client groups same-account items
    // into one card (merge, per spec) since it already does that for the
    // same-day sources above.
    const missedRaw = await listMissedTodosForRep(tid, user.userId, businessDate())
    const missed = missedRaw.map(m => ({
      kind: m.kind, id: m.id, deal_id: m.deal_id, party_id: m.party_id, party_name: m.party_name,
      visit_type: m.visit_type, original_date: m.original_date, label: m.label,
    }))

    return NextResponse.json({ followups, nextMeetings, missed })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
