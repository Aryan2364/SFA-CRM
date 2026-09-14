import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { getVisibleUserIds } from '@/lib/visibility'
import { getDataScope } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

type OrderItem = {
  product_id?: string | null
  product_name: string
  qty: number
  rate: number
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

  const scope = await getDataScope(user, 'orders')
  let allowedIds: string[] | null = null
  if (scope === 'own') {
    allowedIds = [user.userId!]
  } else if (scope === 'team') {
    const visibleIds = await getVisibleUserIds(user.userId!, null, tid)
    allowedIds = [user.userId!, ...visibleIds]
  }
  // scope === 'all' → no user_id filter

  try {
    const rows = await prisma.orders.findMany({
      where: {
        tenant_id: tid,
        ...(userId ? { user_id: userId } : allowedIds ? { user_id: { in: allowedIds } } : {}),
        ...(status ? { status } : {}),
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

  const total = items.reduce((sum, i) => sum + i.qty * i.rate, 0)

  let orderId: string

  if (body.visit_id) {
    // --- Meeting-based flow (unchanged) ---
    const { visit_id, order_date } = body as { visit_id: string; order_date: string }
    if (!order_date) return NextResponse.json({ error: 'order_date is required' }, { status: 400 })

    try {
      // onConflict 'visit_id' maps directly: orders.visit_id is @unique.
      const values = {
        tenant_id: tenantId,
        user_id: user.userId!,
        order_date: new Date(order_date),
        total_amount: total,
      }
      const order = await prisma.orders.upsert({
        where: { visit_id },
        create: { ...values, visit_id },
        update: values,
      })
      orderId = order.id

      // deleteMany: the original .delete() never errored on zero matches.
      await prisma.order_items.deleteMany({ where: { order_id: orderId } })

      await prisma.order_items.createMany({
        data: items.map(i => ({
          tenant_id: tenantId,
          order_id: orderId,
          product_id: i.product_id ?? null,
          product_name: i.product_name,
          qty: i.qty,
          rate: i.rate,
          amount: i.qty * i.rate,
        })),
      })

      return NextResponse.json(
        { ...(serialize(order, 'orders') as Record<string, unknown>), total_amount: total },
        { status: 201 }
      )
    } catch (err) {
      return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
    }
  }

  // --- Direct order flow ---
  const { order_source, entity_type, entity_id, entity_name, sales_user_id, order_date, status } = body as {
    order_source: 'direct'
    entity_type: string
    entity_id: string | null
    entity_name: string
    sales_user_id?: string
    order_date: string
    status?: 'Draft' | 'Submitted' | 'Confirmed'
  }

  if (!entity_name || !order_date) {
    return NextResponse.json({ error: 'entity_name and order_date are required' }, { status: 400 })
  }

  const effectiveUserId = sales_user_id ?? user.userId!

  try {
    const order = await prisma.orders.create({
      data: {
        tenant_id: tenantId,
        user_id: effectiveUserId,
        order_source: 'direct',
        entity_type,
        entity_id,
        entity_name,
        order_date: new Date(order_date),
        status: status ?? 'Draft',
        total_amount: total,
      },
    })
    orderId = order.id

    await prisma.order_items.createMany({
      data: items.map(i => ({
        tenant_id: tenantId,
        order_id: orderId,
        product_id: i.product_id ?? null,
        product_name: i.product_name,
        qty: i.qty,
        rate: i.rate,
        amount: i.qty * i.rate,
      })),
    })

    return NextResponse.json(
      { ...(serialize(order, 'orders') as Record<string, unknown>), total_amount: total },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
