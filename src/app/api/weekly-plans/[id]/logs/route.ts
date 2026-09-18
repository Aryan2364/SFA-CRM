import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { canView } from '@/lib/visibility'
import { readItemsDiff } from '@/lib/weekly-plan-diff'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  /*
    ⚠️ This handler did not call `requireUser()` at all — it leaned entirely on
    the middleware for authentication and then applied no authorisation, so any
    signed-in user in the tenant could read ANY plan's audit trail by id. That
    trail carries manager comments and rejection reasons, which is other
    people's feedback about other people's work.

    Read-only and tenant-scoped, so it is the mildest of the three gaps found on
    these routes — but it is the same shape, and it is fixed the same way: the
    section's view permission, then the owner-or-visible test the write verbs use.
  */
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    const plan = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { user_id: true },
    })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (!user.userId) return NextResponse.json({ error: 'User not in DB' }, { status: 400 })
    if (plan.user_id !== user.userId && !(await canView(user.userId, plan.user_id, tid))) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // `users!actor_user_id(name)` arrived under the key `users`, and the
    // introspected relation field is also called `users`, so no rename is needed.
    const data = await prisma.weekly_plan_audit_logs.findMany({
      where: { weekly_plan_id: params.id, tenant_id: tid },
      include: { users: { select: { name: true } } },
      orderBy: { timestamp: 'desc' },
    })
    /*
      §5.2: "The User must be able to see what changes his Manager made."

      `edited_fields` is a Json column that carried an unrenderable placeholder
      until this release. An `EditByManager` row now carries a before/after
      payload, and it is parsed HERE rather than in each screen — the manager's
      approval screen and the owner's own plan screen both read this endpoint,
      and a second copy of the version rules is a second place to get them
      wrong. `changes` is null for every other action type, and for the
      pre-release rows whose before/after was never recorded.
    */
    const rows = serialize(data, 'weekly_plan_audit_logs') as Record<string, unknown>[]
    return NextResponse.json(
      rows.map((row, i) => ({ ...row, changes: readItemsDiff(data[i].edited_fields) })),
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
