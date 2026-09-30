import { NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

/**
 * The org chart is a view of the user master — every node is a user and every
 * edge is `users.manager_user_id` — so it is governed by the `users` section,
 * the same grant that lets someone open the Users list. Administrators pass
 * through `checkPermission`'s own short-circuit.
 *
 * The section's data scope applies too: a Team-scoped manager sees themselves
 * and their reporting chain, an Own-scoped user sees only themselves, and
 * Company scope sees the whole tenant.
 */
export async function GET() {
  const user = await requireUser()
  if (!await checkPermission(user, 'users', 'view')) return forbidden()

  const tenantId = getTenantId()

  try {
    const ids = await scopedUserIds(user, 'users')
    const data = await prisma.users.findMany({
      where: { tenant_id: tenantId, status: 'Active', ...scopeWhere(ids, 'id') },
      select: {
        id: true, name: true, profile: true, manager_user_id: true,
        designations: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    })

    const result = data.map(u => ({
      id: u.id,
      name: u.name,
      role: u.designations?.name ?? u.profile ?? '',
      manager_user_id: u.manager_user_id ?? null,
    }))

    // Strings and nulls only — nothing to serialise.
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
