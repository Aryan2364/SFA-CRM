import { NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const user = await requireUser()

  try {
    // updateMany: the original had no .single(), so matching nothing was silent.
    await prisma.notifications.updateMany({
      where: { tenant_id: getTenantId(), recipient_id: user.userId ?? undefined, is_read: false },
      data: { is_read: true },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
