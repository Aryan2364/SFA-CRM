import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma, serialize, dbErrorResult, uniqueConstraintName } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { firstForeignTenantRef, type TenantFkCheck } from '@/lib/tenant-fk'
import { rebuildVisibility } from '@/lib/visibility'
import bcrypt from 'bcryptjs'
import { PASSWORD_TOO_SHORT, passwordTooShort } from '@/lib/password-policy'

/** `users_tenant_contact` (unique per tenant): PostgreSQL 23505 under the old client, P2002 under Prisma. */
function isDuplicateContact(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false
  // Prisma 7 leaves `meta.target` unset, so the index name is read from the
  // driver adapter's error instead — see uniqueConstraintName().
  if (uniqueConstraintName(err) === 'users_tenant_contact') return true
  return JSON.stringify(err.meta?.target ?? '').includes('contact')
}

/**
 * Every FK on `users` references a bare primary key, so PostgreSQL accepts a
 * department, designation, role or manager row belonging to ANOTHER tenant —
 * and the list GET then reads that tenant's name back out through its
 * `include`. Until the composite FKs land (PLAN.md §8.2), each body-supplied id
 * is looked up in the caller's own tenant first, through firstForeignTenantRef
 * (src/lib/tenant-fk.ts). Absent, null and empty ids are left alone; only an id
 * that was actually supplied is checked. One round-trip, but per id, so the
 * message can name the field that missed.
 */
function userFkChecks(
  tid: string,
  f: { department_id?: unknown; designation_id?: unknown; role_id?: unknown; manager_user_id?: unknown }
): TenantFkCheck[] {
  return [
    { value: f.department_id, label: 'Department',
      find: id => prisma.departments.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: f.designation_id, label: 'Designation',
      find: id => prisma.designations.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: f.role_id, label: 'Role',
      find: id => prisma.roles.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
    { value: f.manager_user_id, label: 'Manager',
      find: id => prisma.users.findFirst({ where: { id, tenant_id: tid }, select: { id: true } }) },
  ]
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'users', 'edit')) return forbidden()
  const body = await req.json()
  const tid = getTenantId()

  // Every plain-text field in the allow-list below must arrive as a string.
  // Prisma's update input also takes `{ "set": value }` and writes it like the
  // bare value, so an object here would skip the trim, the uniqueness check and
  // the session invalidation below and still be written. `contact` and
  // `profile` are NOT NULL; a null password is "no change", as a blank one is.
  // A blank profile would slip past the truthiness gates below, so it is
  // refused too. The four ids are type-checked by firstForeignTenantRef().
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const TEXT_FIELDS = [['name', 'Name'], ['email', 'Email'], ['contact', 'Contact number'], ['profile', 'Profile']] as const
  for (const [key, label] of TEXT_FIELDS) {
    if (key in body && typeof body[key] !== 'string')
      return NextResponse.json({ error: `${label} is invalid` }, { status: 400 })
  }
  if ('profile' in body && !body.profile)
    return NextResponse.json({ error: 'Profile is invalid' }, { status: 400 })
  if (body.password != null && typeof body.password !== 'string')
    return NextResponse.json({ error: 'Password is invalid' }, { status: 400 })
  // Trimmed once, here, so the length check, the admin gate and the hash all
  // see the same value — the rule POST /api/masters/users applies on create.
  // Blank (or whitespace only) stays "no change".
  if (typeof body.password === 'string') body.password = body.password.trim()
  if (body.password && passwordTooShort(body.password))
    return NextResponse.json({ error: PASSWORD_TOO_SHORT }, { status: 400 })

  try {
    // Fetch existing user to support protections and audit logging
    const existing = await prisma.users.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { name: true, profile: true, manager_user_id: true, role_id: true, contact: true },
    })
    // Before the guards below, which compare against the stored row: without
    // one, a non-admin's form post read as a role change and got 403.
    if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    const oldManagerId = existing.manager_user_id ?? null

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

    // An Administrator's record is editable by Administrators only. The two
    // fields below are not the only lever on that account: `contact` IS the
    // login, and `email` is where /api/auth/forgot-password sends the reset
    // link — so any write to an Administrator's row is a slower takeover.
    if (existing?.profile === 'Administrator' && user.role !== 'Administrator')
      return NextResponse.json({ error: 'Only Administrators can edit an Administrator\'s account' }, { status: 403 })

    // Password and role_id carry the same weight as profile and were gated only
    // by `users:edit`: setting a password IS logging in as that user, and
    // role_id IS the permission set. Same rule, same mechanism — role_id is
    // compared against the stored value because the edit form always posts one.
    if (user.role !== 'Administrator') {
      // Already trimmed above: any value the hash below would write is refused.
      if (body.password)
        return NextResponse.json({ error: 'Only Administrators can set a user\'s password' }, { status: 403 })
      if ('role_id' in body && (body.role_id || null) !== (existing?.role_id ?? null))
        return NextResponse.json({ error: 'Only Administrators can change a user\'s role' }, { status: 403 })
    }

    // Whitelist allowed fields — prevent arbitrary column injection
    const ALLOWED_PUT_FIELDS = ['name', 'email', 'contact', 'password', 'department_id', 'designation_id', 'profile', 'manager_user_id', 'role_id']
    const safeBody: Record<string, unknown> = {}
    for (const key of ALLOWED_PUT_FIELDS) {
      if (key in body) safeBody[key] = body[key]
    }
    if (safeBody.password) {
      safeBody.password = await bcrypt.hash(safeBody.password as string, 12)
      // A reset link emailed before this change dies with it, as it does in
      // change-password and reset-password; left alive it would undo the
      // administrator's password.
      safeBody.password_reset_token = null
      safeBody.password_reset_expires = null
    } else {
      // An empty password is not a password: writing it would replace the hash
      // with a string bcrypt.compare() can never match, locking the account.
      delete safeBody.password
    }
    // Normalise the contact ONCE, so the uniqueness guard, the lookup and the
    // write all see the same value. Trimming only inside the guard let
    // `"9000000100 "` past uniqueness and then stored the space, leaving a
    // contact /api/auth/login could never match.
    if (typeof safeBody.contact === 'string') safeBody.contact = safeBody.contact.trim()
    if (safeBody.contact === '')
      return NextResponse.json({ error: 'Contact number is required' }, { status: 400 })
    // The edit form posts the contact on every save, so "present" is not
    // "changed". Only a changed contact is a new login to check and a reason to
    // end the user's sessions.
    const contactChanged = typeof safeBody.contact === 'string' && safeBody.contact !== existing.contact
    // Name and email are trimmed and required exactly as the create path has
    // them; this route used to store them verbatim.
    if ('name' in safeBody) {
      if (typeof safeBody.name !== 'string' || !safeBody.name.trim())
        return NextResponse.json({ error: 'Name is required' }, { status: 400 })
      safeBody.name = safeBody.name.trim()
    }
    if ('email' in safeBody) {
      if (typeof safeBody.email !== 'string' || !safeBody.email.trim())
        return NextResponse.json({ error: 'Email is required' }, { status: 400 })
      safeBody.email = safeBody.email.trim()
    }

    // Same per-tenant phone check as the create path, matching the DB's
    // `users_tenant_contact`: a number used in ANOTHER firm is allowed, and
    // /api/auth/login resolves it by password. Only on a change, so saving a
    // record whose contact is untouched never re-litigates it.
    if (contactChanged) {
      const contactTaken = await prisma.users.findFirst({
        where: { tenant_id: tid, contact: safeBody.contact as string, id: { not: params.id } },
        select: { id: true },
      })
      if (contactTaken) {
        return NextResponse.json({ error: 'This phone number is already used by another user in this company.' }, { status: 400 })
      }
    }

    // Tenant-scope every body-supplied FK id before the write — see
    // userFkChecks(). A user may not be their own manager either; a longer
    // cycle (A→B→A) is still possible and is left to rebuildVisibility().
    if (typeof safeBody.manager_user_id === 'string' && safeBody.manager_user_id === params.id)
      return NextResponse.json({ error: 'A user cannot be their own manager' }, { status: 400 })
    const fkError = await firstForeignTenantRef(userFkChecks(tid, safeBody))
    if (fkError) return NextResponse.json({ error: fkError }, { status: 400 })

    // Invalidate existing sessions only when a credential ACTUALLY changes. The
    // edit form always posts a contact, so bumping on its mere presence logged
    // the user out for every unrelated edit — a department change, a rename.
    //
    // An atomic increment, not `existing.credentials_version + 1`: that value
    // was read above, and a password change or reset committing in between
    // would already have moved the column there — writing the same number back
    // leaves any session minted by that change alive after this one.
    if (safeBody.password || contactChanged) {
      safeBody.credentials_version = { increment: 1 }
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
        return NextResponse.json({ error: 'This phone number is already used by another user in this company.' }, { status: 400 })
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
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
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
      // Reactivate writes two of the same FKs the PUT does, so it needs the
      // same tenant-scope check — Administrator-only is not tenant-only.
      if (updatePayload.manager_user_id === params.id)
        return NextResponse.json({ error: 'A user cannot be their own manager' }, { status: 400 })
      const fkError = await firstForeignTenantRef(userFkChecks(tid, updatePayload))
      if (fkError) return NextResponse.json({ error: fkError }, { status: 400 })
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
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
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
    const targetUser = await prisma.users.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { profile: true },
    })
    // The PUT's rule: an Administrator's record is for Administrators only, and
    // deleting it is the strongest write there is.
    if (targetUser?.profile === 'Administrator' && u.role !== 'Administrator')
      return NextResponse.json({ error: 'Only Administrators can delete an Administrator\'s account' }, { status: 403 })

    // Block deletion of the last Administrator
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
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
