import { prisma } from '@/lib/db'
import { SessionUser } from '@/lib/auth'
import { firstForeignTenantRef } from '@/lib/tenant-fk'
import { AccessLevel, AccessNeed, getContactAccessLevel, meets } from '@/lib/sharing'

/**
 * "May this user touch THIS Contact?" — the Contacts twin of
 * `deals/_access.ts`. The list scopes on `owner_user_id` (§6.6); every route
 * that reaches a contact by id applies the same predicate, so a contact the
 * caller cannot see in the list is a plain 404 rather than a row they can
 * open, edit or delete by id.
 *
 * Sharing widens it: a contact linked (`company_contacts`) to an account shared
 * with the caller is reachable at that account's level — see
 * `getContactAccessLevel` in src/lib/sharing.ts. `need` is 'read' / 'write' /
 * 'owner' exactly as in `companies/_access.ts`; with nothing shared each is the
 * old owner-scope test. Opportunity-only sharing reaches no contact.
 */
export async function findScopedContact(
  user: SessionUser,
  tenantId: string,
  contactId: string,
  need: AccessNeed
): Promise<{ id: string; access: AccessLevel } | null> {
  const access = await getContactAccessLevel(user, tenantId, contactId)
  return meets(access, need) ? { id: contactId, access: access! } : null
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
