import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { updateUnmetReason } from '@/lib/todo-outcomes'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'todo_unmet_reasons', 'edit')) return forbidden()
  const body = await req.json()
  const result = await updateUnmetReason(getTenantId(), params.id, {
    name: typeof body.name === 'string' ? body.name.trim() : undefined,
    sort_order: typeof body.sort_order === 'number' ? body.sort_order : undefined,
    is_active: typeof body.is_active === 'boolean' ? body.is_active : undefined,
  })
  if (result === 'unavailable') {
    return NextResponse.json({ error: 'This needs a database update first.' }, { status: 503 })
  }
  if (result === null) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(result)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'todo_unmet_reasons', 'delete')) return forbidden()
  // Soft delete only, like every other simple master.
  const result = await updateUnmetReason(getTenantId(), params.id, { is_active: false })
  if (result === 'unavailable') {
    return NextResponse.json({ error: 'This needs a database update first.' }, { status: 503 })
  }
  if (result === null) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(result)
}
