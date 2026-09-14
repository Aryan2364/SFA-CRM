import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { SupabaseClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'users', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const scope = req.nextUrl.searchParams.get('scope')
  const supabase = createServerSupabase()
  const tid = getTenantId()
  let query = supabase.from('users')
    .select('*, departments(name), designations(name), roles(name), manager:manager_user_id(id, name)')
    .eq('tenant_id', tid).order('name')
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,contact.ilike.%${q}%`)

  // scope=manage: non-admins see only users in their user_visibility chain
  // Administrators and Superadmin always see all users regardless of scope
  if (scope === 'manage' && user.userId && user.role !== 'Administrator') {
    const { data: visibleRows } = await supabase
      .from('user_visibility')
      .select('target_user_id')
      .eq('tenant_id', tid)
      .eq('viewer_user_id', user.userId)
    const visibleIds = (visibleRows ?? []).map((r: { target_user_id: string }) => r.target_user_id)
    if (visibleIds.length === 0) return NextResponse.json([])
    query = query.in('id', visibleIds)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'users', 'edit')) return forbidden()
  const { name, email, contact, password, department_id, designation_id, profile, manager_user_id, role_id } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  if (!contact?.trim()) return NextResponse.json({ error: 'Contact is required' }, { status: 400 })
  if (!password?.trim()) return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  if (!profile) return NextResponse.json({ error: 'Profile is required' }, { status: 400 })
  if (user.role !== 'Administrator')
    return NextResponse.json({ error: 'Only Administrators can create users' }, { status: 403 })

  const supabase = createServerSupabase()
  const tid = getTenantId()

  // License cap enforcement
  const [{ count: userCount }, { data: tenant }] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'Active'),
    supabase.from('tenants').select('license_count').eq('id', tid).single(),
  ])
  if (tenant && userCount !== null && userCount >= tenant.license_count) {
    return NextResponse.json(
      { error: `User limit reached (${userCount}/${tenant.license_count}). Please contact My Prosys Support team to upgrade your plan.` },
      { status: 403 }
    )
  }

  const hashedPassword = await bcrypt.hash(password.trim(), 12)
  const { data, error } = await supabase.from('users').insert({
    name: name.trim(), email: email.trim(), contact: contact.trim(), password: hashedPassword,
    department_id: department_id || null, designation_id: designation_id || null,
    profile, manager_user_id: manager_user_id || null, tenant_id: tid,
    role_id: profile === 'Administrator' ? null : (role_id || null),
  }).select().single()
  if (error) {
    if (error.code === '23505' && error.message.includes('users_tenant_contact'))
      return NextResponse.json({ error: 'Number already registered. Please use a different contact number.' }, { status: 400 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Cascade visibility: new user is visible to their manager and all ancestors
  if (manager_user_id && data) {
    await cascadeVisibilityUp(supabase, tid, data.id, manager_user_id)
  }

  // Audit log
  void supabase.from('user_audit_logs').insert({
    tenant_id: tid,
    target_user_id: data.id,
    target_user_name: data.name,
    action: 'created',
    performed_by_user_id: user.userId,
    performed_by_name: user.name,
    metadata: { profile },
  })

  return NextResponse.json(data, { status: 201 })
}

/** Insert visibility rows so managerId and all their managers can see userId. */
async function cascadeVisibilityUp(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  managerId: string
) {
  const rows: { tenant_id: string; viewer_user_id: string; target_user_id: string }[] = []
  let currentId: string | null = managerId
  const visited = new Set<string>()

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    rows.push({ tenant_id: tenantId, viewer_user_id: currentId, target_user_id: userId })
    const res: any = await supabase.from('users').select('manager_user_id').eq('id', currentId).single()
    currentId = (res.data?.manager_user_id as string | null) ?? null
  }

  if (rows.length > 0) {
    await supabase.from('user_visibility').upsert(rows, {
      onConflict: 'viewer_user_id,target_user_id',
      ignoreDuplicates: true,
    })
  }
}
