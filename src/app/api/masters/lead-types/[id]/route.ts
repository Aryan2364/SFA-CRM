import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'lead_types', 'edit')) return forbidden()
  const { name, sort_order, is_active } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  try {
    // update(), not updateMany(): the original ended in .select().single(), so a
    // no-match was ALREADY an error answered with 500 (PLAN.md 8.4).
    const data = await prisma.company_types.update({
      where: { id: params.id, tenant_id: getTenantId() },
      data: { name: name.trim(), sort_order: sort_order ?? 0, is_active: is_active ?? true },
    })
    return NextResponse.json(serialize(data, 'company_types'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'lead_types', 'delete')) return forbidden()
  try {
    // Soft delete. updateMany(), NOT update(): the original had no .single(), so
    // a no-match was silent and returned ok. update() would throw P2025 and turn
    // that into a 500 (PLAN.md 8.4).
    await prisma.company_types.updateMany({
      where: { id: params.id, tenant_id: getTenantId() },
      data: { is_active: false },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
