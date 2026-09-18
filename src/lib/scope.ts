import { SessionUser } from './auth'
import { getDataScope, PermSection } from './permissions'
import { getVisibleUserIds } from './visibility'

/**
 * The Self / Team / Company data filter (REBUILD-PLAN.md §6.6), written once.
 *
 * The mechanism it composes already existed — `getDataScope()` reads
 * `role_permissions.data_scope`, and `user_visibility` already materialises the
 * FULL manager chain, not just direct reports. What did not exist was one place
 * to compose them, so `/api/orders` did it by hand and every other list simply
 * ignored the setting.
 *
 * ⚠️ `getVisibleUserIds()` deliberately EXCLUDES the viewer, so every caller
 * had to remember `[user.userId, ...]`. That convention is fixed here, inside
 * the helper — forgetting it is a silent "manager cannot see their own rows"
 * bug, and this is the reason the file exists.
 */

/** `null` means Company scope: no user predicate at all. */
export async function scopedUserIds(
  user: SessionUser,
  section: PermSection
): Promise<string[] | null> {
  const scope = await getDataScope(user, section)
  if (scope === 'all') return null
  // A session with no user row (SuperAdmin-shaped tokens) can own no rows.
  // `[]` matches nothing, which is the safe answer; `null` would be Company.
  if (!user.userId) return []
  if (scope === 'own') return [user.userId]
  return [user.userId, ...(await getVisibleUserIds(user.userId, user.tenantId))]
}

/**
 * Spreads into a Prisma `where`. `column` is explicit because the Party tables
 * scope on `owner_user_id`, not `user_id`.
 */
export function scopeWhere(
  ids: string[] | null,
  column = 'user_id'
): Record<string, unknown> {
  return ids ? { [column]: { in: ids } } : {}
}

/**
 * Narrows the scope by a caller-supplied `?userId=`.
 *
 * ⚠️ `orders/route.ts:57` lets `?userId=` REPLACE the filter, so any caller can
 * name another user's id and read their rows (gap G3). This INTERSECTS instead:
 * a requested id outside the allowed set collapses to `[]` — no rows — never to
 * a wider set. Company scope (`null`) plus a requested id narrows to that id,
 * which is a filter, not a bypass.
 */
export function intersectScope(
  ids: string[] | null,
  requested: string | null | undefined
): string[] | null {
  if (!requested) return ids
  if (ids === null) return [requested]
  return ids.includes(requested) ? [requested] : []
}
