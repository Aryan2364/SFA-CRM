import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { FOLLOW_UP_MODES, FOLLOW_UP_STATUSES } from '../../../_shape'
import { findScopedDeal, notFound } from '../../../_access'

export const dynamic = 'force-dynamic'

/**
 * `PATCH /api/deals/[id]/follow-ups/[fid]` — edit one follow-up, and in
 * particular mark it Done (§4.5).
 *
 * Allow-listed keys, like the Deal PUT: the body is never spread into
 * `prisma.update`, or a caller could move the row to another Deal or another
 * tenant by naming `deal_id` / `tenant_id`.
 *
 * `completed_at` is DERIVED from `status`, not accepted from the caller. §4.5
 * lists "Completed On" as a field of the follow-up, but it is a fact about when
 * it was marked Done, and a client that can set the two independently produces
 * rows that are Done with no completion time and rows that are open with one.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; fid: string } }
) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'edit')) return forbidden()

  const body = await req.json()
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key)

  if (has('mode') && !(FOLLOW_UP_MODES as readonly string[]).includes(body.mode)) {
    return NextResponse.json(
      { error: `Mode must be one of: ${FOLLOW_UP_MODES.join(', ')}` },
      { status: 400 }
    )
  }
  if (has('status') && !(FOLLOW_UP_STATUSES as readonly string[]).includes(body.status)) {
    return NextResponse.json(
      { error: `Status must be one of: ${FOLLOW_UP_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }
  if (has('due_date') && !body.due_date) {
    return NextResponse.json({ error: 'Due date is required' }, { status: 400 })
  }

  const tid = getTenantId()

  try {
    const deal = await findScopedDeal(user, tid, params.id)
    if (!deal) return notFound()

    // The follow-up must belong to THIS Deal and THIS tenant. Checking the
    // Deal's scope above and then updating by `fid` alone would let any
    // follow-up in the database be edited through a Deal the caller does own.
    const existing = await prisma.deal_follow_ups.findFirst({
      where: { id: params.fid, deal_id: deal.id, tenant_id: tid },
      select: { id: true, status: true, completed_at: true },
    })
    if (!existing) return notFound()

    const data: Record<string, unknown> = { updated_at: new Date() }
    if (has('due_date')) data.due_date = new Date(body.due_date)
    if (has('mode'))     data.mode = body.mode
    if (has('notes'))    data.notes = body.notes || null
    if (has('visit_id')) data.visit_id = body.visit_id || null
    if (has('status')) {
      data.status = body.status
      // Re-opening clears the completion time; marking Done stamps it, but only
      // the first time — re-saving notes on an already-done follow-up must not
      // move the date it was completed.
      data.completed_at =
        body.status === 'done' ? (existing.completed_at ?? new Date()) : null
    }

    const updated = await prisma.deal_follow_ups.update({
      where: { id: existing.id, tenant_id: tid },
      data,
    })
    return NextResponse.json(serialize(updated, 'deal_follow_ups'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/** DELETE — remove a follow-up outright. It carries no history worth keeping;
 *  the Deal's own §4.4 Logs are in `deal_stage_logs`, not here. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; fid: string } }
) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'delete')) return forbidden()
  const tid = getTenantId()

  try {
    const deal = await findScopedDeal(user, tid, params.id)
    if (!deal) return notFound()

    // deleteMany(), not delete(): a no-match stays silent instead of throwing
    // P2025 and becoming a 500 (PLAN.md §8.4).
    await prisma.deal_follow_ups.deleteMany({
      where: { id: params.fid, deal_id: deal.id, tenant_id: tid },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
