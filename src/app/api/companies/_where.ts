import type { SessionUser } from '@/lib/auth'
import { getGstRequiredForOrders } from '@/lib/gst-setting'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'
import { getCompanyMemberships, widenScope, type MemberAccess } from '@/lib/sharing'
import { listIndividualIds } from '@/lib/account-kind'

/**
 * The Companies list's WHERE, written once for `GET /api/companies` (list,
 * pages) and `GET /api/companies/alerts` (counts), so a count and the rows it
 * promises can never disagree.
 *
 * Everything the old screen narrowed in the browser is a database predicate
 * here: status, completeness and "no opportunity". Completeness is the value
 * the list SHOWS, not the stored column: stored `is_complete` /
 * `completeness_missing`, passed through `withGstPolicy` (GST not required, or
 * the account is an Individual, stops "GST Number" counting) and then
 * `withMobileCompleteness` (a blank mobile is always incomplete). The
 * predicates below are that function written as SQL conditions.
 *
 * `tenant_id` and the owner scope are part of every `where` this returns.
 */
export type CompanyFilters = {
  q?: string
  type?: string
  kind?: string
  status?: string
  completeness?: string
  /** Pass the caller's visible-deal `where` (src/lib/deal-visibility.ts) to filter on "no opportunity". */
  noDealWhere?: Record<string, unknown> | null
  requestedOwner?: string | null
}

const GST = 'GST Number'

export async function buildCompanyWhere(user: SessionUser, tid: string, f: CompanyFilters) {
  const requestedOwner = f.requestedOwner ?? null
  const ids = intersectScope(await scopedUserIds(user, 'companies'), requestedOwner)

  const needsGst = f.completeness === 'complete' || f.completeness === 'incomplete'
  // Sharing (src/lib/sharing.ts): accounts shared with the caller are OR-ed
  // into the scope — never in place of it. Not under Company scope (already
  // everything) and not when `?userId=` narrows to one owner.
  const [memberships, gstRequired] = await Promise.all([
    ids === null || requestedOwner
      ? Promise.resolve(new Map<string, MemberAccess>())
      : getCompanyMemberships(user, tid),
    getGstRequiredForOrders(tid), // cached for 30s
  ])
  // The Individual ids, only when a predicate needs the account kind: a kind
  // filter, or completeness while GST is required (Individuals are exempt).
  const individuals = f.kind || (needsGst && gstRequired) ? await listIndividualIds(tid) : []

  const and: Record<string, unknown>[] = [
    widenScope(scopeWhere(ids, 'owner_user_id'), memberships.size ? [{ id: { in: [...memberships.keys()] } }] : []),
  ]

  if (f.kind === 'Individual') and.push({ id: { in: individuals } })
  else if (f.kind === 'Company') { if (individuals.length) and.push({ id: { notIn: individuals } }) }
  else if (f.kind) and.push({ id: { in: [] } }) // unknown kind matches nothing, as the old JS filter did

  if (f.status === 'active') and.push({ is_active: true })
  else if (f.status === 'inactive') and.push({ is_active: false })

  if (needsGst) {
    const mobileBlank = { OR: [{ mobile_1: null }, { mobile_1: '' }] }
    const mobilePresent = { AND: [{ mobile_1: { not: null } }, { mobile_1: { not: '' } }] }
    // A row whose ONLY missing field is the GST number is complete when GST is
    // not required of it (the firm's switch is off, or it is an Individual).
    const gstOnly = { completeness_missing: GST }
    const rescue = gstRequired
      ? (individuals.length ? [{ AND: [gstOnly, { id: { in: individuals } }] }] : [])
      : [gstOnly]
    if (f.completeness === 'complete') {
      and.push({ AND: [mobilePresent, { OR: [{ is_complete: true }, ...rescue] }] })
    } else {
      const notRescued = gstRequired
        ? (individuals.length
            ? [{ OR: [{ completeness_missing: null }, { completeness_missing: { not: GST } }, { id: { notIn: individuals } }] }]
            : [])
        : [{ OR: [{ completeness_missing: null }, { completeness_missing: { not: GST } }] }]
      and.push({ OR: [mobileBlank, { AND: [{ is_complete: false }, ...notRescued] }] })
    }
  }

  if (f.noDealWhere) and.push({ deals: { none: f.noDealWhere } })

  const where = {
    tenant_id: tid,
    ...(f.q ? { name: { contains: f.q, mode: 'insensitive' as const } } : {}),
    ...(f.type ? { type: f.type } : {}),
    AND: and,
  }
  return { where, ids, memberships, gstRequired, individuals }
}
