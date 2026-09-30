import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage, dateOnlyString } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { awardPoint, logAwardFailure } from '@/lib/points'
import { addDays, businessDate } from '@/lib/business-date'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json({ error: 'User not found' }, { status: 400 })

  const { latitude, longitude, address } = await req.json()
  // Business date, not the server's UTC date — see src/lib/business-date.ts.
  const today = businessDate()
  const yesterday = addDays(today, -1)
  const tid = getTenantId()

  try {
    /*
      The caller's most recent OPEN session — checked in, not checked out —
      dated today or yesterday, not just today's row. A rep who checked in at
      18:00 and taps Check out at 00:20 IST has no row for the new business
      date; looking only there answered "Check in first", and the screen then
      offered a check-in that would open a second day. Newest first, so an open
      row today always wins over a stale one from yesterday. Nothing older is
      reached: auto check-out closes those (`src/lib/auto-checkout.ts`), and a
      session two days open is not one a tap should close as "now".
    */
    const open = await prisma.attendance.findFirst({
      where: {
        tenant_id: tid,
        user_id: user.userId,
        date: { in: [new Date(today), new Date(yesterday)] },
        check_in_time: { not: null },
        check_out_time: null,
      },
      orderBy: { date: 'desc' },
      select: { id: true, date: true },
    })

    if (!open) {
      const todays = await prisma.attendance.findFirst({
        where: { tenant_id: tid, user_id: user.userId, date: new Date(today) },
        select: { check_in_time: true, check_out_time: true },
      })
      if (todays?.check_out_time) {
        return NextResponse.json({ error: 'Already checked out today' }, { status: 400 })
      }
      return NextResponse.json({ error: 'Check in first before checking out' }, { status: 400 })
    }

    // Conditional on still being open, so a double tap (or the auto check-out
    // sweep landing at the same moment) closes it once and the other gets the
    // "already checked out" answer rather than overwriting the stamp.
    const now = new Date()
    const { count } = await prisma.attendance.updateMany({
      where: { id: open.id, tenant_id: tid, check_out_time: null },
      data: {
        check_out_time: now,
        check_out_latitude: latitude ?? null,
        check_out_longitude: longitude ?? null,
        check_out_address: address ?? null,
        updated_at: now,
      },
    })
    if (count !== 1) {
      return NextResponse.json({ error: 'Already checked out' }, { status: 400 })
    }

    const closedDate = dateOnlyString(open.date)
    // The response is the row the attendance card should now show for TODAY.
    // Closing today's session, that is the closed row, as before. Closing
    // yesterday's, it is today's row — normally none (null), so the card goes
    // back to "Check in" for the new day instead of showing yesterday's closed
    // row under today's date.
    const data = await prisma.attendance.findFirst({
      where: { tenant_id: tid, user_id: user.userId, date: new Date(today) },
    })

    // The point is for the day the session belongs to, and so is its daily
    // cap: closing yesterday's session must not spend today's check-out point.
    void awardPoint(tid, user.userId, 'daily_checkout', { description: `Daily check-out on ${closedDate}`, forDate: closedDate })
      .catch(logAwardFailure('daily_checkout'))
    return NextResponse.json(data ? serialize(data, 'attendance') : null)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
