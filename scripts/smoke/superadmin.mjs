/**
 * Batch 6 — superadmin. 7 routes, READ paths against live.
 *
 * These routes are deliberately CROSS-TENANT: `tenants` has no tenant_id (its
 * primary key IS the tenant), and the company list aggregates user counts across
 * every tenant. That is the whole point of the SuperAdmin panel, and the
 * tenant-scope allowlist records it.
 *
 * Authenticates with the real SuperAdmin credentials from .env.local — the
 * SuperAdmin login is env-backed, not database-backed, so this is a genuine
 * credentialed session rather than a minted one.
 */
import fs from 'node:fs'
import { db, req, ctx, BASE, COOKIE_NAME } from './lib.mjs'

export const name = 'superadmin'

function readEnv(key) {
  const text = fs.readFileSync('.env.local', 'utf8')
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
}

export async function run() {
  const t = ctx()
  const prisma = db()

  const ISO = /^\d{4}-\d{2}-\d{2}T.*Z$/
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

  t.section('SuperAdmin login (env-backed, not database-backed)')
  const phone = readEnv('SUPER_ADMIN_PHONE')
  const password = readEnv('SUPER_ADMIN_PASSWORD')
  const bad = await fetch(`${BASE}/api/superadmin/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, password: 'wrong-on-purpose' }),
  })
  t.ok('wrong password -> 401', bad.status === 401, bad.status)
  const res = await fetch(`${BASE}/api/superadmin/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  })
  t.ok('correct credentials -> 200', res.status === 200, res.status)
  const token = ((res.headers.get('set-cookie') ?? '').match(/rgb_session=([^;]+)/) || [])[1]
  t.ok('a session cookie was issued', Boolean(token))
  const get = p => req(p, { token })

  t.section('unauthenticated access is refused')
  t.ok('no cookie -> 401 from middleware', (await req('/api/superadmin/companies')).status === 401)
  // A normal tenant session must not reach SuperAdmin routes.
  const tenantUser = await prisma.users.findFirst({ where: { status: 'Active' }, select: { id: true, name: true, contact: true, tenant_id: true } })
  if (tenantUser) {
    const { mintSession } = await import('./lib.mjs')
    const tenantToken = await mintSession({ phone: tenantUser.contact, userId: tenantUser.id, name: tenantUser.name, role: 'Administrator', tenantId: tenantUser.tenant_id, cv: 1 })
    t.ok('a tenant Administrator session -> 403', (await req('/api/superadmin/companies', { token: tenantToken })).status === 403)
  }

  t.section('GET /api/superadmin/companies — cross-tenant list with user counts')
  const cr = await get('/api/superadmin/companies')
  const cb = await cr.json()
  const tenantCount = await prisma.tenants.count()
  t.ok('-> 200', cr.status === 200, cr.status)
  t.ok(`returns all ${tenantCount} tenants`, Array.isArray(cb) && cb.length === tenantCount, Array.isArray(cb) ? cb.length : cb)
  t.ok('sorted by name ascending', cb.every((c, i) => i === 0 || String(cb[i - 1].name).localeCompare(String(c.name)) <= 0))
  t.ok('created_at is a full ISO string', cb.every(c => c.created_at == null || ISO.test(c.created_at)), cb[0]?.created_at)
  t.ok('payment_due_date is DATE-ONLY or null', cb.every(c => c.payment_due_date === null || DATE_ONLY.test(c.payment_due_date)), cb[0]?.payment_due_date)
  t.ok('license_count is a number', cb.every(c => typeof c.license_count === 'number'))

  // The groupBy that replaced counting rows in JS must produce identical totals.
  let countMismatch = 0
  for (const c of cb) {
    const real = await prisma.users.count({ where: { tenant_id: c.id } })
    if (c.user_count !== real) countMismatch++
  }
  t.ok(`user_count matches a direct COUNT for every tenant (${cb.length} checked)`, countMismatch === 0, `${countMismatch} mismatch(es)`)

  t.section('GET /api/superadmin/companies/[id]')
  const one = cb[0]
  if (one) {
    const dr = await get(`/api/superadmin/companies/${one.id}`)
    const dbody = await dr.json()
    const [total, active, admins] = await Promise.all([
      prisma.users.count({ where: { tenant_id: one.id } }),
      prisma.users.count({ where: { tenant_id: one.id, status: 'Active' } }),
      prisma.users.count({ where: { tenant_id: one.id, profile: 'Administrator' } }),
    ])
    t.ok('-> 200', dr.status === 200, dr.status)
    t.ok(`total_users is exactly ${total}`, dbody.total_users === total, dbody.total_users)
    t.ok(`active_users is exactly ${active}`, dbody.active_users === active, dbody.active_users)
    t.ok(`adminUsers has ${admins} entries`, dbody.adminUsers.length === admins, dbody.adminUsers.length)
    t.ok('adminUsers expose only id/name/email/contact/status',
      dbody.adminUsers.every(u => Object.keys(u).sort().join(',') === 'contact,email,id,name,status'), dbody.adminUsers[0])
    t.ok('tenant payment_due_date is DATE-ONLY or null', dbody.payment_due_date === null || DATE_ONLY.test(dbody.payment_due_date), dbody.payment_due_date)
  }
  const missing = await get('/api/superadmin/companies/00000000-0000-4000-8000-0000000000ff')
  t.ok('an unknown company id -> 404 (the .single() error branch)', missing.status === 404, missing.status)

  t.section('GET /api/superadmin/companies/[id]/usage-summary — degrades without login history')
  if (one) {
    const us = await get(`/api/superadmin/companies/${one.id}/usage-summary`)
    t.ok('-> 200 despite user_login_logs not existing (PLAN.md 13.6)', us.status === 200, us.status)
    const usb = await us.json()
    t.ok('returns a JSON object, not an error', typeof usb === 'object' && usb !== null && !('error' in usb), usb)
  }

  t.section('GET /api/superadmin/companies/[id]/users — dead route, still 500 (PLAN.md 13.6)')
  if (one) {
    const ur = await get(`/api/superadmin/companies/${one.id}/users`)
    t.ok('-> 500, exactly as before the migration', ur.status === 500, ur.status)
    t.ok('body is the original "Failed to load users"', (await ur.json()).error === 'Failed to load users')
  }

  t.section('routes not exercised against live')
  t.skip('POST /api/superadmin/companies', 'provisions a whole new tenant — roles, lead masters, expense categories and an Administrator user. Covered on the scratch database.')
  t.skip('PUT /api/superadmin/companies/[id]', 'edits a real customer company record, including licence count and payment status.')
  t.skip('POST /api/superadmin/companies/[id]/admin', 'creates a real Administrator with a login on a customer tenant.')
  t.skip('DELETE /api/superadmin/companies/[id]/admins/[userId]', 'revokes a real customer Administrator.')

  return t.result()
}
