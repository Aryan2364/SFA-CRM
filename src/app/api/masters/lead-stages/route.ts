import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { attachStageTypes, isStageType, readStageTypes, writeStageType } from '@/lib/deal-stage-type'

export const dynamic = 'force-dynamic'

/**
 * ⚠️ Explicit, and it must stay explicit. An unselected `findMany` asks for
 * every scalar the generated client knows about — which now includes
 * `stage_type`, a column that is in `schema.prisma` and not yet in the
 * database. `stage_type` is read separately, in raw SQL, by
 * `src/lib/deal-stage-type.ts`. See that file's header.
 */
const STAGE_SELECT = {
  id: true,
  tenant_id: true,
  name: true,
  sort_order: true,
  is_fixed: true,
  is_active: true,
  created_at: true,
} as const

export async function GET() {
  // Reference data: any authenticated user may read it (used by the Leads form).
  // Managing the master still requires create/edit permission below.
  await requireUser()
  const tid = getTenantId()
  try {
    const [data, types] = await Promise.all([
      prisma.deal_stages.findMany({
        where: { tenant_id: tid },
        orderBy: { sort_order: 'asc' },
        select: STAGE_SELECT,
      }),
      readStageTypes(tid),
    ])
    const rows = serialize(data, 'deal_stages') as ({ id: string } & Record<string, unknown>)[]
    return NextResponse.json(attachStageTypes(rows, types))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'lead_stages', 'create')) return forbidden()
  const { name, sort_order, stage_type } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (stage_type !== undefined && stage_type !== null && !isStageType(stage_type)) {
    return NextResponse.json({ error: "Stage type must be 'Open' or 'Closed'" }, { status: 400 })
  }
  const tid = getTenantId()
  try {
    const data = await prisma.deal_stages.create({
      data: { tenant_id: tid, name: name.trim(), sort_order: sort_order ?? 0, is_fixed: false },
      select: STAGE_SELECT,
    })
    // Written after the insert rather than with it, because the column may not
    // exist yet (see deal-stage-type.ts). Always written, even for the default,
    // so that `wrote` is a straight answer to "does the column exist" and the
    // response never claims a type the database cannot be holding.
    const chosen = isStageType(stage_type) ? stage_type : 'Open'
    const wrote = await writeStageType(tid, data.id, chosen)
    const row = serialize(data, 'deal_stages') as { id: string } & Record<string, unknown>
    return NextResponse.json(
      {
        ...row,
        stage_type: wrote ? chosen : null,
        ...(wrote ? {} : { stage_type_unavailable: true }),
      },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
