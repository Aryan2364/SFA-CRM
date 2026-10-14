import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { createRole, listRoles, DB_NOT_READY } from '@/lib/account-kind'

/**
 * Contact roles master — docs/accounts-contacts-spec.md §2.
 *
 * Gated on `contacts` create/edit (not a new permission section): the live
 * `role_permissions_section_check` constraint does not list a `contact_roles`
 * key, so seeding one here the way the sharing/couldn't-meet masters hit the
 * same wall would need `UNSTORABLE_MASTERS`, which denies every
 * non-Administrator until the constraint is widened. Gating on the existing
 * `contacts` section instead means every role that can already manage
 * contacts can manage their roles today, with no further migration.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  if (!await checkPermission(user, 'contacts', 'view')) return forbidden()
  const { rows, available } = await listRoles(getTenantId(), true)
  return NextResponse.json({ rows, available })
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'contacts', 'create')) return forbidden()
  const { name, sort_order } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const created = await createRole(getTenantId(), name.trim(), sort_order ?? 0)
  if (created === 'unavailable') return NextResponse.json({ error: DB_NOT_READY }, { status: 503 })
  return NextResponse.json(created, { status: 201 })
}
