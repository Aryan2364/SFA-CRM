#!/usr/bin/env node
/**
 * WRITE-PATH tests for Batch 3 — weekly-plans. Local scratch database only.
 *
 *   npm run test:write:plans
 *
 * Every state transition the code can produce is exercised, and each one asserts
 * BOTH the resulting plan status AND the audit row it writes
 * (action_type, previous_status -> new_status).
 *
 * Note the reconnaissance in PLAN.md §8.1 lists the values PRESENT IN LIVE DATA,
 * not the values the code can write. The status CHECK constraint permits seven
 * (Draft, Submitted, Approved, Rejected, On Hold, Edited by Manager,
 * Resubmitted) and action_type has no constraint at all, so the code writes
 * twelve action types. All twelve are covered here.
 *
 * RUN THE SERVER UNDER TZ=UTC. Production runs UTC (PLAN.md 5.8 — Alpine ships
 * no tzdata, so the compose file's TZ is silently ignored), and
 * weekly-plans/summary keys its grid with local-time getters. On an IST machine
 * every key lands a day early and the grid comes back blank.
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

let SUB, MGR
const call = (path, token, method = 'POST', body) => fetch(`${BASE}${path}`, {
  method, redirect: 'manual',
  headers: { cookie: `${COOKIE_NAME}=${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
})

const statusOf = id => prisma.weekly_plans.findUnique({ where: { id }, select: { status: true, reopen_requested: true } })
const lastLog = id => prisma.weekly_plan_audit_logs.findFirst({
  where: { weekly_plan_id: id }, orderBy: { timestamp: 'desc' },
  select: { action_type: true, previous_status: true, new_status: true, actor_role: true, comment: true },
})

/** Assert a transition end-to-end: HTTP, resulting status, and the audit row. */
async function expectTransition(label, res, planId, { status, action, from, to, role }) {
  ok(`${label}: HTTP 200`, res.status === 200, `${res.status} ${await res.text().catch(() => '')}`)
  const p = await statusOf(planId)
  ok(`${label}: status -> ${status}`, p.status === status, p.status)
  const log = await lastLog(planId)
  ok(`${label}: audit action_type = ${action}`, log?.action_type === action, log)
  ok(`${label}: audit ${from} -> ${to}`, log?.previous_status === from && log?.new_status === to, { prev: log?.previous_status, next: log?.new_status })
  if (role) ok(`${label}: actor_role = ${role}`, log?.actor_role === role, log?.actor_role)
}

/** Fresh Draft plan owned by subA for a given week, created through the API. */
async function newPlan(weekStart, weekEnd) {
  await prisma.weekly_plans.deleteMany({ where: { tenant_id: SEED.tenantA, user_id: SEED.subA, week_start_date: new Date(weekStart) } })
  const r = await call('/api/weekly-plans', SUB, 'POST', {
    week_start_date: weekStart, week_end_date: weekEnd,
    week_goal: 'scratch goal',
    items: [
      { plan_date: weekStart, from_place: 'A', to_place: 'B', mode_of_travel: 'Car' },
      { plan_date: weekEnd, from_place: 'C', to_place: 'D', mode_of_travel: 'Bike' },
    ],
  })
  const body = await r.json()
  return { res: r, plan: body }
}

async function main() {
  const probe = await fetch(`${BASE}/login`, { redirect: 'manual' }).catch(() => null)
  if (!probe) { console.error(`No server at ${BASE}. Run the scratch dev server.`); process.exit(1) }

  SUB = await mint({ phone: '9000000002', userId: SEED.subA, name: 'Scratch Subordinate', role: 'Administrator', tenantId: SEED.tenantA, cv: 1 })
  MGR = await mint({ phone: '9000000001', userId: SEED.adminA, name: 'Scratch Admin', role: 'Administrator', tenantId: SEED.tenantA, cv: 1 })

  const me = await (await call('/api/auth/me', MGR, 'GET')).json()
  if (me.tenantName !== 'Scratch Tenant A') {
    console.error(`SAFETY ABORT: server is not on the scratch database (tenantName="${me.tenantName}").`)
    process.exit(1)
  }
  console.log(`Server confirmed on scratch DB (tenant "${me.tenantName}")`)

  // ===== 1. Create =========================================================
  section('Create — POST /api/weekly-plans')
  const { res: cRes, plan } = await newPlan('2026-03-02', '2026-03-08')
  ok('HTTP 201', cRes.status === 201, { status: cRes.status, plan })
  ok('status is Draft', plan.status === 'Draft', plan.status)
  ok('week_start_date serialises DATE-ONLY', plan.week_start_date === '2026-03-02', plan.week_start_date)
  ok('week_end_date serialises DATE-ONLY', plan.week_end_date === '2026-03-08', plan.week_end_date)
  ok('created_at is a full ISO timestamp', /^\d{4}-\d{2}-\d{2}T.*Z$/.test(plan.created_at), plan.created_at)
  ok('day_notes defaults to {}', JSON.stringify(plan.day_notes) === '{}', plan.day_notes)
  ok('2 items were created', (await prisma.weekly_plan_items.count({ where: { weekly_plan_id: plan.id } })) === 2)
  ok('items landed in tenant A', (await prisma.weekly_plan_items.count({ where: { weekly_plan_id: plan.id, tenant_id: SEED.tenantA } })) === 2)
  let log = await lastLog(plan.id)
  ok('audit action_type = Create', log?.action_type === 'Create', log)
  ok('audit new_status = Draft, previous_status null', log?.new_status === 'Draft' && log?.previous_status === null, log)

  // ===== 2. Update =========================================================
  section('Update — PUT /api/weekly-plans/[id]')
  const upd = await call(`/api/weekly-plans/${plan.id}`, SUB, 'PUT', {
    week_goal: 'revised goal',
    day_notes: { mon: 'note' },
    items: [{ plan_date: '2026-03-03', from_place: 'X', to_place: 'Y', mode_of_travel: 'Bus' }],
  })
  const updBody = await upd.json()
  ok('HTTP 200', upd.status === 200, upd.status)
  ok('items were REPLACED (2 -> 1)', (await prisma.weekly_plan_items.count({ where: { weekly_plan_id: plan.id } })) === 1)
  ok('week_goal updated', updBody.week_goal === 'revised goal', updBody.week_goal)
  ok('day_notes accepts an arbitrary jsonb shape', updBody.day_notes?.mon === 'note', updBody.day_notes)
  ok('status unchanged (still Draft)', updBody.status === 'Draft', updBody.status)
  ok('nested weekly_plan_items[].plan_date is DATE-ONLY', updBody.weekly_plan_items.every(i => /^\d{4}-\d{2}-\d{2}$/.test(i.plan_date)), updBody.weekly_plan_items[0]?.plan_date)
  ok('plan_date.localeCompare() works (review page crash site)', typeof updBody.weekly_plan_items[0].plan_date.localeCompare === 'function')
  log = await lastLog(plan.id)
  ok('audit action_type = Update', log?.action_type === 'Update', log)
  ok('audit leaves both statuses null (no status change)', log?.previous_status === null && log?.new_status === null, log)

  // ===== 3. Submit =========================================================
  section('Submit — Draft -> Submitted')
  await expectTransition('Submit', await call(`/api/weekly-plans/${plan.id}/submit`, SUB), plan.id,
    { status: 'Submitted', action: 'Submit', from: 'Draft', to: 'Submitted', role: 'User' })
  ok('submitted_at was stamped', (await prisma.weekly_plans.findUnique({ where: { id: plan.id }, select: { submitted_at: true } })).submitted_at instanceof Date)

  section('Submit is rejected from a non-submittable status')
  const dbl = await call(`/api/weekly-plans/${plan.id}/submit`, SUB)
  ok('second submit -> 400', dbl.status === 400, dbl.status)
  ok('message preserved', (await dbl.json()).error === 'Cannot submit from current status')

  // ===== 4. UndoSubmit =====================================================
  section('UndoSubmit — Submitted -> Draft (within the 15-minute window)')
  await expectTransition('UndoSubmit', await call(`/api/weekly-plans/${plan.id}/undo-submit`, SUB), plan.id,
    { status: 'Draft', action: 'UndoSubmit', from: 'Submitted', to: 'Draft', role: 'User' })

  section('UndoSubmit enforces ownership and the window')
  await call(`/api/weekly-plans/${plan.id}/submit`, SUB)
  const notOwner = await call(`/api/weekly-plans/${plan.id}/undo-submit`, MGR)
  ok('a different user -> 403', notOwner.status === 403, notOwner.status)
  await prisma.weekly_plans.update({ where: { id: plan.id }, data: { submitted_at: new Date(Date.now() - 20 * 60 * 1000) } })
  const expired = await call(`/api/weekly-plans/${plan.id}/undo-submit`, SUB)
  ok('outside the 15-minute window -> 400', expired.status === 400, expired.status)
  ok('expiry message preserved', (await expired.json()).error === 'Undo window has expired (15 minutes)')

  // ===== 5. Approve ========================================================
  section('Approve — Submitted -> Approved (manager)')
  await expectTransition('Approve', await call(`/api/weekly-plans/${plan.id}/approve`, MGR, 'POST', { comment: 'looks good' }), plan.id,
    { status: 'Approved', action: 'Approve', from: 'Submitted', to: 'Approved', role: 'Manager' })
  ok('manager_comment stored', (await prisma.weekly_plans.findUnique({ where: { id: plan.id }, select: { manager_comment: true } })).manager_comment === 'looks good')
  ok('owner was notified', (await prisma.notifications.count({ where: { context_id: plan.id, recipient_id: SEED.subA } })) >= 1)

  // ===== 6. Reject, then 7. Resubmit =======================================
  section('Reject — Submitted -> Rejected (manager)')
  const p2 = (await newPlan('2026-03-09', '2026-03-15')).plan
  await call(`/api/weekly-plans/${p2.id}/submit`, SUB)
  const noComment = await call(`/api/weekly-plans/${p2.id}/reject`, MGR, 'POST', { comment: '  ' })
  ok('reject without a comment -> 400', noComment.status === 400, noComment.status)
  await expectTransition('Reject', await call(`/api/weekly-plans/${p2.id}/reject`, MGR, 'POST', { comment: 'fix the route' }), p2.id,
    { status: 'Rejected', action: 'Reject', from: 'Submitted', to: 'Rejected', role: 'Manager' })

  section('Resubmit — Rejected -> Resubmitted (action_type "Resubmit")')
  const reRes = await call(`/api/weekly-plans/${p2.id}/submit`, SUB)
  ok('response reports the new status', (await reRes.clone().json()).status === 'Resubmitted', await reRes.clone().json())
  await expectTransition('Resubmit', reRes, p2.id,
    { status: 'Resubmitted', action: 'Resubmit', from: 'Rejected', to: 'Resubmitted', role: 'User' })
  ok('"Resubmitted" satisfies the status CHECK constraint', (await statusOf(p2.id)).status === 'Resubmitted')

  section('UndoSubmit also accepts Resubmitted')
  await prisma.weekly_plans.update({ where: { id: p2.id }, data: { submitted_at: new Date() } })
  await expectTransition('UndoSubmit(from Resubmitted)', await call(`/api/weekly-plans/${p2.id}/undo-submit`, SUB), p2.id,
    { status: 'Draft', action: 'UndoSubmit', from: 'Resubmitted', to: 'Draft', role: 'User' })

  // ===== 8. Hold ===========================================================
  section('Hold — -> On Hold (manager)')
  const p3 = (await newPlan('2026-03-16', '2026-03-22')).plan
  await call(`/api/weekly-plans/${p3.id}/submit`, SUB)
  await expectTransition('Hold', await call(`/api/weekly-plans/${p3.id}/hold`, MGR, 'POST', { comment: 'waiting' }), p3.id,
    { status: 'On Hold', action: 'Hold', from: 'Submitted', to: 'On Hold', role: 'Manager' })

  // ===== 9. Suggest ========================================================
  section('Suggest — -> On Hold (manager)')
  const p4 = (await newPlan('2026-03-23', '2026-03-29')).plan
  await call(`/api/weekly-plans/${p4.id}/submit`, SUB)
  const sugNo = await call(`/api/weekly-plans/${p4.id}/suggest`, MGR, 'POST', { comment: '' })
  ok('suggest without a comment -> 400', sugNo.status === 400, sugNo.status)
  await expectTransition('Suggest', await call(`/api/weekly-plans/${p4.id}/suggest`, MGR, 'POST', { comment: 'try a different route' }), p4.id,
    { status: 'On Hold', action: 'Suggest', from: 'Submitted', to: 'On Hold', role: 'Manager' })

  // ===== 10. EditByManager =================================================
  section('EditByManager — -> Edited by Manager')
  const p5 = (await newPlan('2026-03-30', '2026-04-05')).plan
  await call(`/api/weekly-plans/${p5.id}/submit`, SUB)
  await expectTransition('EditByManager', await call(`/api/weekly-plans/${p5.id}/edit-by-manager`, MGR, 'POST', {
    comment: 'manager revised', items: [{ plan_date: '2026-03-31', from_place: 'M', to_place: 'N', mode_of_travel: 'Train' }],
  }), p5.id, { status: 'Edited by Manager', action: 'EditByManager', from: 'Submitted', to: 'Edited by Manager', role: 'Manager' })
  ok('items were replaced by the manager', (await prisma.weekly_plan_items.count({ where: { weekly_plan_id: p5.id } })) === 1)
  const emLog = await lastLog(p5.id)
  ok('edited_fields jsonb recorded', JSON.stringify((await prisma.weekly_plan_audit_logs.findFirst({ where: { weekly_plan_id: p5.id }, orderBy: { timestamp: 'desc' }, select: { edited_fields: true } })).edited_fields) === '{"items":"manager edited"}', emLog)

  section('Submit accepts "Edited by Manager" as a source status')
  await expectTransition('Resubmit(from Edited by Manager)', await call(`/api/weekly-plans/${p5.id}/submit`, SUB), p5.id,
    { status: 'Resubmitted', action: 'Resubmit', from: 'Edited by Manager', to: 'Resubmitted', role: 'User' })

  // ===== 11-13. Reopen flow ================================================
  section('RequestReopen — no status change, sets reopen_requested')
  const p6 = (await newPlan('2026-04-06', '2026-04-12')).plan
  await call(`/api/weekly-plans/${p6.id}/submit`, SUB)
  await call(`/api/weekly-plans/${p6.id}/approve`, MGR, 'POST', {})
  const rrNo = await call(`/api/weekly-plans/${p6.id}/request-reopen`, SUB, 'POST', { message: '' })
  ok('request-reopen without a message -> 400', rrNo.status === 400, rrNo.status)
  await expectTransition('RequestReopen', await call(`/api/weekly-plans/${p6.id}/request-reopen`, SUB, 'POST', { message: 'need to fix Tuesday' }), p6.id,
    { status: 'Approved', action: 'RequestReopen', from: 'Approved', to: 'Approved', role: 'User' })
  ok('reopen_requested is now true', (await statusOf(p6.id)).reopen_requested === true)
  const rrAgain = await call(`/api/weekly-plans/${p6.id}/request-reopen`, SUB, 'POST', { message: 'again' })
  ok('a second request -> 400', rrAgain.status === 400, rrAgain.status)
  ok('the manager was notified', (await prisma.notifications.count({ where: { context_id: p6.id, recipient_id: SEED.adminA } })) >= 1)

  section('DeclineReopen — clears the flag, status unchanged')
  await expectTransition('DeclineReopen', await call(`/api/weekly-plans/${p6.id}/decline-reopen`, MGR), p6.id,
    { status: 'Approved', action: 'DeclineReopen', from: 'Approved', to: 'Approved', role: 'Manager' })
  ok('reopen_requested cleared', (await statusOf(p6.id)).reopen_requested === false)
  const declineNone = await call(`/api/weekly-plans/${p6.id}/decline-reopen`, MGR)
  ok('declining with no pending request -> 400', declineNone.status === 400, declineNone.status)

  section('AcceptReopen — -> Draft, clears the flag')
  await call(`/api/weekly-plans/${p6.id}/request-reopen`, SUB, 'POST', { message: 'second attempt' })
  await expectTransition('AcceptReopen', await call(`/api/weekly-plans/${p6.id}/accept-reopen`, MGR), p6.id,
    { status: 'Draft', action: 'AcceptReopen', from: 'Approved', to: 'Draft', role: 'Manager' })
  ok('reopen_requested cleared', (await statusOf(p6.id)).reopen_requested === false)
  const editable = await call(`/api/weekly-plans/${p6.id}/request-reopen`, SUB, 'POST', { message: 'x' })
  ok('request-reopen on an editable plan -> 400', editable.status === 400, editable.status)
  ok('message preserved', (await editable.json()).error === 'Plan is already editable')

  // ===== all twelve action types actually written ==========================
  section('every action_type the code can write was exercised')
  const written = (await prisma.weekly_plan_audit_logs.findMany({
    where: { tenant_id: SEED.tenantA }, select: { action_type: true }, distinct: ['action_type'],
  })).map(r => r.action_type).sort()
  const EXPECTED = ['AcceptReopen', 'Approve', 'Create', 'DeclineReopen', 'EditByManager', 'Hold',
    'Reject', 'RequestReopen', 'Resubmit', 'Submit', 'Suggest', 'UndoSubmit', 'Update'].sort()
  ok(`all ${EXPECTED.length} action types written (${written.length} distinct)`, EXPECTED.every(a => written.includes(a)), { missing: EXPECTED.filter(a => !written.includes(a)) })

  const statuses = (await prisma.weekly_plans.findMany({ where: { tenant_id: SEED.tenantA }, select: { status: true }, distinct: ['status'] })).map(r => r.status).sort()
  console.log(`      statuses produced: ${statuses.join(' | ')}`)

  // ===== read routes over the same data ====================================
  section('read routes reflect the writes, with correct date shapes')
  const my = await (await call(`/api/weekly-plans/my?weekStart=2026-04-06`, SUB, 'GET')).json()
  ok('GET /my returns the plan', my?.id === p6.id, my?.id)
  ok('/my week_start_date is DATE-ONLY', my.week_start_date === '2026-04-06', my.week_start_date)
  ok('/my nested plan_date is DATE-ONLY', my.weekly_plan_items.every(i => /^\d{4}-\d{2}-\d{2}$/.test(i.plan_date)))
  const myNone = await (await call(`/api/weekly-plans/my?weekStart=2019-01-07`, SUB, 'GET')).json()
  ok('GET /my for a week with no plan -> null', myNone === null, myNone)

  const rev = await (await call(`/api/weekly-plans/review?userId=${SEED.subA}`, MGR, 'GET')).json()
  ok('GET /review returns the subordinate plans', Array.isArray(rev) && rev.length >= 5, Array.isArray(rev) ? rev.length : rev)
  ok('/review exposes the owner under `users`, not the relation name', rev.every(r => 'users' in r && !('users_weekly_plans_user_idTousers' in r)), Object.keys(rev[0] ?? {}).filter(k => k.startsWith('users')))
  ok('/review users embed is an OBJECT with id/name/contact', rev[0].users && !Array.isArray(rev[0].users) && 'contact' in rev[0].users, rev[0].users)
  ok('/review is ordered by week_start_date DESC', rev.every((r, i) => i === 0 || rev[i - 1].week_start_date >= r.week_start_date))
  ok('/review plan_date.localeCompare sorts (the §5.1 crash site)', (() => {
    const items = rev.flatMap(r => r.weekly_plan_items)
    return [...items].sort((a, b) => a.plan_date.localeCompare(b.plan_date)).length === items.length
  })())

  const logs = await (await call(`/api/weekly-plans/${p6.id}/logs`, MGR, 'GET')).json()
  ok('GET /logs returns audit rows', Array.isArray(logs) && logs.length >= 4, Array.isArray(logs) ? logs.length : logs)
  ok('/logs actor is under `users` with a name', logs[0].users === null || typeof logs[0].users?.name === 'string', logs[0].users)
  ok('/logs timestamp is a full ISO string', /^\d{4}-\d{2}-\d{2}T.*Z$/.test(logs[0].timestamp), logs[0].timestamp)
  ok('/logs ordered by timestamp DESC', logs.every((l, i) => i === 0 || logs[i - 1].timestamp >= l.timestamp))

  const day = await (await call(`/api/weekly-plans/day?date=2026-04-06`, SUB, 'GET')).json()
  ok('GET /day finds the plan covering the date', day?.plan_status === 'Draft', day)
  ok('/day items carry DATE-ONLY plan_date', (day.items ?? []).every(i => /^\d{4}-\d{2}-\d{2}$/.test(i.plan_date)), day.items?.[0]?.plan_date)
  const dayNone = await (await call(`/api/weekly-plans/day?date=2019-01-01`, SUB, 'GET')).json()
  ok('/day outside any plan -> null', dayNone === null, dayNone)

  const summary = await (await call('/api/weekly-plans/summary?weeksBack=60', MGR, 'GET')).json()
  ok('GET /summary lists the subordinate', summary.subordinates?.some(s => s.id === SEED.subA), summary.subordinates?.length)
  const subRow = summary.subordinates.find(s => s.id === SEED.subA)
  ok('/summary grid is keyed by "YYYY-MM-DD"', Object.keys(subRow.weeks).every(k => /^\d{4}-\d{2}-\d{2}$/.test(k)), Object.keys(subRow.weeks).slice(0, 2))
  const cell = subRow.weeks['2026-04-06']
  ok('/summary cell for a real week is populated, not blank', cell && cell.status === 'Draft', cell)
  ok('/summary planned_days counts DISTINCT dates, not Date objects', cell.planned_days === 2, cell)

  // ===== tenant isolation ==================================================
  section('tenant B untouched')
  ok('tenant B has no weekly plans', (await prisma.weekly_plans.count({ where: { tenant_id: SEED.tenantB } })) === 0)
  ok('tenant B state name never changed',
    (await prisma.states.findUnique({ where: { id: '0000000b-0000-4000-8000-000000000020' } })).name === 'TENANT B STATE — MUST NEVER BE TOUCHED')

  console.log(`\n${fail === 0 ? 'WEEKLY-PLANS WRITE-PATH TESTS PASSED' : `WEEKLY-PLANS WRITE-PATH TESTS FAILED — ${fail}`}   (${pass} passed, ${fail} failed)`)
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(fail ? 1 : 0) })
  .catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
