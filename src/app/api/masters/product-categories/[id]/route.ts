import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

/**
 * The columns PUT may write — same shape and reasoning as `UPDATABLE` in
 * `src/app/api/companies/[id]/_handlers.ts`, so the master routes read alike.
 *
 * This route used to do `prisma.product_categories.update({ data: body })`,
 * which made EVERY column on `product_categories` writable by anything that
 * could reach the route — `tenant_id` among them, so a crafted body could move
 * a row out of the caller's tenant. `id`, `created_at` and `updated_at` were
 * writable too. A key that is not on this list is ignored, not rejected, so a
 * caller that posts its whole form state back is unaffected.
 */
const UPDATABLE = ['name', 'is_active'] as const

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'product_categories', 'edit')) return forbidden()
  const body = await req.json()

  const updates: Record<string, unknown> = {}
  for (const key of UPDATABLE) if (key in body) updates[key] = body[key]
  // Trimmed as POST trims it — see the note in states/[id].
  if ('name' in updates) {
    if (typeof updates.name !== 'string' || !updates.name.trim())
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    updates.name = updates.name.trim()
  }

  try {
    // `where` carries tenant_id alongside the primary key, so a row belonging to
    // another tenant is not updated - exactly what .eq('id').eq('tenant_id') did.
    const data = await prisma.product_categories.update({
      where: { id: params.id, tenant_id: getTenantId() },
      data: updates,
    })
    return NextResponse.json(serialize(data, 'product_categories'))
  } catch (err) {
    // Includes the no-matching-row case, which previously surfaced as a
    // PostgREST error from .single() and was answered with the same 500.
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'product_categories', 'delete')) return forbidden()
  try {
    // deleteMany, NOT delete: the old client's .delete() did not error when no row
    // matched and still returned ok. delete() throws P2025 in that case, which
    // would turn a silent no-op into a 500.
    await prisma.product_categories.deleteMany({
      where: { id: params.id, tenant_id: getTenantId() },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
