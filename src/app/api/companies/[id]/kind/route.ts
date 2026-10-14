import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { findScopedCompany } from '../../_access'
import { trimmed } from '@/lib/validation'
import {
  addLink, changeLink, findSelfAccountForContact, getSelfRole,
  isAccountKind, listLinksForCompany, readAccountKind, writeAccountKind,
} from '@/lib/account-kind'

/**
 * POST /api/companies/[id]/kind — docs/accounts-contacts-spec.md §4, change
 * kind on the same record (meetings/opportunities/orders stay).
 *
 * Body:
 *   { kind: 'Individual', self_contact_id?: string, self_new_person?: { name, mobile?, email? } }
 *     — required when going Company -> Individual: pick or create the Self
 *       contact (the whole body is required, one of the two).
 *   { kind: 'Company', former_self_role_id?: string }
 *     — Individual -> Company: the Self link becomes a normal role, default
 *       Owner/Proprietor (`former_self_role_id` overrides it).
 *
 * Gate: `companies.edit` + write access (src/lib/sharing.ts) to the account.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'edit')) return forbidden()
  const { kind, self_contact_id, self_new_person, former_self_role_id } = await req.json()
  if (!isAccountKind(kind)) return NextResponse.json({ error: 'kind must be Company or Individual' }, { status: 400 })
  const tid = getTenantId()

  try {
    const found = await findScopedCompany(user, tid, params.id, 'write')
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const current = await readAccountKind(tid, found.id)
    if (current === kind) return NextResponse.json({ ok: true, account_kind: kind })

    const self = await getSelfRole(tid)
    if (!self) return NextResponse.json({ error: 'This needs a database update first.' }, { status: 503 })

    if (kind === 'Individual') {
      let contactId = trimmed(self_contact_id)
      if (!contactId) {
        const personName = trimmed(self_new_person?.name)
        if (!personName) return NextResponse.json({ error: 'Choose or create the Self contact' }, { status: 400 })
        const personMobile = trimmed(self_new_person?.mobile)
        const person = await prisma.contacts.create({
          data: { tenant_id: tid, name: personName, mobile: personMobile ?? '', owner_user_id: user.userId ?? null },
          select: { id: true },
        })
        contactId = person.id
      } else {
        const contact = await prisma.contacts.findFirst({ where: { id: contactId, tenant_id: tid }, select: { id: true } })
        if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 400 })
        const existingSelfAccount = await findSelfAccountForContact(tid, contactId)
        if (existingSelfAccount && existingSelfAccount !== found.id) {
          return NextResponse.json(
            { error: 'This person is already the Self contact of another account.', existing_account_id: existingSelfAccount },
            { status: 409 }
          )
        }
      }
      const linked = await addLink(tid, found.id, contactId, self.id, true)
      if (!linked.ok) return NextResponse.json({ error: linked.error }, { status: linked.status })
    } else {
      // Individual -> Company: the Self link becomes a normal role.
      const links = await listLinksForCompany(tid, found.id)
      const selfLink = links.find(l => l.is_self && l.is_active)
      if (selfLink) {
        const defaultRoleName = 'Owner/Proprietor'
        const newRoleId = trimmed(former_self_role_id)
          ?? (await prisma.$queryRaw<{ id: string }[]>`
                SELECT id::text AS id FROM contact_roles
                 WHERE tenant_id = ${tid}::uuid AND name = ${defaultRoleName} LIMIT 1
              `)[0]?.id
          ?? null
        await changeLink(tid, selfLink.link_id, { role_id: newRoleId }, false)
      }
    }

    const saved = await writeAccountKind(tid, found.id, kind)
    if (!saved) return NextResponse.json({ error: 'This needs a database update first.' }, { status: 503 })
    return NextResponse.json({ ok: true, account_kind: kind })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
