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

export async function checkPermission(
  user: SessionUser,
  section: PermSection,
  action: PermAction
): Promise<boolean> {
  if (user.role === 'Administrator') return true
  if (user.role === 'Deactivated' || user.role === 'NoRole') return false
  const tid = getTenantId()
  // role_permissions has a unique constraint on (tenant_id, profile, section),
  // so findUnique is exactly equivalent to .maybeSingle(): at most one row, and
  // null when there is none (PLAN.md §5.3).
  const data = await prisma.role_permissions.findUnique({
    where: {
      tenant_id_profile_section: { tenant_id: tid, profile: user.role, section },
    },
    select: { can_view: true, can_create: true, can_edit: true, can_delete: true },
  })
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
  const data = await prisma.role_permissions.findUnique({
    where: {
      tenant_id_profile_section: { tenant_id: tid, profile: user.role, section },
    },
    select: { data_scope: true },
  })
  const scope = data?.data_scope as DataScope | undefined
  return scope ?? 'own'
}

export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
