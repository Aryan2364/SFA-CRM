import { prisma } from '@/lib/db'
import { SessionUser } from '@/lib/auth'
import { PermSection } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
import { firstForeignTenantRef } from '@/lib/tenant-fk'

/**
 * "May this user touch THIS Company?" — the Companies twin of
 * `deals/_access.ts`, used by every route that reaches a company by id.
 *
 * The list applies §6.6 Self/Team/Company on `owner_user_id`; without the same
 * test here, a rep on `own` scope who cannot SEE a colleague's company in the
 * list could still open it, edit it or delete it by id.
 *
 * Resolves to the company's id when it exists, is in this tenant, and is inside
 * the caller's scope — and to `null` otherwise. The caller answers a plain 404
 * for `null`: telling an unauthorised caller that a row exists is itself a leak.
 */
export async function findScopedCompany(
  user: SessionUser,
  tenantId: string,
  companyId: string
): Promise<{ id: string } | null> {
  const ids = await scopedUserIds(user, 'companies')
  return prisma.companies.findFirst({
    where: { id: companyId, tenant_id: tenantId, ...scopeWhere(ids, 'owner_user_id') },
    select: { id: true },
  })
}

/**
 * The location ids a company or an address row may carry, each looked up in
 * the caller's tenant before it is written — see `src/lib/tenant-fk.ts`. The
 * row guard protects the row; this protects the VALUES, which Postgres accepts
 * from any tenant and the location `include`s then read back by name. Absent
 * or blank keys are skipped, so a PUT can pass the body as it came.
 *
 * Tenant membership only: nothing here checks that the district is in the
 * state, because no route in this family has ever assumed it.
 */
export function foreignLocationRef(
  tenantId: string,
  body: Record<string, unknown>
): Promise<string | null> {
  const tid = tenantId
  return firstForeignTenantRef([
    { value: body.state_id, label: 'State',
      find: id => prisma.states.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.district_id, label: 'District',
      find: id => prisma.districts.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.taluka_id, label: 'Taluka',
      find: id => prisma.talukas.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.village_id, label: 'Village',
      find: id => prisma.villages.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
  ])
}

/** Every body-supplied FK a company row may carry: the locations plus the rest. */
export async function foreignCompanyRef(
  tenantId: string,
  body: Record<string, unknown>
): Promise<string | null> {
  const tid = tenantId
  return (await foreignLocationRef(tid, body)) ?? firstForeignTenantRef([
    { value: body.industry_id, label: 'Industry',
      find: id => prisma.industries.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.owner_user_id, label: 'Owner',
      find: id => prisma.users.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: body.distributor_id, label: 'Distributor',
      find: id => prisma.companies.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
  ])
}

/**
 * "May this user make SOMEONE ELSE the owner?" — the write-side twin of the
 * §6.6 list filter, for every route that takes a body `owner_user_id` on a
 * Party row (companies, contacts).
 *
 * The list shows a rep on `own` scope only the rows they own, so letting them
 * write another owner would create (or reassign) a row that immediately
 * vanishes from their own view — and, on a company, strand the addresses Step
 * 2 of the form then fails to save against it. The rule is the list's own
 * scope, read through `scopedUserIds()` rather than re-decided here:
 *   - `own`  — the caller only;
 *   - `team` — the caller and everyone below them in `user_visibility`;
 *   - `all`  — anyone in the tenant (tenant membership is `foreign*Ref`'s job).
 *
 * `ownerId` is the value about to be WRITTEN. Blank means "no owner": on a
 * create the route defaults it to the caller before calling this; on a PUT a
 * cleared owner would orphan the row out of every Self/Team scope, so below
 * Company scope it is refused like any other owner outside it.
 *
 * Resolves to the 403 message, or to `null` when the owner is allowed.
 */
export async function ownerOutsideScope(
  user: SessionUser,
  section: Extract<PermSection, 'companies' | 'contacts'>,
  ownerId: unknown
): Promise<string | null> {
  const ids = await scopedUserIds(user, section)
  if (ids === null) return null
  const owner = typeof ownerId === 'string' ? ownerId.trim() : ''
  if (owner && ids.includes(owner)) return null
  const noun = section === 'companies' ? 'companies' : 'contacts'
  // `[caller]` is `own` scope — or `team` with nobody below, where the answer
  // is the same person and so the same sentence. "Assign", not "create": the
  // same refusal answers a create and a PUT that reassigns the owner.
  return ids.length <= 1
    ? `You can only assign ${noun} to yourself.`
    : `You can only assign ${noun} to yourself or someone in your team.`
}
