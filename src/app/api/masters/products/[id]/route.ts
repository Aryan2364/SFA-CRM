import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'products', 'edit')) return forbidden()
  const body = await req.json()
  try {
    if (body.category_id && body.subcategory_id) {
      const sub = await prisma.product_subcategories.findUnique({
        where: { id: body.subcategory_id },
        select: { category_id: true },
      })
      if (!sub || sub.category_id !== body.category_id) {
        return NextResponse.json({ error: 'Subcategory does not belong to selected category' }, { status: 400 })
      }
    }
    const data = await prisma.products.update({
      where: { id: params.id, tenant_id: getTenantId() },
      data: body,
    })
    return NextResponse.json(serialize(data, 'products'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
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
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
