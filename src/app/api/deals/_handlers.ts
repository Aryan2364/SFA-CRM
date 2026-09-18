import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'
import { trimmed } from '@/lib/validation'
import { DEAL_LIST_INCLUDE, checkProbability, shapeDeal } from './_shape'

/**
 * Deals — the Phase 2 entity (REBUILD-PLAN.md §4).
 *
 * The implementation sits in `_handlers.ts` rather than in `route.ts` for the
 * same reason `api/companies` does: a `route.ts` must not be imported by
 * another `route.ts`, so anything that might be re-exported lives in a plain
 * module.
 */

/**
 * `?closeMonth=YYYY-MM` (§4.8) as a half-open range on a `@db.Date` column.
 *
 * A half-open `[first of month, first of next month)` rather than BETWEEN with
 * a computed last day: no month-length arithmetic, no leap-year special case,
 * and it stays correct if the column ever gains a time component. UTC
 * throughout — `@db.Date` values come back from Postgres at UTC midnight, so
 * building the bounds in local time would shift the window by a day either side
 * of the date line.
 */
function closeMonthRange(value: string | null): { gte: Date; lt: Date } | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})$/.exec(value)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)),
    lt: new Date(Date.UTC(year, month, 1)),
  }
}

/**
 * GET — the Deals list, serving both the table (§4.2) and the Kanban board.
 *
 * Filters per §4.8: `?ownerId=`, `?stageId=`, `?companyId=`, `?closeMonth=YYYY-MM`,
 * plus `?q=` on the Deal name.
 *
 * Every row carries company / contact / stage / owner names, the earliest open
 * follow-up and `days_in_stage`, so a list of 200 Deals is one request and not
 * 200 — see `_shape.ts` for how the follow-up avoids an N+1.
 *
 * Response is a BARE ARRAY. There is no envelope in this codebase.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'view')) return forbidden()

  const sp = req.nextUrl.searchParams
  const q = sp.get('q') ?? ''
  const stageId = sp.get('stageId') ?? ''
  const companyId = sp.get('companyId') ?? ''
  const closeMonth = closeMonthRange(sp.get('closeMonth'))
  const tid = getTenantId()

  // §6.6 Self / Team / Company. A Deal scopes on `owner_user_id`, like a Party
  // and unlike an activity row, so the column is passed to scopeWhere()
  // explicitly. `?ownerId=` INTERSECTS the allowed set — it narrows, it never
  // widens (see intersectScope's comment; that is gap G3).
  const ids = intersectScope(await scopedUserIds(user, 'deals'), sp.get('ownerId'))

  try {
    const rows = await prisma.deals.findMany({
      where: {
        tenant_id: tid,
        ...scopeWhere(ids, 'owner_user_id'),
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(stageId ? { deal_stage_id: stageId } : {}),
        ...(companyId ? { company_id: companyId } : {}),
        ...(closeMonth ? { expected_close_date: closeMonth } : {}),
      },
      include: DEAL_LIST_INCLUDE,
      orderBy: [{ created_at: 'desc' }],
    })

    // serialize() BEFORE shapeDeal(): `expected_value` is Decimal(12,2) and
    // JSON.stringify turns a Decimal into a STRING, which silently corrupts
    // every total downstream; `expected_close_date` and the nested
    // `deal_follow_ups.due_date` are @db.Date and must come back "YYYY-MM-DD".
    // Both only happen while the relation keys are still Prisma's own.
    const data = (serialize(rows, 'deals') as Record<string, unknown>[]).map(shapeDeal)

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * POST — create a Deal (§4.1).
 *
 * `name` is the only compulsory field. **Both `company_id` and `contact_id` are
 * optional and independent**: §4.1 says in as many words that a Contact with no
 * Company is acceptable, so neither one may be required and requiring "at least
 * one of them" would be inventing a rule the brief does not have.
 *
 * `stage_entered_at` is set to now() here rather than left to the column
 * default so the ageing clock (§4.7) starts from creation for certain, and so
 * the same expression is used on create and on every stage move.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'create')) return forbidden()

  const {
    name, owner_user_id, company_id, contact_id,
    expected_value, probability, deal_stage_id, expected_close_date,
    product_id, product_category_id, source, remarks,
  } = await req.json()

  if (!name?.trim()) return NextResponse.json({ error: 'Deal name is required' }, { status: 400 })

  // Validated in the route AND in the database. The CHECK is what makes the
  // rule true; this is what makes it a sentence the user can read instead of a
  // 500. 01-GAP-ANALYSIS.md D1 is what happens when only one of the two exists.
  const bad = checkProbability(probability)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  try {
    const created = await prisma.deals.create({
      data: {
        tenant_id: getTenantId(),
        name: name.trim(),
        // Unowned is allowed, but an unstated owner is almost always the
        // creator — and below Company scope an unowned Deal is invisible to
        // everyone, which is not what "I just made this" should mean.
        owner_user_id: owner_user_id || user.userId || null,
        company_id: company_id || null,
        contact_id: contact_id || null,
        expected_value: expected_value != null && expected_value !== '' ? Number(expected_value) : 0,
        probability: probability != null && probability !== '' ? Number(probability) : 0,
        deal_stage_id: deal_stage_id || null,
        // @db.Date — the client sends "YYYY-MM-DD".
        expected_close_date: expected_close_date ? new Date(expected_close_date) : null,
        product_id: product_id || null,
        product_category_id: product_category_id || null,
        source: trimmed(source),
        remarks: remarks || null,
        stage_entered_at: new Date(),
      },
      include: DEAL_LIST_INCLUDE,
    })

    return NextResponse.json(
      shapeDeal(serialize(created, 'deals') as Record<string, unknown>),
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
