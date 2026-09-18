import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Reference data: any authenticated user may read it (used by the Leads form).
  // Managing the master still requires create/edit permission below.
  await requireUser()
  try {
    const data = await prisma.deal_stages.findMany({
      where: { tenant_id: getTenantId() },
      orderBy: { sort_order: 'asc' },
    })
    return NextResponse.json(serialize(data, 'deal_stages'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'lead_stages', 'create')) return forbidden()
  const { name, sort_order } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  try {
    const data = await prisma.deal_stages.create({
      data: { tenant_id: getTenantId(), name: name.trim(), sort_order: sort_order ?? 0, is_fixed: false },
    })
    return NextResponse.json(serialize(data, 'deal_stages'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
