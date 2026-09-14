import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { getVisibleUserIds } from '@/lib/visibility'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const tid = getTenantId()

  const visibleIds = await getVisibleUserIds(user.userId!, null, tid)
  const allowedIds = [user.userId!, ...visibleIds]

  try {
    // .single() answered 404 on PGRST116 (no rows) and 500 on anything else.
    // findFirst's null is the no-row case; a genuine failure still throws.
    const order = await prisma.orders.findFirst({
      where: { id: params.id, tenant_id: tid, user_id: { in: allowedIds } },
      include: {
        order_items: true,
        users: { select: { name: true } },
      },
    })
    if (!order) return NextResponse.json({ error: 'No rows found' }, { status: 404 })
    return NextResponse.json(serialize(order, 'orders'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const { status } = await req.json() as { status: 'Draft' | 'Submitted' | 'Confirmed' }
  const tid = getTenantId()

  const visibleIds = await getVisibleUserIds(user.userId!, null, tid)
  const allowedIds = [user.userId!, ...visibleIds]

  try {
    // updateMany: no .single() in the original, so an order the caller cannot
    // see was a silent no-op rather than an error — and it must stay that way.
    await prisma.orders.updateMany({
      where: { id: params.id, tenant_id: tid, user_id: { in: allowedIds } },
      data: { status },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
