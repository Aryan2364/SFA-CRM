import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'


export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  // Reps need the category names to create an expense even without view on the expense-categories master.
  if (!await checkPermission(user, 'expense_categories', 'view') && !await checkPermission(user, 'expenses', 'create')) return forbidden()
  // Active rows only by default — the expense form's picker relies on that.
  // `?include_inactive=1` is for the master's own screen, where a deleted
  // (deactivated) category must stay visible to be reactivated.
  const includeInactive = req.nextUrl.searchParams.get('include_inactive') === '1'
  try {
    const data = await prisma.expense_categories.findMany({
      where: {
        tenant_id: getTenantId(),
        ...(includeInactive ? {} : { is_active: true }),
      },
      orderBy: { sort_order: 'asc' },
    })
    return NextResponse.json(serialize(data, 'expense_categories'))
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
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
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
