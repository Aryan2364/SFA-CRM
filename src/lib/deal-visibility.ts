import type { SessionUser } from './auth'
import { intersectScope, scopedUserIds, scopeWhere } from './scope'
import { getCompanyMemberships, getDealMemberships, widenScope, type MemberAccess } from './sharing'

/**
 * Which deals the caller may SEE in a list — the one definition behind
 * `GET /api/deals` and behind every "does this account have a deal?" question
 * (the Parties alerts and filter), so the two can never disagree.
 *
 * Scope on `owner_user_id`, widened by sharing (accounts shared with the
 * caller, deals shared with them directly) exactly as the deals list always
 * did. `requestedOwner` (`?ownerId=`) INTERSECTS the scope and turns the
 * sharing widening off, because a filter by owner means that owner's rows.
 *
 * `where` always carries `tenant_id`; spread it, or pass it to a relation
 * filter (`deals: { none: where }`), never drop it.
 */
export async function visibleDealScope(
  user: SessionUser,
  tenantId: string,
  requestedOwner: string | null
) {
  const ids = intersectScope(await scopedUserIds(user, 'deals'), requestedOwner)
  const widen = ids !== null && !requestedOwner
  const [accounts, direct] = widen
    ? await Promise.all([getCompanyMemberships(user, tenantId), getDealMemberships(user, tenantId)])
    : [new Map<string, MemberAccess>(), new Map<string, MemberAccess>()]
  const where: Record<string, unknown> = {
    tenant_id: tenantId,
    ...widenScope(scopeWhere(ids, 'owner_user_id'), [
      ...(accounts.size ? [{ company_id: { in: [...accounts.keys()] } }] : []),
      ...(direct.size ? [{ id: { in: [...direct.keys()] } }] : []),
    ]),
  }
  return { ids, accounts, direct, where }
}
