import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { businessDate } from '@/lib/business-date'
import { recordCouldntMeet, listUnmetReasons, TodoKind } from '@/lib/todo-outcomes'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/daily-activity/couldnt-meet` — the "Couldn't meet" outcome for
 * a to-do (today's card, or a Missed item). Always records a `todo_outcomes`
 * row (reason required, note/new-date/location optional); when a new date
 * is given, reschedules the underlying source using the SAME permission the
 * existing screens already use for that move:
 *
 *   - followup:     `deal_follow_ups.due_date`, gated on `deals:edit`.
 *   - next_meeting: `companies.next_follow_up_date`, gated on `companies:edit`.
 *   - plan:         no due-date column of its own (the approved plan line
 *     stays as logged history); a new date instead sets the PARTY's
 *     `companies.next_follow_up_date`, same as next_meeting — only possible
 *     when the to-do has a party. With no party, the dialog must say so and
 *     this route 400s if a date is sent anyway.
 *
 * `todo_outcomes` may not exist yet (see src/lib/todo-outcomes.ts) — that
 * case 503s with a plain message rather than crashing; the reschedule itself
 * (an existing, already-pushed column) still happens first so a tenant
 * without the new table still gets Move's old behaviour even though the
 * outcome row cannot be saved. Actually: the two must be consistent, so on
 * 'unavailable' nothing is rescheduled either — see below.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  if (!user.userId) return forbidden()
  const tid = getTenantId()

  const body = await req.json()
  const todoKind = body.todo_kind as TodoKind
  const todoRef = String(body.todo_ref || '')
  const partyId: string | null = body.party_id || null
  const dueDate = String(body.due_date || '').slice(0, 10)
  const reasonId: string | null = body.reason_id || null
  const note: string | null = body.note?.trim() || null
  const newDate: string | null = body.new_date ? String(body.new_date).slice(0, 10) : null
  const latitude = typeof body.latitude === 'number' ? body.latitude : null
  const longitude = typeof body.longitude === 'number' ? body.longitude : null
  const address: string | null = body.address || null

  if (!['plan', 'followup', 'next_meeting'].includes(todoKind) || !todoRef || !dueDate) {
    return NextResponse.json({ error: 'todo_kind, todo_ref and due_date are required' }, { status: 400 })
  }
  if (!reasonId) {
    return NextResponse.json({ error: 'A reason is required' }, { status: 400 })
  }
  if (newDate) {
    const today = businessDate()
    if (newDate < today) return NextResponse.json({ error: 'The new date must be today or later' }, { status: 400 })
    if (todoKind === 'plan' && !partyId) {
      return NextResponse.json({ error: 'This plan line has no account, so it cannot be rescheduled' }, { status: 400 })
    }
  }

  try {
    // Reason must belong to this tenant — body-sourced id, checked before use
    // (tenant-fk rule), via the same raw-SQL path the master itself reads
    // through since the table may not exist yet.
    const { rows: reasons, available: reasonsAvailable } = await listUnmetReasons(tid, true)
    if (!reasonsAvailable) {
      return NextResponse.json({ error: 'This needs a database update first.' }, { status: 503 })
    }
    if (!reasons.some(r => r.id === reasonId)) {
      return NextResponse.json({ error: 'Unknown reason' }, { status: 400 })
    }

    // Reschedule first (uses existing, already-pushed columns), gated on the
    // same permission each screen already requires for that move.
    if (newDate) {
      if (todoKind === 'followup') {
        if (!await checkPermission(user, 'deals', 'edit')) return forbidden()
        const fu = await prisma.deal_follow_ups.findFirst({
          where: { id: todoRef, tenant_id: tid, deals: { tenant_id: tid, owner_user_id: user.userId } },
          select: { id: true },
        })
        if (!fu) return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 })
        await prisma.deal_follow_ups.update({
          where: { id: fu.id, tenant_id: tid },
          data: { due_date: new Date(newDate), updated_at: new Date() },
        })
      } else {
        // next_meeting and plan (with a party) both land on the party's own
        // next_follow_up_date.
        if (!await checkPermission(user, 'companies', 'edit')) return forbidden()
        const companyId = todoKind === 'next_meeting' ? todoRef : partyId!
        const company = await prisma.companies.findFirst({
          where: { id: companyId, tenant_id: tid, owner_user_id: user.userId },
          select: { id: true },
        })
        if (!company) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
        await prisma.companies.update({
          where: { id: company.id, tenant_id: tid },
          data: { next_follow_up_date: new Date(newDate) },
        })
      }
    }

    const result = await recordCouldntMeet({
      tenantId: tid, userId: user.userId, todoKind, todoRef, partyId, dueDate,
      reasonId, note, newDate, latitude, longitude, address,
    })
    if (result === 'unavailable') {
      return NextResponse.json({ error: 'This needs a database update first.' }, { status: 503 })
    }
    return NextResponse.json({ ok: true, id: result.id })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
