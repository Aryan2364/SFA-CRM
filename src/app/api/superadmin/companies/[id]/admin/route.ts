import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

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

  try {
    // Cross-tenant by design: phone numbers are globally unique for login.
    const existing = await prisma.users.findFirst({
      where: { contact: contact.trim() },
      select: { id: true },
    })
    if (existing) return NextResponse.json({ error: 'This phone number is already in use' }, { status: 400 })

    const user = await prisma.users.create({
      data: {
        tenant_id: params.id,
        name: name.trim(),
        contact: contact.trim(),
        email: email?.trim() || null,
        password: password.trim(),
        profile: 'Administrator',
        status: 'Active',
      },
      select: { id: true, name: true, email: true, contact: true },
    })

    // Ids and strings only — nothing to serialise.
    return NextResponse.json(user, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
