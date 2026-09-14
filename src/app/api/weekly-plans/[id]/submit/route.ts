import { NextRequest, NextResponse } from 'next/server'
import { prisma, dateOnlyString, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { awardPoint } from '@/lib/points'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const tid = getTenantId()

  try {
    const plan = await prisma.weekly_plans.findUnique({
      where: { id: params.id },
      select: { status: true, week_start_date: true },
    })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const allowed = ['Draft', 'Rejected', 'Edited by Manager']
    if (!allowed.includes(plan.status)) return NextResponse.json({ error: 'Cannot submit from current status' }, { status: 400 })

    const newStatus = plan.status === 'Draft' ? 'Submitted' : 'Resubmitted'
    const now = new Date()

    // updateMany, not update: the original had no .select().single(), so a
    // no-match was silent (PLAN.md 8.4).
    await prisma.weekly_plans.updateMany({
      where: { id: params.id },
      data: { status: newStatus, submitted_at: now, last_status_changed_at: now },
    })

    await prisma.weekly_plan_audit_logs.create({
      data: {
        tenant_id: tid, weekly_plan_id: params.id,
        actor_user_id: user.userId, actor_role: 'User',
        action_type: newStatus === 'Submitted' ? 'Submit' : 'Resubmit',
        previous_status: plan.status, new_status: newStatus,
      },
    })

    // Award points only for first-time on-time submission (not resubmit after rejection)
    if (newStatus === 'Submitted' && user.userId) {
      const today = new Date().toISOString().split('T')[0]
      // week_start_date is a Date now. Comparing a "YYYY-MM-DD" string against a
      // Date coerces the Date to "Mon Sep 14 2026 ..." and the comparison is
      // meaningless — so reduce it to the same date-only string first.
      const weekStart = dateOnlyString(plan.week_start_date)
      const onTime = Boolean(weekStart) && today <= weekStart
      if (onTime) {
        void awardPoint(null, tid, user.userId, 'weekly_plan_submitted', {
          refType: 'weekly_plan', refId: params.id,
          description: `Weekly plan submitted on time for week of ${weekStart}`,
        })
      }
    }

    return NextResponse.json({ ok: true, status: newStatus })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
