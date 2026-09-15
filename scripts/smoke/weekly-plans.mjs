/**
 * Batch 3 — weekly-plans, READ paths against live. 17 routes total; the 12
 * transition endpoints are all POST and are covered by the local write-path
 * harness (npm run test:write:plans), never against production.
 *
 * What live adds over the scratch harness is real data shapes: 74 plans across
 * four statuses, real items, real audit history.
 */
import { db, mintSession, req, ctx } from './lib.mjs'

export const name = 'weekly-plans'

export async function run() {
  const t = ctx()
  const prisma = db()

  // The manager-facing routes (review, summary) are gated on user_visibility, so
  // pick a viewer that actually has rows. Falling back to any Administrator would
  // exercise only the empty-result branch.
  const viewerRow = await prisma.user_visibility.findFirst({ select: { viewer_user_id: true, tenant_id: true } })
  const admin = viewerRow
    ? await prisma.users.findFirst({
        where: { id: viewerRow.viewer_user_id },
        select: { id: true, name: true, contact: true, tenant_id: true, credentials_version: true },
      })
    : await prisma.users.findFirst({
        where: { profile: 'Administrator', status: 'Active' },
        select: { id: true, name: true, contact: true, tenant_id: true, credentials_version: true },
      })
  if (!admin) { t.skip('all weekly-plans routes', 'no usable user'); return t.result() }
  const tid = admin.tenant_id
  const token = await mintSession({
    phone: admin.contact, userId: admin.id, name: admin.name,
    role: 'Administrator', tenantId: tid, cv: admin.credentials_version ?? 1,
  })
  const get = p => req(p, { token })

  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
  const ISO = /^\d{4}-\d{2}-\d{2}T.*Z$/

  t.section('GET /api/weekly-plans/review — the main manager list')
  const visible = await prisma.user_visibility.findMany({ where: { tenant_id: tid, viewer_user_id: admin.id }, select: { target_user_id: true } })
  const subIds = visible.map(v => v.target_user_id)
  const r = await get('/api/weekly-plans/review')
  const plans = await r.json()
  t.ok('-> 200', r.status === 200, r.status)
  if (!subIds.length) {
    t.ok('no visible subordinates -> empty array', Array.isArray(plans) && plans.length === 0, plans)
    t.skip('weekly-plans review row shapes', 'the Administrator has no user_visibility rows in live')
  } else {
    const expected = await prisma.weekly_plans.count({ where: { tenant_id: tid, user_id: { in: subIds } } })
    t.ok(`returns all ${expected} visible plans`, Array.isArray(plans) && plans.length === expected, Array.isArray(plans) ? plans.length : plans)
    if (plans.length) {
      t.ok('tenant-pure', plans.every(p => p.tenant_id === tid))
      t.ok('week_start_date is DATE-ONLY', plans.every(p => DATE_ONLY.test(p.week_start_date)), plans[0].week_start_date)
      t.ok('week_end_date is DATE-ONLY', plans.every(p => DATE_ONLY.test(p.week_end_date)), plans[0].week_end_date)
      t.ok('created_at is a full ISO timestamp', plans.every(p => ISO.test(p.created_at)), plans[0].created_at)
      t.ok('submitted_at is ISO or null', plans.every(p => p.submitted_at === null || ISO.test(p.submitted_at)))
      t.ok('owner is exposed as `users`, not the introspected relation name', plans.every(p => 'users' in p && !('users_weekly_plans_user_idTousers' in p)), Object.keys(plans[0]).filter(k => k.startsWith('users')))
      t.ok('users embed is an OBJECT with id/name/contact', plans.every(p => p.users === null || (!Array.isArray(p.users) && 'contact' in p.users)), plans[0].users)
      t.ok('weekly_plan_items is an ARRAY', plans.every(p => Array.isArray(p.weekly_plan_items)))
      const items = plans.flatMap(p => p.weekly_plan_items)
      t.ok(`every item plan_date is DATE-ONLY (${items.length} items)`, items.every(i => DATE_ONLY.test(i.plan_date)), items[0]?.plan_date)
      t.ok('plan_date.localeCompare() works — review/[userId]/page.tsx:257 crash site', items.length === 0 || typeof items[0].plan_date.localeCompare === 'function')
      t.ok('ordered by week_start_date DESC', plans.every((p, i) => i === 0 || plans[i - 1].week_start_date >= p.week_start_date))
      t.ok('status is one of the seven the CHECK constraint permits',
        plans.every(p => ['Draft', 'Submitted', 'Approved', 'Rejected', 'On Hold', 'Edited by Manager', 'Resubmitted'].includes(p.status)),
        [...new Set(plans.map(p => p.status))])
      t.ok('day_notes is an object or null', plans.every(p => p.day_notes === null || typeof p.day_notes === 'object'))
    }

    t.section('review filters')
    const someStatus = plans[0]?.status
    if (someStatus) {
      const fr = await get(`/api/weekly-plans/review?status=${encodeURIComponent(someStatus)}`)
      const fb = await fr.json()
      const exp = await prisma.weekly_plans.count({ where: { tenant_id: tid, user_id: { in: subIds }, status: someStatus } })
      t.ok(`?status=${someStatus} filters exactly (${exp})`, Array.isArray(fb) && fb.length === exp, Array.isArray(fb) ? fb.length : fb)
    }
    const ur = await get(`/api/weekly-plans/review?userId=${subIds[0]}`)
    const ub = await ur.json()
    const expUser = await prisma.weekly_plans.count({ where: { tenant_id: tid, user_id: subIds[0] } })
    t.ok(`?userId= restricted to that subordinate (${expUser})`, Array.isArray(ub) && ub.length === expUser, Array.isArray(ub) ? ub.length : ub)
    const outsider = await prisma.users.findFirst({ where: { tenant_id: tid, id: { notIn: [...subIds, admin.id] } }, select: { id: true } })
    if (outsider) {
      const or = await get(`/api/weekly-plans/review?userId=${outsider.id}`)
      t.ok('?userId= for a NON-subordinate returns []', JSON.stringify(await or.json()) === '[]')
    } else t.skip('non-subordinate userId filter', 'every tenant user is visible to this admin')
  }

  t.section('GET /api/weekly-plans/my')
  const ownPlan = await prisma.weekly_plans.findFirst({ where: { tenant_id: tid, user_id: admin.id }, select: { week_start_date: true, id: true } })
  if (ownPlan) {
    const ws = ownPlan.week_start_date.toISOString().slice(0, 10)
    const mr = await get(`/api/weekly-plans/my?weekStart=${ws}`)
    const mb = await mr.json()
    t.ok('-> 200 and returns the plan', mr.status === 200 && mb?.id === ownPlan.id, { status: mr.status, id: mb?.id })
    t.ok('week_start_date round-trips DATE-ONLY', mb.week_start_date === ws, mb.week_start_date)
    t.ok('weekly_plan_items is an array', Array.isArray(mb.weekly_plan_items))
  } else t.skip('GET /my with a real plan', 'the Administrator owns no weekly plans in live')
  const none = await get('/api/weekly-plans/my?weekStart=2019-01-07')
  t.ok('a week with no plan -> null (PGRST116 branch preserved)', none.status === 200 && (await none.json()) === null, none.status)
  t.ok('missing weekStart -> 400', (await get('/api/weekly-plans/my')).status === 400)

  t.section('GET /api/weekly-plans/summary')
  const sr = await get('/api/weekly-plans/summary?weeksBack=11')
  const sb = await sr.json()
  t.ok('-> 200', sr.status === 200, sr.status)
  t.ok('weeks is an array of DATE-ONLY strings', Array.isArray(sb.weeks) && sb.weeks.every(w => DATE_ONLY.test(w)), sb.weeks?.slice(0, 2))
  t.ok('subordinates is an array', Array.isArray(sb.subordinates))
  // The route short-circuits to { weeks: [], subordinates: [] } when the viewer
  // has no visible ACTIVE users — so only assert the grid when it has some.
  if (sb.subordinates?.length) {
    t.ok('12 weeks for weeksBack=11', sb.weeks.length === 12, sb.weeks.length)
    t.ok('each subordinate grid is keyed by the same week strings', sb.subordinates.every(s => sb.weeks.every(w => w in s.weeks)))
    t.ok('each cell has status and planned_days', sb.subordinates.every(s => Object.values(s.weeks).every(c => 'status' in c && typeof c.planned_days === 'number')))
    t.ok('planned_days is a non-negative integer', sb.subordinates.every(s => Object.values(s.weeks).every(c => Number.isInteger(c.planned_days) && c.planned_days >= 0)))
    const capped = await (await get('/api/weekly-plans/summary?weeksBack=9999')).json()
    t.ok('weeksBack is capped at 51 (52 week columns)', capped.weeks.length === 52, capped.weeks.length)
    const populated = sb.subordinates.flatMap(s => Object.values(s.weeks)).filter(c => c.status !== null)
    t.ok(`grid cells are populated where plans exist (${populated.length} non-null cells) — a TZ-shifted key would leave every cell blank`, populated.length > 0, populated.length)
  } else {
    t.skip('summary grid assertions', 'this viewer has no visible ACTIVE subordinates in live, so the route short-circuits to empty')
  }

  t.section('GET /api/weekly-plans/day')
  t.ok('missing date -> 400', (await get('/api/weekly-plans/day')).status === 400)
  const dr = await get('/api/weekly-plans/day?date=2019-01-01')
  t.ok('a date inside no plan -> null', dr.status === 200 && (await dr.json()) === null, dr.status)
  if (ownPlan) {
    const ws = ownPlan.week_start_date.toISOString().slice(0, 10)
    const d2 = await get(`/api/weekly-plans/day?date=${ws}`)
    const db2 = await d2.json()
    t.ok('a date inside a real plan returns plan_status + items', d2.status === 200 && db2 !== null && 'plan_status' in db2, db2)
    if (db2?.items?.length) t.ok('day items carry DATE-ONLY plan_date', db2.items.every(i => DATE_ONLY.test(i.plan_date)), db2.items[0].plan_date)
  }

  t.section('GET /api/weekly-plans/[id]/logs')
  const anyPlan = await prisma.weekly_plans.findFirst({ where: { tenant_id: tid }, select: { id: true } })
  if (anyPlan) {
    const lr = await get(`/api/weekly-plans/${anyPlan.id}/logs`)
    const lb = await lr.json()
    const expLogs = await prisma.weekly_plan_audit_logs.count({ where: { tenant_id: tid, weekly_plan_id: anyPlan.id } })
    t.ok('-> 200', lr.status === 200, lr.status)
    t.ok(`returns all ${expLogs} audit rows`, Array.isArray(lb) && lb.length === expLogs, Array.isArray(lb) ? lb.length : lb)
    if (lb.length) {
      t.ok('timestamp is a full ISO string', lb.every(l => ISO.test(l.timestamp)), lb[0].timestamp)
      t.ok('ordered by timestamp DESC', lb.every((l, i) => i === 0 || lb[i - 1].timestamp >= l.timestamp))
      t.ok('actor is exposed under `users` (FK-hint embed)', lb.every(l => 'users' in l))
      t.ok('users embed is an OBJECT or null, never an array', lb.every(l => l.users === null || (typeof l.users === 'object' && !Array.isArray(l.users))), lb[0].users)
      t.ok('action_type is one of the twelve the code writes',
        lb.every(l => ['Create', 'Update', 'Submit', 'Resubmit', 'UndoSubmit', 'Approve', 'Reject',
          'Hold', 'Suggest', 'EditByManager', 'RequestReopen', 'AcceptReopen', 'DeclineReopen'].includes(l.action_type)),
        [...new Set(lb.map(l => l.action_type))])
      t.ok('edited_fields is an object or null', lb.every(l => l.edited_fields === null || typeof l.edited_fields === 'object'))
    }
  } else t.skip('GET /[id]/logs', 'no weekly plans in this tenant')

  t.section('routes not exercised against live')
  t.skip('POST /api/weekly-plans and PUT /api/weekly-plans/[id]', 'create/update write real plans and items into a production tenant; covered locally by npm run test:write:plans.')
  t.skip('all 10 transition endpoints (submit, undo-submit, approve, reject, hold, suggest, edit-by-manager, request-reopen, accept-reopen, decline-reopen)', 'each mutates plan status, writes an audit row and sends a notification to a real user. All 13 action types are exercised on the local scratch database instead, with the audit row asserted against the database for every transition.')

  return t.result()
}
