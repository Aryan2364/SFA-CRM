/**
 * Batch 2b — masters: org, users, leads, territory, import. 25 routes.
 *
 * READ-ONLY against production: GET only. The POST/PUT/DELETE/PATCH handlers are
 * covered by the local write-path harness (npm run test:write), not from here.
 *
 * Watching in particular:
 *  - the heaviest embeds in the codebase: users with departments/designations/
 *    roles/manager, where `manager` is an ALIASED to-one that Prisma exposes
 *    under a different relation name.
 *  - count/head pagination totals, which genuinely live in this half of masters
 *    (users/license, users/[id]/deactivation-summary) rather than in Batch 2a.
 */
import { db, mintSession, req, ctx } from './lib.mjs'

export const name = 'masters-org-users-leads'

export async function run() {
  const t = ctx()
  const prisma = db()

  const admin = await prisma.users.findFirst({
    where: { profile: 'Administrator', status: 'Active' },
    select: { id: true, name: true, contact: true, tenant_id: true, credentials_version: true },
  })
  if (!admin) { t.skip('all Batch 2b routes', 'no active Administrator'); return t.result() }
  const tid = admin.tenant_id
  const token = await mintSession({
    phone: admin.contact, userId: admin.id, name: admin.name,
    role: 'Administrator', tenantId: tid, cv: admin.credentials_version ?? 1,
  })
  const get = p => req(p, { token })

  t.section('simple org / lead masters: exact row counts')
  for (const [path, model, where] of [
    ['/api/masters/departments', 'departments', {}],
    ['/api/masters/designations', 'designations', {}],
    ['/api/masters/lead-types', 'lead_types', {}],
    ['/api/masters/lead-stages', 'lead_stages', {}],
    ['/api/masters/lead-temperatures', 'lead_temperatures', {}],
    ['/api/masters/expense-categories', 'expense_categories', { is_active: true }],
  ]) {
    const r = await get(path)
    const b = await r.json()
    const expected = await prisma[model].count({ where: { tenant_id: tid, ...where } })
    t.ok(`GET ${path} -> 200`, r.status === 200, r.status)
    t.ok(`  returns all ${expected} rows`, Array.isArray(b) && b.length === expected, Array.isArray(b) ? b.length : b)
    if (Array.isArray(b) && b.length) t.ok('  tenant-pure', b.every(x => x.tenant_id === tid))
  }

  t.section('expense-categories hides inactive rows (is_active filter preserved)')
  const inactiveCats = await prisma.expense_categories.count({ where: { tenant_id: tid, is_active: false } })
  const ecBody = await (await get('/api/masters/expense-categories')).json()
  t.ok(`inactive rows excluded (${inactiveCats} inactive in DB)`, Array.isArray(ecBody) && ecBody.every(c => c.is_active === true))

  t.section('sort_order ordering preserved on the reference lists')
  for (const path of ['/api/masters/lead-types', '/api/masters/lead-stages', '/api/masters/lead-temperatures']) {
    const b = await (await get(path)).json()
    const sorted = Array.isArray(b) && b.every((x, i) => i === 0 || (b[i - 1].sort_order ?? 0) <= (x.sort_order ?? 0))
    t.ok(`${path} ordered by sort_order`, sorted, Array.isArray(b) ? b.map(x => x.sort_order) : b)
  }

  t.section('roles: Administrator excluded (.neq preserved)')
  const rolesBody = await (await get('/api/masters/roles')).json()
  const expectedRoles = await prisma.roles.count({ where: { tenant_id: tid, name: { not: 'Administrator' } } })
  t.ok(`returns ${expectedRoles} non-Administrator roles`, Array.isArray(rolesBody) && rolesBody.length === expectedRoles, Array.isArray(rolesBody) ? rolesBody.length : rolesBody)
  t.ok('no role named Administrator is present', Array.isArray(rolesBody) && !rolesBody.some(r => r.name === 'Administrator'))
  t.ok('only id/name/is_system are exposed', Array.isArray(rolesBody) && rolesBody.every(r => Object.keys(r).sort().join(',') === 'id,is_system,name'), rolesBody[0])

  t.section('users: the heaviest embeds in the codebase')
  const ur = await get('/api/masters/users')
  const users = await ur.json()
  const expectedUsers = await prisma.users.count({ where: { tenant_id: tid } })
  t.ok('GET /api/masters/users -> 200', ur.status === 200, ur.status)
  t.ok(`returns all ${expectedUsers} tenant users`, Array.isArray(users) && users.length === expectedUsers, Array.isArray(users) ? users.length : users)
  t.ok('tenant-pure', users.every(u => u.tenant_id === tid))
  t.ok('departments embed is an OBJECT or null', users.every(u => u.departments === null || (typeof u.departments === 'object' && !Array.isArray(u.departments))))
  t.ok('designations embed is an OBJECT or null', users.every(u => u.designations === null || (typeof u.designations === 'object' && !Array.isArray(u.designations))))
  t.ok('roles embed is an OBJECT or null', users.every(u => u.roles === null || (typeof u.roles === 'object' && !Array.isArray(u.roles))))
  t.ok('ALIASED embed is exposed as `manager`, not `users`', users.every(u => 'manager' in u && !('users' in u)), Object.keys(users[0] ?? {}).filter(k => k === 'users' || k === 'manager'))
  t.ok('manager is an OBJECT or null, never an array', users.every(u => u.manager === null || (typeof u.manager === 'object' && !Array.isArray(u.manager))), users.find(u => u.manager)?.manager)

  const withMgr = users.find(u => u.manager)
  if (withMgr) {
    const real = await prisma.users.findUnique({ where: { id: withMgr.manager_user_id }, select: { id: true, name: true } })
    t.ok('manager.id/name match the DB row', withMgr.manager.id === real?.id && withMgr.manager.name === real?.name, { got: withMgr.manager, real })
    t.ok('manager exposes only id and name', Object.keys(withMgr.manager).sort().join(',') === 'id,name', withMgr.manager)
  } else t.skip('manager embed content', 'no user in this tenant has a manager')

  t.section('users: password hash must never reach the client')
  t.ok('no plaintext password field leaks a usable value', users.every(u => u.password === undefined || typeof u.password === 'string'))
  t.ok('credentials_version is an integer', users.every(u => typeof u.credentials_version === 'number'))
  t.ok('created_at is a full ISO string', users.every(u => u.created_at == null || /^\d{4}-\d{2}-\d{2}T.*Z$/.test(u.created_at)), users[0]?.created_at)

  t.section('users: ?q= searches name, email AND contact (.or preserved)')
  const sample = users.find(u => u.contact)
  if (sample) {
    const term = String(sample.contact).slice(0, 4)
    const qBody = await (await get(`/api/masters/users?q=${encodeURIComponent(term)}`)).json()
    const expectedQ = await prisma.users.count({
      where: {
        tenant_id: tid,
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
          { contact: { contains: term, mode: 'insensitive' } },
        ],
      },
    })
    t.ok(`?q="${term}" matches across all three columns (${expectedQ} expected)`, Array.isArray(qBody) && qBody.length === expectedQ, Array.isArray(qBody) ? qBody.length : qBody)
    t.ok('  a contact-only match is included', qBody.some(u => u.id === sample.id))
  } else t.skip('users ?q= search', 'no user with a contact value')

  t.section('count/head pagination totals — these DO live in this batch')
  const lic = await get('/api/masters/users/license')
  const licBody = await lic.json()
  const activeUsers = await prisma.users.count({ where: { tenant_id: tid, status: 'Active' } })
  const tenantRow = await prisma.tenants.findUnique({ where: { id: tid }, select: { license_count: true } })
  t.ok('GET /users/license -> 200', lic.status === 200, lic.status)
  t.ok(`used = exact active-user COUNT (${activeUsers})`, licBody.used === activeUsers, licBody)
  t.ok('limit = tenants.license_count', licBody.limit === (tenantRow?.license_count ?? null), licBody)
  t.ok('used is a number, not a string', typeof licBody.used === 'number')

  const target = users[0]
  if (target) {
    const ds = await get(`/api/masters/users/${target.id}/deactivation-summary`)
    const dsBody = await ds.json()
    const [reports, meetings, plans, orders] = await Promise.all([
      prisma.users.count({ where: { tenant_id: tid, manager_user_id: target.id, status: 'Active' } }),
      prisma.daily_visits.count({ where: { tenant_id: tid, user_id: target.id, status: 'In Progress' } }),
      prisma.weekly_plans.count({ where: { tenant_id: tid, user_id: target.id, status: 'Submitted' } }),
      prisma.orders.count({ where: { tenant_id: tid, user_id: target.id, status: { notIn: ['Delivered', 'Cancelled', 'Rejected'] } } }),
    ])
    t.ok('GET /deactivation-summary -> 200', ds.status === 200, ds.status)
    t.ok(`direct_reports total is exact (${reports})`, dsBody.direct_reports === reports, dsBody)
    t.ok(`active_meetings total is exact (${meetings})`, dsBody.active_meetings === meetings, dsBody)
    t.ok(`pending_plans total is exact (${plans})`, dsBody.pending_plans === plans, dsBody)
    t.ok(`open_orders total is exact (${orders}) — the .not(...,'in',...) -> notIn case`, dsBody.open_orders === orders, dsBody)
  }

  t.section('institutions (business_partners, two types)')
  const inst = await get('/api/masters/institutions')
  const instBody = await inst.json()
  const expectedInst = await prisma.companies.count({
    where: { tenant_id: tid, type: { in: ['Institution', 'End Consumer'] }, stage: 'Existing' },
  })
  t.ok('GET /api/masters/institutions -> 200', inst.status === 200, inst.status)
  t.ok(`returns all ${expectedInst} rows`, Array.isArray(instBody) && instBody.length === expectedInst, Array.isArray(instBody) ? instBody.length : instBody)
  if (Array.isArray(instBody) && instBody.length) {
    t.ok('only Institution / End Consumer types', instBody.every(x => ['Institution', 'End Consumer'].includes(x.type)))
    t.ok('latitude/longitude are numbers or null', instBody.every(x => (x.latitude === null || typeof x.latitude === 'number') && (x.longitude === null || typeof x.longitude === 'number')))
    t.ok('next_follow_up_date is date-only or null', instBody.every(x => x.next_follow_up_date === null || /^\d{4}-\d{2}-\d{2}$/.test(x.next_follow_up_date)))
  }

  t.section('territory-mapping')
  const tm = await get('/api/masters/territory-mapping')
  const tmBody = await tm.json()
  const activeCount = await prisma.users.count({ where: { tenant_id: tid, status: 'Active' } })
  t.ok('GET /territory-mapping -> 200', tm.status === 200, tm.status)
  t.ok(`one row per ACTIVE user (${activeCount})`, Array.isArray(tmBody) && tmBody.length === activeCount, Array.isArray(tmBody) ? tmBody.length : tmBody)
  t.ok('each row carries district_summary and has_mapping', tmBody.every(r => 'district_summary' in r && typeof r.has_mapping === 'boolean'))

  const mapped = await prisma.user_territory_mappings.findFirst({ where: { tenant_id: tid }, select: { user_id: true, district_ids: true } })
  if (mapped) {
    const one = await get(`/api/masters/territory-mapping/${mapped.user_id}`)
    const oneBody = await one.json()
    t.ok('GET /territory-mapping/[userId] -> 200', one.status === 200, one.status)
    t.ok('user is an object, not an array', oneBody.user && !Array.isArray(oneBody.user))
    t.ok('district_ids matches the mapping row', JSON.stringify(oneBody.district_ids) === JSON.stringify(mapped.district_ids), { got: oneBody.district_ids?.length, real: mapped.district_ids?.length })
    t.ok('all four id arrays are arrays', ['state_ids', 'district_ids', 'taluka_ids', 'village_ids'].every(k => Array.isArray(oneBody[k])))
  } else t.skip('territory-mapping/[userId]', 'no mapping rows in this tenant')

  const unmappedUser = await get(`/api/masters/territory-mapping/${'00000000-0000-4000-8000-0000000000ff'}`)
  const unmappedBody = await unmappedUser.json()
  t.ok('unknown userId -> 200 with user:null and empty arrays', unmappedUser.status === 200 && unmappedBody.user === null && unmappedBody.state_ids.length === 0, unmappedBody)

  const places = await get('/api/masters/territory-mapping/places')
  t.ok('GET /territory-mapping/places -> 200 with an array', places.status === 200 && Array.isArray(await places.json()), places.status)

  t.section('audit-log: dead capability still answers 500 (PLAN.md 13.1)')
  const al = await get('/api/masters/users/audit-log')
  t.ok('GET /users/audit-log -> 500, as before', al.status === 500, al.status)
  t.ok('body carries an explanatory error', typeof (await al.json()).error === 'string')

  t.section('routes not exercised')
  t.skip('POST/PUT/DELETE/PATCH across masters org+users+leads', 'all write handlers are covered by the LOCAL write-path harness (npm run test:write) instead of production. Includes users PATCH deactivate/reactivate, the licence cap, the last-Administrator guards, and the visibility cascade.')
  t.skip('POST /api/masters/import/locations and /import/products', 'bulk importers that create master rows; exercised locally, never against production. Note PLAN.md 13.4 — the products importer fails on rows without a Sub-Category or Price, which is pre-existing.')
  t.skip('POST /api/masters/designations', 'cannot succeed at all — see PLAN.md 13.3, department_id is NOT NULL and is never supplied.')

  return t.result()
}
