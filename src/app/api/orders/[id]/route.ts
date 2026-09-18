import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { getVisibleUserIds } from '@/lib/visibility'
import { isOrderStatus, type OrderStatus } from '@/lib/order-math'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const tid = getTenantId()

  const visibleIds = await getVisibleUserIds(user.userId!, tid)
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
  const body = await req.json() as { status?: unknown }
  const tid = getTenantId()

  // Real validation. Until §4.10 this route wrote whatever string arrived,
  // which the CHECK constraint now turns into a 500 — so the shape is
  // checked here and a bad word is a 400 with a sentence in it.
  if (!isOrderStatus(body.status)) {
    return NextResponse.json({ error: "status must be 'Draft' or 'Placed'" }, { status: 400 })
  }
  const status: OrderStatus = body.status

  const visibleIds = await getVisibleUserIds(user.userId!, tid)
  const allowedIds = [user.userId!, ...visibleIds]

  try {
    // The order has to be READ before it is written, which it did not have
    // to be before: §3.5's gate is a fact about the order's party, not
    // about the request, so there is nothing in the body to check it
    // against. Scoped exactly as the updateMany was, so an order the caller
    // cannot see still behaves as it always did.
    const order = await prisma.orders.findFirst({
      where: { id: params.id, tenant_id: tid, user_id: { in: allowedIds } },
      select: { id: true, entity_id: true },
    })
    // No .single() in the original, so an invisible order was a silent
    // no-op rather than an error — and it must stay that way.
    if (!order) return NextResponse.json({ ok: true })

    if (status === 'Placed') {
      // REBUILD-PLAN §3.5 — an order against an Incomplete party stays
      // Draft and cannot be Placed. The reason is STORED as well as
      // returned: the request that was refused goes away, the row does
      // not, and the row is where somebody looks to find out why an order
      // is stuck.
      const party = order.entity_id
        ? await prisma.companies.findFirst({
            where: { id: order.entity_id, tenant_id: tid },
            select: { is_complete: true, completeness_missing: true },
          })
        : null

      const blocked = !party
        ? 'Party is not a saved record'
        : party.is_complete
          ? null
          : `Party is incomplete: ${party.completeness_missing || 'required details missing'}`

      if (blocked) {
        await prisma.orders.update({
          where: { id: order.id },
          data: { blocked_reason: blocked },
        })
        return NextResponse.json(
          { error: `Cannot place this order. ${blocked}`, blocked_reason: blocked },
          { status: 400 }
        )
      }
    }

    await prisma.orders.update({
      where: { id: order.id },
      // Whatever blocked it last time no longer applies: either it has just
      // been placed, or it has been put back to Draft on purpose.
      data: { status, blocked_reason: null },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
