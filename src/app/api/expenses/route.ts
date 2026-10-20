import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { awardPoint, logAwardFailure } from '@/lib/points'
import { businessDate } from '@/lib/business-date'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'
import { isOwnPhotoUrl, safePhotoUrl } from './_photo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  // `expenses` drove nav visibility only — no route enforced it before P4-T1.
  if (!await checkPermission(user, 'expenses', 'view')) return forbidden()
  if (!user.userId) return NextResponse.json([])
  // Self by default: this list is Daily Activity's Expenses tab, where the
  // caller enters their own expenses. Reviewing someone else's is
  // /api/review/expenses. `?userId=` can only narrow the `expenses` scope.
  const requested = req.nextUrl.searchParams.get('userId')
  const ids = requested
    ? intersectScope(await scopedUserIds(user, 'expenses'), requested)
    : [user.userId]
  // Two shapes: `?date=` (original, single day, used by the desktop Daily
  // Activity tab) or `?from=&to=` (inclusive range, added for the phone
  // Expenses list — newest first, across a week/month rather than one day).
  // Neither is required; with nothing given it falls back to today.
  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  const date = req.nextUrl.searchParams.get('date')
  // Phone Activity search (§41.5): a free-text query searches this caller's
  // own expenses across EVERY date — category or notes, case-insensitive.
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  // Strict "YYYY-MM-DD" format only (not calendar validity), matching the
  // pattern used elsewhere (e.g. src/app/api/journal/route.ts).
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
  if (from && !DATE_ONLY.test(from)) {
    return NextResponse.json({ error: 'from must be YYYY-MM-DD' }, { status: 400 })
  }
  if (to && !DATE_ONLY.test(to)) {
    return NextResponse.json({ error: 'to must be YYYY-MM-DD' }, { status: 400 })
  }
  const expenseDateFilter = from || to
    ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined }
    : new Date(date ?? businessDate())
  try {
    const data = await prisma.expenses.findMany({
      where: {
        tenant_id: getTenantId(),
        ...scopeWhere(ids),
        ...(q
          ? {
              OR: [
                { category: { contains: q, mode: 'insensitive' } },
                { notes: { contains: q, mode: 'insensitive' } },
              ],
            }
          : { expense_date: expenseDateFilter }), // expense_date is @db.Date.
      },
      orderBy: { created_at: q ? 'desc' : from || to ? 'desc' : 'asc' },
      ...(q ? { take: 25 } : {}),
    })
    // amount is NUMERIC and expense_date is DATE (PLAN.md 5.1).
    // photo_url is rendered as an <a href>; a row written before POST
    // validated it could hold any string, so anything that is not one of our
    // own photo paths goes out as null.
    return NextResponse.json(
      serialize(data.map(r => ({ ...r, photo_url: safePhotoUrl(r.photo_url) })), 'expenses')
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'expenses', 'create')) return forbidden()
  const { expense_date, category, amount, notes, photo_url } = await req.json()
  if (!expense_date || !category || amount === undefined || amount === null || amount === '') {
    return NextResponse.json({ error: 'expense_date, category and amount are required' }, { status: 400 })
  }
  // Number('abc') is NaN and Number('1e999') is Infinity; either reaches the
  // NUMERIC column and turns every report total that sums it into null.
  const amountNum = typeof amount === 'number' || typeof amount === 'string' ? Number(amount) : NaN
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'amount must be a number greater than 0' }, { status: 400 })
  }
  if (amountNum > 9_999_999_999.99) { // Decimal(12,2)
    return NextResponse.json({ error: 'amount is too large' }, { status: 400 })
  }
  // Business date, not the server's clock: between 00:00 and 05:30 IST the
  // UTC date is still yesterday and today's expense read as "future".
  const todayStr = businessDate()
  if (expense_date > todayStr) return NextResponse.json({ error: 'Cannot create expenses for future dates' }, { status: 400 })
  const tid = getTenantId()
  // photo_url comes from the body and the photo route authorises reads
  // through it, so it must name an object THIS user uploaded in THIS tenant —
  // proved by the tag the upload route put in the name (see ./_photo.ts).
  if (photo_url && !(user.userId && isOwnPhotoUrl(photo_url, tid, user.userId))) {
    return NextResponse.json({ error: 'Receipt photo not recognised. Upload it again.' }, { status: 400 })
  }
  try {
    const data = await prisma.expenses.create({
      data: {
        tenant_id: tid,
        user_id: user.userId!,
        expense_date: new Date(expense_date),
        category,
        amount: amountNum,
        notes: notes ?? null,
        photo_url: photo_url ?? null,
      },
    })
    void awardPoint(tid, user.userId!, 'expense_submitted', { refType: 'expense', refId: data.id, description: `${category} expense on ${expense_date}` })
      .catch(logAwardFailure('expense_submitted'))
    return NextResponse.json(serialize(data, 'expenses'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
