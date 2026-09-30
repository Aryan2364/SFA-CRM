import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { SessionUser } from '@/lib/auth'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
import { firstForeignTenantRef } from '@/lib/tenant-fk'

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
 */
export async function findScopedDeal(
  user: SessionUser,
  tenantId: string,
  dealId: string
): Promise<{ id: string; stage_entered_at: Date; deal_stage_id: string | null } | null> {
  const ids = await scopedUserIds(user, 'deals')
  // findFirst, not findUnique: `tenant_id` is not part of the primary key, so
  // it has to be in the `where` — a Deal id from another tenant resolves
  // otherwise, and nothing crashes when it does.
  return prisma.deals.findFirst({
    where: {
      id: dealId,
      tenant_id: tenantId,
      ...scopeWhere(ids, 'owner_user_id'),
    },
    select: { id: true, stage_entered_at: true, deal_stage_id: true },
  })
}

export function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
    { value: body.deal_stage_id, label: 'Deal stage',
      find: id => prisma.deal_stages.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.product_id, label: 'Product',
      find: id => prisma.products.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.product_category_id, label: 'Product category',
      find: id => prisma.product_categories.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
  ])
}
