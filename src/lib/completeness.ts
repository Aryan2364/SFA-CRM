/**
 * Party completeness — `REBUILD-PLAN.md` line 182 / `02-DATA-MODEL-PLAN.md` §3.5.
 *
 * Two levels of compulsory field exist for a Company:
 *
 *   Quick Create      Name, Mobile Number — enforced by the route.
 *   Full Record       Primary Address, City, State, Pincode, GST Number —
 *                     NOT enforced; recorded on the row instead, as
 *                     `is_complete` plus a human-readable `completeness_missing`
 *                     that the Parties list and the report filter show.
 *
 * `scripts/backfill-parties.mjs` STEP 4 computed exactly this in SQL for the
 * rows that already existed. This is the same rule for rows written from now on,
 * and the two must stay identical — the field list, its ORDER, and the ", "
 * separator are all part of the stored value, and a mismatch would make a
 * re-run of the backfill rewrite every row this code has touched.
 *
 * The first four fields live on the company's PRIMARY `company_addresses` row,
 * not on `companies` — a company with no primary address is missing all four.
 */
import { prisma } from './db'

/** In the order the stored string lists them. Do not reorder. */
export const COMPANY_REQUIRED_FIELDS = [
  'Primary Address',
  'City',
  'State',
  'Pincode',
  'GST Number',
] as const

export type Completeness = {
  is_complete: boolean
  /** e.g. `"City, Pincode, GST Number"`, or null when nothing is missing. */
  completeness_missing: string | null
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === ''
}

/**
 * DISPLAY-SIDE ONLY — Mobile Number joins the five stored fields in what a
 * response reports as missing/incomplete, but never in what is stored
 * (`COMPANY_REQUIRED_FIELDS` above, `scripts/backfill-parties.mjs`) and never
 * in the order-placement gate (`placementBlock` in `src/app/api/orders/route.ts`,
 * the `Placed` transition in `orders/[id]/route.ts`), which both read the
 * stored columns directly and never pass through this function.
 *
 * Apply this AFTER `withGstPolicy` (src/lib/gst-policy.ts) at every place a
 * company row is shaped for a response, so a missing mobile shows in
 * `completeness_missing` without ever blocking an order.
 */
export function withMobileCompleteness<
  T extends { is_complete?: boolean | null; completeness_missing?: string | null; mobile_1?: string | null }
>(row: T): T {
  if (!isBlank(row.mobile_1)) return row
  const parts = row.completeness_missing ? row.completeness_missing.split(', ').filter(Boolean) : []
  if (!parts.includes('Mobile Number')) parts.push('Mobile Number')
  return { ...row, is_complete: false, completeness_missing: parts.join(', ') }
}

/**
 * Recompute and persist `is_complete` / `completeness_missing` for one company.
 *
 * Call it after every write that could change the answer — a company create or
 * update (gst_number), and any address write. Tenant-scoped on both the read and
 * the write; a wrong `tenantId` finds nothing rather than touching another
 * tenant's row.
 *
 * The UPDATE is skipped when the computed values already match, so a no-op write
 * does not fire the `updated_at` trigger — same guard as the backfill's.
 */
export async function recomputeCompanyCompleteness(
  companyId: string,
  tenantId: string
): Promise<Completeness | null> {
  const company = await prisma.companies.findFirst({
    where: { id: companyId, tenant_id: tenantId },
    select: { gst_number: true, is_complete: true, completeness_missing: true },
  })
  if (!company) return null

  // The primary address, oldest first — the same tie-break the backfill's
  // LATERAL used (`ORDER BY ca.created_at, ca.id LIMIT 1`).
  const address = await prisma.company_addresses.findFirst({
    where: { company_id: companyId, tenant_id: tenantId, is_primary: true },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { address_line: true, city: true, state_id: true, pincode: true },
  })

  const missing: string[] = []
  if (isBlank(address?.address_line)) missing.push('Primary Address')
  if (isBlank(address?.city)) missing.push('City')
  if (!address?.state_id) missing.push('State')
  if (isBlank(address?.pincode)) missing.push('Pincode')
  if (isBlank(company.gst_number)) missing.push('GST Number')

  const completeness_missing = missing.length > 0 ? missing.join(', ') : null
  const is_complete = completeness_missing === null

  if (
    company.completeness_missing !== completeness_missing ||
    company.is_complete !== is_complete
  ) {
    await prisma.companies.updateMany({
      where: { id: companyId, tenant_id: tenantId },
      data: { is_complete, completeness_missing },
    })
  }

  return { is_complete, completeness_missing }
}
