import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { DEAL_DETAIL_INCLUDE, DEAL_OUTCOMES, shapeDeal } from '../../_shape'
import { findScopedDeal, notFound } from '../../_access'
import { hasClosedStage, readStageType } from '@/lib/deal-stage-type'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/deals/[id]/close` — close a Deal Won or Lost (§4.6).
 *
 * Two rules, both from the brief and both enforced here rather than left to the
 * form:
 *
 *   - An outcome is compulsory and is one of `won` / `lost`. `deals_outcome_check`
 *     says the same thing in the database; the route says it so the caller gets
 *     a sentence and a 400 instead of a Prisma throw and a 500.
 *   - **Lost requires a Reason for Loss**, from the master. There is no CHECK
 *     that can express that — it is a conditional requirement across two
 *     columns — so this route is the only thing enforcing it. Without it, "why
 *     do we lose deals" has no answer, which is the whole point of the master.
 *
 * Won does NOT create an Order here. §4.6 is explicit that the software
 * *prompts* "do you want to punch the Order for this?" and that punching is not
 * compulsory — so the prompt belongs to the UI and the Order to `/api/orders`.
 * Creating one silently would be the opposite of what was asked.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'deals', 'edit')) return forbidden()

  const { outcome, reason_for_loss_id, deal_stage_id } = await req.json()

  if (!outcome || !(DEAL_OUTCOMES as readonly string[]).includes(outcome)) {
    return NextResponse.json(
      { error: "Outcome is required and must be 'won' or 'lost'" },
      { status: 400 }
    )
  }
  if (outcome === 'lost' && !reason_for_loss_id) {
    return NextResponse.json(
      { error: 'A Reason for Loss is required when a deal is marked lost' },
      { status: 400 }
    )
  }

  const tid = getTenantId()

  try {
    const deal = await findScopedDeal(user, tid, params.id)
    if (!deal) return notFound()

    // The reason must be a real row IN THIS TENANT — an id from another
    // tenant's master would otherwise be accepted by the FK and reported back
    // as this tenant's reason.
    if (outcome === 'lost') {
      const reason = await prisma.reason_for_loss.findFirst({
        where: { id: reason_for_loss_id, tenant_id: tid },
        select: { id: true },
      })
      if (!reason) {
        return NextResponse.json({ error: 'Unknown reason for loss' }, { status: 400 })
      }
    }

    const now = new Date()

    // `deal_stage_id` is optional and is the Won / Lost column on the board: a
    // closed Deal normally lands in a terminal stage. It is validated the same
    // way the drop target validates it, and moving it here writes a stage log
    // too — a close that changed the stage without one would be a gap in §4.4's
    // history exactly where it matters most.
    let targetStageId: string | null = null
    if (deal_stage_id && deal_stage_id !== deal.deal_stage_id) {
      const stage = await prisma.deal_stages.findFirst({
        where: { id: deal_stage_id, tenant_id: tid },
        select: { id: true },
      })
      if (!stage) return NextResponse.json({ error: 'Unknown deal stage' }, { status: 400 })

      // The stage a closing Deal lands in must be one the admin marked Closed
      // in the Lead Stages master — that setting is the whole meaning of
      // "nothing comes after this".
      //
      // Gated on the tenant having configured at least one Closed stage, which
      // is also false while `stage_type` is unpushed. A tenant that has not
      // marked any stage terminal keeps the previous behaviour exactly: any
      // stage is accepted. Refusing on an empty configuration would make
      // closing a Deal impossible with no screen to fix it from.
      if (await hasClosedStage(tid)) {
        const type = await readStageType(tid, stage.id)
        if (type !== 'Closed') {
          return NextResponse.json(
            { error: 'A deal being closed must move to a stage marked Closed in the Lead Stages master' },
            { status: 400 }
          )
        }
      }

      targetStageId = stage.id
    }

    const writes = []
    if (targetStageId) {
      writes.push(
        prisma.deal_stage_logs.create({
          data: {
            tenant_id: tid,
            deal_id: deal.id,
            from_stage_id: deal.deal_stage_id,
            to_stage_id: targetStageId,
            changed_by_user_id: user.userId || null,
            changed_at: now,
            days_in_previous_stage: deal.deal_stage_id
              ? Math.max(0, Math.floor((now.getTime() - deal.stage_entered_at.getTime()) / 86_400_000))
              : null,
          },
        })
      )
    }
    writes.push(
      prisma.deals.update({
        where: { id: deal.id, tenant_id: tid },
        data: {
          outcome,
          // Won clears any reason that a previous Lost close left behind —
          // otherwise a Deal reopened and won still carries "Price" forever.
          reason_for_loss_id: outcome === 'lost' ? reason_for_loss_id : null,
          closed_at: now,
          updated_at: now,
          ...(targetStageId ? { deal_stage_id: targetStageId, stage_entered_at: now } : {}),
        },
        include: DEAL_DETAIL_INCLUDE,
      })
    )

    const results = await prisma.$transaction(writes)
    const updated = results[results.length - 1] as Record<string, unknown>

    return NextResponse.json(shapeDeal(serialize(updated, 'deals') as Record<string, unknown>))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
