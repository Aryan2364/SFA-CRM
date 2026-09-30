import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage, uniqueConstraintName } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import { PASSWORD_TOO_SHORT, passwordTooShort } from '@/lib/password-policy'

async function requireSuperAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'SuperAdmin') return null
  return user
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await requireSuperAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, contact, email, password } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!contact?.trim() || !/^\d{10}$/.test(contact.trim()))
    return NextResponse.json({ error: 'Phone must be exactly 10 digits' }, { status: 400 })
  if (!password?.trim()) return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  if (passwordTooShort(password.trim())) return NextResponse.json({ error: PASSWORD_TOO_SHORT }, { status: 400 })

  try {
    // Unique within this company only, as `users_tenant_contact` enforces: the
    // same number may hold an account in another company, and /api/auth/login
    // resolves that by password.
    const existing = await prisma.users.findFirst({
      where: { tenant_id: params.id, contact: contact.trim() },
      select: { id: true },
    })
    if (existing) return NextResponse.json({ error: 'This phone number is already used by another user in this company.' }, { status: 400 })

    // Never stored in cleartext — same library and cost factor as
    // /api/masters/users and /api/auth/reset-password.
    const hashedPassword = await bcrypt.hash(password.trim(), 12)

    const user = await prisma.users.create({
      data: {
        tenant_id: params.id,
        name: name.trim(),
        contact: contact.trim(),
        email: email?.trim() || null,
        password: hashedPassword,
        profile: 'Administrator',
        status: 'Active',
      },
      select: { id: true, name: true, email: true, contact: true },
    })

    // Ids and strings only — nothing to serialise.
    return NextResponse.json(user, { status: 201 })
  } catch (err) {
    // A concurrent create of the same number in this company passes the check
    // above and is caught by the constraint instead.
    if (uniqueConstraintName(err) === 'users_tenant_contact')
      return NextResponse.json({ error: 'This phone number is already used by another user in this company.' }, { status: 400 })
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
