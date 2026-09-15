import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  // Reference data: any authenticated user may read it (used by meeting/weekly-plan/
  // business-partner forms). Managing the master still requires edit permission below.
  await requireUser()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const tid = getTenantId()
  try {
    const data = await prisma.states.findMany({
      where: {
        tenant_id: tid,
        // .ilike('name', `%q%`) -> case-insensitive contains.
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(serialize(data, 'states'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'states', 'edit')) return forbidden()
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  try {
    const data = await prisma.states.create({
      data: {
        name: name.trim(),
        tenant_id: getTenantId(),
      },
    })
    return NextResponse.json(serialize(data, 'states'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
