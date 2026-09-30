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
  // .catch: the comment is optional, so an empty body is a valid hold rather
  // than an unhandled throw.
  const body = await req.json().catch(() => ({}))
  const comment: string | null = (typeof body.comment === 'string' && body.comment.trim()) || null
  const tid = getTenantId()

  try {
    const { response } = await runDecision({
      user, tenantId: tid, planId: params.id,
      // The version the screen showed, so a stale screen cannot decide.
      expectedVersion: expectedVersion(body),
      allowedFrom: DECISIONS.hold.allowedFrom,
      newStatus: 'On Hold',
      actionType: 'Hold',
      comment,
      planData: { manager_comment: comment },
      message: comment
        ? `Your weekly plan has been put On Hold. Comment: ${comment}`
        : 'Your weekly plan has been put On Hold.',
    })
    return response
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
