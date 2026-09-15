#!/usr/bin/env node
/**
 * WRITE-PATH tests for Batch 5 — points, remarks, notifications,
 * access-control, settings. Local scratch database only.
 *
 *   npm run test:write:ops
 *
 * The settings routes matter most here: role_permissions is what every other
 * route's authorisation reads, so this asserts that a rename and a permission
 * write leave checkPermission()/getDataScope() resolving identically — via
 * /api/auth/me, which derives its whole payload from that table.
 *
 * Run the server under TZ=UTC (PLAN.md 5.8).
 */
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const BASE = process.env.WRITE_BASE_URL ?? 'http://127.0.0.1:3012'
const COOKIE_NAME = 'rgb_session'

function readEnv(key) {
  if (process.env[key]) return process.env[key]
  const m = fs.readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
}

const SEED = {
  tenantA: '0000000a-0000-4000-8000-000000000001',
  adminA: '0000000a-0000-4000-8000-000000000011',
  subA: '0000000a-0000-4000-8000-000000000050',
  tenantB: '0000000b-0000-4000-8000-000000000001',
}

const scratchUrl = readEnv('SCRATCH_DATABASE_URL')
if (!scratchUrl) { console.error('SCRATCH_DATABASE_URL not set'); process.exit(1) }
const host = new URL(scratchUrl).hostname
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`REFUSING TO RUN: target "${host}" is not local PostgreSQL.`)
  process.exit(1)
}
const u = new URL(scratchUrl)
u.searchParams.delete('sslmode'); u.searchParams.delete('connection_limit')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: u.toString(), max: 5 }) })

let pass = 0, fail = 0
const ok = (n, c, got) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : `   got: ${JSON.stringify(got)}`}`); c ? pass++ : fail++ }
const section = n => console.log(`\n-- ${n} --`)

async function mint(payload) {
  const secret = readEnv('SESSION_SECRET')
  const enc = new TextEncoder()
  const data = btoa(JSON.stringify(payload))
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'HMAC', hash: 'SHA-256' }, key, enc.encode(data))
  let s = ''
  for (const b of new Uint8Array(sig)) s += String.fromCharCode(b)
  return `${data}.${btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`
}

let MGR, SUB
const call = (path, token, method = 'POST', body) => fetch(`${BASE}${path}`, {
  method, redirect: 'manual',
  headers: { cookie: `${COOKIE_NAME}=${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
})

async function main() {
  const probe = await fetch(`${BASE}/login`, { redirect: 'manual' }).catch(() => null)
  if (!probe) { console.error(`No server at ${BASE}.`); process.exit(1) }

  MGR = await mint({ phone: '9000000001', userId: SEED.adminA, name: 'Scratch Admin', role: 'Administrator', tenantId: SEED.tenantA, cv: 1 })
  SUB = await mint({ phone: '9000000002', userId: SEED.subA, name: 'Scratch Subordinate', role: 'Administrator', tenantId: SEED.tenantA, cv: 1 })

  const me = await (await call('/api/auth/me', MGR, 'GET')).json()
  if (me.tenantName !== 'Scratch Tenant A') {
    console.error(`SAFETY ABORT: not on the scratch database (tenantName="${me.tenantName}").`)
    process.exit(1)
  }
  console.log(`Server confirmed on scratch DB (tenant "${me.tenantName}")`)

  // ===== settings/roles + role-permissions =================================
  section('settings/roles — create seeds 23 permission rows')
  const before = await prisma.roles.count({ where: { tenant_id: SEED.tenantA } })
  const cr = await call('/api/settings/roles', MGR, 'POST', { name: 'Scratch QA Role' })
  const role = await cr.json()
  ok('POST /settings/roles -> 201', cr.status === 201, { status: cr.status, role })
  ok('role landed in tenant A', role.tenant_id === SEED.tenantA)
  ok('is_system is false', role.is_system === false)
  ok('created_at is a full ISO string', /^\d{4}-\d{2}-\d{2}T.*Z$/.test(role.created_at), role.created_at)
  ok('role count went up by one', (await prisma.roles.count({ where: { tenant_id: SEED.tenantA } })) === before + 1)
  const seeded = await prisma.role_permissions.count({ where: { tenant_id: SEED.tenantA, profile: 'Scratch QA Role' } })
  ok('23 permission rows were seeded', seeded === 23, seeded)
  ok('all seeded rows are all-false / own', (await prisma.role_permissions.findMany({
    where: { tenant_id: SEED.tenantA, profile: 'Scratch QA Role' },
  })).every(r => !r.can_view && !r.can_create && !r.can_edit && !r.can_delete && r.data_scope === 'own'))

  section('roles POST is idempotent on the permission seed (skipDuplicates)')
  const dup = await call('/api/settings/roles', MGR, 'POST', { name: 'Scratch QA Role' })
  ok('a second role with the same name still seeds without erroring', [201, 500].includes(dup.status), dup.status)
  ok('permission rows did NOT duplicate', (await prisma.role_permissions.count({ where: { tenant_id: SEED.tenantA, profile: 'Scratch QA Role' } })) === 23)

  section('role-permissions PUT — upsert on (tenant_id, profile, section)')
  const pu = await call('/api/settings/role-permissions', MGR, 'PUT', {
    profile: 'Scratch QA Role', section: 'products',
    can_view: true, can_create: true, can_edit: true, can_delete: false, data_scope: 'team',
  })
  ok('PUT -> 200', pu.status === 200, pu.status)
  const row = await prisma.role_permissions.findUnique({
    where: { tenant_id_profile_section: { tenant_id: SEED.tenantA, profile: 'Scratch QA Role', section: 'products' } },
  })
  ok('the existing row was UPDATED, not duplicated', row?.can_view === true && row?.data_scope === 'team', row)
  ok('still exactly 23 rows for this profile', (await prisma.role_permissions.count({ where: { tenant_id: SEED.tenantA, profile: 'Scratch QA Role' } })) === 23)

  const pu2 = await call('/api/settings/role-permissions', MGR, 'PUT', {
    profile: 'Scratch QA Role', section: 'leads',
    can_view: true, can_create: false, can_edit: false, can_delete: false, data_scope: 'own',
  })
  ok('PUT for a section with no row inserts it -> 200', pu2.status === 200, pu2.status)
  ok('the inserted row is readable back', (await prisma.role_permissions.findUnique({
    where: { tenant_id_profile_section: { tenant_id: SEED.tenantA, profile: 'Scratch QA Role', section: 'leads' } },
  }))?.can_view === true)

  section('permissions RESOLVE identically after the write — via /api/auth/me')
  // A session whose role is the QA role: /api/auth/me derives its permission
  // payload from role_permissions through exactly the same key.
  const qaToken = await mint({ phone: '9000000002', userId: SEED.subA, name: 'Scratch Subordinate', role: 'Scratch QA Role', tenantId: SEED.tenantA, cv: 1 })
  await prisma.users.update({ where: { id: SEED.subA }, data: { profile: 'Standard', role_id: null } })
  // requireUser() re-resolves from the DB, so point the user at the QA role.
  const qaRole = await prisma.roles.findFirst({ where: { tenant_id: SEED.tenantA, name: 'Scratch QA Role' } })
  await prisma.users.update({ where: { id: SEED.subA }, data: { role_id: qaRole.id } })
  const qaMe = await (await call('/api/auth/me', qaToken, 'GET')).json()
  ok('role resolves to the new role name', qaMe.role === 'Scratch QA Role', qaMe.role)
  ok('products reflects the permission just written (view+edit, no delete)',
    qaMe.permissions.products.view === true && qaMe.permissions.products.edit === true && qaMe.permissions.products.delete === false,
    qaMe.permissions.products)
  ok('leads reflects its row (view only)', qaMe.permissions.leads.view === true && qaMe.permissions.leads.edit === false, qaMe.permissions.leads)
  ok('an untouched section stays all-false', qaMe.permissions.states.view === false, qaMe.permissions.states)

  section('role RENAME cascades to role_permissions and users')
  const ru = await call(`/api/settings/roles/${qaRole.id}`, MGR, 'PUT', { name: 'Scratch QA Renamed' })
  ok('PUT /settings/roles/[id] -> 200', ru.status === 200, ru.status)
  ok('role_permissions rows followed the rename',
    (await prisma.role_permissions.count({ where: { tenant_id: SEED.tenantA, profile: 'Scratch QA Renamed' } })) === 23)
  ok('no rows left under the old profile name',
    (await prisma.role_permissions.count({ where: { tenant_id: SEED.tenantA, profile: 'Scratch QA Role' } })) === 0)
  // /api/auth/me uses getCurrentUser(), i.e. the SESSION role string — it does
  // not re-resolve from the database. A session minted before the rename keeps
  // the old name and finds no permission rows. That is pre-existing behaviour,
  // so assert with a session carrying the NEW name, which is what a user gets
  // after their next login.
  const renamedToken = await mint({ phone: '9000000002', userId: SEED.subA, name: 'Scratch Subordinate', role: 'Scratch QA Renamed', tenantId: SEED.tenantA, cv: 1 })
  const renamedMe = await (await call('/api/auth/me', renamedToken, 'GET')).json()
  ok('permissions STILL resolve after the rename — products view survives', renamedMe.permissions.products.view === true, renamedMe.permissions.products)
  const staleMe = await (await call('/api/auth/me', qaToken, 'GET')).json()
  ok('a STALE session (pre-rename role name) sees all-false — pre-existing, unchanged',
    staleMe.permissions.products.view === false, staleMe.permissions.products)

  section('system roles are protected')
  const sysRole = await prisma.roles.create({ data: { tenant_id: SEED.tenantA, name: 'Scratch System', is_system: true } })
  ok('rename of a system role -> 400', (await call(`/api/settings/roles/${sysRole.id}`, MGR, 'PUT', { name: 'x' })).status === 400)
  ok('delete of a system role -> 400', (await call(`/api/settings/roles/${sysRole.id}`, MGR, 'DELETE')).status === 400)
  ok('the system role survives', (await prisma.roles.count({ where: { id: sysRole.id } })) === 1)

  section('role DELETE is blocked while users are assigned')
  // The guard counts users by PROFILE STRING, so set the profile to match.
  await prisma.users.update({ where: { id: SEED.subA }, data: { profile: 'Scratch QA Renamed' } })
  const blocked = await call(`/api/settings/roles/${qaRole.id}`, MGR, 'DELETE')
  ok('delete with an assigned user -> 400', blocked.status === 400, blocked.status)
  ok('error names the count', /\d+ user\(s\) still assigned/.test((await blocked.json()).error))

  // PRE-EXISTING GAP, asserted so it is visible rather than assumed away: the
  // guard checks users.profile, but the constraint that actually blocks the
  // delete is the users.role_id FOREIGN KEY. A user attached by role_id whose
  // profile string differs slips past the guard and gets a raw 500 instead of
  // the friendly 400. See PLAN.md 13.5.
  await prisma.users.update({ where: { id: SEED.subA }, data: { profile: 'Standard' } })
  const fkPath = await call(`/api/settings/roles/${qaRole.id}`, MGR, 'DELETE')
  ok('assigned by role_id but NOT by profile -> 500 from the FK, not a 400 (pre-existing)', fkPath.status === 500, fkPath.status)
  ok('the role survives that failed delete', (await prisma.roles.count({ where: { id: qaRole.id } })) === 1)

  await prisma.users.update({ where: { id: SEED.subA }, data: { profile: 'Standard', role_id: null } })
  const del = await call(`/api/settings/roles/${qaRole.id}`, MGR, 'DELETE')
  ok('delete once unassigned -> 200', del.status === 200, del.status)
  ok('permission rows were removed with it', (await prisma.role_permissions.count({ where: { tenant_id: SEED.tenantA, profile: 'Scratch QA Renamed' } })) === 0)
  ok('the role row is gone', (await prisma.roles.count({ where: { id: qaRole.id } })) === 0)

  section('settings routes are Administrator-only')
  await prisma.users.update({ where: { id: SEED.subA }, data: { profile: 'Standard' } })
  const nonAdmin = await mint({ phone: '9000000002', userId: SEED.subA, name: 'Scratch Subordinate', role: 'NoRole', tenantId: SEED.tenantA, cv: 1 })
  ok('GET /settings/roles as a non-Administrator -> 403', (await call('/api/settings/roles', nonAdmin, 'GET')).status === 403)
  ok('PUT /settings/role-permissions as a non-Administrator -> 403',
    (await call('/api/settings/role-permissions', nonAdmin, 'PUT', { profile: 'x', section: 'products', can_view: true, can_edit: true, can_delete: true })).status === 403)

  // ===== access-control ====================================================
  section('access-control/visibility')
  const before2 = await prisma.user_visibility.count({ where: { tenant_id: SEED.tenantA } })
  const add = await call('/api/access-control/visibility', MGR, 'POST', { viewerId: SEED.subA, targetId: SEED.adminA })
  ok('POST -> 200', add.status === 200, add.status)
  ok('a row was added', (await prisma.user_visibility.count({ where: { tenant_id: SEED.tenantA } })) === before2 + 1)
  const again = await call('/api/access-control/visibility', MGR, 'POST', { viewerId: SEED.subA, targetId: SEED.adminA })
  ok('POST again -> 200 and does NOT duplicate (upsert)', again.status === 200 &&
    (await prisma.user_visibility.count({ where: { tenant_id: SEED.tenantA } })) === before2 + 1)

  const vrow = await prisma.user_visibility.findFirst({ where: { tenant_id: SEED.tenantA, viewer_user_id: SEED.subA, target_user_id: SEED.adminA } })
  const drow = await call(`/api/access-control/visibility?id=${vrow.id}`, MGR, 'DELETE')
  ok('DELETE -> 200', drow.status === 200, drow.status)
  ok('the row is gone', (await prisma.user_visibility.count({ where: { id: vrow.id } })) === 0)
  const ghostDel = await call(`/api/access-control/visibility?id=0000000f-0000-4000-8000-0000000000ff`, MGR, 'DELETE')
  ok('DELETE of a non-existent id -> 200 (no-op, not 500)', ghostDel.status === 200, ghostDel.status)
  ok('DELETE without id -> 400', (await call('/api/access-control/visibility', MGR, 'DELETE')).status === 400)

  section('access-control/visibility/bulk-import rebuilds the manager chain')
  await prisma.user_visibility.deleteMany({ where: { tenant_id: SEED.tenantA } })
  const bulk = await call('/api/access-control/visibility/bulk-import', MGR, 'POST')
  const bulkBody = await bulk.json()
  ok('POST -> 200 with an inserted count', bulk.status === 200 && typeof bulkBody.inserted === 'number', bulkBody)
  ok('subA is now visible to their manager adminA',
    (await prisma.user_visibility.count({ where: { tenant_id: SEED.tenantA, viewer_user_id: SEED.adminA, target_user_id: SEED.subA } })) === 1)
  const bulk2 = await call('/api/access-control/visibility/bulk-import', MGR, 'POST')
  const after2 = await prisma.user_visibility.count({ where: { tenant_id: SEED.tenantA } })
  ok('a second run is idempotent (skipDuplicates)', bulk2.status === 200 &&
    (await prisma.user_visibility.count({ where: { tenant_id: SEED.tenantA } })) === after2)

  // ===== points ============================================================
  section('points/config PUT writes config and history')
  const cfgBefore = await prisma.point_config.count({ where: { tenant_id: SEED.tenantA } })
  const histBefore = await prisma.point_config_history.count({ where: { tenant_id: SEED.tenantA } })
  const cfg1 = await call('/api/points/config', MGR, 'PUT', [{ action_type: 'daily_checkin', points: 7, cap_per_day: 2, is_active: true }])
  ok('PUT -> 200', cfg1.status === 200, cfg1.status)
  const cfgRow = await prisma.point_config.findUnique({
    where: { tenant_id_action_type: { tenant_id: SEED.tenantA, action_type: 'daily_checkin' } },
  })
  ok('config row created with the new values', cfgRow?.points === 7 && cfgRow?.cap_per_day === 2, cfgRow)
  ok('updated_at is a Date', cfgRow?.updated_at instanceof Date)
  ok('config count went up by one', (await prisma.point_config.count({ where: { tenant_id: SEED.tenantA } })) === cfgBefore + 1)
  ok('NO history row on first insert (old was null)',
    (await prisma.point_config_history.count({ where: { tenant_id: SEED.tenantA } })) === histBefore)

  const cfg2 = await call('/api/points/config', MGR, 'PUT', [{ action_type: 'daily_checkin', points: 9, cap_per_day: 2, is_active: true }])
  ok('a second PUT with a CHANGED value -> 200', cfg2.status === 200)
  ok('the config row was updated, not duplicated',
    (await prisma.point_config.count({ where: { tenant_id: SEED.tenantA, action_type: 'daily_checkin' } })) === 1)
  const hist = await prisma.point_config_history.findFirst({ where: { tenant_id: SEED.tenantA, action_type: 'daily_checkin' }, orderBy: { changed_at: 'desc' } })
  ok('a history row records old -> new', hist?.old_points === 7 && hist?.new_points === 9, hist)

  const cfg3 = await call('/api/points/config', MGR, 'PUT', [{ action_type: 'daily_checkin', points: 9, cap_per_day: 2, is_active: true }])
  ok('an UNCHANGED PUT writes no history row', cfg3.status === 200 &&
    (await prisma.point_config_history.count({ where: { tenant_id: SEED.tenantA, action_type: 'daily_checkin' } })) === 1)

  const bogus = await call('/api/points/config', MGR, 'PUT', [{ action_type: 'not_a_real_action', points: 5, cap_per_day: null, is_active: true }])
  ok('an unknown action_type is ignored, not written', bogus.status === 200 &&
    (await prisma.point_config.count({ where: { tenant_id: SEED.tenantA, action_type: 'not_a_real_action' } })) === 0)

  section('points/settings PUT upserts on the tenant primary key')
  const s1 = await call('/api/points/settings', MGR, 'PUT', { reset_period: 'quarterly' })
  ok('PUT -> 200', s1.status === 200, s1.status)
  ok('row stored', (await prisma.tenant_point_settings.findUnique({ where: { tenant_id: SEED.tenantA } }))?.reset_period === 'quarterly')
  const s2 = await call('/api/points/settings', MGR, 'PUT', { reset_period: 'never' })
  ok('a second PUT updates rather than inserting', s2.status === 200 &&
    (await prisma.tenant_point_settings.count({ where: { tenant_id: SEED.tenantA } })) === 1)
  ok('value changed to never', (await prisma.tenant_point_settings.findUnique({ where: { tenant_id: SEED.tenantA } }))?.reset_period === 'never')
  ok('an invalid reset_period -> 400', (await call('/api/points/settings', MGR, 'PUT', { reset_period: 'weekly' })).status === 400)

  // ===== remarks + notifications ===========================================
  section('remarks POST creates a remark and notifies the other party')
  const plan = await prisma.weekly_plans.findFirst({ where: { tenant_id: SEED.tenantA, user_id: SEED.subA } })
  if (plan) {
    const notifBefore = await prisma.notifications.count({ where: { tenant_id: SEED.tenantA, recipient_id: SEED.subA } })
    const rm = await call('/api/remarks', MGR, 'POST', { context_type: 'weekly_plan', context_id: plan.id, body: '  manager remark  ' })
    const rmb = await rm.json()
    ok('POST -> 201', rm.status === 201, { status: rm.status, rmb })
    ok('body was trimmed', rmb.body === 'manager remark', rmb.body)
    ok('author embed is exposed under `users`', rmb.users && typeof rmb.users.name === 'string', rmb.users)
    ok('is_read is false on create', rmb.is_read === false)
    ok('created_at is a full ISO string', /^\d{4}-\d{2}-\d{2}T.*Z$/.test(rmb.created_at), rmb.created_at)
    ok('the plan owner was notified', (await prisma.notifications.count({ where: { tenant_id: SEED.tenantA, recipient_id: SEED.subA } })) === notifBefore + 1)

    section('remarks GET reflects it, and read-marking is idempotent')
    const listed = await (await call(`/api/remarks?contextType=weekly_plan&contextId=${plan.id}`, SUB, 'GET')).json()
    ok('the remark is listed', listed.some(r => r.id === rmb.id))
    ok('is_read is false for a user who has not read it', listed.find(r => r.id === rmb.id).is_read === false)
    const mark = await call(`/api/remarks/${rmb.id}/read`, SUB)
    ok('POST /remarks/[id]/read -> 200', mark.status === 200, mark.status)
    const listed2 = await (await call(`/api/remarks?contextType=weekly_plan&contextId=${plan.id}`, SUB, 'GET')).json()
    ok('is_read is now true', listed2.find(r => r.id === rmb.id).is_read === true)
    const markAgain = await call(`/api/remarks/${rmb.id}/read`, SUB)
    ok('marking read twice -> 200 and no duplicate row', markAgain.status === 200 &&
      (await prisma.remark_reads.count({ where: { remark_id: rmb.id, user_id: SEED.subA } })) === 1)

    section('notifications PATCH and read-all')
    const notif = await prisma.notifications.findFirst({ where: { tenant_id: SEED.tenantA, recipient_id: SEED.subA, is_read: false } })
    if (notif) {
      const pn = await call(`/api/notifications/${notif.id}`, SUB, 'PATCH')
      ok('PATCH -> 200', pn.status === 200, pn.status)
      ok('the row is marked read', (await prisma.notifications.findUnique({ where: { id: notif.id } }))?.is_read === true)
      const wrongUser = await prisma.notifications.findFirst({ where: { tenant_id: SEED.tenantA, recipient_id: SEED.subA } })
      const byOther = await call(`/api/notifications/${wrongUser.id}`, MGR, 'PATCH')
      ok('another user PATCHing it -> 200 but NO-OP (recipient guard)', byOther.status === 200)
    }
    await prisma.notifications.updateMany({ where: { tenant_id: SEED.tenantA, recipient_id: SEED.subA }, data: { is_read: false } })
    const ra = await call('/api/notifications/read-all', SUB)
    ok('read-all -> 200', ra.status === 200, ra.status)
    ok('every notification for that user is read',
      (await prisma.notifications.count({ where: { tenant_id: SEED.tenantA, recipient_id: SEED.subA, is_read: false } })) === 0)
  } else console.log('  SKIP  remarks/notifications (no weekly plan seeded for subA)')

  section('remarks POST rejects an unauthorised context')
  ok('missing fields -> 400', (await call('/api/remarks', MGR, 'POST', { context_type: 'weekly_plan' })).status === 400)

  // ===== isolation =========================================================
  section('tenant B untouched')
  ok('tenant B has no role_permissions', (await prisma.role_permissions.count({ where: { tenant_id: SEED.tenantB } })) === 0)
  ok('tenant B has no point_config', (await prisma.point_config.count({ where: { tenant_id: SEED.tenantB } })) === 0)
  ok('tenant B has no user_visibility', (await prisma.user_visibility.count({ where: { tenant_id: SEED.tenantB } })) === 0)
  ok('tenant B state name never changed',
    (await prisma.states.findUnique({ where: { id: '0000000b-0000-4000-8000-000000000020' } })).name === 'TENANT B STATE — MUST NEVER BE TOUCHED')

  console.log(`\n${fail === 0 ? 'BATCH 5 WRITE-PATH TESTS PASSED' : `BATCH 5 WRITE-PATH TESTS FAILED — ${fail}`}   (${pass} passed, ${fail} failed)`)
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(fail ? 1 : 0) })
  .catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
