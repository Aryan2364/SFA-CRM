import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { prisma, dateOnlyString } from '@/lib/db'
import { businessDate, businessDayStart } from '@/lib/business-date'
import { readCompanyNextMeetingTimes, readFollowUpTimes } from '@/lib/next-meeting-time'
import { notify } from '@/lib/notify'

export const dynamic = 'force-dynamic'

/**
 * POST /api/cron/follow-up-reminders - called every 5 minutes by the host's
 * crontab (DEPLOYMENT.md). Authenticated ONLY by `Authorization: Bearer
 * <CRON_SECRET>`; a session cookie is never accepted and CRON_SECRET unset
 * means 401 for everyone.
 *
 * Deliberately cross-tenant (it serves every firm in one pass, like the
 * SuperAdmin routes), but every insert carries the row's OWN tenant_id and
 * every id lookup is scoped by that row's tenant_id -
 * nothing here trusts a request value.
 *
 * Rule: an item with a time is due at that time in APP_TIMEZONE; a date-only
 * item is due at 09:00 that day. An item is sent when it became due within the
 * last LOOKBACK_MINUTES (and is not in the future).
 *
 * Exactly once: the notification row is the ledger. Its context_type encodes
 * the due moment (`follow_up_due@2026-10-21T09:00`), context_id is the
 * follow-up / account id, and a partial unique index on
 * (tenant_id, recipient_id, context_type, context_id) makes a second insert for
 * the same due moment fail with P2002, which notify() treats as "already sent".
 * A reschedule changes the due moment, so it correctly reminds again.
 */
const LOOKBACK_MINUTES = 30
const DATE_ONLY_DUE = '09:00'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  const given = header.startsWith('Bearer ') ? header.slice(7) : ''
  // Hash both sides so the compare is constant-time and length-independent.
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b)
}

/** The instant a due date + "HH:MM" (business timezone) falls on. */
function dueInstant(dateOnly: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(businessDayStart(dateOnly).getTime() + ((h || 0) * 60 + (m || 0)) * 60_000)
}

type Due = {
  tenantId: string; ownerId: string; kind: 'follow_up_due' | 'next_meeting_due'
  refId: string; dueKey: string; path: string; name: string
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const earliest = now.getTime() - LOOKBACK_MINUTES * 60_000
  const dates = Array.from(new Set([businessDate(new Date(now.getTime() - 86_400_000)), businessDate(now)]))
  const dateObjs = dates.map(d => new Date(d))

  /** The "HH:MM" it fell due at, when it became due inside the lookback window; else null. */
  const dueAt = (dateOnly: string, hhmm: string | null): string | null => {
    const at = hhmm ?? DATE_ONLY_DUE
    const t = dueInstant(dateOnly, at).getTime()
    return t <= now.getTime() && t > earliest ? at : null
  }

  const due: Due[] = []
  try {
    // Opportunity follow-ups: open, on an open opportunity with an active
    // owner, and not already turned into a visit.
    const followUps = await prisma.deal_follow_ups.findMany({
      where: {
        status: 'not_done', visit_id: null, due_date: { in: dateObjs },
        deals: { closed_at: null, owner_user_id: { not: null }, users: { status: { not: 'Inactive' } } },
      },
      select: {
        id: true, tenant_id: true, due_date: true,
        deals: { select: { id: true, tenant_id: true, name: true, owner_user_id: true } },
      },
    })
    const fuByTenant = new Map<string, string[]>()
    for (const f of followUps) fuByTenant.set(f.tenant_id, [...(fuByTenant.get(f.tenant_id) ?? []), f.id])
    const fuTimes = new Map<string, string | null>()
    for (const [tid, ids] of Array.from(fuByTenant)) {
      const m = await readFollowUpTimes(tid, ids) // null when the time column is not there yet
      for (const id of ids) fuTimes.set(id, m?.get(id) ?? null)
    }
    for (const f of followUps) {
      if (f.deals.tenant_id !== f.tenant_id || !f.deals.owner_user_id) continue
      const date = dateOnlyString(f.due_date)
      const at = date ? dueAt(date, fuTimes.get(f.id) ?? null) : null
      if (!date || !at) continue
      due.push({
        tenantId: f.tenant_id, ownerId: f.deals.owner_user_id, kind: 'follow_up_due',
        refId: f.id, dueKey: `${date}T${at}`, path: `/deals/${f.deals.id}`, name: f.deals.name,
      })
    }

    // Accounts' next meeting: active account with an active owner, and no
    // meeting with it logged by that owner on the day.
    const accounts = await prisma.companies.findMany({
      where: {
        is_active: true, owner_user_id: { not: null }, next_follow_up_date: { in: dateObjs },
        users_companies_owner_user_idTousers: { status: { not: 'Inactive' } },
      },
      select: { id: true, tenant_id: true, name: true, owner_user_id: true, next_follow_up_date: true },
    })
    const acByTenant = new Map<string, string[]>()
    for (const c of accounts) acByTenant.set(c.tenant_id, [...(acByTenant.get(c.tenant_id) ?? []), c.id])
    const acTimes = new Map<string, string | null>()
    const met = new Set<string>()
    for (const [tid, ids] of Array.from(acByTenant)) {
      const m = await readCompanyNextMeetingTimes(tid, ids)
      for (const id of ids) acTimes.set(id, m?.get(id) ?? null)
      const visits = await prisma.daily_visits.findMany({
        where: { tenant_id: tid, entity_id: { in: ids }, visit_date: { in: dateObjs } },
        select: { entity_id: true, user_id: true, visit_date: true },
      })
      for (const v of visits) met.add(`${v.entity_id}|${v.user_id}|${dateOnlyString(v.visit_date)}`)
    }
    for (const c of accounts) {
      if (!c.owner_user_id) continue
      const date = c.next_follow_up_date ? dateOnlyString(c.next_follow_up_date) : null
      if (!date || met.has(`${c.id}|${c.owner_user_id}|${date}`)) continue
      const at = dueAt(date, acTimes.get(c.id) ?? null)
      if (!at) continue
      due.push({
        tenantId: c.tenant_id, ownerId: c.owner_user_id, kind: 'next_meeting_due',
        refId: c.id, dueKey: `${date}T${at}`, path: `/parties/companies/${c.id}`, name: c.name,
      })
    }
  } catch (err) {
    console.error('[cron] follow-up reminders: query failed', err)
    return NextResponse.json({ error: 'Could not read follow-ups' }, { status: 500 })
  }

  let sent = 0
  for (const d of due) {
    const isFollowUp = d.kind === 'follow_up_due'
    const ok = await notify({
      row: {
        tenant_id: d.tenantId, recipient_id: d.ownerId, actor_id: null,
        section: isFollowUp ? 'follow_up' : 'next_meeting',
        context_type: `${d.kind}@${d.dueKey}`, context_id: d.refId,
        redirect_path: d.path,
        message: isFollowUp ? `Follow-up due: ${d.name}` : `Meeting due: ${d.name}`,
      },
      push: {
        title: isFollowUp ? 'Follow-up due' : 'Meeting due',
        // No names or notes on the lock screen.
        body: isFollowUp ? 'You have a follow-up due now' : 'You have a meeting due now',
        tag: `${d.kind}-${d.refId}`,
      },
    })
    if (ok) sent++
  }
  return NextResponse.json({ sent })
}
