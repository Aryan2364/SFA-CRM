import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'contact_types', 'edit')) return forbidden()
  const { name, sort_order, is_active } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  try {
    const data = await prisma.contact_types.update({
      where: { id: params.id, tenant_id: getTenantId() },
      data: { name: name.trim(), sort_order: sort_order ?? 0, is_active: is_active ?? true },
    })
    return NextResponse.json(serialize(data, 'contact_types'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'contact_types', 'delete')) return forbidden()
  try {
    // Soft delete, and updateMany() rather than update(): a no-match stays
    // silent instead of throwing P2025 and becoming a 500 (PLAN.md 8.4).
    // `contacts.contact_type_id` has no cascade, so a hard delete would strand
    // the FK; deactivating keeps existing contacts readable.
    await prisma.contact_types.updateMany({
      where: { id: params.id, tenant_id: getTenantId() },
      data: { is_active: false },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
