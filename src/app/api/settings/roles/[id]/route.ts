import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
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

    // One transaction: the role's name IS the key its permission rows are
    // stored under (role_permissions.profile), so renaming one without the
    // other leaves every user on the role denied everything.
    //
    // users.profile is deliberately NOT rewritten here. It holds only
    // 'Standard' or 'Administrator' — the role a user holds is users.role_id,
    // which a rename does not touch.
    const data = await prisma.$transaction(async tx => {
      // update(), not updateMany(): the original ended in .select().single().
      const role = await tx.roles.update({
        where: { id: params.id, tenant_id: tid },
        data: { name: newName },
      })
      // A no-match must stay silent — updateMany (PLAN.md 8.4).
      await tx.role_permissions.updateMany({
        where: { tenant_id: tid, profile: oldName },
        data: { profile: newName },
      })
      return role
    })

    return NextResponse.json(serialize(data, 'roles'))
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
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

    // A user holds a role through users.role_id — not users.profile, which
    // holds only 'Standard' or 'Administrator', so counting it never fired and
    // the permission rows below were wiped for a role still in use. Every
    // user counts, deactivated ones included: the role_id foreign key blocks
    // the delete for them too.
    const count = await prisma.users.count({
      where: { tenant_id: tid, role_id: params.id },
    })
    if (count > 0) {
      return NextResponse.json(
        { error: `${count} user${count === 1 ? ' still has' : 's still have'} this role. Move them to another role first.` },
        { status: 409 },
      )
    }

    // One transaction, so a failure can never leave the role standing with
    // its permission rows gone.
    await prisma.$transaction([
      prisma.role_permissions.deleteMany({ where: { tenant_id: tid, profile: existing.name } }),
      prisma.roles.deleteMany({ where: { id: params.id, tenant_id: tid } }),
    ])

    return NextResponse.json({ ok: true })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
