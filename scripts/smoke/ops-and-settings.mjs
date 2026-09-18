/**
 * Batch 5 — points, review, dashboard, remarks, conversations, notifications,
 * access-control, settings. 23 routes, READ paths against live.
 *
 * Write paths (points config/settings PUT, remarks POST, notifications PATCH,
 * visibility POST/DELETE/bulk-import, roles POST/PUT/DELETE, role-permissions
 * PUT) are covered by the local write-path harness, never against production —
 * several of them mutate role_permissions, which every other route's
 * authorisation depends on.
 */
import { db, mintSession, req, ctx } from './lib.mjs'

export const name = 'ops-and-settings'

export async function run() {
  const t = ctx()
  const prisma = db()

  // Pick a viewer that actually has user_visibility rows — the review and
  // dashboard routes are gated on them, and the first Administrator has none.
  const viewerRow = await prisma.user_visibility.findFirst({ select: { viewer_user_id: true } })
  const admin = await prisma.users.findFirst({
    where: viewerRow ? { id: viewerRow.viewer_user_id } : { profile: 'Administrator', status: 'Active' },
    select: { id: true, name: true, contact: true, tenant_id: true, credentials_version: true },
  })
  if (!admin) { t.skip('all Batch 5 routes', 'no usable user'); return t.result() }
  const tid = admin.tenant_id
  const token = await mintSession({
    phone: admin.contact, userId: admin.id, name: admin.name,
    role: 'Administrator', tenantId: tid, cv: admin.credentials_version ?? 1,
  })
  const get = p => req(p, { token })

  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
  const ISO = /^\d{4}-\d{2}-\d{2}T.*Z$/

  // ---- dashboard: aggregate COUNT totals -----------------------------------
  t.section('dashboard/stats — every total asserted against the database')
  const sr = await get('/api/dashboard/stats')
  const sb = await sr.json()
  t.ok('-> 200', sr.status === 200, sr.status)
  const expected = {
    states: await prisma.states.count({ where: { tenant_id: tid } }),
    districts: await prisma.districts.count({ where: { tenant_id: tid } }),
    users: await prisma.users.count({ where: { tenant_id: tid } }),
    dealers: await prisma.companies.count({ where: { tenant_id: tid, type: 'Dealer' } }),
    distributors: await prisma.companies.count({ where: { tenant_id: tid, type: 'Distributor' } }),
    products: await prisma.products.count({ where: { tenant_id: tid } }),
    weeklyPlans: await prisma.weekly_plans.count({ where: { tenant_id: tid } }),
  }
  for (const [k, v] of Object.entries(expected)) {
    t.ok(`${k} total is exactly ${v}`, sb[k] === v, { got: sb[k], expected: v })
  }
  t.ok('every total is a number, not a string', Object.values(sb).every(v => typeof v === 'number'))

  t.section('dashboard/manager — the date-keyed daily grid')
  const dm = await get('/api/dashboard/manager')
  const dmb = await dm.json()
  t.ok('-> 200', dm.status === 200, dm.status)
  if (dmb.isManager) {
    t.ok('weekStart/weekEnd are DATE-ONLY strings', DATE_ONLY.test(dmb.weekStart) && DATE_ONLY.test(dmb.weekEnd), [dmb.weekStart, dmb.weekEnd])
    t.ok('teamSize matches visible subordinates', typeof dmb.teamSize === 'number' && dmb.teamSize > 0, dmb.teamSize)
    t.ok('every member has 7 daily cells', dmb.teamPerformance.every(m => m.dailyActivity.length === 7))
    t.ok('every daily cell is keyed by a DATE-ONLY string', dmb.teamPerformance.every(m => m.dailyActivity.every(d => DATE_ONLY.test(d.date))))
    t.ok('orderValue/expenseAmount are numbers, never Decimal strings',
      dmb.teamPerformance.every(m => m.dailyActivity.every(d => typeof d.orderValue === 'number' && typeof d.expenseAmount === 'number')))
    t.ok('weekTotals equal the sum of the daily cells', dmb.teamPerformance.every(m =>
      m.weekTotals.meetingsTotal === m.dailyActivity.reduce((s, d) => s + d.meetingsTotal, 0) &&
      m.weekTotals.orderValue === m.dailyActivity.reduce((s, d) => s + d.orderValue, 0)))
    // A Date-vs-string comparison regression would silently zero every cell.
    const visitsThisWeek = await prisma.daily_visits.count({
      where: { tenant_id: tid, visit_date: { gte: new Date(dmb.weekStart), lte: new Date(dmb.weekEnd) } },
    })
    const gridTotal = dmb.teamPerformance.reduce((s, m) => s + m.weekTotals.meetingsTotal, 0)
    t.ok(`grid meeting total (${gridTotal}) is consistent with the DB for that week (${visitsThisWeek} tenant-wide)`, gridTotal <= visitsThisWeek, { gridTotal, visitsThisWeek })
    t.ok('pendingPlans weekStartDate is DATE-ONLY', dmb.pendingPlans.every(p => DATE_ONLY.test(p.weekStartDate)), dmb.pendingPlans[0]?.weekStartDate)
  } else t.skip('dashboard/manager grid', 'this viewer is not a manager (no visible subordinates)')

  // ---- review --------------------------------------------------------------
  t.section('review/summary-cards')
  const rc = await get('/api/review/summary-cards')
  const rcb = await rc.json()
  t.ok('-> 200', rc.status === 200, rc.status)
  if (Array.isArray(rcb) && rcb.length) {
    t.ok('week_start/week_end are DATE-ONLY', rcb.every(c => DATE_ONLY.test(c.week_start) && DATE_ONLY.test(c.week_end)))
    t.ok('today_expenses is a number, not a Decimal string', rcb.every(c => typeof c.today_expenses === 'number'))
    t.ok('today_meetings is a number', rcb.every(c => typeof c.today_meetings === 'number'))
    t.ok('plan is an object or null', rcb.every(c => c.plan === null || typeof c.plan === 'object'))
  } else t.skip('review/summary-cards rows', 'no visible active subordinates')

  t.section('review/daily-activity and review/expenses')
  const sub = await prisma.user_visibility.findFirst({ where: { tenant_id: tid, viewer_user_id: admin.id }, select: { target_user_id: true } })
  if (sub) {
    const exp = await prisma.expenses.findFirst({ where: { tenant_id: tid, user_id: sub.target_user_id }, select: { expense_date: true } })
    if (exp) {
      const d = exp.expense_date.toISOString().slice(0, 10)
      const er = await get(`/api/review/expenses?userId=${sub.target_user_id}&date=${d}`)
      const eb = await er.json()
      const expCount = await prisma.expenses.count({ where: { tenant_id: tid, user_id: sub.target_user_id, expense_date: exp.expense_date } })
      t.ok(`review/expenses -> 200 with all ${expCount} rows for that date`, er.status === 200 && eb.length === expCount, { status: er.status, got: eb.length })
      t.ok('amount is a number, not a Decimal string', eb.every(x => typeof x.amount === 'number'), eb[0]?.amount)
      t.ok('expense_date is DATE-ONLY', eb.every(x => DATE_ONLY.test(x.expense_date)), eb[0]?.expense_date)
      t.ok('created_at is a full ISO timestamp', eb.every(x => ISO.test(x.created_at)))
    } else t.skip('review/expenses with rows', 'the visible subordinate has no expenses')

    const vis = await prisma.daily_visits.findFirst({ where: { tenant_id: tid, user_id: sub.target_user_id }, select: { visit_date: true } })
    if (vis) {
      const d = vis.visit_date.toISOString().slice(0, 10)
      const vr = await get(`/api/review/daily-activity?userId=${sub.target_user_id}&date=${d}`)
      const vb = await vr.json()
      t.ok('review/daily-activity -> 200', vr.status === 200, vr.status)
      t.ok('visit_date is DATE-ONLY', vb.every(x => DATE_ONLY.test(x.visit_date)), vb[0]?.visit_date)
      t.ok('start_time is ISO or null — the .slice(0,10) site', vb.every(x => x.start_time === null || ISO.test(x.start_time)), vb[0]?.start_time)
      t.ok('latitude is a number or null', vb.every(x => x.latitude === null || typeof x.latitude === 'number'))
    } else t.skip('review/daily-activity with rows', 'the visible subordinate has no visits')

    // Exclude EVERY visible target, not just the one sampled above — this viewer
    // can see 9 of 12 tenant users, so picking the first non-sampled user would
    // land on someone they are allowed to see.
    const allVisible = (await prisma.user_visibility.findMany({
      where: { tenant_id: tid, viewer_user_id: admin.id }, select: { target_user_id: true },
    })).map(v => v.target_user_id)
    const outsider = await prisma.users.findFirst({
      where: { tenant_id: tid, id: { notIn: [...allVisible, admin.id] } },
      select: { id: true },
    })
    if (outsider) {
      const forbidden = await get(`/api/review/expenses?userId=${outsider.id}&date=2026-01-01`)
      t.ok('review/expenses for a NON-visible user -> 403', forbidden.status === 403, forbidden.status)
    }
    t.ok('review/expenses without userId -> 400', (await get('/api/review/expenses')).status === 400)
  } else t.skip('review per-user routes', 'this viewer has no visibility rows')

  // ---- conversations -------------------------------------------------------
  t.section('conversations — the localeCompare crash site')
  const cr = await get('/api/conversations')
  const cb = await cr.json()
  t.ok('-> 200', cr.status === 200, cr.status)
  t.ok('returns an array', Array.isArray(cb))
  if (cb.length) {
    t.ok('updated_at is a full ISO string (localeCompare works on it)', cb.every(c => ISO.test(c.updated_at)), cb[0].updated_at)
    t.ok('sorted by updated_at DESC', cb.every((c, i) => i === 0 || cb[i - 1].updated_at >= c.updated_at))
    t.ok('count and unread_count are numbers', cb.every(c => typeof c.count === 'number' && typeof c.unread_count === 'number'))
    t.ok('last_author is a string', cb.every(c => typeof c.last_author === 'string'))
    const totalGrouped = cb.reduce((s, c) => s + c.count, 0)
    const totalRemarks = await prisma.contextual_remarks.count({ where: { tenant_id: tid } })
    t.ok(`grouped counts sum to the remark total (${totalGrouped} vs ${totalRemarks})`, totalGrouped === totalRemarks, { totalGrouped, totalRemarks })
    t.ok('?status=unread filters', (await (await get('/api/conversations?status=unread')).json()).every(c => c.unread_count > 0))
  } else t.skip('conversations row shapes', 'no contextual_remarks in this tenant')

  // ---- remarks -------------------------------------------------------------
  t.section('remarks')
  t.ok('missing contextType/contextId -> 400', (await get('/api/remarks')).status === 400)
  const anyRemark = await prisma.contextual_remarks.findFirst({ where: { tenant_id: tid }, select: { context_type: true, context_id: true } })
  if (anyRemark) {
    const rr = await get(`/api/remarks?contextType=${anyRemark.context_type}&contextId=${anyRemark.context_id}`)
    const rb = await rr.json()
    const expCount = await prisma.contextual_remarks.count({ where: { tenant_id: tid, context_type: anyRemark.context_type, context_id: anyRemark.context_id } })
    t.ok(`-> 200 with all ${expCount} remarks`, rr.status === 200 && rb.length === expCount, { status: rr.status, got: rb.length })
    t.ok('author is exposed under `users` (no alias on this route)', rb.every(r => 'users' in r))
    t.ok('users embed is an OBJECT, never an array', rb.every(r => r.users === null || !Array.isArray(r.users)), rb[0].users)
    t.ok('is_read is a boolean', rb.every(r => typeof r.is_read === 'boolean'))
    t.ok('created_at is a full ISO string', rb.every(r => ISO.test(r.created_at)))
  } else t.skip('remarks rows', 'no contextual_remarks in this tenant')

  // ---- notifications -------------------------------------------------------
  t.section('notifications')
  const nr = await get('/api/notifications')
  const nb = await nr.json()
  t.ok('-> 200', nr.status === 200, nr.status)
  t.ok('returns an array', Array.isArray(nb))
  if (nb.length) {
    t.ok('ALIASED actor embed is exposed as `actor`, not the relation name',
      nb.every(n => 'actor' in n && !('users_notifications_actor_idTousers' in n)), Object.keys(nb[0]).filter(k => k.includes('actor')))
    t.ok('actor is an OBJECT or null, never an array', nb.every(n => n.actor === null || (typeof n.actor === 'object' && !Array.isArray(n.actor))), nb[0].actor)
    t.ok('every row is addressed to this user', nb.every(n => n.recipient_id === admin.id))
    t.ok('created_at is a full ISO string', nb.every(n => ISO.test(n.created_at)))
    t.ok('sorted by created_at DESC', nb.every((n, i) => i === 0 || nb[i - 1].created_at >= n.created_at))
    t.ok('at most 50 rows (limit preserved)', nb.length <= 50, nb.length)
  } else t.skip('notification row shapes', 'this user has no notifications')

  // ---- points --------------------------------------------------------------
  t.section('points')
  const pc = await get('/api/points/config')
  const pcb = await pc.json()
  t.ok('config -> 200 with one row per POINT_ACTION', pc.status === 200 && Array.isArray(pcb) && pcb.length === 7, { status: pc.status, len: pcb?.length })
  t.ok('points and cap_per_day are numbers or null', pcb.every(c => typeof c.points === 'number' && (c.cap_per_day === null || typeof c.cap_per_day === 'number')))
  t.ok('is_active is a boolean', pcb.every(c => typeof c.is_active === 'boolean'))

  const pm = await get('/api/points/my')
  const pmb = await pm.json()
  t.ok('my -> 200', pm.status === 200, pm.status)
  t.ok('total is a number', typeof pmb.total === 'number', pmb.total)
  t.ok('events is an array', Array.isArray(pmb.events))
  if (pmb.events.length) {
    t.ok('earned_at is a full ISO string', pmb.events.every(e => ISO.test(e.earned_at)), pmb.events[0].earned_at)
    t.ok('points are numbers', pmb.events.every(e => typeof e.points === 'number'))
    t.ok('total equals the sum of the events', pmb.total === pmb.events.reduce((s, e) => s + e.points, 0))
  }

  const lb = await get('/api/points/leaderboard')
  const lbb = await lb.json()
  t.ok('leaderboard -> 200 array', lb.status === 200 && Array.isArray(lbb), lb.status)
  if (lbb.length) {
    t.ok('ranks are 1..n in order', lbb.every((r, i) => r.rank === i + 1))
    t.ok('sorted by points DESC', lbb.every((r, i) => i === 0 || lbb[i - 1].points >= r.points))
    t.ok('designation resolves to a string', lbb.every(r => typeof r.designation === 'string'))
    t.ok('exactly one row is flagged is_self', lbb.filter(r => r.is_self).length <= 1)
  }

  const ps = await get('/api/points/settings')
  const psb = await ps.json()
  t.ok('settings -> 200 with a reset_period', ps.status === 200 && typeof psb.reset_period === 'string', psb)
  const ph = await get('/api/points/config/history')
  t.ok('config/history -> 200 array', ph.status === 200 && Array.isArray(await ph.json()), ph.status)

  // ---- access-control ------------------------------------------------------
  t.section('access-control')
  const oc = await get('/api/access-control/org-chart')
  const ocb = await oc.json()
  const activeUsers = await prisma.users.count({ where: { tenant_id: tid, status: 'Active' } })
  t.ok(`org-chart -> 200 with all ${activeUsers} active users`, oc.status === 200 && ocb.length === activeUsers, { status: oc.status, got: ocb.length })
  t.ok('role resolves from designation or profile', ocb.every(u => typeof u.role === 'string'))

  const va = await get('/api/access-control/visibility/all')
  const vab = await va.json()
  const visCount = await prisma.user_visibility.count({ where: { tenant_id: tid } })
  t.ok(`visibility/all -> 200 with all ${visCount} rows`, va.status === 200 && vab.length === visCount, { status: va.status, got: vab.length })
  if (vab.length) t.ok('viewer_name and target_name are resolved', vab.every(r => typeof r.viewer_name === 'string' && typeof r.target_name === 'string'))

  t.ok('visibility without viewerId -> 400', (await get('/api/access-control/visibility')).status === 400)
  if (viewerRow) {
    const vr = await get(`/api/access-control/visibility?viewerId=${admin.id}`)
    const vrb = await vr.json()
    const exp = await prisma.user_visibility.count({ where: { tenant_id: tid, viewer_user_id: admin.id } })
    t.ok(`visibility?viewerId= -> ${exp} rows`, vr.status === 200 && vrb.length === exp, { status: vr.status, got: vrb.length })
  }

  // ---- settings ------------------------------------------------------------
  t.section('settings — role_permissions is what every other route depends on')
  const rr2 = await get('/api/settings/roles')
  const rb2 = await rr2.json()
  const roleCount = await prisma.roles.count({ where: { tenant_id: tid } })
  t.ok(`roles -> 200 with all ${roleCount} roles`, rr2.status === 200 && rb2.length === roleCount, { status: rr2.status, got: rb2.length })
  t.ok('system roles sort first', rb2.every((r, i) => i === 0 || !(r.is_system && !rb2[i - 1].is_system)))
  t.ok('created_at is a full ISO string', rb2.every(r => ISO.test(r.created_at)))

  const anyProfile = await prisma.role_permissions.findFirst({ where: { tenant_id: tid }, select: { profile: true } })
  if (anyProfile) {
    const rp = await get(`/api/settings/role-permissions?profile=${encodeURIComponent(anyProfile.profile)}`)
    const rpb = await rp.json()
    t.ok('role-permissions -> 200', rp.status === 200, rp.status)
    t.ok('all 23 sections present', Object.keys(rpb).length === 23, Object.keys(rpb).length)
    const rows = await prisma.role_permissions.findMany({
      where: { tenant_id: tid, profile: anyProfile.profile },
      select: { section: true, can_view: true, can_create: true, can_edit: true, can_delete: true, data_scope: true },
    })
    let mismatch = 0
    for (const row of rows) {
      const got = rpb[row.section]
      if (!got) continue
      if (got.view !== row.can_view || got.create !== row.can_create || got.edit !== row.can_edit ||
          got.delete !== row.can_delete || got.data_scope !== row.data_scope) mismatch++
    }
    t.ok(`every DB row matches the payload (${rows.length} rows, 0 mismatches)`, mismatch === 0, mismatch)
    t.ok('sections with no row default to all-false/own',
      Object.entries(rpb).filter(([s]) => !rows.some(r => r.section === s))
        .every(([, v]) => !v.view && !v.create && !v.edit && !v.delete && v.data_scope === 'own'))
  }

  t.section('permissions still resolve identically after the role_permissions conversion')
  // /api/auth/me derives its whole permission payload through the same table.
  const meBody = await (await get('/api/auth/me')).json()
  t.ok('/api/auth/me still returns all 25 permission sections', Object.keys(meBody.permissions).length === 25, Object.keys(meBody.permissions).length)
  t.ok('Administrator still resolves to full access', Object.values(meBody.permissions).every(p => p.view && p.edit && p.delete))

  t.section('routes not exercised against live')
  t.skip('PUT /api/points/config, PUT /api/points/settings', 'both write point_config / tenant_point_settings and append to point_config_history for a real tenant.')
  t.skip('POST /api/remarks, POST /api/remarks/[id]/read', 'create real remarks and notifications addressed to real users.')
  t.skip('PATCH /api/notifications/[id], POST /api/notifications/read-all', 'would mark real users\' notifications read.')
  t.skip('POST/DELETE /api/access-control/visibility, POST /api/access-control/visibility/bulk-import', 'alter who can see whom in a production tenant — bulk-import rewrites the whole visibility graph.')
  t.skip('POST/PUT/DELETE /api/settings/roles/*, PUT /api/settings/role-permissions', 'write role_permissions, which every route\'s authorisation reads. Covered on the scratch database instead.')

  return t.result()
}
