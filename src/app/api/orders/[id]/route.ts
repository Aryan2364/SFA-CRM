import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { getVisibleUserIds } from '@/lib/visibility'
import { checkPermission } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
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

    /*
     * §5.6's Order → Meeting direction, resolved HERE rather than left to the
     * drawer to infer from `visit_id`.
     *
     * `orders.visit_id` being set says an order was taken in a meeting; it does
     * NOT say the reader may open that meeting. The two records are scoped
     * separately — a manager can be handed a rep's order through the `orders`
     * scope while the `meetings` scope puts the visit out of reach, and the
     * reverse happens too. Rendering a link off the raw column would name a
     * party and a date the reader was never granted, and the click would then
     * 404, which is the worst of both.
     *
     * So the visit is re-read under `meetings:view` plus the `meetings` scope,
     * and `meeting` is null whenever that read finds nothing. Null means "no
     * link", never "no meeting": the drawer cannot tell the two apart and must
     * not try, because the only honest thing to do with either is show nothing.
     */
    let meeting: { id: string; entity_name: string; visit_date: string } | null = null
    if (order.visit_id && (await checkPermission(user, 'meetings', 'view'))) {
      const visit = await prisma.daily_visits.findFirst({
        where: {
          id: order.visit_id,
          tenant_id: tid,
          ...scopeWhere(await scopedUserIds(user, 'meetings')),
        },
        select: { id: true, entity_name: true, visit_date: true },
      })
      // `visit_date` is @db.Date; without the model name it would reach the
      // drawer as a full ISO timestamp and print the wrong day in IST.
      if (visit) {
        meeting = serialize(visit, 'daily_visits') as typeof meeting
      }
    }

    // `serialize` is declared `unknown` (it walks an arbitrary shape), so the
    // cast is what lets the one extra key be spread alongside it.
    const body = serialize(order, 'orders') as Record<string, unknown>
    return NextResponse.json({ ...body, meeting })
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
