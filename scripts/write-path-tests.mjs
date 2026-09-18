#!/usr/bin/env node
/**
 * WRITE-PATH tests (PLAN.md §8.3). These run against a dev server pointed at the
 * LOCAL scratch database — never live Supabase, never RDS. They exist because
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

async function mintSession(payload) {
  const secret = readEnv('SESSION_SECRET')
  const enc = new TextEncoder()
  const data = btoa(JSON.stringify(payload))
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'HMAC', hash: 'SHA-256' }, key, enc.encode(data))
  let s = ''
  for (const b of new Uint8Array(sig)) s += String.fromCharCode(b)
  return `${data}.${btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`
}

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

  // === 2. PUT cross-tenant -> 500, row untouched ============================
  section("PUT with ANOTHER TENANT's id -> 500, row untouched")
  const beforeName = (await prisma.states.findUnique({ where: { id: SEED.stateB } })).name
  const rPutB = await call(`/api/masters/states/${SEED.stateB}`, 'PUT', { name: 'HIJACKED' })
  ok('cross-tenant PUT -> 500 (matches the old .single() error path)', rPutB.status === 500, rPutB.status)
  const afterName = (await prisma.states.findUnique({ where: { id: SEED.stateB } })).name
  ok('tenant B state name UNCHANGED', afterName === beforeName, { beforeName, afterName })

  section('PUT with a non-existent id -> 500')
  ok('non-existent id -> 500', (await call(`/api/masters/states/${ghost}`, 'PUT', { name: 'x' })).status === 500)

  // === 3. business_partners `type` guard ====================================
  section('business_partners type guard: a dealers endpoint cannot touch a distributor')
  const distBefore = (await prisma.companies.findUnique({ where: { id: SEED.distributorB } })).name
  const rTypePut = await call(`/api/masters/dealers/${SEED.distributorB}`, 'PUT', { name: 'HIJACKED VIA DEALERS' })
  ok('PUT distributor id via /dealers -> 500', rTypePut.status === 500, rTypePut.status)
  ok('distributor name UNCHANGED', (await prisma.companies.findUnique({ where: { id: SEED.distributorB } })).name === distBefore)

  // Same-tenant distributor, to prove the guard is about `type`, not tenancy.
  const distA = await prisma.companies.create({
    data: { tenant_id: SEED.tenantA, type: 'Distributor', stage: 'Existing', name: 'Scratch Distributor A' },
  })
  const rTypeSame = await call(`/api/masters/dealers/${distA.id}`, 'PUT', { name: 'HIJACKED SAME TENANT' })
  ok('PUT same-tenant distributor via /dealers -> 500 (type guard, not tenancy)', rTypeSame.status === 500, rTypeSame.status)
  ok('same-tenant distributor name UNCHANGED',
    (await prisma.companies.findUnique({ where: { id: distA.id } })).name === 'Scratch Distributor A')
  const rTypeDel = await call(`/api/masters/dealers/${distA.id}`, 'DELETE')
  ok('DELETE same-tenant distributor via /dealers -> 200 but NO-OP', rTypeDel.status === 200)
  ok('distributor SURVIVES the dealers DELETE', (await prisma.companies.count({ where: { id: distA.id } })) === 1)

  // === 4. POST serialisation: Decimal + Date ================================
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

  const rDist = await call('/api/masters/distributors', 'POST', {
    name: 'Scratch Distributor Decimal', latitude: 12.9716, longitude: 77.5946,
    state_id: SEED.stateA, district_id: SEED.districtA, taluka_id: SEED.talukaA,
  })
  const dist = await rDist.json()
  ok('POST /distributors -> 201', rDist.status === 201, { status: rDist.status, dist })
  ok('latitude is a NUMBER', typeof dist.latitude === 'number', { v: dist.latitude, t: typeof dist.latitude })
  ok('longitude is a NUMBER', typeof dist.longitude === 'number', { v: dist.longitude, t: typeof dist.longitude })
  ok('latitude value exact', dist.latitude === 12.9716, dist.latitude)

  // next_follow_up_date is DATE — set it directly, then read it back through the API.
  await prisma.companies.update({
    where: { id: dist.id }, data: { next_follow_up_date: new Date('2026-03-04T00:00:00.000Z') },
  })
  const listed = await (await call('/api/masters/distributors', 'GET')).json()
  const withDate = listed.find(d => d.id === dist.id)
  ok('next_follow_up_date is DATE-ONLY "2026-03-04"', withDate?.next_follow_up_date === '2026-03-04', withDate?.next_follow_up_date)

  // === 5. POST/PUT happy paths + tenant stamping ============================
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
  ok('POST /distributors with bad mobile -> 400', (await call('/api/masters/distributors', 'POST', { name: 'x', mobile_1: '123' })).status === 400)
  ok('POST /distributors with bad latitude -> 400', (await call('/api/masters/distributors', 'POST', { name: 'x', latitude: 999 })).status === 400)

  // === 6. auth write paths, retro-covering Batch 1 ==========================
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
    body: JSON.stringify({ phone: '9000009999', password: 'newpass123' }),
  })
  ok('inactive user login -> 403', rInactive.status === 403, rInactive.status)

  // === 7. tenant B is completely untouched by everything above ==============
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
