import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'


export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'designations', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const department_id = req.nextUrl.searchParams.get('departmentId')
  const tid = getTenantId()
  try {
    const data = await prisma.designations.findMany({
      where: {
        tenant_id: tid,
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(department_id ? { department_id } : {}),
      },
      include: { departments: { select: { name: true } } },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(serialize(data, 'designations'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'designations', 'edit')) return forbidden()
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  try {
    // PRESERVED BUG, do not "fix" here. designations.department_id is NOT NULL
    // with no default, and this handler has never supplied it — the Supabase
    // insert failed on a not-null violation and the route answered 500. The UI
    // only ever sends { name } (masters/designations/page.tsx), so creating a
    // designation is impossible today. Prisma's types catch at compile time what
    // Postgres was rejecting at runtime, hence the cast: the runtime outcome is
    // unchanged (create throws -> 500). See PLAN.md 13.3.
    const data = await prisma.designations.create({
      data: { name: name.trim(), tenant_id: getTenantId() } as unknown as Prisma.designationsUncheckedCreateInput,
    })
    return NextResponse.json(serialize(data, 'designations'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
