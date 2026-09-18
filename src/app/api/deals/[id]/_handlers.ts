import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
import { trimmed } from '@/lib/validation'
import { DEAL_DETAIL_INCLUDE, checkProbability, shapeDeal } from '../_shape'
import { findScopedDeal, notFound } from '../_access'

/**
 * GET — one Deal with everything the Deal page reads: company, contact, stage,
 * owner, product and product category (§4.1), its follow-ups (§4.5), its stage
 * logs (§4.4) and its attachments (§4.8).
 *
 * Bare object, no envelope.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    const ids = await scopedUserIds(user, 'deals')
    // findFirst with tenant_id AND the scope predicate in the `where` — see
    // `_access.ts`. This one does the query itself rather than calling
    // findScopedDeal() because it needs the full row and its includes anyway.
    const row = await prisma.deals.findFirst({
      where: { id: params.id, tenant_id: tid, ...scopeWhere(ids, 'owner_user_id') },
      include: DEAL_DETAIL_INCLUDE,
    })
    if (!row) return notFound()

    return NextResponse.json(shapeDeal(serialize(row, 'deals') as Record<string, unknown>))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * PUT — edit a Deal (§4.1 fields).
 *
 * ⚠️ **Explicit allow-list, destructured from the body one key at a time.** The
 * body is never spread into `prisma.update` — that is mass assignment, and it
 * would let a caller set `tenant_id` (moving the row to another tenant),
 * `outcome`/`closed_at` (closing a Deal without the §4.6 Reason for Loss),
 * `stage_entered_at` (resetting the ageing clock) or `id`. The same bug was
 * fixed in the Companies route and must not reappear here.
 *
 * `stage`, `outcome` and `reason_for_loss_id` are deliberately NOT editable
 * through this verb: a stage change has to write a log row (`PATCH .../stage`)
 * and a close has to enforce the Reason for Loss (`POST .../close`). Allowing
 * either here would be a way around both.
 *
 * A key that is absent from the body is left alone; `null` clears it.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'edit')) return forbidden()
  const tid = getTenantId()

  const body = await req.json()
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key)

  if (has('name') && !body.name?.trim()) {
    return NextResponse.json({ error: 'Deal name is required' }, { status: 400 })
  }
  const bad = checkProbability(has('probability') ? body.probability : undefined)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  const data: Record<string, unknown> = { updated_at: new Date() }
  if (has('name'))                data.name = String(body.name).trim()
  if (has('owner_user_id'))       data.owner_user_id = body.owner_user_id || null
  if (has('company_id'))          data.company_id = body.company_id || null
  if (has('contact_id'))          data.contact_id = body.contact_id || null
  if (has('expected_value'))      data.expected_value = body.expected_value === '' || body.expected_value == null ? 0 : Number(body.expected_value)
  if (has('probability'))         data.probability = body.probability === '' || body.probability == null ? 0 : Number(body.probability)
  // @db.Date — "YYYY-MM-DD" in, "YYYY-MM-DD" out via serialize().
  if (has('expected_close_date')) data.expected_close_date = body.expected_close_date ? new Date(body.expected_close_date) : null
  if (has('product_id'))          data.product_id = body.product_id || null
  if (has('product_category_id')) data.product_category_id = body.product_category_id || null
  if (has('source'))              data.source = trimmed(body.source)
  if (has('remarks'))             data.remarks = body.remarks || null
  if (has('is_active'))           data.is_active = Boolean(body.is_active)

  try {
    const found = await findScopedDeal(user, tid, params.id)
    if (!found) return notFound()

    const updated = await prisma.deals.update({
      // tenant_id alongside the primary key even though findScopedDeal() has
      // already proved both: Prisma allows the extra predicate, and a query
      // that carries the tenant filter cannot become a leak if someone later
      // moves the guard. Same reason the master routes spell it out.
      where: { id: found.id, tenant_id: tid },
      data,
      include: DEAL_DETAIL_INCLUDE,
    })
    return NextResponse.json(shapeDeal(serialize(updated, 'deals') as Record<string, unknown>))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * DELETE — soft delete.
 *
 * `deal_stage_logs`, `deal_follow_ups` and `deal_attachments` all cascade from
 * `deals`, so a hard delete would take the Deal's whole history with it. §4.4
 * makes that history a feature of the Deal, not scratch data, so this clears
 * `is_active` instead. updateMany() rather than update() so a no-match stays
 * silent instead of throwing P2025 and becoming a 500 (PLAN.md §8.4).
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'delete')) return forbidden()
  const tid = getTenantId()

  try {
    const found = await findScopedDeal(user, tid, params.id)
    if (!found) return notFound()

    await prisma.deals.updateMany({
      where: { id: found.id, tenant_id: tid },
      data: { is_active: false, updated_at: new Date() },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
