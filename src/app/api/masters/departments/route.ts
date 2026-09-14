import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'


export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'departments', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const tid = getTenantId()
  try {
    const data = await prisma.departments.findMany({
      where: {
        tenant_id: tid,
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(serialize(data, 'departments'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'departments', 'edit')) return forbidden()
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  try {
    const data = await prisma.departments.create({
      data: { name: name.trim(), tenant_id: getTenantId() },
    })
    return NextResponse.json(serialize(data, 'departments'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
