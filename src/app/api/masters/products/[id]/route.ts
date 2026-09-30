import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { firstForeignTenantRef } from '@/lib/tenant-fk'

/**
 * The columns PUT may write — same shape and reasoning as `UPDATABLE` in
 * `src/app/api/companies/[id]/_handlers.ts`, so the master routes read alike.
 *
 * This route used to do `prisma.products.update({ data: body })`, which made
 * EVERY column on `products` writable by anything that could reach the route —
 * `tenant_id` among them, so a crafted body could move a row out of the
 * caller's tenant. `id`, `created_at` and `updated_at` were writable too. A key
 * that is not on this list is ignored, not rejected, so a caller that posts its
 * whole form state back is unaffected.
 *
 * The list matches the POST sibling's destructure exactly — `name`,
 * `category_id`, `subcategory_id`, `price`, `sku` — which is also the whole of
 * what the Products form sends. `price` is `@db.Decimal`; the form already
 * sends a JS number and Prisma takes it, so it is passed through as this route
 * always has rather than coerced here.
 */
const UPDATABLE = [
  'name', 'category_id', 'subcategory_id', 'price', 'sku', 'is_active',
] as const

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'products', 'edit')) return forbidden()
  const body = await req.json()

  const updates: Record<string, unknown> = {}
  for (const key of UPDATABLE) if (key in body) updates[key] = body[key]
  // Trimmed as POST trims it — see the note in states/[id].
  if ('name' in updates) {
    if (typeof updates.name !== 'string' || !updates.name.trim())
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    updates.name = updates.name.trim()
  }

  const tid = getTenantId()
  try {
    // Both FKs reference a bare primary key — see src/lib/tenant-fk.ts. Each
    // is checked on its own, so re-pointing just one of them is covered too.
    const miss = await firstForeignTenantRef([
      { value: updates.category_id, label: 'Category',
        find: id => prisma.product_categories.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
      { value: updates.subcategory_id, label: 'Subcategory',
        find: id => prisma.product_subcategories.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    ])
    if (miss) return NextResponse.json({ error: miss }, { status: 400 })

    if (body.category_id && body.subcategory_id) {
      const sub = await prisma.product_subcategories.findFirst({
        where: { id: body.subcategory_id, tenant_id: tid },
        select: { category_id: true },
      })
      if (!sub || sub.category_id !== body.category_id) {
        return NextResponse.json({ error: 'Subcategory does not belong to selected category' }, { status: 400 })
      }
    }
    const data = await prisma.products.update({
      where: { id: params.id, tenant_id: tid },
      data: updates,
    })
    return NextResponse.json(serialize(data, 'products'))
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'products', 'delete')) return forbidden()
  try {
    // deleteMany, NOT delete — see the note in the other master [id] routes.
    await prisma.products.deleteMany({
      where: { id: params.id, tenant_id: getTenantId() },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
