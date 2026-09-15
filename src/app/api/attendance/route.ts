import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json(null)

  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  try {
    // .single() left `data` null when there was no row and the route answered
    // null — findFirst's null takes the same branch. `date` is @db.Date.
    const data = await prisma.attendance.findFirst({
      where: {
        tenant_id: getTenantId(),
        user_id: user.userId ?? undefined,
        date: new Date(date),
      },
    })

    return NextResponse.json(data ? serialize(data, 'attendance') : null)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
