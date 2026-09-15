import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { awardPoint } from '@/lib/points'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  try {
    const data = await prisma.expenses.findMany({
      where: {
        tenant_id: getTenantId(),
        user_id: user.userId ?? undefined,
        // expense_date is @db.Date.
        expense_date: new Date(date),
      },
      orderBy: { created_at: 'asc' },
    })
    // amount is NUMERIC and expense_date is DATE (PLAN.md 5.1).
    return NextResponse.json(serialize(data, 'expenses'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  const { expense_date, category, amount, notes, photo_url } = await req.json()
  if (!expense_date || !category || !amount) {
    return NextResponse.json({ error: 'expense_date, category and amount are required' }, { status: 400 })
  }
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  if (expense_date > todayStr) return NextResponse.json({ error: 'Cannot create expenses for future dates' }, { status: 400 })
  const tid = getTenantId()
  try {
    const data = await prisma.expenses.create({
      data: {
        tenant_id: tid,
        user_id: user.userId!,
        expense_date: new Date(expense_date),
        category,
        amount: Number(amount),
        notes: notes ?? null,
        photo_url: photo_url ?? null,
      },
    })
    void awardPoint(tid, user.userId!, 'expense_submitted', { refType: 'expense', refId: data.id, description: `${category} expense on ${expense_date}` })
    return NextResponse.json(serialize(data, 'expenses'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
