import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  if (!user.userId) return NextResponse.json(null)

  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  // ⚠️ This route answers ONE row, and Daily Activity reads it to decide whether
  // the caller has punched in. Widening it to the whole team would hand a
  // manager an arbitrary subordinate's row as if it were their own, so the
  // default target stays Self. `?userId=` is what the scope gates: it is
  // INTERSECTED with the allowed ids (never substituted, unlike
  // `orders/route.ts:57`), so a Self-scoped caller naming someone else gets
  // `[]` — no rows — rather than that person's attendance.
  const requested = req.nextUrl.searchParams.get('userId')
  const ids = requested
    ? intersectScope(await scopedUserIds(user, 'meetings'), requested)
    : [user.userId]

  try {
    // .single() left `data` null when there was no row and the route answered
    // null — findFirst's null takes the same branch. `date` is @db.Date.
    const data = await prisma.attendance.findFirst({
      where: {
        tenant_id: getTenantId(),
        ...scopeWhere(ids),
        date: new Date(date),
      },
    })

    return NextResponse.json(data ? serialize(data, 'attendance') : null)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
