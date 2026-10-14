import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { isAppliesTo, readAllAppliesTo, writeAppliesTo, attachAppliesTo } from '@/lib/account-kind'


export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Reference data: any authenticated user may read it (used by the Leads form).
  // Managing the master still requires create/edit permission below.
  await requireUser()
  // `?active=true` narrows to live rows, for pickers. The default is still every
  // row: the master's own screen lists inactive ones so they can be reactivated.
  const activeOnly = req.nextUrl.searchParams.get('active') === 'true'
  const tid = getTenantId()
  try {
    const data = await prisma.company_types.findMany({
      where: {
        tenant_id: tid,
        ...(activeOnly ? { is_active: true } : {}),
      },
      orderBy: { sort_order: 'asc' },
    })
    const appliesTo = await readAllAppliesTo(tid)
    return NextResponse.json(attachAppliesTo(serialize(data, 'company_types') as { id: string }[], appliesTo))
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'lead_types', 'create')) return forbidden()
  const { name, sort_order, applies_to } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const tid = getTenantId()
  try {
    const data = await prisma.company_types.create({
      data: { tenant_id: tid, name: name.trim(), sort_order: sort_order ?? 0 },
    })
    const appliesTo = isAppliesTo(applies_to) ? applies_to : 'Company'
    const appliesToSaved = appliesTo === 'Company' || await writeAppliesTo(tid, data.id, appliesTo)
    return NextResponse.json(
      { ...(serialize(data, 'company_types') as Record<string, unknown>), applies_to: appliesToSaved ? appliesTo : 'Company' },
      { status: 201 }
    )
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
