import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { getVisibleUserIds } from '@/lib/visibility'
import { scopedUserIds } from '@/lib/scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  const tid = getTenantId()

  const visibleIds = await getVisibleUserIds(user.userId!, tid)
  let allowedIds = [user.userId!, ...visibleIds]

  // `?for=orders` — the people the caller may RECORD an order for, i.e. the
  // chain narrowed to their `orders` data scope, which is what `POST
  // /api/orders` enforces. Without it an own-scope manager was offered their
  // whole team and got a 403 on save. Opt-in, because the Deals owner filter
  // reads the plain chain from this same route.
  const forOrders = req.nextUrl.searchParams.get('for') === 'orders'
  if (forOrders) {
    const scoped = await scopedUserIds(user, 'orders')
    if (scoped) allowedIds = allowedIds.filter(id => scoped.includes(id))
  }

  try {
    // Return current user + their visible users
    const data = await prisma.users.findMany({
      where: { tenant_id: tid, id: { in: allowedIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    // Ids and names only — nothing to serialise. `self` marks the caller so
    // the order dialog can preselect them; only added in the opt-in shape.
    return NextResponse.json(
      forOrders ? data.map(u => (u.id === user.userId ? { ...u, self: true } : u)) : data
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
