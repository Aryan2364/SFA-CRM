import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { firstForeignTenantRef } from '@/lib/tenant-fk'

export async function GET(req: NextRequest) {
  // Reference data: any authenticated user may read it (used by meeting/weekly-plan/
  // business-partner forms). Managing the master still requires edit permission below.
  await requireUser()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const state_id = req.nextUrl.searchParams.get('stateId')
  const tid = getTenantId()
  try {
    const data = await prisma.districts.findMany({
      where: {
        tenant_id: tid,
        // .ilike('name', `%q%`) -> case-insensitive contains.
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(state_id ? { state_id } : {}),
      },
      include: { states: { select: { name: true } } },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(serialize(data, 'districts'))
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'districts', 'edit')) return forbidden()
  const { name, state_id } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!state_id) return NextResponse.json({ error: 'State is required' }, { status: 400 })
  const tid = getTenantId()
  try {
    // The FK references a bare primary key, so another tenant's state would be
    // accepted — see src/lib/tenant-fk.ts.
    const miss = await firstForeignTenantRef([
      { value: state_id, label: 'State',
        find: id => prisma.states.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    ])
    if (miss) return NextResponse.json({ error: miss }, { status: 400 })

    const data = await prisma.districts.create({
      data: {
        name: name.trim(),
        state_id: state_id,
        tenant_id: tid,
      },
    })
    return NextResponse.json(serialize(data, 'districts'), { status: 201 })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
