import { NextResponse } from 'next/server'
import { prisma } from './db'
import { getTenantId } from './tenant'
import { SessionUser } from './auth'
import {
  MASTERS,
  MASTER_SECTION_KEYS,
  OPERATION_SECTIONS,
  POINTS_SECTIONS,
} from './masters-registry'

// Master sections, operation sections and points sections all come from the
// one registry — src/lib/masters-registry.ts. Adding a section is one edit
// there, not seven edits spread across the tree. MasterSection stays a union of
// literals because MASTERS is `as const`; that is what keeps checkPermission's
// signature narrow, and `tsc --noEmit` is what proves it.

// Master sections — data_scope not used (always tenant-wide)
export type MasterSection = typeof MASTERS[number]['key']

// Operations sections — data_scope applies (own / team / all)
export type OperationSection = typeof OPERATION_SECTIONS[number]

// Points sections
export type PointsSection = typeof POINTS_SECTIONS[number]

export type PermSection = MasterSection | OperationSection | PointsSection
export type PermAction = 'view' | 'create' | 'edit' | 'delete'
export type DataScope = 'own' | 'team' | 'all'

const MASTER_SECTIONS: ReadonlySet<string> = new Set<string>(MASTER_SECTION_KEYS)

type RolePermissionRow = {
  section: string
  can_view: boolean
  can_create: boolean | null
  can_edit: boolean
  can_delete: boolean
  data_scope: string | null
}

/** One role's permission rows, keyed by section. A missing section means no row. */
export type RolePermissionRows = ReadonlyMap<string, RolePermissionRow>

/**
 * A role's `role_permissions` rows, cached per (tenant, profile) for 30 seconds.
 *
 * Without it every checkPermission() and getDataScope() was its own query on a
 * 5-connection pool, and a single request makes several of them. The price is
 * that a change to a role's permissions made on ANOTHER server instance takes up
 * to 30 seconds to reach this one; a change made through this instance evicts
 * its own copy at once (invalidateRolePermissions, called by every route that
 * writes role_permissions or renames, creates or deletes a role).
 *
 * Why it is safe: the key is BOTH the tenant id and the profile, so one firm's
 * entry can only ever answer for that firm — a key built from the profile alone
 * would hand Tenant A's "Sales Rep" permissions to Tenant B's. The whole role
 * is loaded in ONE query (the rows are small and a role has one per section),
 * and an empty result is cached too: no row means denied, and that is the
 * answer until a route that writes the table evicts it. Concurrent misses share
 * one in-flight load. A load that FAILS throws and is never cached, so a
 * database blip is retried on the next call rather than remembered. Per
 * process: each server instance keeps its own copy.
 *
 * The user's role NAME is not cached here — requireUser() re-reads it from the
 * database on every request, so a role change, deactivation or credentials bump
 * still bites immediately. Only the permissions a role name maps to are cached.
 */
const ROLE_PERMISSIONS_TTL_MS = 30_000
const rolePermissionsCache = new Map<string, { rows: RolePermissionRows; expiresAt: number }>()
const rolePermissionsInflight = new Map<string, Promise<RolePermissionRows>>()

// A tenant id is a UUID and never contains ':', so the first ':' always ends it
// and no (tenant, profile) pair can collide with another.
const rolePermissionsKey = (tenantId: string, profile: string) => `${tenantId}:${profile}`

/**
 * Drop cached permissions so a change applies on the next call rather than after
 * the TTL. With a profile: that one role. Without: every role in the tenant
 * (use it for a rename, where both the old and the new name are stale). Also
 * abandons any load in flight, so a read that began before the write cannot
 * repopulate the cache with the old rows after it. PER PROCESS: it clears this
 * server's copy only; any other instance keeps its entry until the 30s expire.
 */
export function invalidateRolePermissions(tenantId: string, profile?: string): void {
  if (profile !== undefined) {
    const key = rolePermissionsKey(tenantId, profile)
    rolePermissionsCache.delete(key)
    rolePermissionsInflight.delete(key)
    return
  }
  const prefix = `${tenantId}:`
  for (const key of Array.from(rolePermissionsCache.keys())) {
    if (key.startsWith(prefix)) rolePermissionsCache.delete(key)
  }
  for (const key of Array.from(rolePermissionsInflight.keys())) {
    if (key.startsWith(prefix)) rolePermissionsInflight.delete(key)
  }
}

/**
 * Every `role_permissions` row for a role, from the cache or one query.
 * checkPermission(), getDataScope() and /api/auth/me all read through this, so
 * the three cannot disagree about a role.
 */
export async function getRolePermissions(tenantId: string, profile: string): Promise<RolePermissionRows> {
  const key = rolePermissionsKey(tenantId, profile)
  const hit = rolePermissionsCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.rows

  const pending = rolePermissionsInflight.get(key)
  if (pending) return pending

  const load: Promise<RolePermissionRows> = prisma.role_permissions
    .findMany({
      where: { tenant_id: tenantId, profile },
      select: {
        section: true, can_view: true, can_create: true, can_edit: true, can_delete: true, data_scope: true,
      },
    })
    .then(data => {
      const rows: RolePermissionRows = new Map(data.map(r => [r.section, r]))
      // Cache only if no invalidation has run since this load began: an eviction
      // removes this promise from the in-flight map, and what it read may predate
      // the write that evicted it.
      if (rolePermissionsInflight.get(key) === load) {
        rolePermissionsCache.set(key, { rows, expiresAt: Date.now() + ROLE_PERMISSIONS_TTL_MS })
      }
      return rows
    })
    .finally(() => {
      if (rolePermissionsInflight.get(key) === load) rolePermissionsInflight.delete(key)
    })
  rolePermissionsInflight.set(key, load)
  return load
}

export async function checkPermission(
  user: SessionUser,
  section: PermSection,
  action: PermAction
): Promise<boolean> {
  if (user.role === 'Administrator') return true
  if (user.role === 'Deactivated' || user.role === 'NoRole') return false
  const tid = getTenantId()
  // role_permissions has a unique constraint on (tenant_id, profile, section),
  // so a role has at most one row per section, and none means denied
  // (PLAN.md §5.3). The role's rows come from getRolePermissions()'s cache.
  const data = (await getRolePermissions(tid, user.role)).get(section)
  if (!data) return false
  switch (action) {
    case 'view':   return data.can_view
    case 'create': return data.can_create ?? data.can_edit
    case 'edit':   return data.can_edit
    case 'delete': return data.can_delete
  }
}

export async function getDataScope(
  user: SessionUser,
  section: PermSection
): Promise<DataScope> {
  if (user.role === 'Administrator') return 'all'
  // Master sections are always tenant-wide
  if (MASTER_SECTIONS.has(section)) return 'all'
  if (user.role === 'NoRole') return 'own'
  const tid = getTenantId()
  const data = (await getRolePermissions(tid, user.role)).get(section)
  const scope = data?.data_scope as DataScope | undefined
  return scope ?? 'own'
}

export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
