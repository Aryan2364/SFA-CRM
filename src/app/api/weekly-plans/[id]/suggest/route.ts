import { NextRequest, NextResponse } from 'next/server'
import { dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { DECISIONS } from '@/components/weekly-plan/approval-types'
import { expectedVersion, runDecision } from '../../_transition'

/**
 * "Suggest changes" sends the plan BACK to its owner, editable.
 *
 * It used to write 'On Hold' — identical to Hold, and the one returned status
 * the owner cannot edit (`[id]/route.ts` PUT and `submit` accept only Draft /
 * Rejected / Edited by Manager). The owner was told "make these changes" and
 * had no Save and no Submit, only a Request Reopen round-trip.
 *
 * It now writes 'Edited by Manager' — an existing CHECK-permitted value, and
 * the one that already means "your manager sent this back to you": editable,
 * resubmits to 'Resubmitted' (so no fresh on-time point), and sits under the
 * manager's In progress tab until then. The audit row's 'Suggest' action is
 * what tells the owner's screen this was a suggestion rather than a line
 * edit, and `manager_comment` carries the suggestion text it shows.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  // .catch: an empty or non-JSON body is the 400 below, not an unhandled throw.
  const body = await req.json().catch(() => ({}))
  const comment: string = typeof body.comment === 'string' ? body.comment.trim() : ''
  if (!comment) return NextResponse.json({ error: 'Comment is required for suggestion' }, { status: 400 })
  const tid = getTenantId()

  try {
    const { response } = await runDecision({
      user, tenantId: tid, planId: params.id,
      // The version the screen showed, so a stale screen cannot decide.
      expectedVersion: expectedVersion(body),
      allowedFrom: DECISIONS.suggest.allowedFrom,
      newStatus: 'Edited by Manager',
      actionType: 'Suggest',
      comment,
      planData: { manager_comment: comment },
      message: `Manager has suggested changes to your weekly plan: ${comment}`,
    })
    return response
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
