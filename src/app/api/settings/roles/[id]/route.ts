import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const tid = getTenantId()

  try {
    const existing = await prisma.roles.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { is_system: true, name: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.is_system) return NextResponse.json({ error: 'System roles cannot be renamed' }, { status: 400 })

    const oldName = existing.name
    const newName = name.trim()

    // update(), not updateMany(): the original ended in .select().single().
    const data = await prisma.roles.update({
      where: { id: params.id, tenant_id: tid },
      data: { name: newName },
    })

    // Sync profile text in role_permissions and users tables. Both were bare
    // .update() calls with no .single(), so a no-match must stay silent —
    // updateMany (PLAN.md 8.4). This is what keeps checkPermission() resolving
    // for users of a renamed role.
    await Promise.all([
      prisma.role_permissions.updateMany({
        where: { tenant_id: tid, profile: oldName },
        data: { profile: newName },
      }),
      prisma.users.updateMany({
        where: { tenant_id: tid, profile: oldName },
        data: { profile: newName },
      }),
    ])

    return NextResponse.json(serialize(data, 'roles'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tid = getTenantId()

  try {
    const existing = await prisma.roles.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { is_system: true, name: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.is_system) return NextResponse.json({ error: 'System roles cannot be deleted' }, { status: 400 })

    // Block if any users are assigned this role (count: 'exact', head: true)
    const count = await prisma.users.count({
      where: { tenant_id: tid, profile: existing.name },
    })
    if (count > 0)
      return NextResponse.json({ error: `Cannot delete role: ${count} user(s) still assigned to it` }, { status: 400 })

    // Delete permissions rows, then the role
    await prisma.role_permissions.deleteMany({ where: { tenant_id: tid, profile: existing.name } })
    await prisma.roles.deleteMany({ where: { id: params.id, tenant_id: tid } })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
