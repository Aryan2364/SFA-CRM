import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { ALL_PERMISSION_KEYS } from '@/lib/masters-registry'

type SectionPerm = { view: boolean; edit: boolean; delete: boolean }
type Permissions = Record<string, SectionPerm>

// The permission map the client reads. It carries the two points sections as
// well as the 23 storable ones, which is why it uses ALL_PERMISSION_KEYS rather
// than ALL_SECTIONS — see the note on POINTS_SECTIONS in the registry. This
// response never writes, so an unstorable key here is harmless.
const allTrue: Permissions = ALL_PERMISSION_KEYS.reduce(
  (acc, s) => ({ ...acc, [s]: { view: true, edit: true, delete: true } }),
  {} as Permissions
)
const allFalse: Permissions = ALL_PERMISSION_KEYS.reduce(
  (acc, s) => ({ ...acc, [s]: { view: false, edit: false, delete: false } }),
  {} as Permissions
)

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tid = getTenantId()

  // Invalidate session if credentials have changed since login
  if (user.userId && user.cv !== undefined) {
    const dbUser = await prisma.users.findUnique({
      where: { id: user.userId },
      select: { credentials_version: true },
    })
    if (dbUser && (dbUser.credentials_version ?? 1) !== user.cv) {
      return NextResponse.json({ error: 'Credentials changed' }, { status: 401 })
    }
  }

  const tenant = await prisma.tenants.findUnique({ where: { id: tid }, select: { name: true } })
  const tenantName: string = tenant?.name ?? ''

  // Subordinate count. Deliberately NOT tenant-scoped, matching the previous
  // query — viewer_user_id is already specific to this user. On the
  // tenant-scope allowlist (PLAN.md §8.2) with that reason.
  const countSubordinates = (viewerUserId: string) =>
    prisma.user_visibility.count({ where: { viewer_user_id: viewerUserId } })

  if (user.role === 'Administrator') {
    if (!user.userId) return NextResponse.json({ ...user, tenantName, hasSubordinates: false, permissions: allTrue })
    const count = await countSubordinates(user.userId)
    return NextResponse.json({ ...user, tenantName, hasSubordinates: count > 0, permissions: allTrue })
  }

  if (user.role === 'NoRole' || user.role === 'Deactivated') {
    return NextResponse.json({ ...user, tenantName, hasSubordinates: false, permissions: allFalse })
  }

  // Role-based user — fetch permissions + subordinate count
  const [visCount, permRows] = await Promise.all([
    user.userId ? countSubordinates(user.userId) : Promise.resolve(0),
    prisma.role_permissions.findMany({
      where: { tenant_id: tid, profile: user.role },
      select: { section: true, can_view: true, can_create: true, can_edit: true, can_delete: true },
    }),
  ])

  const permissions: Permissions = { ...allFalse }
  for (const row of permRows) {
    if (ALL_PERMISSION_KEYS.includes(row.section)) {
      permissions[row.section] = {
        view: row.can_view,
        edit: row.can_edit || row.can_create,
        delete: row.can_delete,
      }
    }
  }

  return NextResponse.json({
    ...user,
    tenantName,
    hasSubordinates: visCount > 0,
    permissions,
  })
}
