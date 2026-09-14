import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'lead_stages', 'edit')) return forbidden()
  const { name, sort_order, is_active } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const tid = getTenantId()
  try {
    // A fixed stage may only be activated/deactivated; its name and order are
    // locked. The previous .single() left `existing` null when the row was
    // missing or belonged to another tenant, and `!existing?.is_fixed` then
    // allowed the rename — which the update below still rejects, because its
    // own tenant filter matches nothing. findFirst reproduces that exactly.
    const existing = await prisma.lead_stages.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { is_fixed: true },
    })
    const update: Record<string, unknown> = { is_active: is_active ?? true }
    if (!existing?.is_fixed) {
      update.name = name.trim()
      update.sort_order = sort_order ?? 0
    }
    // update(), not updateMany(): the original ended in .select().single().
    const data = await prisma.lead_stages.update({
      where: { id: params.id, tenant_id: tid },
      data: update,
    })
    return NextResponse.json(serialize(data, 'lead_stages'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'lead_stages', 'delete')) return forbidden()
  const tid = getTenantId()
  try {
    const stage = await prisma.lead_stages.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { is_fixed: true },
    })
    if (stage?.is_fixed) return NextResponse.json({ error: 'Fixed stages cannot be deleted' }, { status: 400 })
    // Soft delete. updateMany(), NOT update(): no .single() in the original, so
    // a no-match stayed silent and returned ok (PLAN.md §8.4).
    await prisma.lead_stages.updateMany({
      where: { id: params.id, tenant_id: tid },
      data: { is_active: false },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
