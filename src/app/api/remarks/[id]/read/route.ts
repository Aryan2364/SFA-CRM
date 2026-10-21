import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json({ error: 'Remark not found' }, { status: 404 })
  const tid = getTenantId()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Remark not found' }, { status: 404 })
  }

  try {
    // The id is from the URL and the FK is not tenant-safe: confirm the
    // remark is this tenant's before a read row points at it.
    const remark = await prisma.contextual_remarks.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { id: true },
    })
    if (!remark) return NextResponse.json({ error: 'Remark not found' }, { status: 404 })

    // onConflict 'remark_id,user_id' is the real @@unique([remark_id, user_id]).
    // Nothing to change on conflict — the row just needs to exist — so `update`
    // is an empty object, matching the original upsert's do-nothing behaviour.
    await prisma.remark_reads.upsert({
      where: { remark_id_user_id: { remark_id: params.id, user_id: user.userId } },
      create: { tenant_id: tid, remark_id: params.id, user_id: user.userId },
      update: {},
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const r = dbErrorResult(err)
    return NextResponse.json({ error: r.error }, { status: r.status })
  }
}
