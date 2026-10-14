import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { deleteRole, updateRole, DB_NOT_READY } from '@/lib/account-kind'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'contacts', 'edit')) return forbidden()
  const { name, sort_order, is_active } = await req.json()
  const tid = getTenantId()
  const result = await updateRole(tid, params.id, { name: name?.trim(), sort_order, is_active })
  if (result === 'unavailable') return NextResponse.json({ error: DB_NOT_READY }, { status: 503 })
  if (result === 'locked') return NextResponse.json({ error: 'The Self role cannot be renamed or deactivated.' }, { status: 409 })
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(result)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'contacts', 'delete')) return forbidden()
  const tid = getTenantId()
  const result = await deleteRole(tid, params.id)
  if (result === 'unavailable') return NextResponse.json({ error: DB_NOT_READY }, { status: 503 })
  if (result === 'locked') return NextResponse.json({ error: 'The Self role cannot be deleted.' }, { status: 409 })
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
