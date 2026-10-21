import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma, serialize, dbErrorMessage, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { invalidateRolePermissions } from '@/lib/permissions'
import { ALL_SECTIONS } from '@/lib/masters-registry'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tid = getTenantId()

  try {
    const data = await prisma.roles.findMany({
      where: { tenant_id: tid },
      select: { id: true, name: true, is_system: true, created_at: true },
      // Two .order() calls become an ORDERED array — is_system desc first, then name.
      orderBy: [{ is_system: 'desc' }, { name: 'asc' }],
    })
    return NextResponse.json(serialize(data, 'roles'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const tid = getTenantId()

  try {
    // One transaction: a role whose permission rows failed to seed would exist
    // with no rows at all, and checkPermission denies a missing row.
    const data = await prisma.$transaction(async tx => {
      const role = await tx.roles.create({
        data: { tenant_id: tid, name: name.trim(), is_system: false },
      })

      // Seed an empty permission row per section, from the one registry.
      // ALL_SECTIONS includes every section — masters, operations and the
      // points sections (leaderboard/points_config) — the
      // role_permissions_section_check constraint does not exist on RDS or
      // locally (verified 2026-10-16), so every section is insertable.
      // ignoreDuplicates: true -> skipDuplicates, against the real
      // @@unique([tenant_id, profile, section]).
      await tx.role_permissions.createMany({
        data: ALL_SECTIONS.map(s => ({
          tenant_id: tid,
          profile: name.trim(),
          section: s,
          can_view: false,
          can_create: false,
          can_edit: false,
          can_delete: false,
          data_scope: 'own',
        })),
        skipDuplicates: true,
      })
      return role
    })
    // A name that was looked up before it existed may be cached as "no rows".
    invalidateRolePermissions(tid, name.trim())

    return NextResponse.json(serialize(data, 'roles'), { status: 201 })
  } catch (err) {
    // dbErrorResult: a duplicate role name is a 409 with a readable message.
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
