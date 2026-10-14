import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
import { firstForeignTenantRef } from '@/lib/tenant-fk'
import { findScopedContact } from '@/app/api/contacts/_access'
import {
  ATTENDEES_UNAVAILABLE,
  listAttendees,
  pickMain,
  setAttendees,
  type AttendeeInput,
} from '@/lib/meeting-attendees'

export const dynamic = 'force-dynamic'

/**
 * `GET`/`PATCH /api/daily-activity/[id]/attendees` — the Inside-a-Meeting
 * attendee list (§8, Stage 2), read and edited separately from the rest of
 * the meeting so adding/removing a person does not have to resend the whole
 * `daily_visits` PATCH body.
 *
 * Gate is the SAME one `PATCH /api/daily-activity/[id]` (the sibling route)
 * uses for every meeting-mutating action: `checkPermission(user, 'meetings',
 * 'edit')` AND the visit must be inside the caller's own `meetings` data
 * scope (`scopeWhere(scopedUserIds(...))`) — which for most roles collapses
 * to "their own meeting" (Self scope), and for a manager/admin to "a meeting
 * of someone in their scope". This is deliberately the EXISTING ownership
 * rule, not a bare `visit.user_id === caller` check, so a Team/Company-scope
 * manager keeps the same edit reach on attendees as on everything else about
 * the meeting. Sharing (`src/lib/sharing.ts`) is READ-only on a meeting and
 * is never consulted here — a shared viewer cannot edit attendees, same as
 * they cannot start/stop/delete it.
 *
 * A caller outside that gate gets a plain 404 (not 403): the GET below is
 * also gated so the page can decide whether to render the edit UI at all
 * (hide it entirely for "not your meeting", per the global UI rule) versus
 * disabled+tooltip for an actual permission gap.
 */
async function reachableVisit(tid: string, visitId: string, userIds: string[] | null) {
  return prisma.daily_visits.findFirst({
    where: { id: visitId, tenant_id: tid, ...scopeWhere(userIds) },
    select: { id: true },
  })
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  const tid = getTenantId()
  try {
    const visit = await reachableVisit(tid, params.id, await scopedUserIds(user, 'meetings'))
    if (!visit) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const attendees = await listAttendees(tid, params.id)
    return NextResponse.json({ attendees })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'edit')) return forbidden()
  const tid = getTenantId()
  const { attendees } = await req.json()
  if (!Array.isArray(attendees)) {
    return NextResponse.json({ error: 'attendees must be an array' }, { status: 400 })
  }

  try {
    // Same gate as PATCH /api/daily-activity/[id]: outside the caller's own
    // `meetings` scope is a 404, never a 403 that confirms the row exists.
    const visit = await reachableVisit(tid, params.id, await scopedUserIds(user, 'meetings'))
    if (!visit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Every contact id validated before anything is written — same two
    // checks as the daily-activity POST route: tenant-FK, then caller
    // visibility (findScopedContact 'read').
    let inputs: AttendeeInput[] = []
    for (const raw of attendees) {
      const cid = (raw as { contact_id?: unknown } | null)?.contact_id
      const isMain = !!(raw as { is_main?: unknown } | null)?.is_main
      const miss = await firstForeignTenantRef([
        { value: cid, label: 'Attendee', find: id => prisma.contacts.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
      ])
      if (miss) return NextResponse.json({ error: miss }, { status: 400 })
      const scoped = await findScopedContact(user, tid, String(cid), 'read')
      if (!scoped) return NextResponse.json({ error: 'Attendee not found' }, { status: 400 })
      inputs.push({ contact_id: String(cid), is_main: isMain })
    }
    inputs = pickMain(inputs)

    const result = await setAttendees(tid, params.id, inputs)
    if (result === 'unavailable') {
      return NextResponse.json({ error: ATTENDEES_UNAVAILABLE }, { status: 503 })
    }
    const out = await listAttendees(tid, params.id)
    return NextResponse.json({ attendees: out })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
