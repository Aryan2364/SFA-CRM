import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { awardPoint } from '@/lib/points'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json({ error: 'User not found' }, { status: 400 })

  const { latitude, longitude, address } = await req.json()
  const today = new Date().toISOString().split('T')[0]
  const tid = getTenantId()
  const todayDate = new Date(today)

  try {
    // Check if already checked in today
    const existing = await prisma.attendance.findFirst({
      where: { tenant_id: tid, user_id: user.userId ?? undefined, date: todayDate },
      select: { id: true, check_in_time: true },
    })

    if (existing?.check_in_time) {
      return NextResponse.json({ error: 'Already checked in today' }, { status: 400 })
    }

    const payload = {
      tenant_id: tid,
      user_id: user.userId!,
      date: todayDate,
      check_in_time: new Date(),
      check_in_latitude: latitude ?? null,
      check_in_longitude: longitude ?? null,
      check_in_address: address ?? null,
    }

    // Both branches ended in .select().single(), so both use the singular form.
    const data = existing
      ? await prisma.attendance.update({ where: { id: existing.id }, data: payload })
      : await prisma.attendance.create({ data: payload })

    void awardPoint(null, tid, user.userId, 'daily_checkin', { description: `Daily check-in on ${today}` })
    return NextResponse.json(serialize(data, 'attendance'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
