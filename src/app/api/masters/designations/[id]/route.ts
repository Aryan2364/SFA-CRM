import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'designations', 'edit')) return forbidden()
  const body = await req.json()
  try {
    const data = await prisma.designations.update({
      where: { id: params.id, tenant_id: getTenantId() },
      data: body,
    })
    return NextResponse.json(serialize(data, 'designations'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'designations', 'delete')) return forbidden()
  try {
    // deleteMany, NOT delete: a no-match was silent before and must stay silent
    // (PLAN.md 8.4). delete() throws P2025 and would turn it into a 500.
    await prisma.designations.deleteMany({
      where: { id: params.id, tenant_id: getTenantId() },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
