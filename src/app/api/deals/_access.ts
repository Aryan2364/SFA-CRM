import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { SessionUser } from '@/lib/auth'
import { asId, firstForeignTenantRef } from '@/lib/tenant-fk'
import { AccessLevel, AccessNeed, getDealAccessLevel, meets } from '@/lib/sharing'

/**
 * "May this user touch THIS Deal?" — used by every single-Deal route.
 *
 * The list applies §6.6 Self/Team/Company through `scopedUserIds()`; without
 * the same test here, a Sales Executive on `own` scope who cannot SEE another
 * rep's Deal in the list could still fetch it, edit it, drag it to another
 * stage or close it by guessing nothing harder than its id. Four routes need
 * the check, so it is written once.
 *
 * Resolves to the Deal's id when it exists, is in this tenant, and is inside
 * the caller's scope — and to `null` in every other case. The caller returns a
 * plain 404 for `null` rather than distinguishing "no such Deal" from "not
 * yours": telling an unauthorised caller that a row exists is itself a leak.
 *
 * Sharing (src/lib/sharing.ts) widens the owner-scope test by the caller's
 * membership of the deal's ACCOUNT (`account_members`) or of the deal itself
 * (`deal_members`). `need`:
 *   'read'   owner-scope, or a 'work' / 'view' member — every GET
 *   'write'  owner-scope, or a 'work' member — stage, close, edit, follow-ups,
 *            attachments
 *   'owner'  owner-scope only — delete the deal, reassign its owner, move it
 *            to another account
 * The role permission is checked by the route BEFORE this, as always: sharing
 * grants record access, never an action. With nothing shared, every `need` is
 * exactly the old owner-scope test.
 */
export type ScopedDeal = {
  id: string
  stage_entered_at: Date
  deal_stage_id: string | null
  owner_user_id: string | null
  company_id: string | null
  access: AccessLevel
}

export async function findScopedDeal(
  user: SessionUser,
  tenantId: string,
  dealId: string,
  need: AccessNeed
): Promise<ScopedDeal | null> {
  if (!asId(dealId)) return null
  // findFirst, not findUnique: `tenant_id` is not part of the primary key, so
  // it has to be in the `where` — a Deal id from another tenant resolves
  // otherwise, and nothing crashes when it does.
  const row = await prisma.deals.findFirst({
    where: { id: dealId, tenant_id: tenantId },
    select: { id: true, stage_entered_at: true, deal_stage_id: true, owner_user_id: true, company_id: true },
  })
  if (!row) return null
  const access = await getDealAccessLevel(user, tenantId, row.id, row)
  return meets(access, need) ? { ...row, access: access! } : null
}

export function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

/**
 * §7: the opportunity dialog's contact picker only ever offers contacts
 * linked (`company_contacts`) to the chosen account, but a body posted by
 * hand (or a stale form) could still name an unlinked contact — so the
 * server checks the link itself rather than trusting the picker. `true` when
 * `contactId` is blank: an opportunity with no contact is always acceptable.
 */
export async function contactLinkedToCompany(
  tenantId: string,
  companyId: string,
  contactId: string | null | undefined
): Promise<boolean> {
  if (!contactId) return true
  if (!asId(companyId) || !asId(contactId)) return false
  const link = await prisma.company_contacts.findFirst({
    where: { tenant_id: tenantId, company_id: companyId, contact_id: contactId },
    select: { id: true },
  })
  return !!link
}

/**
 * The body-supplied foreign keys a Deal write may carry, each looked up in the
 * caller's tenant before POST or PUT writes it — see `src/lib/tenant-fk.ts`.
 * The row guard (`where: { id, tenant_id }`) protects the Deal; this protects
 * the VALUES, which Postgres would otherwise accept from any tenant and which
 * `DEAL_*_INCLUDE` would then read back by name. An absent or blank key is
 * skipped, so PUT can pass the body as it came.
 */
export function foreignDealRef(
  tenantId: string,
  body: Record<string, unknown>
): Promise<string | null> {
  const tid = tenantId
  return firstForeignTenantRef([
    { value: body.owner_user_id, label: 'Owner',
      find: id => prisma.users.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.company_id, label: 'Company',
      find: id => prisma.companies.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.contact_id, label: 'Contact',
      find: id => prisma.contacts.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.deal_stage_id, label: 'Opportunity stage',
      find: id => prisma.deal_stages.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.product_id, label: 'Product',
      find: id => prisma.products.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.product_category_id, label: 'Product category',
      find: id => prisma.product_categories.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
  ])
}
