import { NextRequest, NextResponse } from 'next/server'
import { dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { DECISIONS } from '@/components/weekly-plan/approval-types'
import { expectedVersion, runDecision } from '../../_transition'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  // .catch: an empty or non-JSON body is the 400 below, not an unhandled throw.
  const body = await req.json().catch(() => ({}))
  const comment: string = typeof body.comment === 'string' ? body.comment.trim() : ''
  if (!comment) return NextResponse.json({ error: 'Comment is required for rejection' }, { status: 400 })
  const tid = getTenantId()

  try {
    const { response } = await runDecision({
      user, tenantId: tid, planId: params.id,
      // The version the screen showed, so a stale screen cannot decide.
      expectedVersion: expectedVersion(body),
      allowedFrom: DECISIONS.reject.allowedFrom,
      newStatus: 'Rejected',
      actionType: 'Reject',
      comment,
      planData: { manager_comment: comment },
      message: `Your weekly plan has been Rejected. Comment: ${comment}`,
    })
    return response
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
