import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireUser()

  try {
    // onConflict 'remark_id,user_id' is the real @@unique([remark_id, user_id]).
    // Nothing to change on conflict — the row just needs to exist — so `update`
    // is an empty object, matching the original upsert's do-nothing behaviour.
    await prisma.remark_reads.upsert({
      where: { remark_id_user_id: { remark_id: params.id, user_id: user.userId ?? '' } },
      create: { tenant_id: getTenantId(), remark_id: params.id, user_id: user.userId ?? '' },
      update: {},
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
