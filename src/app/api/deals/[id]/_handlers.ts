import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { trimmed } from '@/lib/validation'
import { canShareDeal, getCompanyAccessLevel, isSharingAvailable, meets } from '@/lib/sharing'
import { DEAL_DETAIL_INCLUDE, checkProbability, shapeDeal } from '../_shape'
import { contactLinkedToCompany, findScopedDeal, foreignDealRef, notFound } from '../_access'

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
    // The access test (owner-scope, widened by sharing) — see `../_access.ts`.
    const found = await findScopedDeal(user, tid, params.id, 'read')
    if (!found) return notFound()
    // findFirst with tenant_id in the `where`: the id alone is not a tenant
    // filter.
    const row = await prisma.deals.findFirst({
      where: { id: found.id, tenant_id: tid },
      include: DEAL_DETAIL_INCLUDE,
    })
    if (!row) return notFound()

    // Whether the caller may open the deal's ACCOUNT. Someone the opportunity
    // alone was shared with (`deal_members`) may not: the page shows the
    // account's name as plain text, and `/api/companies/[id]` 404s for them.
    const companyAccess = row.company_id
      ? await getCompanyAccessLevel(user, tid, row.company_id)
      : null

    return NextResponse.json({
      ...shapeDeal(serialize(row, 'deals') as Record<string, unknown>),
      // 'owner-scope' | 'work' | 'view', decided here so the page never
      // re-derives it (src/lib/sharing.ts).
      access: found.access,
      company_access: companyAccess,
      can_share: await canShareDeal(user, { owner_user_id: row.owner_user_id }),
      // False until both sharing tables exist; the page then shows no
      // "Shared with" section and no "Log a meeting", exactly as before.
      sharing_available: await isSharingAvailable(tid, ['account_members', 'deal_members']),
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * `expected_value` is `Decimal(12,2)`. `Number('abc')` is NaN and a NaN row
 * turns every pipeline total that sums the column into null, so anything that
 * is not a finite, non-negative amount the column can hold is a 400. Blank is
 * 0, as before. (Same rule as `decimalOrNull` in weekly-plans/_items.ts.)
 */
const MAX_DEAL_VALUE = 9_999_999_999.99
function parseExpectedValue(value: unknown): { value: number } | { error: string } {
  if (value === undefined || value === null || value === '') return { value: 0 }
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return { error: 'Expected value must be a number' }
  if (n < 0) return { error: 'Expected value cannot be negative' }
  if (n > MAX_DEAL_VALUE) return { error: 'Expected value is too large' }
  return { value: n }
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
 *
 * §7 (spec, 2026-10-13): **an edit save requires an account.** The Deal
 * dialog always sends `company_id` (even an unchanged one), so this amounts
 * to: an EDIT may not leave, or set, the account blank. A Deal that already
 * had no account is untouched by every other verb (GET, stage move, close,
 * follow-ups) — only this save path, with its account field required on
 * screen, enforces it. An optional contact, when sent, must be linked to
 * whichever account the save lands on.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'edit')) return forbidden()
  const tid = getTenantId()

  const body = await req.json()
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key)

  if (has('name') && !body.name?.trim()) {
    return NextResponse.json({ error: 'Opportunity name is required' }, { status: 400 })
  }
  if (has('company_id') && !body.company_id) {
    return NextResponse.json({ error: 'Choose the account this opportunity is for.' }, { status: 400 })
  }
  const bad = checkProbability(has('probability') ? body.probability : undefined)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })
  const ev = parseExpectedValue(has('expected_value') ? body.expected_value : undefined)
  if ('error' in ev) return NextResponse.json({ error: ev.error }, { status: 400 })

  const data: Record<string, unknown> = { updated_at: new Date() }
  if (has('name'))                data.name = String(body.name).trim()
  if (has('owner_user_id'))       data.owner_user_id = body.owner_user_id || null
  if (has('company_id'))          data.company_id = body.company_id || null
  if (has('contact_id'))          data.contact_id = body.contact_id || null
  if (has('expected_value'))      data.expected_value = ev.value
  if (has('probability'))         data.probability = body.probability === '' || body.probability == null ? 0 : Number(body.probability)
  // @db.Date — "YYYY-MM-DD" in, "YYYY-MM-DD" out via serialize().
  if (has('expected_close_date')) data.expected_close_date = body.expected_close_date ? new Date(body.expected_close_date) : null
  if (has('product_id'))          data.product_id = body.product_id || null
  if (has('product_category_id')) data.product_category_id = body.product_category_id || null
  if (has('source'))              data.source = trimmed(body.source)
  if (has('remarks'))             data.remarks = body.remarks || null
  if (has('is_active'))           data.is_active = Boolean(body.is_active)

  try {
    const found = await findScopedDeal(user, tid, params.id, 'write')
    if (!found) return notFound()

    // A shared member works the opportunity; handing it to another owner or
    // moving it to another account is the owner's call. The form posts its
    // whole state, so an UNCHANGED value is accepted and simply not rewritten.
    if (found.access !== 'owner-scope') {
      for (const key of ['owner_user_id', 'company_id'] as const) {
        if (!(key in data)) continue
        if ((found[key] ?? null) !== (data[key] ?? null)) {
          return NextResponse.json(
            {
              error: key === 'owner_user_id'
                ? 'Only the owner, or someone whose team includes the owner, can change who owns this opportunity.'
                : 'Only the owner, or someone whose team includes the owner, can move this opportunity to another account.',
            },
            { status: 403 }
          )
        }
        delete data[key]
      }
    }

    const miss = await foreignDealRef(tid, body)
    if (miss) return NextResponse.json({ error: miss }, { status: 400 })

    // The account landing on this row — the one just set, or the one already
    // there when this save does not touch it — must be one the caller can at
    // least read, and any contact in the body must belong to it.
    const landingCompanyId = has('company_id') ? (data.company_id as string | null) : found.company_id
    if (landingCompanyId) {
      const companyAccess = await getCompanyAccessLevel(user, tid, landingCompanyId)
      if (!meets(companyAccess, 'read')) {
        return NextResponse.json({ error: 'Choose the account this opportunity is for.' }, { status: 400 })
      }
    }
    if (has('contact_id') && !(await contactLinkedToCompany(tid, landingCompanyId ?? '', data.contact_id as string | null))) {
      return NextResponse.json({ error: 'That contact is not linked to the chosen account.' }, { status: 400 })
    }

    const updated = await prisma.deals.update({
      // tenant_id alongside the primary key even though findScopedDeal() has
      // already proved both: Prisma allows the extra predicate, and a query
      // that carries the tenant filter cannot become a leak if someone later
      // moves the guard. Same reason the master routes spell it out.
      where: { id: found.id, tenant_id: tid },
      data,
      include: DEAL_DETAIL_INCLUDE,
    })
    // The same access fields GET carries, so a page that replaces its state
    // with this response does not lose them. A member cannot change owner or
    // account (above), so only an owner-scope edit can move either.
    return NextResponse.json({
      ...shapeDeal(serialize(updated, 'deals') as Record<string, unknown>),
      access: found.access,
      company_access: updated.company_id ? await getCompanyAccessLevel(user, tid, updated.company_id) : null,
      can_share: await canShareDeal(user, { owner_user_id: updated.owner_user_id }),
      sharing_available: await isSharingAvailable(tid, ['account_members', 'deal_members']),
    })
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
    const found = await findScopedDeal(user, tid, params.id, 'owner')
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
