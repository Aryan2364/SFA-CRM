import { prisma } from '@/lib/db'
import { SessionUser } from '@/lib/auth'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
import { firstForeignTenantRef } from '@/lib/tenant-fk'

/**
 * "May this user touch THIS Contact?" — the Contacts twin of
 * `deals/_access.ts`. The list scopes on `owner_user_id` (§6.6); every route
 * that reaches a contact by id applies the same predicate, so a contact the
 * caller cannot see in the list is a plain 404 rather than a row they can
 * open, edit or delete by id.
 */
export async function findScopedContact(
  user: SessionUser,
  tenantId: string,
  contactId: string
): Promise<{ id: string } | null> {
  const ids = await scopedUserIds(user, 'contacts')
  return prisma.contacts.findFirst({
    where: { id: contactId, tenant_id: tenantId, ...scopeWhere(ids, 'owner_user_id') },
    select: { id: true },
  })
}

/**
 * The body-supplied FK columns on `contacts`, looked up in the caller's tenant
 * before they are written — see `src/lib/tenant-fk.ts`. `CONTACT_INCLUDE`
 * reads both back by name, so a foreign id would leak that tenant's data. The
 * company links are checked separately, by `loadCompanies()`.
 */
export function foreignContactRef(
  tenantId: string,
  body: Record<string, unknown>
): Promise<string | null> {
  const tid = tenantId
  return firstForeignTenantRef([
    { value: body.contact_type_id, label: 'Contact type',
      find: id => prisma.contact_types.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.owner_user_id, label: 'Owner',
      find: id => prisma.users.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
  ])
}
