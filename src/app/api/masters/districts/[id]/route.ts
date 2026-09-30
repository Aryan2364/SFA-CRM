import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { firstForeignTenantRef } from '@/lib/tenant-fk'

/**
 * The columns PUT may write — same shape and reasoning as `UPDATABLE` in
 * `src/app/api/companies/[id]/_handlers.ts`, so the master routes read alike.
 *
 * This route used to do `prisma.districts.update({ data: body })`, which made
 * EVERY column on `districts` writable by anything that could reach the route —
 * `tenant_id` among them, so a crafted body could move a row out of the
 * caller's tenant. `id`, `created_at` and `updated_at` were writable too. A key
 * that is not on this list is ignored, not rejected, so a caller that posts its
 * whole form state back is unaffected.
 *
 * `state_id` IS on the list: the Districts page sends it on every save, and
 * dropping it would turn a failed re-parent into a silent 200.
 */
const UPDATABLE = ['name', 'state_id', 'is_active'] as const

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'districts', 'edit')) return forbidden()
  const body = await req.json()

  const updates: Record<string, unknown> = {}
  for (const key of UPDATABLE) if (key in body) updates[key] = body[key]
  // Trimmed as POST trims it — see the note in states/[id].
  if ('name' in updates) {
    if (typeof updates.name !== 'string' || !updates.name.trim())
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    updates.name = updates.name.trim()
  }
  if ('state_id' in updates && !updates.state_id)
    return NextResponse.json({ error: 'State is required' }, { status: 400 })

  const tid = getTenantId()
  try {
    // A re-parent must stay inside the caller's tenant — see src/lib/tenant-fk.ts.
    const miss = await firstForeignTenantRef([
      { value: updates.state_id, label: 'State',
        find: id => prisma.states.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    ])
    if (miss) return NextResponse.json({ error: miss }, { status: 400 })

    // `where` carries tenant_id alongside the primary key, so a row belonging to
    // another tenant is not updated - exactly what .eq('id').eq('tenant_id') did.
    const data = await prisma.districts.update({
      where: { id: params.id, tenant_id: tid },
      data: updates,
    })
    return NextResponse.json(serialize(data, 'districts'))
  } catch (err) {
    // Includes the no-matching-row case, which previously surfaced as a
    // PostgREST error from .single() and was answered with the same 500.
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'districts', 'delete')) return forbidden()
  try {
    // deleteMany, NOT delete: the old client's .delete() did not error when no row
    // matched and still returned ok. delete() throws P2025 in that case, which
    // would turn a silent no-op into a 500.
    await prisma.districts.deleteMany({
      where: { id: params.id, tenant_id: getTenantId() },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
