import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireUser()

  try {
    // updateMany: no .single() in the original, and the recipient_id guard means
    // one user cannot mark another user's notification read.
    await prisma.notifications.updateMany({
      where: {
        id: params.id,
        tenant_id: getTenantId(),
        recipient_id: user.userId ?? undefined,
      },
      data: { is_read: true },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
