import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

async function requireSuperAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'SuperAdmin') return null
  return user
}

export async function GET() {
  if (!await requireSuperAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // SuperAdmin routes are deliberately CROSS-TENANT: `tenants` has no tenant_id
    // (its primary key IS the tenant) and the user counts are grouped across all
    // of them. See the tenant-scope allowlist.
    const tenants = await prisma.tenants.findMany({ orderBy: { name: 'asc' } })

    // Get user counts per tenant — groupBy replaces counting rows in JS.
    const grouped = await prisma.users.groupBy({
      by: ['tenant_id'],
      _count: { _all: true },
    })
    const countMap = new Map<string, number>()
    for (const g of grouped) countMap.set(g.tenant_id, g._count._all)

    // tenants carries payment_due_date (DATE) and created_at (timestamptz).
    const rows = serialize(tenants, 'tenants') as Record<string, unknown>[]
    const result = rows.map(t => ({
      ...t,
      user_count: countMap.get(t.id as string) ?? 0,
    }))

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!await requireSuperAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const {
    name, email, phone, address, gstin,
    license_count, payment_due_date,
    adminName, adminEmail, adminPhone, adminPassword,
  } = await req.json()

  if (!name?.trim()) return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
  if (!adminName?.trim()) return NextResponse.json({ error: 'Admin name is required' }, { status: 400 })
  if (!adminPhone?.trim()) return NextResponse.json({ error: 'Admin phone is required' }, { status: 400 })
  if (!adminPassword?.trim()) return NextResponse.json({ error: 'Admin password is required' }, { status: 400 })

  // Check admin phone is not already in use. Deliberately cross-tenant: phone
  // numbers are globally unique for login, which is why /api/auth/login also
  // looks users up by contact with no tenant filter.
  const existingUser = await prisma.users.findFirst({
    where: { contact: adminPhone.trim() },
    select: { id: true },
  })
  if (existingUser) {
    return NextResponse.json({ error: 'A user with this phone number already exists' }, { status: 400 })
  }

  let tenant
  try {
    // Create tenant. payment_due_date is @db.Date, so the incoming string has to
    // become a Date.
    tenant = await prisma.tenants.create({
      data: {
        name: name.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        gstin: gstin?.trim() || null,
        license_count: license_count ? Number(license_count) : 10,
        payment_due_date: payment_due_date ? new Date(payment_due_date) : null,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }

  const tid = tenant.id

  // Auto-provision Administrator system role for new tenant
  try {
    await prisma.roles.create({
      data: { tenant_id: tid, name: 'Administrator', is_system: true },
    })
  } catch (err) {
    // Same manual rollback as before — there was no transaction here and adding
    // one would change which rows survive a partial failure.
    await prisma.tenants.deleteMany({ where: { id: tid } })
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }

  // Seed lead masters (stages, temperatures, types)
  await Promise.all([
    prisma.lead_stages.createMany({ data: [
      { tenant_id: tid, name: 'Prospect',    sort_order: 1,   is_fixed: true },
      { tenant_id: tid, name: 'Contacted',   sort_order: 2,   is_fixed: false },
      { tenant_id: tid, name: 'Interested',  sort_order: 3,   is_fixed: false },
      { tenant_id: tid, name: 'Qualified',   sort_order: 4,   is_fixed: false },
      { tenant_id: tid, name: 'Proposal',    sort_order: 5,   is_fixed: false },
      { tenant_id: tid, name: 'Negotiation', sort_order: 6,   is_fixed: false },
      { tenant_id: tid, name: 'Existing',    sort_order: 999, is_fixed: true },
    ] }),
    prisma.lead_temperatures.createMany({ data: [
      { tenant_id: tid, name: 'Cold', sort_order: 1 },
      { tenant_id: tid, name: 'Warm', sort_order: 2 },
      { tenant_id: tid, name: 'Hot',  sort_order: 3 },
    ] }),
    prisma.lead_types.createMany({ data: [
      { tenant_id: tid, name: 'Dealer',       sort_order: 1 },
      { tenant_id: tid, name: 'Distributor',  sort_order: 2 },
      { tenant_id: tid, name: 'Institution',  sort_order: 3 },
      { tenant_id: tid, name: 'End Consumer', sort_order: 4 },
    ] }),
    prisma.expense_categories.createMany({ data: [
      { tenant_id: tid, name: 'Travel',        sort_order: 1 },
      { tenant_id: tid, name: 'Food',          sort_order: 2 },
      { tenant_id: tid, name: 'Accommodation', sort_order: 3 },
      { tenant_id: tid, name: 'Communication', sort_order: 4 },
      { tenant_id: tid, name: 'Miscellaneous', sort_order: 5 },
    ] }),
  ])

  // Create admin user
  let adminUser
  try {
    adminUser = await prisma.users.create({
      data: {
        tenant_id: tid,
        name: adminName.trim(),
        email: adminEmail?.trim() || `admin@${name.trim().toLowerCase().replace(/\s+/g, '')}.local`,
        contact: adminPhone.trim(),
        password: adminPassword.trim(),
        profile: 'Administrator',
        status: 'Active',
      },
    })
  } catch (err) {
    await prisma.roles.deleteMany({ where: { tenant_id: tid } })
    await prisma.tenants.deleteMany({ where: { id: tid } })
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }

  return NextResponse.json({
    tenant: serialize(tenant, 'tenants'),
    user: serialize(adminUser, 'users'),
  }, { status: 201 })
}
