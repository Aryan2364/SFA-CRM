import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { rebuildVisibility } from '@/lib/visibility'
import bcrypt from 'bcryptjs'

/** `users_tenant_contact`: PostgreSQL 23505 under Supabase, P2002 under Prisma. */
function isDuplicateContact(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false
  const target = JSON.stringify(err.meta?.target ?? '')
  return target.includes('users_tenant_contact') || target.includes('contact')
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'users', 'edit')) return forbidden()
  const body = await req.json()
  const tid = getTenantId()

  try {
    // Fetch existing user to support protections and audit logging
    const existing = await prisma.users.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { name: true, profile: true, manager_user_id: true },
    })
    const oldManagerId = existing?.manager_user_id ?? null

    // Self-edit restrictions
    if (params.id === user.userId) {
      if (body.profile && body.profile !== existing?.profile)
        return NextResponse.json(
          { error: user.role === 'Administrator' ? 'Administrators cannot change their own role' : 'You cannot change your own role' },
          { status: 400 }
        )
      if ('manager_user_id' in body && (body.manager_user_id || null) !== (existing?.manager_user_id || null))
        return NextResponse.json({ error: 'You cannot change your own hierarchy position' }, { status: 400 })
    }

    // Profile changes require Administrator
    if (body.profile && body.profile !== existing?.profile && user.role !== 'Administrator')
      return NextResponse.json({ error: 'Only Administrators can change a user\'s profile' }, { status: 403 })

    // Whitelist allowed fields — prevent arbitrary column injection
    const ALLOWED_PUT_FIELDS = ['name', 'email', 'contact', 'password', 'department_id', 'designation_id', 'profile', 'manager_user_id', 'role_id']
    const safeBody: Record<string, unknown> = {}
    for (const key of ALLOWED_PUT_FIELDS) {
      if (key in body) safeBody[key] = body[key]
    }
    if (safeBody.password) {
      safeBody.password = await bcrypt.hash(safeBody.password as string, 12)
    }

    // Increment credentials_version when login credentials change to invalidate existing sessions
    if (safeBody.password || safeBody.contact) {
      const cv = await prisma.users.findUnique({
        where: { id: params.id },
        select: { credentials_version: true },
      })
      safeBody.credentials_version = (cv?.credentials_version ?? 1) + 1
    }

    let data
    try {
      // update(), not updateMany(): the original ended in .select().single(), so
      // a no-match was already a 500 (PLAN.md §8.4).
      data = await prisma.users.update({
        where: { id: params.id, tenant_id: tid },
        data: safeBody,
      })
    } catch (err) {
      if (isDuplicateContact(err))
        return NextResponse.json({ error: 'Number already registered. Please use a different contact number.' }, { status: 400 })
      throw err
    }

    // NOTE: the role_changed / name_changed `user_audit_logs` inserts were
    // removed here — that table does not exist, so they had been failing
    // silently. See PLAN.md §13.1.

    // Sync user_visibility when manager changes.
    //
    // This used to remove the old ancestors' rows and cascade up the new chain,
    // both keyed on params.id alone — so a re-parented user's own subtree was
    // never re-cascaded. The old manager kept seeing the grandchildren and the
    // new manager never got them. A whole-tenant rebuild has no subtree to miss.
    const newManagerId = ('manager_user_id' in body) ? (body.manager_user_id ?? null) : oldManagerId
    if (oldManagerId !== newManagerId) {
      await rebuildVisibility(tid)
    }

    return NextResponse.json(serialize(data, 'users'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const u = await requireUser()
  if (!await checkPermission(u, 'users', 'edit')) return forbidden()

  const body = await req.json()
  const { action } = body
  if (!['deactivate', 'reactivate'].includes(action))
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const tid = getTenantId()

  try {
    if (action === 'reactivate') {
      // License cap: only Active users consume a seat
      const [activeCount, tenant] = await Promise.all([
        prisma.users.count({ where: { tenant_id: tid, status: 'Active' } }),
        prisma.tenants.findUnique({ where: { id: tid }, select: { license_count: true } }),
      ])
      if (tenant && activeCount >= tenant.license_count)
        return NextResponse.json(
          { error: 'All licensed seats are in use. Deactivate an existing user to free a seat.' },
          { status: 403 }
        )
    }

    const targetUser = await prisma.users.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { name: true, profile: true, manager_user_id: true },
    })
    if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Only Administrators can deactivate/reactivate users
    if (u.role !== 'Administrator')
      return NextResponse.json({ error: 'Only Administrators can deactivate or reactivate users' }, { status: 403 })

    // Block deactivating the last active Administrator
    if (action === 'deactivate' && targetUser.profile === 'Administrator') {
      const activeAdminCount = await prisma.users.count({
        where: { tenant_id: tid, profile: 'Administrator', status: 'Active' },
      })
      if (activeAdminCount <= 1)
        return NextResponse.json(
          { error: 'Cannot deactivate the only active Administrator. Assign another Administrator first.' },
          { status: 400 }
        )
    }

    const updatePayload: Record<string, unknown> = { status: action === 'deactivate' ? 'Inactive' : 'Active' }
    // For reactivate, optionally update profile, role and manager
    if (action === 'reactivate') {
      if (body.profile) updatePayload.profile = body.profile
      if ('role_id' in body) updatePayload.role_id = body.role_id || null
      if ('manager_user_id' in body) updatePayload.manager_user_id = body.manager_user_id || null
    }

    // updateMany(), NOT update(): this call had no .select().single(), so a
    // no-match was silent and still returned ok (PLAN.md §8.4).
    await prisma.users.updateMany({
      where: { id: params.id, tenant_id: tid },
      data: updatePayload,
    })

    // Restore the visibility chain when reactivating. Reactivate can also move
    // the user (it accepts manager_user_id), and the old cascade-only call never
    // removed the rows from the previous chain — a second way stale rows
    // accumulated. Deactivate does not touch manager_user_id, so the closure is
    // unchanged and needs no rebuild.
    if (action === 'reactivate') {
      await rebuildVisibility(tid)
    }

    // NOTE: the deactivated/reactivated `user_audit_logs` insert was removed
    // here — see PLAN.md §13.1.

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const u = await requireUser()
  if (!await checkPermission(u, 'users', 'delete')) return forbidden()

  // Block self-deletion
  if (u.userId === params.id)
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })

  const tid = getTenantId()

  try {
    // Block deletion of the last Administrator
    const targetUser = await prisma.users.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { profile: true },
    })
    if (targetUser?.profile === 'Administrator') {
      const adminCount = await prisma.users.count({
        where: { tenant_id: tid, profile: 'Administrator' },
      })
      if (adminCount <= 1)
        return NextResponse.json({ error: 'Cannot delete the only Administrator account' }, { status: 400 })
    }

    // Subordinate check. Deliberately NOT tenant-scoped, matching the previous
    // query — manager_user_id already points within a tenant.
    const subordinates = await prisma.users.count({ where: { manager_user_id: params.id } })
    if (subordinates > 0) return NextResponse.json({ error: 'Cannot delete user who has subordinates' }, { status: 400 })

    // deleteMany(), NOT delete(): a no-match was silent before (PLAN.md §8.4).
    await prisma.users.deleteMany({ where: { id: params.id, tenant_id: tid } })

    // Clean up all user_visibility rows involving this user
    await prisma.user_visibility.deleteMany({
      where: {
        tenant_id: tid,
        OR: [{ viewer_user_id: params.id }, { target_user_id: params.id }],
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
