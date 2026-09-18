import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { FOLLOW_UP_MODES } from '../../_shape'
import { findScopedDeal, notFound } from '../../_access'

export const dynamic = 'force-dynamic'

/**
 * Follow-ups against a Deal (§4.5).
 *
 * A Deal carries MANY follow-ups, not one date field — that is the whole point
 * of the section. The earliest OPEN one is what the Deal card shows, which is
 * why `/api/deals` includes it on every row rather than leaving the board to
 * fetch this endpoint once per card.
 */

/** GET — every follow-up on the Deal, earliest due first. Bare array. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    const deal = await findScopedDeal(user, tid, params.id)
    if (!deal) return notFound()

    const rows = await prisma.deal_follow_ups.findMany({
      where: { deal_id: deal.id, tenant_id: tid },
      orderBy: [{ due_date: 'asc' }, { created_at: 'asc' }],
    })
    // `due_date` is @db.Date and must come back "YYYY-MM-DD", so the model name
    // is not optional here.
    return NextResponse.json(serialize(rows, 'deal_follow_ups'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * POST — add a follow-up. `due_date` and `mode` are compulsory; §4.5's "prompt
 * for the next follow-up date" on completing one is a UI prompt that lands
 * here, and it is a prompt, never a requirement.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'edit')) return forbidden()

  const { due_date, mode, status, notes, visit_id } = await req.json()

  if (!due_date) return NextResponse.json({ error: 'Due date is required' }, { status: 400 })
  if (!mode || !(FOLLOW_UP_MODES as readonly string[]).includes(mode)) {
    return NextResponse.json(
      { error: `Mode is required and must be one of: ${FOLLOW_UP_MODES.join(', ')}` },
      { status: 400 }
    )
  }

  const tid = getTenantId()

  try {
    const deal = await findScopedDeal(user, tid, params.id)
    if (!deal) return notFound()

    const done = status === 'done'
    const created = await prisma.deal_follow_ups.create({
      data: {
        tenant_id: tid,
        deal_id: deal.id,
        // @db.Date — the client sends "YYYY-MM-DD".
        due_date: new Date(due_date),
        mode,
        status: done ? 'done' : 'not_done',
        notes: notes || null,
        // Derived from status, never taken from the body: a follow-up that is
        // Done must have a Completed On, and one that is not must not have one.
        completed_at: done ? new Date() : null,
        // §4.5's Meeting→Minutes auto-pull is Phase 3 (P3-T9); the column is
        // accepted here so the link can be written, and nothing reads it yet.
        visit_id: visit_id || null,
      },
    })
    return NextResponse.json(serialize(created, 'deal_follow_ups'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
