import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

async function requireSuperAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'SuperAdmin') return null
  return user
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; userId: string } }) {
  if (!await requireSuperAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Count remaining active admins for this tenant
    const adminCount = await prisma.users.count({
      where: { tenant_id: params.id, profile: 'Administrator', status: 'Active' },
    })

    if (adminCount <= 1)
      return NextResponse.json(
        { error: 'Cannot revoke the only Administrator. The company must have at least one admin.' },
        { status: 400 }
      )

    // Revoke admin: change profile to Standard, clear role_id (they'll see "define role" page).
    // updateMany, not update: no .single() in the original, so a no-match — including
    // a user who is not actually an Administrator — stayed a silent no-op.
    await prisma.users.updateMany({
      where: { id: params.userId, tenant_id: params.id, profile: 'Administrator' },
      data: { profile: 'Standard', role_id: null },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
