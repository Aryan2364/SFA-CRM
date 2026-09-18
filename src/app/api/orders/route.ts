import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { getVisibleUserIds } from '@/lib/visibility'
import { getDataScope } from '@/lib/permissions'
import {
  isOrderStatus,
  orderTotals,
  type DiscountType,
  type LineInput,
  type OrderStatus,
} from '@/lib/order-math'

export const dynamic = 'force-dynamic'

/**
 * What the browser posts for one line.
 *
 * `rate` and `product_name` are both OPTIONAL, and for a line that carries
 * a `product_id` both are ignored: the route reads `products.price` and
 * `products.name` instead. They survive on the type because a FREE-TEXT
 * line — no `product_id`, which the meeting-order modal allows for
 * something not yet in the master — has no row to read them from, and
 * because the existing screens still send them.
 */
type OrderItem = {
  product_id?: string | null
  product_name?: string | null
  qty: number
  rate?: number | null
  discount_type?: DiscountType | string | null
  discount_value?: number | string | null
}

/** A line after the server has decided what it actually costs and is called. */
type PricedLine = LineInput & { product_id: string | null; product_name: string }

/**
 * THE MASTER IS THE AUTHORITY (REBUILD-PLAN §4.10, P2-T13).
 *
 * One lookup decides BOTH of a line's facts. Every line with a
 * `product_id` takes its rate from `products.price` and its name from
 * `products.name`, tenant-scoped, and whatever was posted for either is
 * discarded. Only a free-text line — no `product_id`, which the
 * meeting-order modal allows for something not yet in the master — keeps
 * what was typed, because there is no row to read it from.
 *
 * For the RATE this is about trust: without it, §7.4's "Discount Given by
 * Sales Person" reports over numbers the sales person typed, and a rep
 * could post `rate: 1` with no discount and take the whole margin without
 * appearing in the discount report at all.
 *
 * For the NAME it is about what the column is FOR. `order_items.
 * product_name` is NOT NULL and is a denormalised SNAPSHOT — it exists so
 * the line still reads correctly after the product is renamed or deleted.
 * A snapshot the client supplies is not a snapshot of anything; and since
 * the row is already being read for the price, asking the caller for the
 * name was requiring a field the server was holding in its hand. It used
 * to be mandatory on the wire, and a caller that omitted it got Prisma's
 * `Argument \`product_name\` is missing` as a 500.
 *
 * A `product_id` that does not resolve inside the tenant is an error, not
 * a fallback to what was posted — falling back would hand a tamperer
 * exactly what they wanted by sending a bogus id. A free-text line with
 * no name is the same error for the same reason: the column is NOT NULL,
 * so the alternative is a 500 from the database.
 */
async function priceLines(
  tenantId: string,
  items: OrderItem[]
): Promise<{ lines: PricedLine[] } | { error: string }> {
  const ids = [...new Set(items.map(i => i.product_id).filter((v): v is string => !!v))]

  const products = ids.length
    ? await prisma.products.findMany({
        where: { tenant_id: tenantId, id: { in: ids } },
        select: { id: true, name: true, price: true },
      })
    : []
  const byId = new Map(products.map(p => [p.id, p]))

  const missing = ids.filter(id => !byId.has(id))
  if (missing.length > 0) {
    return { error: `Unknown product: ${missing.join(', ')}` }
  }

  const unnamed = items.filter(i => !i.product_id && !String(i.product_name ?? '').trim())
  if (unnamed.length > 0) {
    return { error: 'Every line needs a product_id or a product_name' }
  }

  return {
    lines: items.map(i => {
      const master = i.product_id ? byId.get(i.product_id)! : null
      return {
        product_id: i.product_id ?? null,
        product_name: master ? master.name : String(i.product_name).trim(),
        qty: i.qty,
        rate: master ? Number(master.price) : Number(i.rate) || 0,
        discount_type: i.discount_type,
        discount_value: i.discount_value,
      }
    }),
  }
}

/**
 * REBUILD-PLAN §3.5 — an order against an Incomplete party stays Draft
 * and cannot be Placed.
 *
 * Returns the reason it cannot, or `null` if it can. The reason is
 * written to `orders.blocked_reason` as well as returned, so the record
 * says why it is stuck rather than only the rejected request saying so.
 *
 * A party with no `entity_id` at all — the modal's "New" mode, which
 * posts a typed name and nothing else — is not complete either. Nothing
 * has been saved about it beyond a name, which is strictly less than
 * the Incomplete case, so it gets the stricter answer rather than
 * slipping through the gate by having no record to fail.
 */
async function placementBlock(
  tenantId: string,
  entityId: string | null | undefined
): Promise<string | null> {
  if (!entityId) return 'Party is not a saved record'

  const party = await prisma.companies.findFirst({
    where: { id: entityId, tenant_id: tenantId },
    select: { is_complete: true, completeness_missing: true },
  })
  if (!party) return 'Party is not a saved record'
  if (party.is_complete) return null

  return `Party is incomplete: ${party.completeness_missing || 'required details missing'}`
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  const tid = getTenantId()
  const visitId = req.nextUrl.searchParams.get('visitId')

  // Single-order mode (used by OrderEntryModal in Daily Activity — unchanged).
  // PGRST116 (no rows) was tolerated and answered null; every other error was a
  // 500. findFirst returns null for the no-row case and throws only on real
  // failures, so both branches survive.
  if (visitId) {
    try {
      const order = await prisma.orders.findFirst({
        where: { tenant_id: tid, visit_id: visitId },
        include: { order_items: true },
      })
      return NextResponse.json(order ? serialize(order, 'orders') : null)
    } catch (err) {
      return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
    }
  }

  // List mode — scope based on role's data_scope setting
  const status = req.nextUrl.searchParams.get('status')
  const dateFrom = req.nextUrl.searchParams.get('dateFrom')
  const dateTo = req.nextUrl.searchParams.get('dateTo')
  const userId = req.nextUrl.searchParams.get('userId')
  const q = req.nextUrl.searchParams.get('q')
  /*
   * §5.5's "View All goes to the Orders page with the Company filter applied
   * automatically" (P3-T9).
   *
   * It is a separate parameter from `q` because `q` CANNOT express it. `q`
   * matches `entity_name`, and the meeting branch of POST below writes neither
   * `entity_type` nor `entity_id` nor `entity_name` — so every order punched
   * against a meeting has a NULL party name and is invisible to a name search,
   * while being one of that company's orders. A name filter would therefore
   * show a party's direct orders and silently drop the ones taken in front of
   * them, which is the worse of the two failures because nothing looks wrong.
   *
   * So the company is matched the same way the meeting screen matches it: by
   * id, through BOTH routes an order can reach a party — its own `entity_id`,
   * or the visit it was taken at. `tenant_id` is repeated inside the relation
   * filter; it is redundant against the outer predicate and it stays, because
   * a relation filter reaching another tenant's visit is exactly the mistake
   * that leaks with nothing crashing.
   */
  const entityId = req.nextUrl.searchParams.get('entityId')
  /* §7.2's "Discount Applied (Yes/No)" dimension, as a list filter. The
     column is stored rather than derived precisely so this is an index
     lookup and not a scan over the line items. */
  const discounted = req.nextUrl.searchParams.get('discounted')

  const scope = await getDataScope(user, 'orders')
  let allowedIds: string[] | null = null
  if (scope === 'own') {
    allowedIds = [user.userId!]
  } else if (scope === 'team') {
    const visibleIds = await getVisibleUserIds(user.userId!, tid)
    allowedIds = [user.userId!, ...visibleIds]
  }
  // scope === 'all' → no user_id filter

  try {
    const rows = await prisma.orders.findMany({
      where: {
        tenant_id: tid,
        ...(userId ? { user_id: userId } : allowedIds ? { user_id: { in: allowedIds } } : {}),
        ...(status ? { status } : {}),
        ...(discounted === 'yes' ? { has_discount: true } : {}),
        ...(discounted === 'no' ? { has_discount: false } : {}),
        // order_date is @db.Date, so the bounds have to be Date objects.
        ...(dateFrom || dateTo
          ? {
              order_date: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {}),
              },
            }
          : {}),
        ...(q ? { entity_name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(entityId
          ? {
              OR: [
                { entity_id: entityId },
                { daily_visits: { is: { tenant_id: tid, entity_id: entityId } } },
              ],
            }
          : {}),
      },
      include: {
        // `order_items(count)` -> the _count aggregate.
        _count: { select: { order_items: true } },
        // `users!orders_user_id_fkey(name)` -> the relation field is already
        // called `users`, which is the key the client reads.
        users: { select: { name: true } },
      },
      // Two .order() calls become an ORDERED array.
      orderBy: [{ order_date: 'desc' }, { created_at: 'desc' }],
    })

    // PostgREST returned a nested count as `order_items: [{ count: N }]`.
    // Prisma reports it as `_count.order_items`, so reshape it back — the wire
    // format stays byte-compatible even though the orders page ignores it.
    const data = (serialize(rows, 'orders') as Record<string, unknown>[]).map(row => {
      const { _count, ...rest } = row as { _count?: { order_items: number } }
      return { ...rest, order_items: [{ count: _count?.order_items ?? 0 }] }
    })

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  const body = await req.json()
  const tenantId = getTenantId()

  const items: OrderItem[] = body.items ?? []
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items are required' }, { status: 400 })
  }

  // Authoritative rates first — everything below is computed from these,
  // never from what was posted.
  const priced = await priceLines(tenantId, items)
  if ('error' in priced) {
    return NextResponse.json({ error: priced.error }, { status: 400 })
  }

  const totals = orderTotals(
    priced.lines,
    body.order_discount_type,
    body.order_discount_value
  )

  /** The order row's money columns, in the one shape both branches write. */
  const money = {
    gross_amount: totals.gross_amount,
    item_discount_total: totals.item_discount_total,
    order_discount_type: totals.order_discount_type,
    order_discount_value: totals.order_discount_value,
    order_discount_amount: totals.order_discount_amount,
    has_discount: totals.has_discount,
    total_amount: totals.total_amount,
  }

  /** The line rows, in the shape `order_items` wants. */
  const itemRows = (orderId: string) =>
    priced.lines.map((i, idx) => ({
      tenant_id: tenantId,
      order_id: orderId,
      product_id: i.product_id,
      product_name: i.product_name,
      qty: i.qty,
      rate: i.rate,
      gross_amount: totals.lines[idx].gross_amount,
      discount_type: totals.lines[idx].discount_type,
      discount_value: totals.lines[idx].discount_value,
      discount_amount: totals.lines[idx].discount_amount,
      amount: totals.lines[idx].amount,
    }))

  if (body.visit_id) {
    // --- Meeting-based flow ---
    const { visit_id, order_date } = body as { visit_id: string; order_date: string }
    if (!order_date) return NextResponse.json({ error: 'order_date is required' }, { status: 400 })

    try {
      // ONE TRANSACTION. This branch is a re-punch as often as it is a
      // first punch, so between the deleteMany and the createMany the
      // order exists with NO lines at all. Outside a transaction, a
      // failure in the insert would leave a previously-correct order
      // stripped of every item and still carrying its old total — worse
      // than the empty-order case in the create branch, because the row
      // looks established rather than new. See the direct branch below
      // for the rest of the reasoning.
      const order = await prisma.$transaction(async tx => {
        // onConflict 'visit_id' maps directly: orders.visit_id is @unique.
        //
        // `status` is set EXPLICITLY rather than inherited from the column
        // default. The default is a leftover from the three-state model and
        // is not one of §4.10's two words; a meeting order that has just
        // been punched has not been placed, so it is a Draft.
        const values = {
          tenant_id: tenantId,
          user_id: user.userId!,
          order_date: new Date(order_date),
          status: 'Draft' as OrderStatus,
          ...money,
        }
        const row = await tx.orders.upsert({
          where: { visit_id },
          create: { ...values, visit_id },
          update: values,
        })

        // deleteMany: the original .delete() never errored on zero matches.
        await tx.order_items.deleteMany({ where: { order_id: row.id } })
        await tx.order_items.createMany({ data: itemRows(row.id) })
        return row
      })

      return NextResponse.json(
        { ...(serialize(order, 'orders') as Record<string, unknown>), ...money },
        { status: 201 }
      )
    } catch (err) {
      return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
    }
  }

  // --- Direct order flow ---
  const { entity_type, entity_id, entity_name, sales_user_id, order_date, status } = body as {
    order_source: 'direct'
    entity_type: string
    entity_id: string | null
    entity_name: string
    sales_user_id?: string
    order_date: string
    status?: string
  }

  if (!entity_name || !order_date) {
    return NextResponse.json({ error: 'entity_name and order_date are required' }, { status: 400 })
  }

  // §4.10: two states and no third. An absent status is a Draft; an
  // unrecognised one is a 400 rather than a silent write, because the
  // CHECK constraint would otherwise turn a typo into a 500.
  const requested: OrderStatus = status === undefined || status === null ? 'Draft' : status as OrderStatus
  if (!isOrderStatus(requested)) {
    return NextResponse.json({ error: "status must be 'Draft' or 'Placed'" }, { status: 400 })
  }

  // §3.5: Placed is only reachable against a complete party.
  const block = requested === 'Placed' ? await placementBlock(tenantId, entity_id) : null
  if (block) {
    return NextResponse.json(
      { error: `Cannot place this order. ${block}`, blocked_reason: block },
      { status: 400 }
    )
  }

  const effectiveUserId = sales_user_id ?? user.userId!

  try {
    // ONE TRANSACTION. An order and its lines are a single fact, and
    // writing them as two statements meant a failure in the second left
    // the first behind: an order with ZERO line items and a total of 0,
    // committed and permanent, while the caller got an error and
    // reasonably assumed nothing had been written.
    //
    // Nothing downstream can tell that row from a real one. It is counted
    // by the orders list, by every report that counts orders, and by
    // §7.7's "Pending Draft Orders" health alert — which is precisely the
    // alert meant to surface orders that are genuinely stuck. A phantom
    // order is silent, permanent and indistinguishable from a real
    // problem, which is the worst combination of the three.
    const order = await prisma.$transaction(async tx => {
      const row = await tx.orders.create({
        data: {
          tenant_id: tenantId,
          user_id: effectiveUserId,
          order_source: 'direct',
          entity_type,
          entity_id,
          entity_name,
          order_date: new Date(order_date),
          status: requested,
          ...money,
        },
      })
      await tx.order_items.createMany({ data: itemRows(row.id) })
      return row
    })

    return NextResponse.json(
      { ...(serialize(order, 'orders') as Record<string, unknown>), ...money },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
