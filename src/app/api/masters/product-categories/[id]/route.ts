import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'product_categories', 'edit')) return forbidden()
  const body = await req.json()
  try {
    // `where` carries tenant_id alongside the primary key, so a row belonging to
    // another tenant is not updated - exactly what .eq('id').eq('tenant_id') did.
    const data = await prisma.product_categories.update({
      where: { id: params.id, tenant_id: getTenantId() },
      data: body,
    })
    return NextResponse.json(serialize(data, 'product_categories'))
  } catch (err) {
    // Includes the no-matching-row case, which previously surfaced as a
    // PostgREST error from .single() and was answered with the same 500.
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'product_categories', 'delete')) return forbidden()
  try {
    // deleteMany, NOT delete: Supabase's .delete() did not error when no row
    // matched and still returned ok. delete() throws P2025 in that case, which
    // would turn a silent no-op into a 500.
    await prisma.product_categories.deleteMany({
      where: { id: params.id, tenant_id: getTenantId() },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
