import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { findScopedContact } from '../../_access'
import { addLink, findSelfAccountForContact, getSelfRole, writeAccountKind } from '@/lib/account-kind'

/**
 * POST /api/contacts/[id]/make-individual — docs/accounts-contacts-spec.md §3,
 * the "⋮ Make Individual account" action. Creates an Individual account owned
 * by the caller, named after the contact, with that contact as Self.
 *
 * Refuses (409) when the contact is already Self somewhere, naming that
 * account's id so the UI can link to it instead of creating a duplicate.
 * Gated on `companies` create (the caller must be able to make accounts) plus
 * read access to the contact.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'create')) return forbidden()
  const tid = getTenantId()
  try {
    const found = await findScopedContact(user, tid, params.id, 'read')
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const existingSelfAccount = await findSelfAccountForContact(tid, found.id)
    if (existingSelfAccount) {
      return NextResponse.json(
        { error: 'This person is already the Self contact of another account.', existing_account_id: existingSelfAccount },
        { status: 409 }
      )
    }

    const contact = await prisma.contacts.findFirst({ where: { id: found.id, tenant_id: tid }, select: { name: true } })
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const self = await getSelfRole(tid)
    if (!self) return NextResponse.json({ error: 'This needs a database update first.' }, { status: 503 })

    const created = await prisma.companies.create({
      data: {
        tenant_id: tid,
        type: '',
        stage: 'Prospect',
        name: contact.name,
        owner_user_id: user.userId ?? null,
        created_by_user_id: user.userId ?? null,
      },
    })
    await writeAccountKind(tid, created.id, 'Individual')
    const linked = await addLink(tid, created.id, found.id, self.id, true)
    if (!linked.ok) return NextResponse.json({ error: linked.error }, { status: linked.status })

    return NextResponse.json(serialize(created, 'companies'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
