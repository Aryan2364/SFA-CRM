import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireUser()
  // The screen already hides Delete without `expenses.delete`; the route now
  // agrees with it instead of honouring a request the UI would never send.
  if (!await checkPermission(user, 'expenses', 'delete')) return forbidden()
  try {
    // deleteMany: a no-match — including another user's expense — was a silent
    // no-op before and must stay one (PLAN.md 8.4).
    await prisma.expenses.deleteMany({
      where: { id: params.id, tenant_id: getTenantId(), user_id: user.userId ?? undefined },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
