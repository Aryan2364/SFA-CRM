import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

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

  try {
    // update(), not updateMany(): the original ended in .select().single().
    const data = await prisma.tenants.update({
      where: { id: params.id },
      data: update,
    })

  // Update admin user if payload provided
  if (body.adminUser?.id) {
    const { id: adminId, name: adminName, email: adminEmail, contact: adminContact, password: adminPassword } = body.adminUser
    const userUpdate: Record<string, unknown> = {}
    if (adminName !== undefined) userUpdate.name = adminName.trim()
    if (adminEmail !== undefined) userUpdate.email = adminEmail.trim() || null
    if (adminContact !== undefined && adminContact.trim()) userUpdate.contact = adminContact.trim()
    if (adminPassword !== undefined && adminPassword.trim()) userUpdate.password = adminPassword.trim()
    if (Object.keys(userUpdate).length > 0) {
      // updateMany: no .single() in the original, so a no-match stayed silent.
      await prisma.users.updateMany({ where: { id: adminId }, data: userUpdate })
    }
  }

    return NextResponse.json(serialize(data, 'tenants'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
