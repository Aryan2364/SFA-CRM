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
  const taluka_id = req.nextUrl.searchParams.get('talukaId')
  const tid = getTenantId()
  try {
    const data = await prisma.villages.findMany({
      where: {
        tenant_id: tid,
        // .ilike('name', `%q%`) -> case-insensitive contains.
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(taluka_id ? { taluka_id } : {}),
      },
      include: { talukas: { select: { name: true } } },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(serialize(data, 'villages'))
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'villages', 'edit')) return forbidden()
  const { name, taluka_id } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!taluka_id) return NextResponse.json({ error: 'Taluka is required' }, { status: 400 })
  const tid = getTenantId()
  try {
    // The FK references a bare primary key, so another tenant's taluka would be
    // accepted — see src/lib/tenant-fk.ts.
    const miss = await firstForeignTenantRef([
      { value: taluka_id, label: 'Taluka',
        find: id => prisma.talukas.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    ])
    if (miss) return NextResponse.json({ error: miss }, { status: 400 })

    const data = await prisma.villages.create({
      data: {
        name: name.trim(),
        taluka_id: taluka_id,
        tenant_id: tid,
      },
    })
    return NextResponse.json(serialize(data, 'villages'), { status: 201 })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
