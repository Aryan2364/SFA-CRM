import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { canView } from '@/lib/visibility'
import { toItemRows } from '../../_items'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  const { items, comment } = await req.json()
  const tid = getTenantId()

  try {
    const now = new Date()

    /*
      ⚠️ Same hole as `submit`, and worse in effect: this route REPLACES the
      plan's entire item list and forces the status to 'Edited by Manager', yet
      it selected only `{status}` — it never loaded `user_id`, so it had no
      authorisation of any kind. Any authenticated caller could rewrite any
      plan's lines while the audit row recorded them as actor_role 'Manager'.
      The unfiltered plan id meant it did not stop at the tenant boundary either.

      Every sibling manager verb (approve / reject / hold / suggest /
      accept-reopen / decline-reopen) gates on `canView(actor, owner, tenant)`;
      this one is now held to the same rule, so a manager edits exactly the plans
      they can already see and nobody else's.
    */
    const plan = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { status: true, user_id: true },
    })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (!user.userId || !(await canView(user.userId, plan.user_id, tid))) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // Replace items. deleteMany is required anyway (the original .delete() never
    // errored on zero matches), and plan_date is @db.Date so the incoming
    // "YYYY-MM-DD" strings must become Date objects.
    // Shares `toItemRows` with the user's own save path so a manager edit cannot
    // silently drop the party a line carries: the old `{ ...item }` spread wrote
    // back exactly the keys the manager screen happened to send, which is how a
    // new column gets lost the first time a manager touches a plan.
    await prisma.weekly_plan_items.deleteMany({ where: { weekly_plan_id: params.id, tenant_id: tid } })
    const rows = toItemRows(items, tid, params.id)
    if (rows.length) await prisma.weekly_plan_items.createMany({ data: rows })

    await prisma.weekly_plans.updateMany({
      where: { id: params.id, tenant_id: tid },
      data: { status: 'Edited by Manager', manager_comment: comment || null, last_status_changed_at: now },
    })

    await prisma.weekly_plan_audit_logs.create({
      data: {
        tenant_id: tid, weekly_plan_id: params.id,
        actor_user_id: user.userId, actor_role: 'Manager',
        action_type: 'EditByManager',
        previous_status: plan.status, new_status: 'Edited by Manager',
        comment: comment || null,
        edited_fields: { items: 'manager edited' },
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
