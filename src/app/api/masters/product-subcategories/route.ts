import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { firstForeignTenantRef } from '@/lib/tenant-fk'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'product_subcategories', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const category_id = req.nextUrl.searchParams.get('categoryId')
  const tid = getTenantId()
  try {
    const data = await prisma.product_subcategories.findMany({
      where: {
        tenant_id: tid,
        // .ilike('name', `%q%`) -> case-insensitive contains.
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(category_id ? { category_id } : {}),
      },
      include: { product_categories: { select: { name: true } } },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(serialize(data, 'product_subcategories'))
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'product_subcategories', 'edit')) return forbidden()
  const { name, category_id } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!category_id) return NextResponse.json({ error: 'Category is required' }, { status: 400 })
  const tid = getTenantId()
  try {
    // The FK references a bare primary key, so another tenant's category would
    // be accepted — see src/lib/tenant-fk.ts.
    const miss = await firstForeignTenantRef([
      { value: category_id, label: 'Category',
        find: id => prisma.product_categories.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    ])
    if (miss) return NextResponse.json({ error: miss }, { status: 400 })

    const data = await prisma.product_subcategories.create({
      data: {
        name: name.trim(),
        category_id: category_id,
        tenant_id: tid,
      },
    })
    return NextResponse.json(serialize(data, 'product_subcategories'), { status: 201 })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
