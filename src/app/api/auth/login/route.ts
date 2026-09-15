import { NextRequest, NextResponse } from 'next/server'
import { signSession, COOKIE_NAME } from '@/lib/session'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  const { phone, password } = await req.json()
  if (!phone || !password) return NextResponse.json({ error: 'Phone and password are required' }, { status: 400 })

  // Query user by contact globally (multi-tenant: no tenant filter)
  //
  // Supabase surfaced database failures as a value (`dbError`) and this route
  // fell through to the generic 401 rather than raising. Prisma throws, so the
  // lookup is wrapped to preserve that exact behaviour (PLAN.md §5.4).
  let user = null as Awaited<ReturnType<typeof findUserByContact>>
  try {
    user = await findUserByContact(phone.trim())
  } catch {
    user = null
  }

  if (user) {
    const isHashed = user.password?.startsWith('$2')
    const isValid = isHashed
      ? await bcrypt.compare(password, user.password)
      : user.password === password
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid phone or password' }, { status: 401 })
    }
    // Lazily upgrade plaintext password to hash on first successful login.
    // Fire-and-forget, as before — a failure here must never block login, so the
    // rejection is swallowed rather than left unhandled.
    if (!isHashed) {
      const hash = await bcrypt.hash(password, 12)
      void prisma.users.update({ where: { id: user.id }, data: { password: hash } }).catch(() => {})
    }
    if (user.status !== 'Active') {
      return NextResponse.json({ error: 'Account is inactive. Contact your administrator.' }, { status: 403 })
    }

    // Check tenant status
    if (user.tenant_id) {
      const tenant = await prisma.tenants.findUnique({
        where: { id: user.tenant_id },
        select: { is_active: true, payment_status: true },
      })
      if (tenant) {
        if (!tenant.is_active) {
          return NextResponse.json({ error: 'Your company account is disabled. Please contact support.' }, { status: 403 })
        }
        if (tenant.payment_status === 'Suspended') {
          return NextResponse.json({ error: "Your company's access has been suspended. Please contact support." }, { status: 403 })
        }
      }
    }

    // Resolve the effective role the same way requireUser() does:
    // Administrator profile stays 'Administrator'; otherwise use the assigned
    // role name (from role_id → roles.name), falling back to 'NoRole'.
    const roleName = user.roles?.name
    const effectiveRole =
      user.profile === 'Administrator' ? 'Administrator' : (roleName ?? 'NoRole')

    const token = await signSession({
      phone: user.contact,
      userId: user.id,
      name: user.name,
      role: effectiveRole,
      tenantId: user.tenant_id ?? process.env.DEFAULT_TENANT_ID ?? '',
      cv: user.credentials_version ?? 1,
    })
    // NOTE: the previous fire-and-forget insert into `user_login_logs` was
    // removed here. That table does not exist in the database, so the write had
    // been failing silently (Supabase returned the error as an ignored value).
    // See PLAN.md §13.1 — the capability is gone, not migrated.
    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 8 })
    return res
  }

  return NextResponse.json({ error: 'Invalid phone or password' }, { status: 401 })
}

/**
 * `.order('created_at').limit(1).maybeSingle()` becomes findFirst with the same
 * ordering: oldest matching row, or null. Deliberately not tenant-scoped — login
 * resolves a user across all tenants and derives the tenant FROM the row. This
 * is on the tenant-scope allowlist (PLAN.md §8.2) with that reason.
 */
function findUserByContact(contact: string) {
  return prisma.users.findFirst({
    where: { contact },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      name: true,
      profile: true,
      contact: true,
      password: true,
      status: true,
      tenant_id: true,
      credentials_version: true,
      roles: { select: { name: true } },
    },
  })
}
