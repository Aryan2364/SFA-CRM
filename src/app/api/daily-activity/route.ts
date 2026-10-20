import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { awardPoint, logAwardFailure } from '@/lib/points'
import { businessDate, businessDaysAgo } from '@/lib/business-date'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'
import { firstForeignTenantRef } from '@/lib/tenant-fk'
import { findScopedDeal } from '@/app/api/deals/_access'
import { findScopedContact } from '@/app/api/contacts/_access'
import {
  attachVisitContacts,
  readVisitContacts,
  resolveVisitContact,
  VISIT_SELECT,
  writeVisitContact,
} from '@/lib/visit-contact'
import { listAttendees, listAttendeesForVisits, pickMain, recordAttendees, type AttendeeInput } from '@/lib/meeting-attendees'

export const dynamic = 'force-dynamic'

/**
 * Links a newly-created visit back to the Opportunity follow-up that
 * started it: a `deal_meetings` row (the same join the meeting screen's
 * "Deals discussed" tick box writes — see `/api/deal-meetings`) so the
 * Opportunity shows this meeting, plus `deal_follow_ups.visit_id` so the
 * to-do route hides the card once a visit exists for it.
 *
 * The follow-up is deliberately NOT marked `done` here — that is a later
 * decision per the task, so `status` is left untouched.
 */
async function linkFollowUp(tid: string, followUp: { id: string; deal_id: string }, visitId: string) {
  await prisma.$transaction([
    prisma.deal_meetings.upsert({
      where: { deal_id_visit_id: { deal_id: followUp.deal_id, visit_id: visitId } },
      create: { tenant_id: tid, deal_id: followUp.deal_id, visit_id: visitId },
      update: {},
    }),
    prisma.deal_follow_ups.update({
      where: { id: followUp.id },
      data: { visit_id: visitId },
    }),
  ])
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  // `meetings` exists in role_permissions and drives nav visibility, but no
  // route enforced it before P4-T1. A scope filter without a permission check
  // is half a fix.
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  if (!user.userId) return NextResponse.json([])
  // Phone Activity search (§41.5): a free-text query searches this caller's
  // own meetings across EVERY date, not just one day — entity name or notes,
  // case-insensitive. Mutually exclusive with `date`.
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const date = req.nextUrl.searchParams.get('date') ?? businessDate()
  // Account detail phone screen's "Meetings" row (§3.2): every meeting ever
  // logged against one account, newest first — a account-centric view, not
  // "my day", so it deliberately does NOT narrow to `user.userId` by default
  // the way the plain daily-entry read does below. Mutually exclusive with
  // `q`/`date`.
  const companyId = req.nextUrl.searchParams.get('companyId')?.trim() ?? ''
  if (companyId) {
    const tid = getTenantId()
    const miss = await firstForeignTenantRef([
      { value: companyId, label: 'Account',
        find: cid => prisma.companies.findFirst({ where: { id: cid, tenant_id: tid }, select: { id: true } }) },
    ])
    if (miss) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    const ids = await scopedUserIds(user, 'meetings')
    try {
      const data = await prisma.daily_visits.findMany({
        where: {
          tenant_id: tid,
          ...scopeWhere(ids),
          entity_id: companyId,
        },
        select: VISIT_SELECT,
        orderBy: { created_at: 'desc' },
        take: 50,
      })
      const rows = serialize(data, 'daily_visits') as (Record<string, unknown> & { id: string })[]
      const contacts = await readVisitContacts(tid, rows.map(r => r.id))
      const withContacts = attachVisitContacts(rows, contacts)
      const attendeesByVisit = await listAttendeesForVisits(tid, rows.map(r => r.id))
      const withAttendees = withContacts.map(row => {
        const list = attendeesByVisit.get((row as { id: string }).id) ?? []
        if (list.length === 0) return row
        const main = list.find(a => a.is_main) ?? null
        return {
          ...row,
          attendees_summary: { main_name: main?.name ?? list[0].name, others: Math.max(0, list.length - 1) },
        }
      })
      return NextResponse.json(withAttendees)
    } catch (err) {
      return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
    }
  }
  // Daily Activity is where the caller ENTERS their own day, not where they
  // review anyone else's (that is /review/[userId], on /api/review/*). So the
  // default target is Self whatever the role's scope — an Administrator's
  // Company scope used to put every colleague's meetings on their own entry
  // screen. `?userId=` can only NARROW the `meetings` scope, the same as
  // `/api/attendance` and `/api/daily-activity/calendar`.
  const requested = req.nextUrl.searchParams.get('userId')
  const ids = requested
    ? intersectScope(await scopedUserIds(user, 'meetings'), requested)
    : [user.userId]
  const tid = getTenantId()
  try {
    const data = await prisma.daily_visits.findMany({
      where: {
        tenant_id: tid,
        ...scopeWhere(ids),
        ...(q
          ? {
              OR: [
                { entity_name: { contains: q, mode: 'insensitive' } },
                { notes: { contains: q, mode: 'insensitive' } },
              ],
            }
          : { visit_date: new Date(date) }), // visit_date is @db.Date.
      },
      // Explicit, not the default whole row: see VISIT_SELECT for why an
      // unselected read breaks the moment the client learns about contact_id.
      select: VISIT_SELECT,
      orderBy: { created_at: 'asc' },
      ...(q ? { take: 25 } : {}),
    })
    const rows = serialize(data, 'daily_visits') as (Record<string, unknown> & { id: string })[]
    // One extra query for the whole day's meetings, not one per row. Null when
    // the column is unpushed, and every card then falls back to entity_name.
    const contacts = await readVisitContacts(tid, rows.map(r => r.id))
    const withContacts = attachVisitContacts(rows, contacts)
    // Attendees (§8, Stage 2), same one-query-for-the-day shape: `[]`/missing
    // for a meeting with no attendee rows, or while the table is unpushed —
    // the card then falls back to its plain `entity_name` display unchanged.
    const attendeesByVisit = await listAttendeesForVisits(tid, rows.map(r => r.id))
    const withAttendees = withContacts.map(row => {
      const list = attendeesByVisit.get((row as { id: string }).id) ?? []
      if (list.length === 0) return row
      const main = list.find(a => a.is_main) ?? null
      return {
        ...row,
        attendees_summary: { main_name: main?.name ?? list[0].name, others: Math.max(0, list.length - 1) },
      }
    })
    return NextResponse.json(withAttendees)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'create')) return forbidden()
  const {
    visit_type, entity_id, entity_name, is_new_entity, visit_date, new_prospect, weekly_plan_item_id,
    is_manual_entry, manual_start_time, manual_end_time, contact_id, deal_follow_up_id,
    deal_id, attendees,
  } = await req.json()
  if (!visit_type) return NextResponse.json({ error: 'visit_type is required' }, { status: 400 })
  // Business date, not the server's clock: between 00:00 and 05:30 IST the
  // UTC date is still yesterday and today's meeting read as "future".
  const todayStr = businessDate()
  const effectiveDate = visit_date ?? todayStr
  if (effectiveDate > todayStr) return NextResponse.json({ error: 'Cannot create meetings for future dates' }, { status: 400 })
  const tid = getTenantId()
  const visitDate = new Date(effectiveDate)

  /*
   * P3-T10, §5.4. A past meeting that was not logged live is entered by
   * hand: the caller types Start and End, which the spec calls
   * "tentative" — there is no real GPS fix behind them. So this branch
   * never writes latitude/longitude/address/end_* location fields (they
   * stay at their column defaults, null), and it stores exactly the
   * wall-clock instant the browser sent — no "now" substitution, no
   * fabricated accuracy.
   *
   * `manual_start_time`/`manual_end_time` arrive as ISO strings built by
   * the browser from LOCAL date+time components (`new Date(...)` on a
   * "YYYY-MM-DDTHH:mm" literal is parsed in the browser's own zone), so
   * the UTC instant is already correct regardless of what zone this
   * server process happens to run in. Reading it back is just
   * `toLocaleTimeString()` in the viewer's own browser — see
   * `formatTime` in `types.ts`. Nothing here does zone arithmetic, which
   * is the one thing that would actually introduce the IST/UTC skew.
   */
  let manualFields: {
    status: 'Completed'
    is_manual_entry: true
    start_time: Date
    end_time: Date
    duration_secs: number
  } | null = null
  if (is_manual_entry) {
    if (!manual_start_time || !manual_end_time) {
      return NextResponse.json({ error: 'Start and end time are required for a manual entry' }, { status: 400 })
    }
    const start = new Date(manual_start_time)
    const end = new Date(manual_end_time)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Start and end time are not valid' }, { status: 400 })
    }
    if (end.getTime() <= start.getTime()) {
      return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 })
    }
    manualFields = {
      status: 'Completed',
      is_manual_entry: true,
      start_time: start,
      end_time: end,
      duration_secs: Math.floor((end.getTime() - start.getTime()) / 1000),
    }
  }

  /*
   * §5.3 rule 1. A meeting started from an approved plan line carries
   * that line's id, which is what lets the screen show one row instead
   * of a planned line and a meeting that look unrelated.
   *
   * The id is VALIDATED rather than trusted: it must be this tenant's,
   * on this caller's own plan, that plan must be Approved, and the line
   * must be for the day being written. Otherwise a client could stamp a
   * visit with any uuid and the planned/actual join would silently point
   * at someone else's plan.
   */
  let planItemId: string | null = null
  if (weekly_plan_item_id) {
    const item = await prisma.weekly_plan_items.findFirst({
      where: {
        id: weekly_plan_item_id,
        tenant_id: tid,
        plan_date: visitDate,
        weekly_plans: { tenant_id: tid, user_id: user.userId ?? undefined, status: 'Approved' },
      },
      select: { id: true },
    })
    if (!item) return NextResponse.json({ error: 'Plan line not found for this day' }, { status: 400 })
    planItemId = item.id
  }

  /*
   * A meeting started from an Opportunity follow-up card (§5.3-adjacent
   * to-do b)). Validated the same way as `weekly_plan_item_id` above: this
   * must be the caller's own tenant, an OPEN follow-up (not already linked
   * to a visit), due on the day being written, and on a deal the caller
   * owns — a client cannot stamp a visit onto a colleague's follow-up by
   * guessing its id. `deals.owner_user_id` is the authorisation, because
   * `deal_follow_ups` itself carries no assignee.
   */
  let followUp: { id: string; deal_id: string } | null = null
  if (deal_follow_up_id) {
    const fu = await prisma.deal_follow_ups.findFirst({
      where: {
        id: deal_follow_up_id,
        tenant_id: tid,
        status: 'not_done',
        visit_id: null,
        deals: { tenant_id: tid, owner_user_id: user.userId ?? undefined },
      },
      select: { id: true, deal_id: true, due_date: true },
    })
    if (!fu) return NextResponse.json({ error: 'Follow-up not found for this day' }, { status: 400 })
    const dueStr = fu.due_date.toISOString().slice(0, 10)
    // Either due exactly on the day being written (the ordinary same-day
    // to-do card), or MISSED — due in the past, within the 7-business-day
    // Missed window the to-do route itself uses. A due date further in the
    // future, or missed beyond that window, is refused: the first would let
    // a client pull a follow-up forward before its day; the second does not
    // exist as a "Missed" card any more for the caller to have clicked.
    const isSameDay = dueStr === effectiveDate
    const isMissed = dueStr < todayStr && businessDaysAgo(dueStr, businessDate()) <= 7
    if (!isSameDay && !isMissed) {
      return NextResponse.json({ error: 'Follow-up not found for this day' }, { status: 400 })
    }
    followUp = fu
  }

  /*
   * The PERSON met, when the form named one.
   *
   * Validated BEFORE anything is written: a 400 must not leave a meeting
   * behind. `resolveVisitContact` checks the contact is this tenant's and,
   * when a company is also named, that the two are actually linked — see that
   * function for why the second check is the one that matters.
   */
  // Body-sourced ids, looked up in the caller's tenant before anything is
  // written — see src/lib/tenant-fk.ts.
  const miss = await firstForeignTenantRef([
    { value: new_prospect ? null : entity_id, label: 'Account',
      find: id => prisma.companies.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: new_prospect?.state_id, label: 'State',
      find: id => prisma.states.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: new_prospect?.district_id, label: 'District',
      find: id => prisma.districts.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: new_prospect?.taluka_id, label: 'Taluka',
      find: id => prisma.talukas.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: new_prospect?.village_id, label: 'Village',
      find: id => prisma.villages.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
  ])
  if (miss) return NextResponse.json({ error: miss }, { status: 400 })

  let resolvedContactId: string | null = null
  if (contact_id) {
    if (new_prospect) {
      return NextResponse.json(
        { error: 'An account being created here has no contacts yet, so a person cannot be named on this meeting' },
        { status: 400 }
      )
    }
    const found = await resolveVisitContact(tid, String(contact_id), entity_id || null)
    if ('error' in found) return NextResponse.json({ error: found.error }, { status: 400 })
    resolvedContactId = found.contact.id
  }

  /*
   * "Log a meeting" from an Opportunity page (sharing, src/lib/sharing.ts).
   * The meeting is filed against the opportunity's account and linked to the
   * opportunity through `deal_meetings`, the same join the meeting screen's
   * "Deals discussed" tick writes. That link is what lets someone the
   * opportunity alone was shared with see this meeting — and only meetings
   * like it — under "Previous meetings" (`[id]/history`).
   *
   * Validated before anything is written: the caller needs `deals.view` and
   * WRITE access to the opportunity (owner-scope, or a 'work' member of it or
   * its account), and the meeting must be at that opportunity's own account.
   *
   * ⚠️ Owner-based follow-on logic is NOT widened by this: next-meeting
   * reminders, Missed / outcome counts and reports keep reading
   * `owner_user_id` / `user_id` exactly as before.
   */
  let linkDealId: string | null = null
  if (deal_id !== undefined && deal_id !== null && deal_id !== '') {
    if (new_prospect) {
      return NextResponse.json({ error: 'A meeting for an opportunity is at its own account, not a brand-new one' }, { status: 400 })
    }
    if (!await checkPermission(user, 'deals', 'view')) return forbidden()
    const deal = await findScopedDeal(user, tid, String(deal_id), 'write')
    if (!deal) return NextResponse.json({ error: 'Opportunity not found' }, { status: 400 })
    if (!deal.company_id || deal.company_id !== entity_id) {
      return NextResponse.json({ error: "This meeting must be at the opportunity's own account" }, { status: 400 })
    }
    linkDealId = deal.id
  }

  /*
   * Attendees (Accounts & Contacts, stage 2, §8): optional `[{contact_id,
   * is_main}]`. Every plan-line Start / to-do Start / Missed / new-prospect
   * flow sends none, and must keep working exactly as before — this block is
   * a no-op for an empty/absent array.
   *
   * Each `contact_id` is validated BEFORE anything is written, same rule as
   * `resolveVisitContact` above: a 400 must never leave a meeting behind.
   * Two checks, both required:
   *   - `firstForeignTenantRef` — the id is a real contact of THIS tenant
   *     (src/lib/tenant-fk.ts; a body-sourced FK is never trusted bare).
   *   - `findScopedContact(..., 'read')` — the CALLER may see it, under the
   *     same data-scope/sharing rules `/api/contacts` itself uses
   *     (src/app/api/contacts/_access.ts), not just "exists in the tenant".
   * The whole request is rejected (400) on the first invalid/invisible id —
   * never silently dropped. Multiple `is_main: true` is not an error: only
   * the first is kept (`pickMain`, src/lib/meeting-attendees.ts).
   */
  let attendeeInputs: AttendeeInput[] = []
  if (Array.isArray(attendees) && attendees.length > 0) {
    for (const raw of attendees) {
      const cid = (raw as { contact_id?: unknown } | null)?.contact_id
      const isMain = !!(raw as { is_main?: unknown } | null)?.is_main
      const miss = await firstForeignTenantRef([
        { value: cid, label: 'Attendee', find: id => prisma.contacts.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
      ])
      if (miss) return NextResponse.json({ error: miss }, { status: 400 })
      const scoped = await findScopedContact(user, tid, String(cid), 'read')
      if (!scoped) return NextResponse.json({ error: 'Attendee not found' }, { status: 400 })
      attendeeInputs.push({ contact_id: String(cid), is_main: isMain })
    }
    attendeeInputs = pickMain(attendeeInputs)
  }

  try {
    // New Prospect mode: create business_partner first, then link visit
    if (new_prospect) {
      if (!new_prospect.name?.trim()) return NextResponse.json({ error: 'Prospect name is required' }, { status: 400 })
      const bp = await prisma.companies.create({
        data: {
          tenant_id: tid,
          // The lead's own type, which may be blank ('' — the column is NOT
          // NULL, as in POST /api/companies); the meeting's `visit_type` is
          // then 'Other'. A client that sends no `type` key keeps the old
          // behaviour of typing the lead with the visit type.
          type: 'type' in new_prospect
            ? (typeof new_prospect.type === 'string' ? new_prospect.type.trim() : '')
            : visit_type,
          stage: 'Prospect',
          name: new_prospect.name.trim(),
          mobile_1: new_prospect.mobile_1?.trim() || null,
          state_id: new_prospect.state_id || null,
          district_id: new_prospect.district_id || null,
          taluka_id: new_prospect.taluka_id || null,
          village_id: new_prospect.village_id || null,
          // Every company has an owner: the rep who met the lead, as for a
          // company created by hand. Unowned, it would sit outside their own
          // Self/Team scope the moment they created it.
          owner_user_id: user.userId || null,
          created_by_user_id: user.userId || null,
        },
      })
      const data = await prisma.daily_visits.create({
        data: {
          tenant_id: tid, user_id: user.userId!, visit_date: visitDate,
          visit_type, entity_id: bp.id, entity_name: bp.name, is_new_entity: true, status: 'Pending',
          weekly_plan_item_id: planItemId,
          ...manualFields,
        },
        select: VISIT_SELECT,
      })
      if (followUp) await linkFollowUp(tid, followUp, data.id)
      void awardPoint(tid, user.userId!, 'meeting_logged', { refType: 'daily_visit', refId: data.id, description: `Meeting with ${bp.name} on ${effectiveDate}` })
        .catch(logAwardFailure('meeting_logged'))
      // Attendees written AFTER the visit exists, never blocking it: see the
      // header comment on src/lib/meeting-attendees.ts. 'unavailable' (the
      // table not yet pushed) is reported back but the meeting still stands.
      let attendeesUnavailable = false
      if (attendeeInputs.length > 0) {
        const result = await recordAttendees(tid, data.id, attendeeInputs)
        if (result === 'unavailable') attendeesUnavailable = true
      }
      const attendeesOut = await listAttendees(tid, data.id)
      // A lead created here has no contacts yet, so there is never one to name.
      const created = serialize(data, 'daily_visits') as Record<string, unknown>
      return NextResponse.json(
        { ...created, contact: null, attendees: attendeesOut, attendees_unavailable: attendeesUnavailable },
        { status: 201 }
      )
    }

    if (!entity_name?.trim()) return NextResponse.json({ error: 'entity_name is required' }, { status: 400 })
    const data = await prisma.daily_visits.create({
      data: {
        tenant_id: tid, user_id: user.userId!, visit_date: visitDate,
        visit_type, entity_id: entity_id || null, entity_name: entity_name.trim(),
        is_new_entity: is_new_entity ?? false, status: 'Pending',
        weekly_plan_item_id: planItemId,
        ...manualFields,
      },
      select: VISIT_SELECT,
    })
    /*
     * A second statement rather than a column on the insert, because the
     * column may not exist yet. `writeVisitContact` answers false in that
     * case and the meeting stands: it is already saved, `entity_name` already
     * carries the person's name as text, and refusing to log a meeting over a
     * pending migration would be the worse failure.
     */
    if (resolvedContactId) await writeVisitContact(tid, data.id, resolvedContactId)
    if (followUp) await linkFollowUp(tid, followUp, data.id)
    if (linkDealId) {
      // Idempotent on the (deal_id, visit_id) unique, as in /api/deal-meetings.
      await prisma.deal_meetings.upsert({
        where: { deal_id_visit_id: { deal_id: linkDealId, visit_id: data.id } },
        create: { tenant_id: tid, deal_id: linkDealId, visit_id: data.id },
        update: {},
      })
    }
    void awardPoint(tid, user.userId!, 'meeting_logged', { refType: 'daily_visit', refId: data.id, description: `Meeting with ${entity_name.trim()} on ${effectiveDate}` })
      .catch(logAwardFailure('meeting_logged'))
    // Attendees written AFTER the visit exists, never blocking it — see
    // src/lib/meeting-attendees.ts. An empty/absent array (every flow that
    // predates this feature) is a no-op and leaves today's response shape
    // untouched beyond the two added keys below.
    let attendeesUnavailable = false
    if (attendeeInputs.length > 0) {
      const result = await recordAttendees(tid, data.id, attendeeInputs)
      if (result === 'unavailable') attendeesUnavailable = true
    }
    const attendeesOut = await listAttendees(tid, data.id)
    const row = serialize(data, 'daily_visits') as Record<string, unknown> & { id: string }
    const contacts = await readVisitContacts(tid, [row.id])
    const shaped = attachVisitContacts([row], contacts)[0] as Record<string, unknown>
    return NextResponse.json(
      { ...shaped, attendees: attendeesOut, attendees_unavailable: attendeesUnavailable },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
