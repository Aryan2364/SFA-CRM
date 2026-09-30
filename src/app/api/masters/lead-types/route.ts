import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'


export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Reference data: any authenticated user may read it (used by the Leads form).
  // Managing the master still requires create/edit permission below.
  await requireUser()
  // `?active=true` narrows to live rows, for pickers. The default is still every
  // row: the master's own screen lists inactive ones so they can be reactivated.
  const activeOnly = req.nextUrl.searchParams.get('active') === 'true'
  try {
    const data = await prisma.company_types.findMany({
      where: {
        tenant_id: getTenantId(),
        ...(activeOnly ? { is_active: true } : {}),
      },
      orderBy: { sort_order: 'asc' },
    })
    return NextResponse.json(serialize(data, 'company_types'))
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'lead_types', 'create')) return forbidden()
  const { name, sort_order } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  try {
    const data = await prisma.company_types.create({
      data: { tenant_id: getTenantId(), name: name.trim(), sort_order: sort_order ?? 0 },
    })
    return NextResponse.json(serialize(data, 'company_types'), { status: 201 })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
