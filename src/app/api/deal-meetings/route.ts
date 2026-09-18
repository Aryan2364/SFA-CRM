import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

/**
 * `deal_meetings` — "which Deals were discussed in this meeting" (§5.5).
 *
 * The table already existed and nothing wrote to it. It is a plain join:
 * `(deal_id, visit_id)` with a UNIQUE on the pair, which is what makes marking
 * a Deal discussed idempotent rather than something that accumulates duplicate
 * rows every time a thumb brushes the checkbox.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ONE ROW AT A TIME AND NOT "REPLACE THE SET"
 *
 * §5.5 says the user marks "all, one, or none", which reads like a set and
 * tempts a `PUT` that deletes every row for the visit and re-inserts what was
 * posted. That would be a data-loss bug with no error message: the caller can
 * only send the Deals they can SEE, and the Deals scope on this screen is the
 * Deals scope of whoever is looking. A Sales Executive on Self scope opening a
 * meeting that a manager had already tagged with a colleague's Deal would post
 * a set that does not contain it, and the wholesale delete would quietly unlink
 * it. Nothing would throw; the link would simply be gone.
 *
 * A toggle can only ever touch the one Deal named, and that Deal has to survive
 * the scope check below, so an unreachable link cannot be removed by someone
 * who cannot see it.
 *
 * ---------------------------------------------------------------------------
 * THE TWO PERMISSIONS, AND WHY IT IS NOT `deals:edit`
 *
 * Tagging a Deal onto a meeting records something about the MEETING — what was
 * talked about — and changes nothing about the Deal itself: no stage, no value,
 * no owner. So it is gated on `meetings:edit` for the write, plus `deals:view`
 * to name a Deal at all. Requiring `deals:edit` would stop a rep who is allowed
 * to log their own meetings from saying which Deal one was about, which is the
 * whole feature.
 *
 * Both sides are then scope-checked independently, exactly as the meeting
 * screen's GET does: the visit against `meetings`, the Deal against `deals`.
 * Neither side is inferred from the other.
 */

type Side = { visitId: string; dealId: string; tenantId: string }

async function resolveSides(
  req: NextRequest,
  from: 'body' | 'query'
): Promise<Side | NextResponse> {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'edit')) return forbidden()
  if (!await checkPermission(user, 'deals', 'view')) return forbidden()

  let visitId: unknown
  let dealId: unknown
  if (from === 'body') {
    const body = await req.json().catch(() => ({}))
    visitId = body.visit_id
    dealId = body.deal_id
  } else {
    visitId = req.nextUrl.searchParams.get('visit_id')
    dealId = req.nextUrl.searchParams.get('deal_id')
  }

  if (typeof visitId !== 'string' || !visitId || typeof dealId !== 'string' || !dealId) {
    return NextResponse.json(
      { error: 'visit_id and deal_id are required' },
      { status: 400 }
    )
  }

  const tenantId = getTenantId()

  const visit = await prisma.daily_visits.findFirst({
    where: {
      id: visitId,
      tenant_id: tenantId,
      ...scopeWhere(await scopedUserIds(user, 'meetings')),
    },
    select: { id: true },
  })
  if (!visit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const deal = await prisma.deals.findFirst({
    where: {
      id: dealId,
      tenant_id: tenantId,
      ...scopeWhere(await scopedUserIds(user, 'deals'), 'owner_user_id'),
    },
    select: { id: true },
  })
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return { visitId: visit.id, dealId: deal.id, tenantId }
}

/** The Deals marked discussed in one meeting. */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  const visitId = req.nextUrl.searchParams.get('visit_id')
  if (!visitId) {
    return NextResponse.json({ error: 'visit_id is required' }, { status: 400 })
  }
  const tenantId = getTenantId()

  try {
    const visit = await prisma.daily_visits.findFirst({
      where: {
        id: visitId,
        tenant_id: tenantId,
        ...scopeWhere(await scopedUserIds(user, 'meetings')),
      },
      select: { id: true },
    })
    if (!visit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const rows = await prisma.deal_meetings.findMany({
      where: { tenant_id: tenantId, visit_id: visit.id },
      orderBy: { created_at: 'asc' },
    })
    return NextResponse.json(serialize(rows, 'deal_meetings'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/** Mark one Deal as discussed in this meeting. Idempotent. */
export async function POST(req: NextRequest) {
  const sides = await resolveSides(req, 'body')
  if (sides instanceof NextResponse) return sides

  try {
    /*
     * The UNIQUE on (deal_id, visit_id) turns a second tick into a constraint
     * violation, which Prisma throws — a 500 for an action the user reasonably
     * expects to be a no-op. `upsert` on that same compound unique makes the
     * repeat return the existing row instead, so a double-tap, a retried
     * request and two tabs all land on one row.
     */
    const row = await prisma.deal_meetings.upsert({
      where: { deal_id_visit_id: { deal_id: sides.dealId, visit_id: sides.visitId } },
      create: {
        tenant_id: sides.tenantId,
        deal_id: sides.dealId,
        visit_id: sides.visitId,
      },
      update: {},
    })
    return NextResponse.json(serialize(row, 'deal_meetings'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/** Unmark one Deal. */
export async function DELETE(req: NextRequest) {
  const sides = await resolveSides(req, 'query')
  if (sides instanceof NextResponse) return sides

  try {
    // deleteMany, so unticking something already unticked is a no-op rather
    // than a 500 on a row that is not there.
    await prisma.deal_meetings.deleteMany({
      where: {
        tenant_id: sides.tenantId,
        deal_id: sides.dealId,
        visit_id: sides.visitId,
      },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
