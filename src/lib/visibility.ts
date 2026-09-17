import { prisma } from './db'

/**
 * Recomputes one tenant's visibility closure from `users.manager_user_id`:
 * every ancestor can see every descendant.
 *
 * Rows flagged `is_manual` are left alone. An Administrator can grant an
 * arbitrary (viewer, target) pair through `POST /api/access-control/visibility`,
 * and those grants are not derivable from the hierarchy — a blind rebuild would
 * erase them.
 *
 * ⚠️ So this does NOT produce the chain closure. It produces the closure UNION
 * the manual rows, and a pair that is in both stays flagged manual permanently:
 * the delete below skips it, and the insert then skips it as a duplicate.
 * Anything that later assumes "the table equals the chain" — a report, an audit
 * script, an access-control screen — will be wrong.
 *
 * Idempotent: safe to call on every hierarchy change, and self-healing if rows
 * ever drift. Two queries, one transaction.
 */
export async function rebuildVisibility(tenantId: string): Promise<void> {
  const users = await prisma.users.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, manager_user_id: true },
  })

  // Manager lookup, built once. Only this tenant's users are in it, so a chain
  // that somehow points outside the tenant terminates instead of following.
  const managerMap: Record<string, string | null> = {}
  for (const u of users) managerMap[u.id] = u.manager_user_id ?? null

  const rowSet = new Set<string>()
  const rows: { tenant_id: string; viewer_user_id: string; target_user_id: string }[] = []

  for (const u of users) {
    if (!u.manager_user_id) continue
    let currentId: string | null = u.manager_user_id
    // `visited` guards a cycle in manager_user_id; nothing enforces acyclicity.
    const visited = new Set<string>()

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const key = `${currentId}:${u.id}`
      if (!rowSet.has(key)) {
        rowSet.add(key)
        rows.push({ tenant_id: tenantId, viewer_user_id: currentId, target_user_id: u.id })
      }
      currentId = managerMap[currentId] ?? null
    }
  }

  await prisma.$transaction([
    prisma.user_visibility.deleteMany({ where: { tenant_id: tenantId, is_manual: false } }),
    // skipDuplicates is load-bearing, not defensive: manual rows survive the
    // delete above, so a pair that is both manual and chain-implied would
    // otherwise collide with @@unique([viewer_user_id, target_user_id]) and
    // throw P2002 — failing the whole transaction, and with it the routine
    // manager change that called this.
    ...(rows.length
      ? [prisma.user_visibility.createMany({ data: rows, skipDuplicates: true })]
      : []),
  ])
}

/**
 * Returns IDs of all users that `viewerUserId` is configured to see.
 * Does NOT include viewerUserId itself (callers add that if needed).
 */
export async function getVisibleUserIds(
  viewerUserId: string,
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
