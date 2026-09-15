import { NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json([])

  try {
    const rows = await prisma.notifications.findMany({
      where: { tenant_id: getTenantId(), recipient_id: user.userId },
      include: { users_notifications_actor_idTousers: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
      take: 50,
    })

    // `actor:actor_id(name)` was an ALIASED embed. notifications has TWO
    // relations to users (actor and recipient), so the introspected field name
    // is disambiguated — rename it back to `actor`, the only key the client saw.
    const data = (serialize(rows, 'notifications') as Record<string, unknown>[])
      .map(({ users_notifications_actor_idTousers, ...rest }) => ({
        ...rest,
        actor: users_notifications_actor_idTousers ?? null,
      }))

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
