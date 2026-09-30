import { NextRequest, NextResponse } from 'next/server'
import { dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { DECISIONS } from '@/components/weekly-plan/approval-types'
import { awardOncePerPlan, expectedVersion, runDecision } from '../../_transition'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  const body = await req.json().catch(() => ({}))
  const comment: string | undefined = body.comment?.trim() || undefined
  const tid = getTenantId()

  try {
    // Status guard, audit row and notification in one transaction: see `runDecision`.
    const { response, ownerId } = await runDecision({
      user, tenantId: tid, planId: params.id,
      // The version the screen showed, so a stale screen cannot decide.
      expectedVersion: expectedVersion(body),
      allowedFrom: DECISIONS.approve.allowedFrom,
      newStatus: 'Approved',
      actionType: 'Approve',
      comment: comment ?? null,
      planData: comment ? { manager_comment: comment } : {},
      message: comment
        ? `Your weekly plan has been Approved. Comment: ${comment}`
        : 'Your weekly plan has been Approved.',
    })

    // Award points to plan owner for getting approved — after the commit, and
    // only for a transition that actually happened, so a repeat approve (now a
    // 409) never reaches this line.
    if (ownerId) {
      awardOncePerPlan(tid, ownerId, 'weekly_plan_approved', params.id, 'Weekly plan approved by manager')
    }

    return response
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
