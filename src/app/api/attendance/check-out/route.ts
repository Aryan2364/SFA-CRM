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

  try {
    const existing = await prisma.attendance.findFirst({
      where: { tenant_id: tid, user_id: user.userId ?? undefined, date: new Date(today) },
      select: { id: true, check_in_time: true, check_out_time: true },
    })

    if (!existing?.check_in_time) {
      return NextResponse.json({ error: 'Check in first before checking out' }, { status: 400 })
    }
    if (existing.check_out_time) {
      return NextResponse.json({ error: 'Already checked out today' }, { status: 400 })
    }

    const data = await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        check_out_time: new Date(),
        check_out_latitude: latitude ?? null,
        check_out_longitude: longitude ?? null,
        check_out_address: address ?? null,
      },
    })

    void awardPoint(tid, user.userId, 'daily_checkout', { description: `Daily check-out on ${today}` })
    return NextResponse.json(serialize(data, 'attendance'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
