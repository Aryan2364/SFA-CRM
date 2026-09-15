import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'


export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  if (!await checkPermission(user, 'expense_categories', 'view')) return forbidden()
  try {
    const data = await prisma.expense_categories.findMany({
      where: {
        tenant_id: getTenantId(),
        is_active: true,
      },
      orderBy: { sort_order: 'asc' },
    })
    return NextResponse.json(serialize(data, 'expense_categories'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'expense_categories', 'create')) return forbidden()
  const { name, sort_order } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  try {
    const data = await prisma.expense_categories.create({
      data: { tenant_id: getTenantId(), name: name.trim(), sort_order: sort_order ?? 0 },
    })
    return NextResponse.json(serialize(data, 'expense_categories'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
