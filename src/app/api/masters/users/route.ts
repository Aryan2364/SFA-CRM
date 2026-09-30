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

/**
 * The `users_tenant_contact` unique index — a phone is unique per tenant, not
 * globally. The old client surfaced this as PostgreSQL error 23505; Prisma raises
 * P2002. Both are answered with the same 400.
 */
function isDuplicateContact(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false
  // Prisma 7 leaves `meta.target` unset, so the index name is read from the
  // driver adapter's error instead — see uniqueConstraintName().
  if (uniqueConstraintName(err) === 'users_tenant_contact') return true
  return JSON.stringify(err.meta?.target ?? '').includes('contact')
}

/**
 * `manager:manager_user_id(id, name)` was an ALIASED to-one embed. The Prisma
 * relation field for the same FK is called `users` (the self-relation), so the
 * row is fetched through that and renamed back to `manager` — the client reads
 * `manager`, and never saw a `users` key.
 */
function withManagerAlias(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(({ users, ...rest }) => ({ ...rest, manager: users ?? null }))
}

/**
 * Every FK on `users` references a bare primary key, so PostgreSQL accepts a
 * department, designation, role or manager row belonging to ANOTHER tenant —
 * and the list GET above then reads that tenant's name back out through its
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

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'users', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const scope = req.nextUrl.searchParams.get('scope')
  const tid = getTenantId()

  try {
    // scope=manage: non-admins see only users in their user_visibility chain
    // Administrators and Superadmin always see all users regardless of scope
    let visibleIds: string[] | null = null
    if (scope === 'manage' && user.userId && user.role !== 'Administrator') {
      const visibleRows = await prisma.user_visibility.findMany({
        where: { tenant_id: tid, viewer_user_id: user.userId },
        select: { target_user_id: true },
      })
      visibleIds = visibleRows.map(r => r.target_user_id)
      if (visibleIds.length === 0) return NextResponse.json([])
    }

    const data = await prisma.users.findMany({
      where: {
        tenant_id: tid,
        // .or('name.ilike.%q%,email.ilike.%q%,contact.ilike.%q%')
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { email: { contains: q, mode: 'insensitive' as const } },
                { contact: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(visibleIds ? { id: { in: visibleIds } } : {}),
      },
      include: {
        departments: { select: { name: true } },
        designations: { select: { name: true } },
        roles: { select: { name: true } },
        users: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    })

    const serialised = serialize(data, 'users') as Record<string, unknown>[]
    return NextResponse.json(withManagerAlias(serialised))
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'users', 'edit')) return forbidden()
  const { name, email, contact, password, department_id, designation_id, profile, manager_user_id, role_id } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  if (!contact?.trim()) return NextResponse.json({ error: 'Contact is required' }, { status: 400 })
  if (!password?.trim()) return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  if (passwordTooShort(password.trim())) return NextResponse.json({ error: PASSWORD_TOO_SHORT }, { status: 400 })
  if (!profile) return NextResponse.json({ error: 'Profile is required' }, { status: 400 })
  if (user.role !== 'Administrator')
    return NextResponse.json({ error: 'Only Administrators can create users' }, { status: 403 })

  const tid = getTenantId()

  try {
    // License cap enforcement
    const [userCount, tenant] = await Promise.all([
      prisma.users.count({ where: { tenant_id: tid, status: 'Active' } }),
      prisma.tenants.findUnique({ where: { id: tid }, select: { license_count: true } }),
    ])
    if (tenant && userCount >= tenant.license_count) {
      return NextResponse.json(
        { error: `User limit reached (${userCount}/${tenant.license_count}). Please contact My Prosys Support team to upgrade your plan.` },
        { status: 403 }
      )
    }

    // Phone must be free within THIS tenant only — the same rule the DB enforces
    // with `users_tenant_contact`. One number may hold accounts in several
    // firms; /api/auth/login resolves that by password. Checked up front for a
    // clean 400; the constraint still catches a concurrent create below.
    const contactTaken = await prisma.users.findFirst({
      where: { tenant_id: tid, contact: contact.trim() },
      select: { id: true },
    })
    if (contactTaken) {
      return NextResponse.json({ error: 'This phone number is already used by another user in this company.' }, { status: 400 })
    }

    // Tenant-scope every body-supplied FK id before the write — see
    // userFkChecks(). role_id is checked as it will be written: an
    // Administrator is stored with none, so an id sent alongside that profile
    // is discarded rather than rejected.
    const fkError = await firstForeignTenantRef(userFkChecks(tid, {
      department_id, designation_id, manager_user_id,
      role_id: profile === 'Administrator' ? null : role_id,
    }))
    if (fkError) return NextResponse.json({ error: fkError }, { status: 400 })

    const hashedPassword = await bcrypt.hash(password.trim(), 12)
    let data
    try {
      data = await prisma.users.create({
        data: {
          name: name.trim(), email: email.trim(), contact: contact.trim(), password: hashedPassword,
          department_id: department_id || null, designation_id: designation_id || null,
          profile, manager_user_id: manager_user_id || null, tenant_id: tid,
          role_id: profile === 'Administrator' ? null : (role_id || null),
        },
      })
    } catch (err) {
      if (isDuplicateContact(err))
        return NextResponse.json({ error: 'This phone number is already used by another user in this company.' }, { status: 400 })
      throw err
    }

    // Rebuild visibility: the new user becomes visible to their manager and all
    // ancestors. A whole-tenant rebuild rather than a walk from this one user —
    // see rebuildVisibility() for why.
    if (manager_user_id && data) {
      await rebuildVisibility(tid)
    }

    // NOTE: the fire-and-forget `user_audit_logs` insert was removed here. That
    // table does not exist in the database, so the write had been failing
    // silently. See PLAN.md §13.1 — the capability is gone, not migrated.

    return NextResponse.json(serialize(data, 'users'), { status: 201 })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
