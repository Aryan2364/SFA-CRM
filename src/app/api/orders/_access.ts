/**
 * The orders of SHARED accounts, as a Prisma predicate (src/lib/sharing.ts).
 *
 * An order reaches a company two ways, and the `entityId` filter in
 * `route.ts` explains why both are needed: a direct order carries `entity_id`,
 * an order punched in a meeting carries only `visit_id`. So "this account's
 * orders" is the union, and `tenant_id` is repeated inside the relation filter
 * for the same reason it is there.
 *
 * Returned as the extra OR-branches for `widenScope()`; `[]` when nothing is
 * shared, which leaves the caller's scope predicate untouched.
 */
export function sharedOrderWhere(tenantId: string, companyIds: string[]): Record<string, unknown>[] {
  if (companyIds.length === 0) return []
  return [
    { entity_id: { in: companyIds } },
    { daily_visits: { is: { tenant_id: tenantId, entity_id: { in: companyIds } } } },
  ]
}
