import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { findScopedCompany } from '../../_access'
import { addLink, listLinksForCompany } from '@/lib/account-kind'
import { trimmed } from '@/lib/validation'

/**
 * Account <-> contact links — docs/accounts-contacts-spec.md §2.
 *
 * GET  — every link on this account (active and inactive; the client filters
 *        for pickers). Shape: { link_id, contact_id, contact_name, role_id,
 *        role_name, is_primary, is_active }.
 * POST — add one link: { contact_id, role_id? }. `role_id: null` is "no role
 *        yet". Setting the role to Self is refused when another contact is
 *        already Self on this account, or when the contact is Self elsewhere
 *        (409, see src/lib/account-kind.ts `addLink`).
 */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'view')) return forbidden()
  const tid = getTenantId()
  try {
    const found = await findScopedCompany(user, tid, params.id, 'read')
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const links = await listLinksForCompany(tid, found.id)
    const contacts = await prisma.contacts.findMany({
      where: { tenant_id: tid, id: { in: links.map(l => l.contact_id) } },
      select: { id: true, name: true, mobile: true },
    })
    const byId = new Map(contacts.map(c => [c.id, c]))
    return NextResponse.json(
      links.map(l => ({
        ...l,
        contact_name: byId.get(l.contact_id)?.name ?? null,
        contact_mobile: byId.get(l.contact_id)?.mobile ?? null,
      }))
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'edit')) return forbidden()
  const { contact_id, role_id, is_primary } = await req.json()
  const contactId = trimmed(contact_id)
  if (!contactId) return NextResponse.json({ error: 'Contact is required' }, { status: 400 })
  const tid = getTenantId()
  try {
    const found = await findScopedCompany(user, tid, params.id, 'write')
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const contact = await prisma.contacts.findFirst({ where: { id: contactId, tenant_id: tid }, select: { id: true } })
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 400 })
    const result = await addLink(tid, found.id, contactId, trimmed(role_id), Boolean(is_primary))
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ link_id: result.link_id }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
