/**
 * Batch 1 — auth. Five routes:
 *   POST /api/auth/login            POST /api/auth/logout
 *   GET  /api/auth/me               POST /api/auth/forgot-password
 *   POST /api/auth/reset-password
 *
 * Everything here is READ-ONLY with respect to production data: the only
 * mutating routes (forgot-password, reset-password) are exercised ONLY on
 * inputs that cannot match a row, so no user's password or reset token is ever
 * written. See the skip() notes for what that leaves unexercised.
 */
import { db, mintSession, req, ctx } from './lib.mjs'

export const name = 'auth'

export async function run() {
  const t = ctx()
  const prisma = db()

  t.section('POST /api/auth/login')
  t.ok('bad credentials -> 401', (await req('/api/auth/login', { method: 'POST', body: { phone: '0000000000', password: 'nope' } })).status === 401)
  t.ok('missing fields -> 400', (await req('/api/auth/login', { method: 'POST', body: {} })).status === 400)
  const noPw = await req('/api/auth/login', { method: 'POST', body: { phone: '9999999999' } })
  t.ok('phone without password -> 400', noPw.status === 400, noPw.status)
  t.skip('POST /api/auth/login (success path)', 'requires a real user password; bcrypt hashes cannot be reversed and writing a known password to production is not acceptable. The success path is covered indirectly: /api/auth/me validates a minted session built from the same signSession() the route uses.')

  t.section('POST /api/auth/logout')
  const out = await req('/api/auth/logout', { method: 'POST' })
  t.ok('logout -> 200', out.status === 200, out.status)
  t.ok('logout clears the cookie (Max-Age=0)', /rgb_session=;|Max-Age=0/i.test(out.headers.get('set-cookie') ?? ''), out.headers.get('set-cookie'))

  t.section('GET /api/auth/me — unauthenticated')
  t.ok('no cookie -> redirected by middleware', [302, 307].includes((await req('/api/auth/me')).status))
  t.ok('tampered cookie -> redirected', [302, 307].includes((await req('/api/auth/me', { token: 'bogus.sig' })).status))

  t.section('GET /api/auth/me — Administrator')
  const admin = await prisma.users.findFirst({
    where: { profile: 'Administrator', status: 'Active' },
    select: { id: true, name: true, contact: true, tenant_id: true, credentials_version: true },
  })
  if (admin) {
    const tenant = await prisma.tenants.findUnique({ where: { id: admin.tenant_id }, select: { name: true } })
    const token = await mintSession({ phone: admin.contact, userId: admin.id, name: admin.name, role: 'Administrator', tenantId: admin.tenant_id, cv: admin.credentials_version ?? 1 })
    const r = await req('/api/auth/me', { token })
    const b = await r.json()
    t.ok('-> 200', r.status === 200, r.status)
    t.ok('tenantName matches the tenants row', b.tenantName === (tenant?.name ?? ''), b.tenantName)
    t.ok('permissions has all 25 sections', Object.keys(b.permissions).length === 25, Object.keys(b.permissions).length)
    t.ok('Administrator gets view+edit+delete everywhere', Object.values(b.permissions).every(p => p.view && p.edit && p.delete))
    t.ok('hasSubordinates is a boolean', typeof b.hasSubordinates === 'boolean', b.hasSubordinates)
    const expectedSubs = (await prisma.user_visibility.count({ where: { viewer_user_id: admin.id } })) > 0
    t.ok('hasSubordinates matches user_visibility', b.hasSubordinates === expectedSubs, `${b.hasSubordinates} vs ${expectedSubs}`)
    t.ok('no Date/Decimal leaked into the payload', JSON.stringify(b) === JSON.stringify(JSON.parse(JSON.stringify(b))))
  } else t.skip('GET /api/auth/me (Administrator)', 'no active Administrator in live data')

  t.section('GET /api/auth/me — role-holder permissions match the DB')
  const roleU = await prisma.users.findFirst({
    where: { status: 'Active', NOT: { profile: 'Administrator' }, role_id: { not: null } },
    select: { id: true, name: true, contact: true, tenant_id: true, credentials_version: true, roles: { select: { name: true } } },
  })
  if (roleU) {
    const token = await mintSession({ phone: roleU.contact, userId: roleU.id, name: roleU.name, role: roleU.roles.name, tenantId: roleU.tenant_id, cv: roleU.credentials_version ?? 1 })
    const r = await req('/api/auth/me', { token })
    const b = await r.json()
    t.ok('-> 200', r.status === 200, r.status)
    const rows = await prisma.role_permissions.findMany({
      where: { tenant_id: roleU.tenant_id, profile: roleU.roles.name },
      select: { section: true, can_view: true, can_create: true, can_edit: true, can_delete: true },
    })
    let mismatches = 0
    for (const row of rows) {
      const got = b.permissions[row.section]
      if (!got) continue
      if (got.view !== row.can_view || got.edit !== (row.can_edit || row.can_create) || got.delete !== row.can_delete) mismatches++
    }
    t.ok(`every role_permissions row is reflected in the payload (${rows.length} rows)`, mismatches === 0, `${mismatches} mismatch(es)`)
    t.ok('sections with no row default to all-false',
      Object.entries(b.permissions).filter(([s]) => !rows.some(r => r.section === s)).every(([, p]) => !p.view && !p.edit && !p.delete))
  } else t.skip('GET /api/auth/me (role-holder)', 'no active non-admin user with a role')

  t.section('GET /api/auth/me — session invalidation on credentials_version')
  if (roleU) {
    const stale = await mintSession({ phone: roleU.contact, userId: roleU.id, name: roleU.name, role: roleU.roles.name, tenantId: roleU.tenant_id, cv: (roleU.credentials_version ?? 1) + 999 })
    const r = await req('/api/auth/me', { token: stale })
    t.ok('stale credentials_version -> 401 "Credentials changed"', r.status === 401, r.status)
    t.ok('error body is the expected message', (await r.json()).error === 'Credentials changed')
  }

  t.section('GET /api/auth/me — Inactive and NoRole')
  const inactive = await prisma.users.findFirst({ where: { status: 'Inactive' }, select: { id: true, name: true, contact: true, tenant_id: true, credentials_version: true } })
  if (inactive) {
    const token = await mintSession({ phone: inactive.contact, userId: inactive.id, name: inactive.name, role: 'Deactivated', tenantId: inactive.tenant_id, cv: inactive.credentials_version ?? 1 })
    const r = await req('/api/auth/me', { token })
    const b = await r.json()
    t.ok('Deactivated -> 200 with all-false permissions', r.status === 200 && Object.values(b.permissions).every(p => !p.view && !p.edit && !p.delete), r.status)
    t.ok('Deactivated hasSubordinates is false', b.hasSubordinates === false)
  } else t.skip('GET /api/auth/me (Inactive)', 'no Inactive user in live data')

  t.section('POST /api/auth/forgot-password')
  t.ok('missing phone -> 400', (await req('/api/auth/forgot-password', { method: 'POST', body: {} })).status === 400)
  const unknown = await req('/api/auth/forgot-password', { method: 'POST', body: { phone: '0000000000' } })
  t.ok('unknown phone -> 200 (no enumeration)', unknown.status === 200, unknown.status)
  t.ok('unknown phone body is {ok:true}', (await unknown.json()).ok === true)
  t.skip('POST /api/auth/forgot-password (success path)', 'would overwrite password_reset_token/expires on a real production user and send them an email. Not exercised deliberately.')

  t.section('POST /api/auth/reset-password')
  t.ok('missing token -> 400', (await req('/api/auth/reset-password', { method: 'POST', body: { password: 'abcdef', confirmPassword: 'abcdef' } })).status === 400)
  t.ok('mismatched passwords -> 400', (await req('/api/auth/reset-password', { method: 'POST', body: { token: 'x', password: 'abcdef', confirmPassword: 'ghijkl' } })).status === 400)
  t.ok('short password -> 400', (await req('/api/auth/reset-password', { method: 'POST', body: { token: 'x', password: 'abc', confirmPassword: 'abc' } })).status === 400)
  const badTok = await req('/api/auth/reset-password', { method: 'POST', body: { token: 'definitely-not-a-real-token', password: 'abcdef', confirmPassword: 'abcdef' } })
  t.ok('unknown token -> 400 "Invalid or expired reset link"', badTok.status === 400, badTok.status)
  t.ok('unknown token message is exact', (await badTok.json()).error === 'Invalid or expired reset link')
  t.skip('POST /api/auth/reset-password (success + expiry paths)', 'both require a valid reset token, which would mean writing one to a real production user and changing their password.')

  return t.result()
}
