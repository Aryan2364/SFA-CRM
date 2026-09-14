import { NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { getVisibleUserIds } from '@/lib/visibility'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  const tid = getTenantId()

  const visibleIds = await getVisibleUserIds(user.userId!, tid)
  const allowedIds = [user.userId!, ...visibleIds]

  try {
    // Return current user + their visible users
    const data = await prisma.users.findMany({
      where: { tenant_id: tid, id: { in: allowedIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    // Ids and names only — nothing to serialise.
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
