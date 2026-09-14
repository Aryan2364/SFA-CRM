import { NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { getVisibleUserIds } from '@/lib/visibility'

export const dynamic = 'force-dynamic'

export async function GET() {
  const manager = await requireUser()
  const tenantId = getTenantId()
  const today = new Date().toISOString().split('T')[0]

  const subIds = await getVisibleUserIds(manager.userId!, null, tenantId)
  if (subIds.length === 0) return NextResponse.json([])

  try {
  const subs = await prisma.users.findMany({
    where: { id: { in: subIds }, tenant_id: tenantId, status: 'Active' },
    select: { id: true, name: true },
  })

  if (subs.length === 0) return NextResponse.json([])

  const activeSubIds = subs.map(s => s.id)

  // Current week range
  const now = new Date()
  const dayOfWeek = now.getDay()
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const weekStart = monday.toISOString().split('T')[0]
  const weekEnd = sunday.toISOString().split('T')[0]

  // All three date columns are @db.Date, so the "YYYY-MM-DD" strings become Dates.
  const [plans, visits, expenses] = await Promise.all([
    prisma.weekly_plans.findMany({
      where: { tenant_id: tenantId, user_id: { in: activeSubIds }, week_start_date: new Date(weekStart) },
      select: { id: true, user_id: true, status: true },
    }),
    prisma.daily_visits.findMany({
      where: { tenant_id: tenantId, user_id: { in: activeSubIds }, visit_date: new Date(today) },
      select: { user_id: true, status: true },
    }),
    prisma.expenses.findMany({
      where: { tenant_id: tenantId, user_id: { in: activeSubIds }, expense_date: new Date(today) },
      select: { user_id: true, amount: true },
    }),
  ])

  const planMap: Record<string, { id: string; status: string }> = {}
  for (const p of plans) planMap[p.user_id] = { id: p.id, status: p.status }

  const visitMap: Record<string, number> = {}
  for (const v of visits) {
    if (v.status === 'Completed') visitMap[v.user_id] = (visitMap[v.user_id] ?? 0) + 1
  }

  // amount is NUMERIC -> Decimal. Number() coerces it correctly, and the totals
  // leave this route as plain numbers.
  const expenseMap: Record<string, number> = {}
  for (const e of expenses) {
    expenseMap[e.user_id] = (expenseMap[e.user_id] ?? 0) + Number(e.amount)
  }

  const cards = subs.map(s => ({
    id: s.id,
    name: s.name,
    plan: planMap[s.id] ?? null,
    today_meetings: visitMap[s.id] ?? 0,
    today_expenses: expenseMap[s.id] ?? 0,
    week_start: weekStart,
    week_end: weekEnd,
  }))

  // weekStart/weekEnd are already "YYYY-MM-DD" strings built in JS; everything
  // else is a string or a number.
  return NextResponse.json(cards)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
