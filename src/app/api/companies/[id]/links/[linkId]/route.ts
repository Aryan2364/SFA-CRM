import { NextRequest, NextResponse } from 'next/server'
import { dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { findScopedCompany } from '../../../_access'
import { changeLink, readAccountKind, removeLink } from '@/lib/account-kind'
import { trimmed } from '@/lib/validation'

/**
 * PATCH { role_id?, is_primary?, is_active? } — change role / primary /
 * active on one link. DELETE — remove the link outright (refused on Self,
 * see src/lib/account-kind.ts).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; linkId: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'edit')) return forbidden()
  const body = await req.json()
  const tid = getTenantId()
  try {
    const found = await findScopedCompany(user, tid, params.id, 'write')
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const kind = await readAccountKind(tid, found.id)
    const data: { role_id?: string | null; is_primary?: boolean; is_active?: boolean } = {}
    if ('role_id' in body) data.role_id = trimmed(body.role_id)
    if ('is_primary' in body) data.is_primary = Boolean(body.is_primary)
    if ('is_active' in body) data.is_active = Boolean(body.is_active)
    const result = await changeLink(tid, params.linkId, data, kind === 'Individual')
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; linkId: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'edit')) return forbidden()
  const tid = getTenantId()
  try {
    const found = await findScopedCompany(user, tid, params.id, 'write')
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const result = await removeLink(tid, params.linkId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
