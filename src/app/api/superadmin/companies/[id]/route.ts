import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage, uniqueConstraintName } from '@/lib/db'
import { getCurrentUser, evictTenantHealth } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import { PASSWORD_TOO_SHORT, passwordTooShort } from '@/lib/password-policy'

async function requireSuperAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'SuperAdmin') return null
  return user
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!await requireSuperAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // .single() errored when the tenant did not exist and the route answered 404;
    // findUnique's null takes the same branch.
    const tenant = await prisma.tenants.findUnique({ where: { id: params.id } })
    if (!tenant) return NextResponse.json({ error: 'No rows found' }, { status: 404 })

    const [totalUsers, activeUsers, adminUsers] = await Promise.all([
      prisma.users.count({ where: { tenant_id: params.id } }),
      prisma.users.count({ where: { tenant_id: params.id, status: 'Active' } }),
      prisma.users.findMany({
        where: { tenant_id: params.id, profile: 'Administrator' },
        select: { id: true, name: true, email: true, contact: true, status: true },
        orderBy: { created_at: 'asc' },
      }),
    ])

    return NextResponse.json({
      ...(serialize(tenant, 'tenants') as Record<string, unknown>),
      total_users: totalUsers,
      active_users: activeUsers,
      adminUsers,
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await requireSuperAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const allowed = ['name', 'email', 'phone', 'address', 'gstin', 'license_count', 'payment_status', 'payment_due_date', 'is_active']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }
  if (update.license_count !== undefined) update.license_count = Number(update.license_count)
  // payment_due_date is @db.Date — the client sends "YYYY-MM-DD".
  if (update.payment_due_date !== undefined) {
    update.payment_due_date = update.payment_due_date ? new Date(update.payment_due_date as string) : null
  }
  // Before anything is written, like the checks below: a refused password must
  // not leave the firm's details saved. Blank is "no change", as further down.
  const newAdminPassword = body.adminUser?.id ? body.adminUser.password : undefined
  if (typeof newAdminPassword === 'string' && newAdminPassword.trim() && passwordTooShort(newAdminPassword.trim()))
    return NextResponse.json({ error: PASSWORD_TOO_SHORT }, { status: 400 })

  try {
    // Same per-company phone check as /api/masters/users/[id], matching the DB's
    // `users_tenant_contact`: a number used in ANOTHER company is allowed, and
    // /api/auth/login resolves it by password. Checked before the tenant row is
    // written so a rejected number does not leave the firm's details saved.
    const newContact =
      typeof body.adminUser?.contact === 'string' ? body.adminUser.contact.trim() : ''

    // The admin must belong to THIS company: without the tenant_id predicate, a
    // company's URL could edit any user in any firm. Looked up before anything
    // is written so a wrong id leaves the company untouched, too.
    let currentAdmin: { contact: string | null } | null = null
    if (body.adminUser?.id) {
      currentAdmin = await prisma.users.findFirst({
        where: { id: body.adminUser.id, tenant_id: params.id },
        select: { contact: true },
      })
      if (!currentAdmin) return NextResponse.json({ error: 'No rows found' }, { status: 404 })
    }

    if (body.adminUser?.id && newContact) {
      const contactTaken = await prisma.users.findFirst({
        where: { tenant_id: params.id, contact: newContact, id: { not: body.adminUser.id } },
        select: { id: true },
      })
      if (contactTaken) {
        return NextResponse.json({ error: 'This phone number is already used by another user in this company.' }, { status: 400 })
      }
    }

    // update(), not updateMany(): the original ended in .select().single().
    const data = await prisma.tenants.update({
      where: { id: params.id },
      data: update,
    })
    // Straight after the write, before the admin update below can throw: the
    // firm's flags are already changed, and requireUser() must see it.
    if ('is_active' in update || 'payment_status' in update) evictTenantHealth(params.id)

  // Update admin user if payload provided
  if (body.adminUser?.id) {
    const { id: adminId, name: adminName, email: adminEmail, password: adminPassword } = body.adminUser
    const userUpdate: Record<string, unknown> = {}
    if (adminName !== undefined) userUpdate.name = adminName.trim()
    if (adminEmail !== undefined) userUpdate.email = adminEmail.trim() || null
    // The same trimmed value the uniqueness check above was run against.
    if (newContact) userUpdate.contact = newContact
    // Never stored in cleartext — same library and cost factor as
    // /api/masters/users and /api/auth/reset-password.
    const passwordChanged = adminPassword !== undefined && Boolean(adminPassword.trim())
    if (passwordChanged)
      userUpdate.password = await bcrypt.hash(adminPassword.trim(), 12)
    // Log the admin out everywhere when a credential ACTUALLY changes, as
    // /api/auth/reset-password and /api/masters/users/[id] do: requireUser()
    // refuses any token whose credentials_version no longer matches. The edit
    // form always posts the contact, so a mere presence would log the admin
    // out for every rename — compare against what is stored.
    const contactChanged = Boolean(newContact) && currentAdmin?.contact !== newContact
    if (passwordChanged || contactChanged) userUpdate.credentials_version = { increment: 1 }
    if (Object.keys(userUpdate).length > 0) {
      // updateMany: no .single() in the original, so a no-match stayed silent.
      await prisma.users.updateMany({ where: { id: adminId, tenant_id: params.id }, data: userUpdate })
    }
  }

    return NextResponse.json(serialize(data, 'tenants'))
  } catch (err) {
    // A concurrent change to the same number in this company passes the check
    // above and is caught by the constraint instead.
    if (uniqueConstraintName(err) === 'users_tenant_contact')
      return NextResponse.json({ error: 'This phone number is already used by another user in this company.' }, { status: 400 })
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
