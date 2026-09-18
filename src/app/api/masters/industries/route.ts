import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'


export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Reference data: any authenticated user may read it (the Company form needs
  // it). Managing the master still requires create/edit permission below.
  await requireUser()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  try {
    const data = await prisma.industries.findMany({
      where: {
        tenant_id: getTenantId(),
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { sort_order: 'asc' },
    })
    return NextResponse.json(serialize(data, 'industries'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'industries', 'create')) return forbidden()
  const { name, sort_order } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  try {
    const data = await prisma.industries.create({
      data: { tenant_id: getTenantId(), name: name.trim(), sort_order: sort_order ?? 0 },
    })
    return NextResponse.json(serialize(data, 'industries'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
