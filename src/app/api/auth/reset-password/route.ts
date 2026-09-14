import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  const { token, password, confirmPassword } = await req.json()

  if (!token || !password)
    return NextResponse.json({ error: 'Token and password are required' }, { status: 400 })
  if (password !== confirmPassword)
    return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 })
  if (password.length < 6)
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })

  const tid = getTenantId()

  // password_reset_token carries no unique constraint, so findFirst is the
  // faithful counterpart of .maybeSingle(): first match, or null.
  const user = await prisma.users.findFirst({
    where: { password_reset_token: token, tenant_id: tid },
    select: { id: true, password_reset_expires: true },
  })

  if (!user)
    return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 })

  // Prisma already returns a Date here, where Supabase returned an ISO string.
  if (!user.password_reset_expires || user.password_reset_expires < new Date())
    return NextResponse.json({ error: 'Reset link has expired. Please request a new one.' }, { status: 400 })

  const hashedPassword = await bcrypt.hash(password, 12)
  await prisma.users.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      password_reset_token: null,
      password_reset_expires: null,
    },
  })

  return NextResponse.json({ ok: true })
}
