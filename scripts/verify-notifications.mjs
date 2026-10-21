#!/usr/bin/env node
/**
 * Verifies phone push + notification producers against a RUNNING dev server on
 * the LOCAL demo tenant. Refuses a non-local database.
 *
 *   CRON_SECRET=... node scripts/verify-notifications.mjs [baseUrl]
 *
 * The server must have been started with the same CRON_SECRET (and, to prove
 * real delivery, VAPID_* keys). Without VAPID keys push is a no-op and this
 * still proves the rows, the dedupe and the auth. It restores the rows it
 * edits (one follow-up's date/time, one plan's status) and removes its own
 * test notifications and subscriptions.
 */
import fs from 'node:fs'
import pg from 'pg'

const base = process.argv[2] ?? 'http://localhost:3013'
const secret = process.env.CRON_SECRET
if (!secret) { console.error('CRON_SECRET is required'); process.exit(1) }

const env = fs.readFileSync('.env.local', 'utf8')
const raw = (env.match(/^SCRATCH_DATABASE_URL=(.*)$/m) || [])[1]?.trim().replace(/^"|"$/g, '')
if (!raw || !['localhost', '127.0.0.1', '::1'].includes(new URL(raw).hostname)) {
  console.error('REFUSING: SCRATCH_DATABASE_URL missing or not local'); process.exit(1)
}
const db = new pg.Client({ connectionString: raw })
await db.connect()
const T = '0000000d-0000-4000-8000-000000000001'
const AMIT = '0000000d-0000-4000-8000-000000000103' // phone 9000000102, manager Priya (102)

let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) fails++ }

async function login(phone) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, password: 'dev1234' }),
  })
  const cookie = (r.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
  if (!r.ok || !cookie) throw new Error(`login ${phone} failed ${r.status}`)
  return cookie
}
const call = (cookie, method, path, body) => fetch(`${base}${path}`, {
  method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
})
const cron = (auth) => fetch(`${base}/api/cron/follow-up-reminders`, { method: 'POST', headers: auth ? { authorization: auth } : {} })
const q = async (sql, p = []) => (await db.query(sql, p)).rows

try {
  const admin = await login('9000000100')
  const amit = await login('9000000102')

  // --- subscribe / reassign / unsubscribe
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/verify-notifications-1', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }
  await q('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint])
  check('subscribe (admin)', (await call(admin, 'POST', '/api/push/subscribe', sub)).status === 200)
  check('subscribe again (idempotent)', (await call(admin, 'POST', '/api/push/subscribe', sub)).status === 200)
  check('one row', (await q('SELECT 1 FROM push_subscriptions WHERE endpoint=$1', [sub.endpoint])).length === 1)
  check('subscribe (Amit takes the shared phone)', (await call(amit, 'POST', '/api/push/subscribe', sub)).status === 200)
  const owner = (await q('SELECT user_id FROM push_subscriptions WHERE endpoint=$1', [sub.endpoint]))[0]?.user_id
  check('reassigned to Amit', owner === AMIT)
  await call(admin, 'DELETE', '/api/push/subscribe', { endpoint: sub.endpoint })
  check("another user's DELETE does not remove it", (await q('SELECT 1 FROM push_subscriptions WHERE endpoint=$1', [sub.endpoint])).length === 1)
  await call(amit, 'DELETE', '/api/push/subscribe', { endpoint: sub.endpoint })
  check('owner DELETE removes it', (await q('SELECT 1 FROM push_subscriptions WHERE endpoint=$1', [sub.endpoint])).length === 0)
  check('malformed body is 400', (await call(admin, 'POST', '/api/push/subscribe', { endpoint: 'x' })).status === 400)

  // --- cron auth
  check('cron without header 401', (await cron(null)).status === 401)
  check('cron wrong secret 401', (await cron('Bearer nope')).status === 401)
  check('cron with a session cookie only 401', (await fetch(`${base}/api/cron/follow-up-reminders`, { method: 'POST', headers: { cookie: admin } })).status === 401)

  // --- cron logic on Amit's follow-up
  const fu = (await q(`SELECT f.id, f.due_date::text AS d, f.due_time::text AS t FROM deal_follow_ups f JOIN deals x ON x.id=f.deal_id
                        WHERE f.tenant_id=$1 AND x.owner_user_id=$2 AND f.status='not_done' LIMIT 1`, [T, AMIT]))[0]
  const tz = process.env.APP_TIMEZONE || 'Asia/Kolkata'
  const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(p => [p.type, p.value]))
  const at = (minsAgo) => { const p = parts(new Date(Date.now() - minsAgo * 60000)); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` } }
  const sentNow = async () => (await (await cron(`Bearer ${secret}`)).json()).sent
  const rows = () => q(`SELECT context_type FROM notifications WHERE tenant_id=$1 AND context_id=$2 AND context_type LIKE 'follow_up_due@%'`, [T, fu.id])
  await q(`DELETE FROM notifications WHERE tenant_id=$1 AND context_id=$2 AND context_type LIKE 'follow_up_due@%'`, [T, fu.id])
  try {
    let w = at(10)
    await q('UPDATE deal_follow_ups SET due_date=$1, due_time=$2 WHERE id=$3', [w.date, w.time, fu.id])
    check('due 10 min ago: sent >= 1', (await sentNow()) >= 1)
    const r1 = await rows()
    check('row has the due moment in context_type', r1.length === 1 && r1[0].context_type === `follow_up_due@${w.date}T${w.time}`, JSON.stringify(r1))
    check('second run sends nothing for it (exactly once)', (await sentNow(), (await rows()).length === 1))
    await q(`DELETE FROM notifications WHERE tenant_id=$1 AND context_id=$2 AND context_type LIKE 'follow_up_due@%'`, [T, fu.id])
    w = at(-20)
    await q('UPDATE deal_follow_ups SET due_date=$1, due_time=$2 WHERE id=$3', [w.date, w.time, fu.id])
    await sentNow()
    check('due in 20 min (future): nothing sent', (await rows()).length === 0)
    w = at(120)
    await q('UPDATE deal_follow_ups SET due_date=$1, due_time=$2 WHERE id=$3', [w.date, w.time, fu.id])
    await sentNow()
    check('due 2 h ago (outside lookback): nothing sent', (await rows()).length === 0)
    w = at(10)
    await q(`UPDATE deal_follow_ups SET due_date=$1, due_time=$2, status='done' WHERE id=$3`, [w.date, w.time, fu.id])
    await sentNow()
    check('completed follow-up: nothing sent', (await rows()).length === 0)
  } finally {
    await q('UPDATE deal_follow_ups SET due_date=$1::date, due_time=$2::time, status=$3 WHERE id=$4', [fu.d, fu.t, 'not_done', fu.id])
    await q(`DELETE FROM notifications WHERE tenant_id=$1 AND context_id=$2 AND context_type LIKE 'follow_up_due@%'`, [T, fu.id])
  }

  // --- submit notifies the reviewers; mark read / unread
  const plan = (await q(`SELECT id, status, submitted_at, last_status_changed_at FROM weekly_plans WHERE tenant_id=$1 AND user_id=$2 AND status='Draft' LIMIT 1`, [T, AMIT]))[0]
  if (plan) {
    await q(`DELETE FROM notifications WHERE tenant_id=$1 AND context_id=$2`, [T, plan.id])
    const r = await call(amit, 'POST', `/api/weekly-plans/${plan.id}/submit`, {})
    check('submit ok', r.status === 200, String(r.status))
    const n = await q(`SELECT id, recipient_id, redirect_path, message, is_read FROM notifications WHERE tenant_id=$1 AND context_id=$2`, [T, plan.id])
    console.log('     reviewers notified:', n.map(x => `${x.recipient_id.slice(-3)} ${x.redirect_path}`).join(', '))
    check('at least one reviewer notified, redirect to approval', n.length >= 1 && n.every(x => x.redirect_path === '/weekly-plan/approval' && x.recipient_id !== AMIT))
    if (n[0]) {
      const reviewerPhone = { '101': '9000000100', '102': '9000000101' }[n[0].recipient_id.slice(-3)]
      const rc = await login(reviewerPhone)
      await call(rc, 'PATCH', `/api/notifications/${n[0].id}`, { is_read: true })
      check('PATCH is_read true', (await q('SELECT is_read FROM notifications WHERE id=$1', [n[0].id]))[0].is_read === true)
      await call(rc, 'PATCH', `/api/notifications/${n[0].id}`, { is_read: false })
      check('PATCH is_read false', (await q('SELECT is_read FROM notifications WHERE id=$1', [n[0].id]))[0].is_read === false)
      await call(rc, 'PATCH', `/api/notifications/${n[0].id}`)
      check('PATCH with no body marks read', (await q('SELECT is_read FROM notifications WHERE id=$1', [n[0].id]))[0].is_read === true)
      check('PATCH bad body is 400', (await call(rc, 'PATCH', `/api/notifications/${n[0].id}`, { is_read: 'yes' })).status === 400)
    }
    // put the plan back to Draft; leave no test rows
    await q(`UPDATE weekly_plans SET status='Draft', submitted_at=$3, last_status_changed_at=$4 WHERE id=$1 AND tenant_id=$2`, [plan.id, T, plan.submitted_at, plan.last_status_changed_at])
    await q(`DELETE FROM weekly_plan_audit_logs WHERE weekly_plan_id=$1 AND tenant_id=$2 AND action_type='Submit' AND timestamp > now() - interval '1 hour'`, [plan.id, T])
    await q(`DELETE FROM notifications WHERE tenant_id=$1 AND context_id=$2`, [T, plan.id])
  } else console.log('SKIP  no Draft plan for Amit')
} finally {
  await db.end()
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
