import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'

const ALL_SECTIONS = [
  'states', 'districts', 'talukas', 'villages', 'territory_mapping',
  'dealers', 'distributors', 'institutions',
  'product_categories', 'product_subcategories', 'products',
  'departments', 'designations', 'expense_categories',
  'lead_types', 'lead_stages', 'lead_temperatures',
  'meetings', 'expenses', 'weekly_plan', 'orders', 'leads', 'users',
]

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const profile = req.nextUrl.searchParams.get('profile') ?? ''
  const tid = getTenantId()

  try {
  const data = await prisma.role_permissions.findMany({
    where: { tenant_id: tid, profile },
    select: { section: true, can_view: true, can_create: true, can_edit: true, can_delete: true, data_scope: true },
  })

  const result: Record<string, { view: boolean; create: boolean; edit: boolean; delete: boolean; data_scope: string }> = {}
  for (const s of ALL_SECTIONS) {
    const row = data.find(r => r.section === s)
    result[s] = row
      ? { view: row.can_view, create: row.can_create ?? false, edit: row.can_edit, delete: row.can_delete, data_scope: row.data_scope ?? 'own' }
      : { view: false, create: false, edit: false, delete: false, data_scope: 'own' }
  }

  // Booleans and strings only — nothing to serialise.
  return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { profile, section, can_view, can_create, can_edit, can_delete, data_scope } = await req.json()
  const tid = getTenantId()

  try {
    // onConflict 'tenant_id,profile,section' is the real
    // @@unique([tenant_id, profile, section]) — the same key checkPermission()
    // and getDataScope() read through, so permissions keep resolving identically.
    const values = {
      can_view, can_create: can_create ?? false, can_edit, can_delete,
      data_scope: data_scope ?? 'own',
    }
    await prisma.role_permissions.upsert({
      where: { tenant_id_profile_section: { tenant_id: tid, profile, section } },
      create: { tenant_id: tid, profile, section, ...values },
      update: values,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
