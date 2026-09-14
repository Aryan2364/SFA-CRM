import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'products', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const categoryId = req.nextUrl.searchParams.get('categoryId')
  const tid = getTenantId()
  try {
    const data = await prisma.products.findMany({
      where: {
        tenant_id: tid,
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
      },
      include: {
        product_categories: { select: { name: true } },
        product_subcategories: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    })
    // `price` is NUMERIC. Prisma returns a Decimal whose toJSON() is a STRING,
    // so without serialize() the client would silently start receiving
    // "1234.50" where it used to receive 1234.5 (PLAN.md §5.1).
    return NextResponse.json(serialize(data, 'products'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'products', 'edit')) return forbidden()
  const { name, category_id, subcategory_id, price, sku } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!category_id) return NextResponse.json({ error: 'Category is required' }, { status: 400 })
  if (!subcategory_id) return NextResponse.json({ error: 'Subcategory is required' }, { status: 400 })
  if (price == null || isNaN(Number(price))) return NextResponse.json({ error: 'Valid price is required' }, { status: 400 })

  try {
    // Unchanged semantics: the previous .single() left `sub` null when the
    // subcategory did not exist, and the !sub branch produced this same 400.
    const sub = await prisma.product_subcategories.findUnique({
      where: { id: subcategory_id },
      select: { category_id: true },
    })
    if (!sub || sub.category_id !== category_id) {
      return NextResponse.json({ error: 'Subcategory does not belong to selected category' }, { status: 400 })
    }

    const data = await prisma.products.create({
      data: {
        name: name.trim(),
        category_id,
        subcategory_id,
        price: Number(price),
        sku: sku || null,
        tenant_id: getTenantId(),
      },
    })
    return NextResponse.json(serialize(data, 'products'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
