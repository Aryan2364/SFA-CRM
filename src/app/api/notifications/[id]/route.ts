import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Mark one notification read - or unread, with body `{ is_read: false }`.
 * No body (or no `is_read`) keeps the original behaviour: mark it read.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireUser()

  const body = await req.json().catch(() => null) as { is_read?: unknown } | null
  if (body && body.is_read !== undefined && typeof body.is_read !== 'boolean') {
    return NextResponse.json({ error: 'is_read must be true or false' }, { status: 400 })
  }
  const isRead = typeof body?.is_read === 'boolean' ? body.is_read : true

  try {
    // updateMany: no .single() in the original, and the recipient_id guard means
    // one user cannot mark another user's notification read.
    await prisma.notifications.updateMany({
      where: {
        id: params.id,
        tenant_id: getTenantId(),
        recipient_id: user.userId ?? undefined,
      },
      data: { is_read: isRead },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
