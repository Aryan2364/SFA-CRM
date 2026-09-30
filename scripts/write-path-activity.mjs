#!/usr/bin/env node
/**
 * WRITE-PATH tests for Batch 4 — orders, daily-activity, attendance,
 * expenses. Local scratch database only. Run the server under TZ=UTC.
 *
 *   npm run test:write:activity
 *
 * expenses/upload is NOT covered: it writes to R2 storage.
 */
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { mintSession as mintTestSession } from './test-session.mjs'
// The app's own business-date helper: "today" is the date in APP_TIMEZONE
// (default Asia/Kolkata), not the UTC date these suites run under.
import { businessDate } from '../src/lib/business-date.ts'

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
  stateA: '0000000a-0000-4000-8000-000000000020',
  districtA: '0000000a-0000-4000-8000-000000000021',
  talukaA: '0000000a-0000-4000-8000-000000000022',
  tenantB: '0000000b-0000-4000-8000-000000000001',
  productB: '0000000b-0000-4000-8000-000000000030',
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
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const ISO = /^\d{4}-\d{2}-\d{2}T.*Z$/

// Signed by the app's own signSession(), so iat/exp and the encoding match login.
const mint = payload => mintTestSession(payload, readEnv('SESSION_SECRET'))

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

  // The server stamps attendance, visits and expenses with the BUSINESS date.
  // Under TZ=UTC the UTC date is a day behind IST from 18:30 to 00:00 UTC, so
  // deriving "today" from toISOString() made this suite flake in that window.
  // Mirror the server's APP_TIMEZONE (env or .env.local) before computing it.
  if (!process.env.APP_TIMEZONE) { const tz = readEnv('APP_TIMEZONE'); if (tz) process.env.APP_TIMEZONE = tz }
  const today = businessDate()

  // ===== leads (removed) ===================================================
  // This section drove /api/leads, which does not exist on main or on this
  // branch: the route answered a 404 HTML page and `lr.json()` crashed the whole
  // suite before any later section ran. Leads are Companies now (the renamed
  // business_partners table). Their DATE-ONLY round trip and cross-tenant PUT /
  // DELETE guards are covered through /api/companies in write-path-tests.mjs.
  // No later section here depended on the lead it created.

  // ===== daily-activity ====================================================
  section('daily-activity POST + the start/stop lifecycle')
  const vr = await call('/api/daily-activity', SUB, 'POST', { visit_type: 'Dealer', entity_name: 'Scratch Visit', visit_date: today })
  const visit = await vr.json()
  ok('POST -> 201', vr.status === 201, { status: vr.status, visit })
  ok('visit_date is DATE-ONLY', visit.visit_date === today, visit.visit_date)
  ok('status starts Pending', visit.status === 'Pending', visit.status)
  ok('future date -> 400', (await call('/api/daily-activity', SUB, 'POST', { visit_type: 'Dealer', entity_name: 'x', visit_date: '2099-01-01' })).status === 400)

  const st = await call(`/api/daily-activity/${visit.id}`, SUB, 'PATCH', { action: 'start', latitude: 1.5, longitude: 2.5, address: 'here' })
  const stb = await st.json()
  ok('start -> 200 and status Active', st.status === 200 && stb.status === 'Active', { status: st.status, s: stb.status })
  ok('start_time is a full ISO string', ISO.test(stb.start_time), stb.start_time)
  ok('latitude is a NUMBER', typeof stb.latitude === 'number', stb.latitude)

  section('start blocks a second active meeting the SAME day (the .slice(0,10) path)')
  const v2 = await (await call('/api/daily-activity', SUB, 'POST', { visit_type: 'Dealer', entity_name: 'Second Visit', visit_date: today })).json()
  const blocked = await call(`/api/daily-activity/${v2.id}`, SUB, 'PATCH', { action: 'start' })
  ok('-> 400 "Another meeting is already active today"', blocked.status === 400, blocked.status)
  ok('message preserved', (await blocked.json()).error === 'Another meeting is already active today. Stop it first.')

  section('start AUTO-COMPLETES a stale meeting from a previous day')
  await prisma.daily_visits.update({
    where: { id: visit.id },
    data: { start_time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
  })
  const st2 = await call(`/api/daily-activity/${v2.id}`, SUB, 'PATCH', { action: 'start' })
  ok('now succeeds -> 200', st2.status === 200, st2.status)
  ok('the stale visit was auto-completed', (await prisma.daily_visits.findUnique({ where: { id: visit.id } })).status === 'Completed')
  ok('its end_time was stamped', (await prisma.daily_visits.findUnique({ where: { id: visit.id } })).end_time instanceof Date)

  section('stop computes duration from start_time')
  await prisma.daily_visits.update({ where: { id: v2.id }, data: { start_time: new Date(Date.now() - 90 * 1000) } })
  const sp = await call(`/api/daily-activity/${v2.id}`, SUB, 'PATCH', { action: 'stop', end_latitude: 3.5, end_longitude: 4.5 })
  const spb = await sp.json()
  ok('stop -> 200 and status Completed', sp.status === 200 && spb.status === 'Completed', { status: sp.status, s: spb.status })
  ok('duration_secs is ~90, computed from a Date not a string', spb.duration_secs >= 85 && spb.duration_secs <= 100, spb.duration_secs)
  ok('end_latitude is a NUMBER', typeof spb.end_latitude === 'number', spb.end_latitude)

  section('update_notes and delete')
  const un = await call(`/api/daily-activity/${v2.id}`, SUB, 'PATCH', { action: 'update_notes', notes: 'scratch note' })
  ok('update_notes -> 200', un.status === 200 && (await un.json()).notes === 'scratch note')
  ok('unknown action -> 400', (await call(`/api/daily-activity/${v2.id}`, SUB, 'PATCH', { action: 'nope' })).status === 400)
  const dv = await call(`/api/daily-activity/${v2.id}`, SUB, 'PATCH', { action: 'delete' })
  ok('delete -> 200', dv.status === 200)
  ok('the row is gone', (await prisma.daily_visits.count({ where: { id: v2.id } })) === 0)

  // ===== orders ============================================================
  section('orders POST — direct flow')
  const or = await call('/api/orders', MGR, 'POST', {
    order_source: 'direct', entity_type: 'Dealer', entity_id: null, entity_name: 'Scratch Buyer',
    order_date: today, status: 'Draft',
    items: [
      { product_name: 'Widget', qty: 3, rate: 100.5 },
      { product_name: 'Gadget', qty: 2, rate: 50.25 },
    ],
  })
  const order = await or.json()
  ok('-> 201', or.status === 201, { status: or.status, order })
  ok('total_amount is a NUMBER and equals 3*100.5 + 2*50.25', order.total_amount === 402, order.total_amount)
  ok('order_date is DATE-ONLY', order.order_date === today, order.order_date)
  ok('2 order_items created', (await prisma.order_items.count({ where: { order_id: order.id } })) === 2)
  ok('item amounts stored correctly', (await prisma.order_items.findMany({ where: { order_id: order.id } })).every(i => Number(i.amount) === Number(i.qty) * Number(i.rate)))
  ok('no items -> 400', (await call('/api/orders', MGR, 'POST', { order_source: 'direct', entity_name: 'x', order_date: today, items: [] })).status === 400)

  section('orders list reports the nested count in the PostgREST shape')
  const ol = await (await call('/api/orders', MGR, 'GET')).json()
  const listed = ol.find(o => o.id === order.id)
  ok('the order appears in the list', Boolean(listed))
  ok('order_items is [{ count: 2 }]', Array.isArray(listed.order_items) && listed.order_items[0].count === 2, listed.order_items)
  ok('total_amount is a number in the list too', typeof listed.total_amount === 'number')

  section('orders POST — meeting flow upserts on visit_id')
  const mv = await (await call('/api/daily-activity', SUB, 'POST', { visit_type: 'Dealer', entity_name: 'Order Visit', visit_date: today })).json()
  const mo1 = await call('/api/orders', SUB, 'POST', { visit_id: mv.id, order_date: today, items: [{ product_name: 'A', qty: 1, rate: 10 }] })
  const mo1b = await mo1.json()
  ok('first POST -> 201', mo1.status === 201, mo1.status)
  ok('1 item', (await prisma.order_items.count({ where: { order_id: mo1b.id } })) === 1)
  const mo2 = await call('/api/orders', SUB, 'POST', { visit_id: mv.id, order_date: today, items: [{ product_name: 'B', qty: 2, rate: 20 }, { product_name: 'C', qty: 1, rate: 5 }] })
  const mo2b = await mo2.json()
  ok('second POST for the SAME visit upserts, does not duplicate', mo2b.id === mo1b.id, { first: mo1b.id, second: mo2b.id })
  ok('only one order exists for that visit', (await prisma.orders.count({ where: { visit_id: mv.id } })) === 1)
  ok('items were REPLACED (1 -> 2)', (await prisma.order_items.count({ where: { order_id: mo1b.id } })) === 2)
  ok('total recalculated to 45', mo2b.total_amount === 45, mo2b.total_amount)

  section('orders single-order mode returns the full items array')
  const sm = await (await call(`/api/orders?visitId=${mv.id}`, SUB, 'GET')).json()
  ok('returns the order with full item rows', sm?.id === mo1b.id && sm.order_items.length === 2, sm?.order_items?.length)
  ok('rate/amount are numbers', sm.order_items.every(i => typeof i.rate === 'number' && typeof i.amount === 'number'))

  section('orders PATCH respects visibility')
  // ORDER_STATUSES is ['Draft', 'Placed'] (src/lib/order-math.ts); 'Confirmed',
  // which this section used to send, was never valid and is now a 400.
  ok("unknown status 'Confirmed' -> 400",
    (await call(`/api/orders/${order.id}`, MGR, 'PATCH', { status: 'Confirmed' })).status === 400)
  // The order was created with entity_id null, so §3.5 refuses to place it and
  // records why on the row.
  const pl = await call(`/api/orders/${order.id}`, MGR, 'PATCH', { status: 'Placed' })
  ok("'Placed' with no saved party -> 400", pl.status === 400, pl.status)
  ok('blocked_reason is stored on the row',
    (await prisma.orders.findUnique({ where: { id: order.id } })).blocked_reason === 'Party is not a saved record')
  // Put the row in 'Placed' directly so the PATCH below is a real change.
  await prisma.orders.update({ where: { id: order.id }, data: { status: 'Placed' } })
  const pt = await call(`/api/orders/${order.id}`, MGR, 'PATCH', { status: 'Draft' })
  ok('-> 200', pt.status === 200, pt.status)
  ok('status updated', (await prisma.orders.findUnique({ where: { id: order.id } })).status === 'Draft')
  const orderB = await prisma.orders.findFirst({ where: { tenant_id: SEED.tenantB } })
  if (orderB) {
    const target = orderB.status === 'Draft' ? 'Placed' : 'Draft'
    await call(`/api/orders/${orderB.id}`, MGR, 'PATCH', { status: target })
    ok('cross-tenant PATCH is a no-op', (await prisma.orders.findUnique({ where: { id: orderB.id } })).status === orderB.status)
  }

  // ===== attendance ========================================================
  section('attendance check-in / check-out')
  await prisma.attendance.deleteMany({ where: { tenant_id: SEED.tenantA } })
  const ci = await call('/api/attendance/check-in', SUB, 'POST', { latitude: 5.5, longitude: 6.5, address: 'office' })
  const cib = await ci.json()
  ok('check-in -> 201', ci.status === 201, { status: ci.status, cib })
  ok('date is DATE-ONLY', cib.date === today, cib.date)
  ok('check_in_time is a full ISO string', ISO.test(cib.check_in_time), cib.check_in_time)
  ok('check_in_latitude is a NUMBER', typeof cib.check_in_latitude === 'number', cib.check_in_latitude)
  const ci2 = await call('/api/attendance/check-in', SUB, 'POST', {})
  ok('a second check-in -> 400', ci2.status === 400, ci2.status)
  ok('message preserved', (await ci2.json()).error === 'Already checked in today')

  const co = await call('/api/attendance/check-out', SUB, 'POST', { latitude: 7.5, longitude: 8.5 })
  const cob = await co.json()
  ok('check-out -> 200', co.status === 200, co.status)
  ok('check_out_time is ISO', ISO.test(cob.check_out_time), cob.check_out_time)
  const co2 = await call('/api/attendance/check-out', SUB, 'POST', {})
  ok('a second check-out -> 400', co2.status === 400, co2.status)
  ok('only ONE attendance row for the day', (await prisma.attendance.count({ where: { tenant_id: SEED.tenantA, user_id: SEED.subA } })) === 1)

  section('check-out before check-in is refused')
  await prisma.attendance.deleteMany({ where: { tenant_id: SEED.tenantA } })
  const coFirst = await call('/api/attendance/check-out', SUB, 'POST', {})
  ok('-> 400 "Check in first"', coFirst.status === 400 && (await coFirst.json()).error === 'Check in first before checking out', coFirst.status)

  section('attendance GET reads it back with the right shapes')
  await call('/api/attendance/check-in', SUB, 'POST', {})
  const ag = await (await call(`/api/attendance?date=${today}`, SUB, 'GET')).json()
  ok('returns the row', ag !== null && ag.date === today, ag?.date)
  ok('a day with no row -> null', (await (await call('/api/attendance?date=2019-01-01', SUB, 'GET')).json()) === null)

  // ===== expenses ==========================================================
  section('expenses POST/GET/DELETE')
  const er = await call('/api/expenses', SUB, 'POST', { expense_date: today, category: 'Travel', amount: 1234.56, notes: 'cab' })
  const expense = await er.json()
  ok('-> 201', er.status === 201, { status: er.status, expense })
  ok('amount is a NUMBER with the exact value', expense.amount === 1234.56, expense.amount)
  ok('expense_date is DATE-ONLY', expense.expense_date === today, expense.expense_date)
  ok('DB value matches', Number((await prisma.expenses.findUnique({ where: { id: expense.id } })).amount) === 1234.56)
  ok('future date -> 400', (await call('/api/expenses', SUB, 'POST', { expense_date: '2099-01-01', category: 'Travel', amount: 1 })).status === 400)
  ok('missing fields -> 400', (await call('/api/expenses', SUB, 'POST', { category: 'Travel' })).status === 400)

  const eg = await (await call(`/api/expenses?date=${today}`, SUB, 'GET')).json()
  ok('GET returns it with a numeric amount', eg.some(x => x.id === expense.id && x.amount === 1234.56))

  section('expenses DELETE is scoped to the owner')
  const byOther = await call(`/api/expenses/${expense.id}`, MGR, 'DELETE')
  ok('another user DELETE -> 200 but NO-OP', byOther.status === 200, byOther.status)
  ok('the expense survives', (await prisma.expenses.count({ where: { id: expense.id } })) === 1)
  const byOwner = await call(`/api/expenses/${expense.id}`, SUB, 'DELETE')
  ok('the owner DELETE -> 200', byOwner.status === 200)
  ok('the expense is gone', (await prisma.expenses.count({ where: { id: expense.id } })) === 0)

  section('calendars reflect the writes as DATE-ONLY strings')
  await call('/api/expenses', SUB, 'POST', { expense_date: today, category: 'Food', amount: 10 })
  await call('/api/expenses', SUB, 'POST', { expense_date: today, category: 'Food', amount: 20 })
  const ec = await (await call(`/api/expenses/calendar?month=${today.slice(0, 7)}&userId=${SEED.subA}`, SUB, 'GET')).json()
  ok('filledDates are DATE-ONLY', ec.filledDates.every(d => DATE_ONLY.test(d)), ec.filledDates)
  ok('TWO expenses on one day dedupe to ONE date', ec.filledDates.filter(d => d === today).length === 1, ec.filledDates)
  const dc = await (await call(`/api/daily-activity/calendar?month=${today.slice(0, 7)}&userId=${SEED.subA}`, SUB, 'GET')).json()
  ok('daily-activity filledDates are DATE-ONLY', dc.filledDates.every(d => DATE_ONLY.test(d)), dc.filledDates)

  // ===== expenses/photo authorisation (Phase B) ============================
  // This suite covers the AUTHORISATION branches only; the Cloudflare half is
  // verify-r2.mjs's job. Both outcomes below mean "got past authorisation":
  // 302 when R2 is configured (the signed redirect) and 500 when it is not.
  // Asserting only one of them makes the suite depend on whether R2 credentials
  // happen to be present, which is exactly how it broke once already.
  const pastAuth = r => r.status === 302 || r.status === 500
  section('expenses/photo — authorisation branches')
  const photoFile = '11111111-2222-4333-8444-555555555555.jpg'
  const photoUrl = `/api/expenses/photo/${photoFile}`
  const owned = await prisma.expenses.create({
    data: { tenant_id: SEED.tenantA, user_id: SEED.subA, expense_date: new Date(today), category: 'Travel', amount: 5, photo_url: photoUrl },
  })

  ok('a malformed id -> 404 before anything else', (await call('/api/expenses/photo/..%2Fetc%2Fpasswd', SUB, 'GET')).status === 404)
  ok('a non-uuid id -> 404', (await call('/api/expenses/photo/not-a-uuid.jpg', SUB, 'GET')).status === 404)
  ok('a wrong extension -> 404', (await call(`/api/expenses/photo/11111111-2222-4333-8444-555555555555.gif`, SUB, 'GET')).status === 404)
  ok('a well-formed id with no matching expense -> 404',
    (await call('/api/expenses/photo/99999999-9999-4999-8999-999999999999.jpg', SUB, 'GET')).status === 404)

  const asOwner = await call(photoUrl, SUB, 'GET')
  ok(`the OWNER gets past authorisation (${asOwner.status})`, pastAuth(asOwner), asOwner.status)
  if (asOwner.status === 500) {
    ok('when R2 is unconfigured the message names storage, not permissions',
      (await asOwner.json()).error === 'File storage is not configured.')
  } else {
    ok('when R2 is configured the 302 carries a signed URL',
      (asOwner.headers.get('location') ?? '').includes('X-Amz-Signature'), asOwner.headers.get('location')?.slice(0, 60))
  }

  // adminA can see subA (seeded user_visibility), so scope=team must allow it.
  const asManager = await call(photoUrl, MGR, 'GET')
  ok(`a manager who can SEE the owner also gets past authorisation (${asManager.status})`, pastAuth(asManager), asManager.status)

  section('expenses/photo — a user who cannot see the owner is refused')
  const outsider = await prisma.users.create({
    data: {
      tenant_id: SEED.tenantA, name: 'Scratch Outsider', email: 'outsider@example.invalid',
      contact: '9000007777', password: '', profile: 'Standard', status: 'Active',
      role_id: (await prisma.roles.findFirst({ where: { tenant_id: SEED.tenantA, name: 'Scratch Role' } })).id,
    },
  })
  // 'Scratch Role' has data_scope 'all' from the seed, so narrow it to 'own' for
  // this assertion — otherwise the test would prove nothing about scoping.
  await prisma.role_permissions.updateMany({
    where: { tenant_id: SEED.tenantA, profile: 'Scratch Role', section: 'expenses' },
    data: { data_scope: 'own' },
  })
  await prisma.role_permissions.upsert({
    where: { tenant_id_profile_section: { tenant_id: SEED.tenantA, profile: 'Scratch Role', section: 'expenses' } },
    create: { tenant_id: SEED.tenantA, profile: 'Scratch Role', section: 'expenses', can_view: true, can_create: false, can_edit: false, can_delete: false, data_scope: 'own' },
    update: { data_scope: 'own' },
  })
  const outsiderToken = await mint({ phone: '9000007777', userId: outsider.id, name: 'Scratch Outsider', role: 'Scratch Role', tenantId: SEED.tenantA, cv: 1 })
  const asOutsider = await call(photoUrl, outsiderToken, 'GET')
  ok("scope=own + another user's expense -> 403, never the signed url", asOutsider.status === 403, asOutsider.status)

  section('expenses/photo — cross-tenant photo ids resolve to nothing')
  const expB = await prisma.expenses.create({
    data: { tenant_id: SEED.tenantB, user_id: (await prisma.users.findFirst({ where: { tenant_id: SEED.tenantB } }))?.id ?? SEED.subA, expense_date: new Date(today), category: 'Travel', amount: 1, photo_url: '/api/expenses/photo/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg' },
  }).catch(() => null)
  if (expB) {
    const xTenant = await call('/api/expenses/photo/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg', SUB, 'GET')
    ok('a tenant A session cannot reach a tenant B photo -> 404', xTenant.status === 404, xTenant.status)
  } else console.log('  SKIP  cross-tenant photo id (tenant B has no users to own an expense)')

  // Clean up BOTH fixtures. The tenant-B row exists only to prove a tenant A
  // session cannot reach it; leaving it behind would (correctly) trip the
  // isolation assertion below.
  await prisma.expenses.deleteMany({ where: { id: owned.id } })
  if (expB) await prisma.expenses.deleteMany({ where: { id: expB.id } })

  // ===== isolation =========================================================
  section('tenant B untouched')
  ok('tenant B product name never changed',
    (await prisma.products.findUnique({ where: { id: SEED.productB } })).name === 'TENANT B PRODUCT — MUST NEVER BE TOUCHED')
  ok('tenant B has no daily_visits', (await prisma.daily_visits.count({ where: { tenant_id: SEED.tenantB } })) === 0)
  ok('tenant B has no expenses', (await prisma.expenses.count({ where: { tenant_id: SEED.tenantB } })) === 0)
  ok('tenant B has no attendance', (await prisma.attendance.count({ where: { tenant_id: SEED.tenantB } })) === 0)

  console.log(`\n${fail === 0 ? 'BATCH 4 WRITE-PATH TESTS PASSED' : `BATCH 4 WRITE-PATH TESTS FAILED — ${fail}`}   (${pass} passed, ${fail} failed)`)
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(fail ? 1 : 0) })
  .catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
