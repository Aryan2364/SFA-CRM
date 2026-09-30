import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

/**
 * The columns PUT may write — same shape and reasoning as `UPDATABLE` in
 * `src/app/api/companies/[id]/_handlers.ts`, so the master routes read alike.
 *
 * This route used to do `prisma.designations.update({ data: body })`, which
 * made EVERY column on `designations` writable by anything that could reach the
 * route — `tenant_id` among them, so a crafted body could move a row out of the
 * caller's tenant. `id`, `created_at` and `updated_at` were writable too. A key
 * that is not on this list is ignored, not rejected, so a caller that posts its
 * whole form state back is unaffected.
 *
 * `department_id` is absent. No caller sends it — the Designations page edits
 * the name alone — and nothing here checks that a supplied department belongs
 * to the caller's tenant, so listing it would open a cross-tenant pointer that
 * no form needs. It belongs on the list the day the page gains a department
 * picker AND the route validates the id against `getTenantId()`.
 */
const UPDATABLE = ['name', 'is_active'] as const

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'designations', 'edit')) return forbidden()
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
    const data = await prisma.designations.update({
      where: { id: params.id, tenant_id: getTenantId() },
      data: updates,
    })
    return NextResponse.json(serialize(data, 'designations'))
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
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
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
