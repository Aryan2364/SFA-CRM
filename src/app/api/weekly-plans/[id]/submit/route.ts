import { NextRequest, NextResponse } from 'next/server'
import { prisma, dateOnlyString, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { businessDate } from '@/lib/business-date'
import {
  CHANGED_SINCE_OPENED, StaleStatus, awardOncePerPlan, badVersion, claimStatus, expectedVersion, isPlanId, planNotFound, readPlanVersion,
} from '../../_transition'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  // .catch: the body is optional — an older client posts none.
  const expected = expectedVersion(await req.json().catch(() => ({})))
  if (expected === false) return badVersion()
  const tid = getTenantId()
  // Before the raw version SQL, whose `::uuid` cast would 500 on it.
  if (!isPlanId(params.id)) return planNotFound()

  try {
    /*
      ⚠️ This route selected only `{status, week_start_date}` — it never loaded
      `user_id`, so it could not check whose plan it was, and did not. Any
      authenticated caller could submit any other user's Draft for review, and
      the audit row was written under the caller's id. The plan id was also
      unfiltered by tenant, so it did not even stop at the tenant boundary.

      `tenant_id` on the lookup and an owner comparison close both. Submitting
      is the owner's act by definition: a manager has approve / reject / hold /
      edit-by-manager and none of them route through here.
    */
    // The version the owner's screen showed (or saved at). Without one — an
    // older client — the version read here, before the plan: that still stops
    // an overlapping write, just not a stale screen. See `readPlanVersion`.
    const version = expected ?? (await readPlanVersion(params.id, tid))
    const plan = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { status: true, week_start_date: true, user_id: true },
    })
    if (!plan || version === null) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (!user.userId || plan.user_id !== user.userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const allowed = ['Draft', 'Rejected', 'Edited by Manager']
    if (!allowed.includes(plan.status)) return NextResponse.json({ error: 'Cannot submit from current status' }, { status: 400 })

    const newStatus = plan.status === 'Draft' ? 'Submitted' : 'Resubmitted'
    const now = new Date()

    // Status write and audit row commit together or not at all. The write is
    // conditional on the status read above, so a double-click, a second tab or
    // an Undo racing this can make exactly one of them land.
    try {
      await prisma.$transaction(async tx => {
        await claimStatus(
          tx,
          { id: params.id, tenant_id: tid, status: plan.status },
          { status: newStatus, submitted_at: now, last_status_changed_at: now, updated_at: now },
          // ...and still at the version the owner saw, so a manager edit
          // landing on an Edited by Manager plan first is not submitted unseen.
          version,
        )
        await tx.weekly_plan_audit_logs.create({
          data: {
            tenant_id: tid, weekly_plan_id: params.id,
            actor_user_id: user.userId, actor_role: 'User',
            action_type: newStatus === 'Submitted' ? 'Submit' : 'Resubmit',
            previous_status: plan.status, new_status: newStatus,
          },
        })
      })
    } catch (err) {
      if (err instanceof StaleStatus) {
        // Either a second submit won, or a manager changed the plan first.
        return NextResponse.json({ error: CHANGED_SINCE_OPENED }, { status: 409 })
      }
      throw err
    }

    // Award points only for first-time on-time submission (not resubmit after rejection)
    if (newStatus === 'Submitted' && user.userId) {
      // Business date: on the server's UTC date a submission between 00:00 and
      // 05:30 IST on Tuesday still read as Monday and earned the on-time point.
      const today = businessDate()
      // week_start_date is a Date now. Comparing a "YYYY-MM-DD" string against a
      // Date coerces the Date to "Mon Sep 14 2026 ..." and the comparison is
      // meaningless — so reduce it to the same date-only string first.
      const weekStart = dateOnlyString(plan.week_start_date)
      const onTime = Boolean(weekStart) && today <= weekStart
      if (onTime) {
        // After the commit, logged on failure, and once per plan — so submit →
        // undo → submit does not pay out twice for one week.
        awardOncePerPlan(
          tid, user.userId, 'weekly_plan_submitted', params.id,
          `Weekly plan submitted on time for week of ${weekStart}`,
        )
      }
    }

    return NextResponse.json({ ok: true, status: newStatus })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
