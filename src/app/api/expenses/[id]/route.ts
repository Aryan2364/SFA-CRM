import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { businessDate } from '@/lib/business-date'
import { checkPermission, forbidden } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
import { isOwnPhotoUrl, safePhotoUrl } from '../_photo'

export const dynamic = 'force-dynamic'

/**
 * `PUT`/`DELETE /api/expenses/[id]` — round 2 addition so the phone Expense
 * detail screen can edit/delete a row, following the same pattern as
 * `../route.ts`: `requireUser()` -> `checkPermission` -> data scope ->
 * tenant_id on every query -> `serialize()` / `dbErrorMessage()`.
 *
 * Both are owner-only, whatever the data scope: a manager with `team` or
 * `all` scope on `expenses` can read a report's entry but must not change or
 * delete it. PUT looks the row up through the data scope first, so a row the
 * caller cannot see is a 404 and one they can see but do not own is a 403
 * with a reason.
 */

async function findScoped(id: string, tid: string, user: Parameters<typeof checkPermission>[0]) {
  const ids = await scopedUserIds(user, 'expenses')
  return prisma.expenses.findFirst({
    where: { id, tenant_id: tid, ...scopeWhere(ids) },
  })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'expenses', 'edit')) return forbidden()
  if (!user.userId) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  const tid = getTenantId()

  try {
    const found = await findScoped(params.id, tid, user)
    if (!found) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    if (found.user_id !== user.userId) {
      return NextResponse.json({ error: 'Only the person who added this expense can edit it.' }, { status: 403 })
    }

    const { expense_date, category, amount, notes, photo_url } = await req.json()
    const data: Record<string, unknown> = { updated_at: new Date() }

    if (expense_date !== undefined) {
      const todayStr = businessDate()
      if (expense_date > todayStr) {
        return NextResponse.json({ error: 'Cannot set expenses for future dates' }, { status: 400 })
      }
      data.expense_date = new Date(expense_date)
    }
    if (category !== undefined) {
      if (!category) return NextResponse.json({ error: 'category is required' }, { status: 400 })
      data.category = category
    }
    if (amount !== undefined) {
      const amountNum = typeof amount === 'number' || typeof amount === 'string' ? Number(amount) : NaN
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        return NextResponse.json({ error: 'amount must be a number greater than 0' }, { status: 400 })
      }
      if (amountNum > 9_999_999_999.99) {
        return NextResponse.json({ error: 'amount is too large' }, { status: 400 })
      }
      data.amount = amountNum
    }
    if (notes !== undefined) data.notes = notes || null
    if (photo_url !== undefined) {
      if (photo_url && !isOwnPhotoUrl(photo_url, tid, user.userId)) {
        return NextResponse.json({ error: 'That photo cannot be attached to this expense' }, { status: 400 })
      }
      data.photo_url = photo_url || null
    }

    const updated = await prisma.expenses.update({
      where: { id: found.id, tenant_id: tid },
      data,
    })
    const row = serialize(updated, 'expenses') as Record<string, unknown>
    return NextResponse.json({ ...row, photo_url: safePhotoUrl(row.photo_url as string | null | undefined) })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'expenses', 'delete')) return forbidden()
  if (!user.userId) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  const tid = getTenantId()

  try {
    // Owner-only, whatever the data scope: a manager must not delete a team
    // member's expense. deleteMany, so a no-match (including another user's
    // expense) is a silent 200 no-op, as it always was (PLAN.md 8.4).
    await prisma.expenses.deleteMany({
      where: { id: params.id, tenant_id: tid, user_id: user.userId },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
