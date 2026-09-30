#!/usr/bin/env node
/**
 * WRITE-PATH tests (PLAN.md §8.3). These run against a dev server pointed at the
 * LOCAL scratch database — never RDS. They exist because
 * POST/PUT/DELETE cannot be exercised against production without creating rows
 * in real customers' tenants.
 *
 *   npm run scratch:setup                  # push schema + seed (once)
 *   npm run dev:scratch                    # dev server on :3012, scratch DB
 *   npm run test:write                     # this file
 *
 * Deliberately NOT merged into the live smoke suites: live proves real data
 * shapes, local proves write semantics. Keeping them separate is what keeps the
 * live suites safe to run.
 */
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { mintSession as mintTestSession, readSession } from './test-session.mjs'

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
  stateA: '0000000a-0000-4000-8000-000000000020',
  districtA: '0000000a-0000-4000-8000-000000000021',
  talukaA: '0000000a-0000-4000-8000-000000000022',
  catA: '0000000a-0000-4000-8000-000000000030',
  subcatA: '0000000a-0000-4000-8000-000000000031',
  tenantB: '0000000b-0000-4000-8000-000000000001',
  stateB: '0000000b-0000-4000-8000-000000000020',
  productB: '0000000b-0000-4000-8000-000000000030',
  distributorB: '0000000b-0000-4000-8000-000000000040',
}

const scratchUrl = readEnv('SCRATCH_DATABASE_URL')
if (!scratchUrl) { console.error('SCRATCH_DATABASE_URL not set'); process.exit(1) }
const host = new URL(scratchUrl).hostname
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`REFUSING TO RUN: write-path tests target "${host}", not local PostgreSQL.`)
  process.exit(1)
}
const u = new URL(scratchUrl)
u.searchParams.delete('sslmode'); u.searchParams.delete('connection_limit')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: u.toString(), max: 5 }) })

let pass = 0, fail = 0
const ok = (n, c, got) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : `   got: ${JSON.stringify(got)}`}`); c ? pass++ : fail++ }
const section = n => console.log(`\n-- ${n} --`)

// Signed by the app's own signSession(), so iat/exp and the encoding match login.
const mintSession = payload => mintTestSession(payload, readEnv('SESSION_SECRET'))

let TOKEN
const call = (path, method, body) => fetch(`${BASE}${path}`, {
  method, redirect: 'manual',
  headers: { cookie: `${COOKIE_NAME}=${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
})

async function main() {
  // Guard: make sure the server under test is really on the scratch DB. If it
  // were pointed at live, these tests would write to production.
  const probe = await fetch(`${BASE}/login`, { redirect: 'manual' }).catch(() => null)
  if (!probe) { console.error(`No server at ${BASE}. Run: npm run dev:scratch`); process.exit(1) }

  TOKEN = await mintSession({
    phone: '9000000001', userId: SEED.adminA, name: 'Scratch Admin',
    role: 'Administrator', tenantId: SEED.tenantA, cv: 1,
  })
  const me = await call('/api/auth/me', 'GET')
  const meBody = await me.json()
  if (meBody.tenantName !== 'Scratch Tenant A') {
    console.error(`SAFETY ABORT: server at ${BASE} is not on the scratch database (tenantName="${meBody.tenantName}").`)
    process.exit(1)
  }
  console.log(`Server confirmed on scratch DB (tenant "${meBody.tenantName}")`)

  // === 1. DELETE no-match returns ok, not 500 (the deleteMany finding) ======
  section('DELETE with a non-matching id -> { ok: true }, NOT 500')
  const ghost = '0000000f-0000-4000-8000-0000000000ff'
  for (const [path, label] of [
    [`/api/masters/states/${ghost}`, 'states'],
    [`/api/masters/districts/${ghost}`, 'districts'],
    [`/api/masters/products/${ghost}`, 'products'],
    [`/api/masters/product-categories/${ghost}`, 'product-categories'],
  ]) {
    const r = await call(path, 'DELETE')
    const b = await r.json().catch(() => null)
    ok(`${label}: non-existent id -> 200 { ok: true }`, r.status === 200 && b?.ok === true, { status: r.status, b })
  }

  section("DELETE with ANOTHER TENANT's id -> no-op, { ok: true }, row survives")
  const rDelB = await call(`/api/masters/states/${SEED.stateB}`, 'DELETE')
  ok('cross-tenant DELETE -> 200 { ok: true }', rDelB.status === 200 && (await rDelB.json()).ok === true, rDelB.status)
  ok('tenant B state STILL EXISTS after the cross-tenant DELETE',
    (await prisma.states.count({ where: { id: SEED.stateB } })) === 1)

  const rDelProdB = await call(`/api/masters/products/${SEED.productB}`, 'DELETE')
  ok('cross-tenant product DELETE -> 200 { ok: true }', rDelProdB.status === 200)
  ok('tenant B product STILL EXISTS', (await prisma.products.count({ where: { id: SEED.productB } })) === 1)

  // === 2. PUT cross-tenant -> 404, row untouched ============================
  // 404, not 500: the master routes map Prisma's P2025 (no row matched the
  // tenant-scoped update) to 404 through dbErrorResult(). The old 500 was the
  // .single() error path, carried over unchanged until that mapping existed.
  section("PUT with ANOTHER TENANT's id -> 404, row untouched")
  const beforeName = (await prisma.states.findUnique({ where: { id: SEED.stateB } })).name
  const rPutB = await call(`/api/masters/states/${SEED.stateB}`, 'PUT', { name: 'HIJACKED' })
  ok('cross-tenant PUT -> 404 (P2025 mapped by dbErrorResult)', rPutB.status === 404, rPutB.status)
  const afterName = (await prisma.states.findUnique({ where: { id: SEED.stateB } })).name
  ok('tenant B state name UNCHANGED', afterName === beforeName, { beforeName, afterName })

  section('PUT with a non-existent id -> 404')
  ok('non-existent id -> 404', (await call(`/api/masters/states/${ghost}`, 'PUT', { name: 'x' })).status === 404)

  // A by-id URL whose id is not a UUID fails Postgres's uuid cast. That is
  // Prisma P2007, which dbErrorResult() maps to a 400 (it used to be a 500).
  section('malformed (non-UUID) id in the URL -> 400, not 500')
  const rBadPut = await call('/api/masters/states/not-a-uuid', 'PUT', { name: 'x' })
  const bBadPut = await rBadPut.json().catch(() => null)
  ok('PUT /states/not-a-uuid -> 400', rBadPut.status === 400, { status: rBadPut.status, b: bBadPut })
  ok('error is "One of the values is invalid."', bBadPut?.error === 'One of the values is invalid.', bBadPut)
  const rBadDel = await call('/api/masters/states/not-a-uuid', 'DELETE')
  ok('DELETE /states/not-a-uuid -> 400', rBadDel.status === 400, rBadDel.status)

  // === 3. POST serialisation: Decimal + Date ================================
  section('POST responses serialise Decimal and Date correctly (§5.1)')
  const rProd = await call('/api/masters/products', 'POST', {
    name: 'Scratch Product', category_id: SEED.catA, subcategory_id: SEED.subcatA,
    price: 1234.56, sku: 'SKU-1',
  })
  const prod = await rProd.json()
  ok('POST /products -> 201', rProd.status === 201, { status: rProd.status, prod })
  ok('price is a NUMBER, not a Decimal string', typeof prod.price === 'number', { price: prod.price, type: typeof prod.price })
  ok('price value is exact', prod.price === 1234.56, prod.price)
  ok('created_at is a full ISO string', /^\d{4}-\d{2}-\d{2}T.*Z$/.test(prod.created_at), prod.created_at)
  ok('row landed in tenant A', prod.tenant_id === SEED.tenantA, prod.tenant_id)
  const dbPrice = (await prisma.products.findUnique({ where: { id: prod.id } })).price
  ok('DB value matches what was returned', Number(dbPrice) === 1234.56, String(dbPrice))

  // @db.Date round trip. This replaces the check that went through the deleted
  // /api/masters/distributors: same table (companies, the renamed
  // business_partners) and same column, now through the Party routes.
  section('@db.Date serialises as "YYYY-MM-DD" (companies.next_follow_up_date)')
  const rCo = await call('/api/companies', 'POST', { name: 'Scratch Company Date', next_follow_up_date: '2026-03-04' })
  const co = await rCo.json()
  ok('POST /companies -> 201', rCo.status === 201, { status: rCo.status, co })
  ok('POST response: next_follow_up_date is DATE-ONLY "2026-03-04"', co.next_follow_up_date === '2026-03-04', co.next_follow_up_date)
  ok('created_at stays a full ISO timestamp', /^\d{4}-\d{2}-\d{2}T.*Z$/.test(co.created_at), co.created_at)
  ok('company landed in tenant A', co.tenant_id === SEED.tenantA, co.tenant_id)
  // No owner in the body: the creator owns it, so it is inside their own
  // Self/Team scope. It used to be NULL, which no one below Company scope sees.
  ok('owner_user_id defaults to the creator', co.owner_user_id === SEED.adminA, co.owner_user_id)
  const dbDate = (await prisma.companies.findUnique({ where: { id: co.id } })).next_follow_up_date
  ok('DB holds 2026-03-04 (no timezone shift on write)', dbDate instanceof Date && dbDate.toISOString().startsWith('2026-03-04'), dbDate)
  const rCoPut = await call(`/api/companies/${co.id}`, 'PUT', { next_follow_up_date: '2026-12-31' })
  ok('PUT /companies/[id] -> 200', rCoPut.status === 200, rCoPut.status)
  const coGot = await (await call(`/api/companies/${co.id}`, 'GET')).json()
  ok('GET /companies/[id]: next_follow_up_date is DATE-ONLY "2026-12-31"', coGot.next_follow_up_date === '2026-12-31', coGot.next_follow_up_date)
  const coListed = (await (await call('/api/companies', 'GET')).json()).find(c => c.id === co.id)
  ok('GET /companies list: next_follow_up_date is DATE-ONLY "2026-12-31"', coListed?.next_follow_up_date === '2026-12-31', coListed?.next_follow_up_date)

  // Carried over from the retired /api/leads section of write-path-activity.mjs.
  // A company outside the caller's tenant is not found (findScopedCompany), so
  // both verbs answer 404 and touch nothing.
  section("companies: ANOTHER TENANT's id -> 404, row untouched")
  const coPutB = await call(`/api/companies/${SEED.distributorB}`, 'PUT', { name: 'HIJACKED' })
  ok('cross-tenant PUT /companies/[id] -> 404', coPutB.status === 404, coPutB.status)
  const coDelB = await call(`/api/companies/${SEED.distributorB}`, 'DELETE')
  ok('cross-tenant DELETE /companies/[id] -> 404', coDelB.status === 404, coDelB.status)
  ok('tenant B company survives both, name unchanged',
    (await prisma.companies.findUnique({ where: { id: SEED.distributorB } }))?.name === 'TENANT B DISTRIBUTOR — MUST NEVER BE TOUCHED')

  // Body FKs (src/lib/tenant-fk.ts). A value that is present but is not a bare
  // UUID string is "<Label> is invalid" before any lookup. Prisma would write
  // `{ "set": "<uuid>" }` exactly like the bare id, so skipping non-strings
  // would be a bypass. A well-formed uuid from another tenant is "<Label> not found".
  section('body FK guard: non-UUID values are "is invalid", foreign ids "not found"')
  const coCountBefore = await prisma.companies.count({ where: { tenant_id: SEED.tenantA } })
  for (const [label, value] of [
    ['{ set: <uuid> }', { set: SEED.stateA }],
    ['a number', 12345],
    ['a uuid with surrounding spaces', ` ${SEED.stateA} `],
  ]) {
    const r = await call('/api/companies', 'POST', { name: 'Scratch FK Probe', state_id: value })
    const b = await r.json().catch(() => null)
    ok(`POST /companies state_id = ${label} -> 400 "State is invalid"`, r.status === 400 && b?.error === 'State is invalid', { status: r.status, b })
  }
  const rFkB = await call('/api/companies', 'POST', { name: 'Scratch FK Probe', state_id: SEED.stateB })
  const bFkB = await rFkB.json().catch(() => null)
  ok('POST /companies state_id = tenant B state -> 400 "State not found"', rFkB.status === 400 && bFkB?.error === 'State not found', { status: rFkB.status, b: bFkB })
  const rOwnSet = await call(`/api/companies/${co.id}`, 'PUT', { owner_user_id: { set: SEED.adminA } })
  const bOwnSet = await rOwnSet.json().catch(() => null)
  ok('PUT /companies/[id] owner_user_id = { set: <uuid> } -> 400 "Owner is invalid"', rOwnSet.status === 400 && bOwnSet?.error === 'Owner is invalid', { status: rOwnSet.status, b: bOwnSet })
  ok('no company was created by any refused POST',
    (await prisma.companies.count({ where: { tenant_id: SEED.tenantA } })) === coCountBefore)

  // A contact with no owner in the body and no company to inherit one from
  // falls back to its creator, for the same scope reason as companies.
  section('contacts POST: owner falls back to the caller')
  const rCt = await call('/api/contacts', 'POST', { name: 'Scratch Contact Owner', mobile: '9876543210' })
  ok('POST /contacts -> 201', rCt.status === 201, { status: rCt.status, b: await rCt.clone().json().catch(() => null) })
  const ct = await prisma.contacts.findFirst({ where: { tenant_id: SEED.tenantA, name: 'Scratch Contact Owner' }, select: { owner_user_id: true } })
  ok('contact owner_user_id is the caller', ct?.owner_user_id === SEED.adminA, ct)

  // === 4. POST/PUT happy paths + tenant stamping ============================
  section('POST/PUT happy paths, and every created row is stamped with the session tenant')
  const rState = await call('/api/masters/states', 'POST', { name: 'Scratch Created State' })
  const st = await rState.json()
  ok('POST /states -> 201', rState.status === 201, rState.status)
  ok('created state is in tenant A', st.tenant_id === SEED.tenantA, st.tenant_id)

  const rPut = await call(`/api/masters/states/${st.id}`, 'PUT', { name: 'Scratch Renamed State' })
  const put = await rPut.json()
  ok('PUT own-tenant state -> 200', rPut.status === 200, rPut.status)
  ok('name actually changed', put.name === 'Scratch Renamed State', put.name)
  ok('DB reflects the change', (await prisma.states.findUnique({ where: { id: st.id } })).name === 'Scratch Renamed State')

  const rDel = await call(`/api/masters/states/${st.id}`, 'DELETE')
  ok('DELETE own-tenant state -> 200', rDel.status === 200)
  ok('row is actually gone', (await prisma.states.count({ where: { id: st.id } })) === 0)

  section('POST validation still returns 400, not 500')
  ok('POST /states with no name -> 400', (await call('/api/masters/states', 'POST', {})).status === 400)
  ok('POST /districts with no state_id -> 400', (await call('/api/masters/districts', 'POST', { name: 'x' })).status === 400)
  ok('POST /products with bad price -> 400', (await call('/api/masters/products', 'POST', { name: 'x', category_id: SEED.catA, subcategory_id: SEED.subcatA, price: 'abc' })).status === 400)
  ok('POST /products with mismatched subcategory -> 400',
    (await call('/api/masters/products', 'POST', { name: 'x', category_id: SEED.stateA, subcategory_id: SEED.subcatA, price: 1 })).status === 400)

  // === 5. auth write paths, retro-covering Batch 1 ==========================
  section('auth write paths (Batch 1 retro-coverage)')
  const scratchUser = await prisma.users.create({
    data: {
      tenant_id: SEED.tenantA, name: 'Reset Target', email: 'reset-target@example.invalid',
      contact: '9000009999', password: '', profile: 'Standard', status: 'Active',
    },
  })
  const rForgot = await fetch(`${BASE}/api/auth/forgot-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '9000009999' }),
  })
  ok('POST /forgot-password for a real user -> 200', rForgot.status === 200, rForgot.status)
  const afterForgot = await prisma.users.findUnique({ where: { id: scratchUser.id } })
  if (!afterForgot.password_reset_token) {
    console.error('  !! No reset token was written. Almost certainly a MISCONFIGURATION, not a bug:')
    console.error('     /api/auth/forgot-password is a PUBLIC route, so middleware injects no')
    console.error('     x-tenant-id and getTenantId() falls back to DEFAULT_TENANT_ID. Start the')
    console.error('     scratch server with DEFAULT_TENANT_ID set to the scratch tenant:')
    console.error(`       DATABASE_URL=$SCRATCH_DATABASE_URL DEFAULT_TENANT_ID=${SEED.tenantA} npx next dev -p 3012`)
    console.error('     See PLAN.md 13.2.')
  }
  ok('a reset token was written', typeof afterForgot.password_reset_token === 'string' && afterForgot.password_reset_token.length > 0)
  ok('the expiry is a Date roughly an hour out',
    afterForgot.password_reset_expires instanceof Date &&
    afterForgot.password_reset_expires.getTime() - Date.now() > 50 * 60 * 1000, afterForgot.password_reset_expires)

  const rReset = await fetch(`${BASE}/api/auth/reset-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: afterForgot.password_reset_token, password: 'newpass123', confirmPassword: 'newpass123' }),
  })
  ok('POST /reset-password with a valid token -> 200', rReset.status === 200, rReset.status)
  const afterReset = await prisma.users.findUnique({ where: { id: scratchUser.id } })
  ok('password is now a bcrypt hash', afterReset.password.startsWith('$2'), afterReset.password.slice(0, 4))
  ok('reset token was cleared', afterReset.password_reset_token === null)
  ok('reset expiry was cleared', afterReset.password_reset_expires === null)

  const rLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '9000009999', password: 'newpass123' }),
  })
  ok('POST /login with the NEW password -> 200 (the success path, finally exercised)', rLogin.status === 200, rLogin.status)
  const setCookie = rLogin.headers.get('set-cookie') ?? ''
  ok('login sets an httpOnly session cookie', /rgb_session=/.test(setCookie) && /HttpOnly/i.test(setCookie))
  ok('login with the OLD password -> 401', (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '9000009999', password: 'newpass123-wrong' }),
  })).status === 401)

  // POST /api/auth/change-password bumps credentials_version, so every session
  // minted under the old password dies, and re-issues THIS device a cookie
  // carrying the new version. The cookie from the login above is the "old" one.
  section('change-password: new cookie carries the new cv, the old cookie is dead')
  const cookieOf = res => /rgb_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]
  const oldCookie = cookieOf(rLogin)
  ok('the login cookie works before the change', (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: `${COOKIE_NAME}=${oldCookie}` } })).status === 200)
  const changePw = body => fetch(`${BASE}/api/auth/change-password`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: `${COOKIE_NAME}=${oldCookie}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const cvBefore = (await prisma.users.findUnique({ where: { id: scratchUser.id } })).credentials_version
  const rWrongPw = await changePw({ currentPassword: 'not-the-password', newPassword: 'changed456' })
  ok('wrong current password -> 400', rWrongPw.status === 400, rWrongPw.status)
  ok('...and credentials_version is unchanged',
    (await prisma.users.findUnique({ where: { id: scratchUser.id } })).credentials_version === cvBefore)
  const rChanged = await changePw({ currentPassword: 'newpass123', newPassword: 'changed456' })
  ok('correct current password -> 200', rChanged.status === 200, rChanged.status)
  const newCookie = cookieOf(rChanged)
  const cvAfter = (await prisma.users.findUnique({ where: { id: scratchUser.id } })).credentials_version
  ok('credentials_version went up by one', cvAfter === cvBefore + 1, { cvBefore, cvAfter })
  const newPayload = newCookie ? await readSession(newCookie, readEnv('SESSION_SECRET')) : null
  ok("a NEW cookie was issued, and its cv equals the DB's credentials_version",
    Boolean(newCookie) && newCookie !== oldCookie && newPayload?.cv === cvAfter, { cv: newPayload?.cv, cvAfter })
  ok('the new cookie works', (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: `${COOKIE_NAME}=${newCookie}` } })).status === 200)
  ok('the OLD cookie is rejected -> 401', (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: `${COOKIE_NAME}=${oldCookie}` } })).status === 401)

  section('reset-password expiry branch')
  await prisma.users.update({
    where: { id: scratchUser.id },
    data: { password_reset_token: 'expired-token-xyz', password_reset_expires: new Date(Date.now() - 60 * 1000) },
  })
  const rExpired = await fetch(`${BASE}/api/auth/reset-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'expired-token-xyz', password: 'another123', confirmPassword: 'another123' }),
  })
  ok('expired token -> 400', rExpired.status === 400, rExpired.status)
  ok('expired token message is exact', (await rExpired.json()).error === 'Reset link has expired. Please request a new one.')

  section('login: inactive user is refused')
  await prisma.users.update({ where: { id: scratchUser.id }, data: { status: 'Inactive' } })
  const rInactive = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // The password set by change-password above, so only the status can refuse it.
    body: JSON.stringify({ phone: '9000009999', password: 'changed456' }),
  })
  ok('inactive user login -> 403', rInactive.status === 403, rInactive.status)

  // Phone numbers are unique per company (users_tenant_contact), not globally:
  // one person may hold an account in two firms. Tenant B has no administrator
  // to call the API as, so its side is written directly; tenant A's goes
  // through POST /api/masters/users.
  // ⚠️ Needs a local DB whose users.contact constraint is the per-tenant one;
  // a database still carrying a global unique on contact answers 400 here.
  section('phone uniqueness is per company')
  const SHARED_PHONE = '9000008888'
  await prisma.users.create({
    data: { tenant_id: SEED.tenantB, name: 'Tenant B Phone Holder', email: 'b-phone@example.invalid',
      contact: SHARED_PHONE, password: '', profile: 'Standard', status: 'Active' },
  })
  const newUser = (email) => call('/api/masters/users', 'POST', {
    name: 'Scratch Phone User', email, contact: SHARED_PHONE, password: 'phone123', profile: 'Standard',
  })
  const rPhoneA = await newUser('a-phone@example.invalid')
  ok("tenant A may use a number tenant B already has -> 201", rPhoneA.status === 201, { status: rPhoneA.status, b: await rPhoneA.clone().json().catch(() => null) })
  ok('both tenants now hold that number',
    (await prisma.users.count({ where: { contact: SHARED_PHONE, tenant_id: { in: [SEED.tenantA, SEED.tenantB] } } })) === 2)
  const rPhoneDup = await newUser('a-phone-2@example.invalid')
  const bPhoneDup = await rPhoneDup.json().catch(() => null)
  ok('the same number twice within tenant A -> 400', rPhoneDup.status === 400, rPhoneDup.status)
  ok('message names the company rule', bPhoneDup?.error === 'This phone number is already used by another user in this company.', bPhoneDup)
  ok('no second tenant A row was written',
    (await prisma.users.count({ where: { tenant_id: SEED.tenantA, contact: SHARED_PHONE } })) === 1)

  // === 6. tenant B is completely untouched by everything above ==============
  section('FINAL ISOLATION CHECK — tenant B must be byte-identical')
  ok('tenant B still has exactly 1 state', (await prisma.states.count({ where: { tenant_id: SEED.tenantB } })) === 1)
  ok('tenant B still has exactly 1 product', (await prisma.products.count({ where: { tenant_id: SEED.tenantB } })) === 1)
  ok('tenant B still has exactly 1 business_partner', (await prisma.companies.count({ where: { tenant_id: SEED.tenantB } })) === 1)
  ok('tenant B state name never changed',
    (await prisma.states.findUnique({ where: { id: SEED.stateB } })).name === 'TENANT B STATE — MUST NEVER BE TOUCHED')
  ok('tenant B product name never changed',
    (await prisma.products.findUnique({ where: { id: SEED.productB } })).name === 'TENANT B PRODUCT — MUST NEVER BE TOUCHED')
  ok('tenant B distributor name never changed',
    (await prisma.companies.findUnique({ where: { id: SEED.distributorB } })).name === 'TENANT B DISTRIBUTOR — MUST NEVER BE TOUCHED')

  console.log(`\n${fail === 0 ? 'WRITE-PATH TESTS PASSED' : `WRITE-PATH TESTS FAILED — ${fail}`}   (${pass} passed, ${fail} failed)`)
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(fail ? 1 : 0) })
  .catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
