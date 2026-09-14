import { prisma } from './db'

/**
 * The `supabase` parameter is retained only so the ~21 existing call sites keep
 * compiling while the route batches are converted one at a time (PLAN.md §2.7).
 * It is unused and is removed, along with every caller's argument, in Batch 9.
 */
type LegacyClientArg = unknown

/**
 * Returns IDs of all users that `viewerUserId` is configured to see.
 * Does NOT include viewerUserId itself (callers add that if needed).
 */
export async function getVisibleUserIds(
  viewerUserId: string,
  _supabase: LegacyClientArg,
  tenantId: string
): Promise<string[]> {
  const rows = await prisma.user_visibility.findMany({
    where: { viewer_user_id: viewerUserId, tenant_id: tenantId },
    select: { target_user_id: true },
  })
  return rows.map(r => r.target_user_id)
}

/**
 * Returns true if `viewerUserId` can see `targetUserId`.
 */
export async function canView(
  viewerUserId: string,
  targetUserId: string,
  _supabase: LegacyClientArg,
  tenantId: string
): Promise<boolean> {
  const count = await prisma.user_visibility.count({
    where: {
      viewer_user_id: viewerUserId,
      target_user_id: targetUserId,
      tenant_id: tenantId,
    },
  })
  return count > 0
}
