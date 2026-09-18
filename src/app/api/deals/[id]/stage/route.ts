import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { DEAL_LIST_INCLUDE, FUNNEL_STAGE_WHERE, daysInStage, shapeDeal } from '../../_shape'
import { findScopedDeal, notFound } from '../../_access'

export const dynamic = 'force-dynamic'

/**
 * `PATCH /api/deals/[id]/stage` — the Kanban drop target (§4.2, §4.4).
 *
 * Moving a Deal between stage columns is THREE writes that must all happen or
 * none of them:
 *
 *   1. `deals.deal_stage_id` = the new stage
 *   2. a `deal_stage_logs` row recording from → to, who, when, and how long the
 *      Deal stood in the stage it just left
 *   3. `deals.stage_entered_at` = now(), restarting the ageing clock (§4.7)
 *
 * They run in one `$transaction` for that reason. Half of this applied is worse
 * than none of it: a moved Deal with no log silently loses its history, and a
 * log written without the reset leaves the card showing an age measured from
 * the wrong stage — neither throws, and neither is visible until someone reads
 * the Logs tab weeks later.
 *
 * `days_in_previous_stage` is computed from the CURRENT `stage_entered_at`
 * before it is overwritten, which is the only moment that number is knowable.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  // A drop on the board is an edit of the Deal, so it is gated on 'edit' — not
  // 'view'. A read-only role can see the board and must not be able to move a
  // card on it.
  if (!await checkPermission(user, 'deals', 'edit')) return forbidden()

  const { deal_stage_id } = await req.json()
  if (!deal_stage_id) {
    return NextResponse.json({ error: 'deal_stage_id is required' }, { status: 400 })
  }

  const tid = getTenantId()

  try {
    const deal = await findScopedDeal(user, tid, params.id)
    if (!deal) return notFound()

    // The target stage must be a real funnel stage IN THIS TENANT. Without the
    // tenant filter a stage id from another tenant would be accepted, and
    // `Existing` is excluded because it is the "master record, not a lead"
    // sentinel, not a column anyone may drop a card into (see FUNNEL_STAGE_WHERE).
    const stage = await prisma.deal_stages.findFirst({
      where: { id: deal_stage_id, tenant_id: tid, ...FUNNEL_STAGE_WHERE },
      select: { id: true },
    })
    if (!stage) {
      return NextResponse.json({ error: 'Unknown deal stage' }, { status: 400 })
    }

    // A drop back onto the column the card came from is a no-op, not a log
    // entry: writing one would reset the ageing clock and make a Deal that has
    // been stuck for a month look fresh, which is precisely the signal §4.7
    // exists to give.
    if (deal.deal_stage_id === stage.id) {
      const unchanged = await prisma.deals.findFirstOrThrow({
        where: { id: deal.id, tenant_id: tid },
        include: DEAL_LIST_INCLUDE,
      })
      return NextResponse.json(shapeDeal(serialize(unchanged, 'deals') as Record<string, unknown>))
    }

    const now = new Date()
    const previousDays = daysInStage(deal.stage_entered_at)

    const [, updated] = await prisma.$transaction([
      prisma.deal_stage_logs.create({
        data: {
          tenant_id: tid,
          deal_id: deal.id,
          from_stage_id: deal.deal_stage_id,
          to_stage_id: stage.id,
          changed_by_user_id: user.userId || null,
          changed_at: now,
          // Null, not 0, when the Deal had no stage to leave — "it was never in
          // a stage" and "it was there for less than a day" are different facts.
          days_in_previous_stage: deal.deal_stage_id ? previousDays : null,
        },
      }),
      prisma.deals.update({
        where: { id: deal.id, tenant_id: tid },
        data: { deal_stage_id: stage.id, stage_entered_at: now, updated_at: now },
        include: DEAL_LIST_INCLUDE,
      }),
    ])

    return NextResponse.json(shapeDeal(serialize(updated, 'deals') as Record<string, unknown>))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
