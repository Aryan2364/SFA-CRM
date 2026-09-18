import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { toItemRows } from '../_items'
import { loadGoals, saveGoals } from '../_goals'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  const { items, day_notes, goals } = await req.json()
  const tid = getTenantId()

  try {
    // Every write below carries tenant_id as well as the plan id. The id alone
    // is a global key: without the tenant predicate a guessed uuid would let one
    // tenant rewrite another's plan, and nothing would crash.
    const target = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { id: true, user_id: true, status: true },
    })
    if (!target) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    /*
      ⚠️ This route had NO authorisation at all beyond "is logged in", and it
      replaces a plan's entire item list. Measured on the local database: signed
      in as one Standard user, `PUT` on a PEER's plan id returned 200 and deleted
      all six of their lines, writing an `Update` audit row under the attacker's
      user id. Nothing in the tenant filter catches that — both users are in the
      same tenant. This is the owner's own edit path (a manager has
      `edit-by-manager`), so the owner is the only caller it should ever accept.
    */
    if (!user.userId || target.user_id !== user.userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    /*
      ...and it did not check the status either, so the same call rewrote an
      APPROVED plan. `canEdit` on the screen gates every input on exactly these
      three statuses and `handleSubmit` only PUTs while the plan is in one of
      them, so this refuses precisely what the UI already refuses to send —
      rather than leaving the freeze as a client-side courtesy.
    */
    const EDITABLE = ['Draft', 'Rejected', 'Edited by Manager']
    if (!EDITABLE.includes(target.status)) {
      return NextResponse.json(
        { error: 'Plan is not editable in its current status' },
        { status: 400 },
      )
    }

    // Update plan-level fields
    const planUpdate: Record<string, unknown> = {}
    if (day_notes !== undefined) planUpdate.day_notes = day_notes
    if (Object.keys(planUpdate).length > 0) {
      await prisma.weekly_plans.updateMany({ where: { id: params.id, tenant_id: tid }, data: planUpdate })
    }

    // Replace items. deleteMany is required anyway (the original .delete() never
    // errored on zero matches), and plan_date is @db.Date so the incoming
    // "YYYY-MM-DD" strings must become Date objects.
    await prisma.weekly_plan_items.deleteMany({ where: { weekly_plan_id: params.id, tenant_id: tid } })
    const rows = toItemRows(items, tid, params.id)
    if (rows.length) await prisma.weekly_plan_items.createMany({ data: rows })

    // §5.1 checklist. Unlike items this is reconciled, not replaced — see
    // `_goals.ts`: the ids are the Weekly Review's tick targets.
    await saveGoals(params.id, tid, goals)

    // Update carries no status change, so previous_status/new_status stay null.
    await prisma.weekly_plan_audit_logs.create({
      data: {
        tenant_id: tid, weekly_plan_id: params.id,
        actor_user_id: user.userId, actor_role: 'User',
        action_type: 'Update',
        edited_fields: { items: 'updated' },
      },
    })

    const data = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      include: { weekly_plan_items: true },
    })
    if (!data) return NextResponse.json(null)

    return NextResponse.json({
      ...(serialize(data, 'weekly_plans') as Record<string, unknown>),
      weekly_goals: await loadGoals(params.id, tid),
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
