#!/usr/bin/env node
/**
 * Verifies Phase B against REAL Cloudflare R2. Everything this asserts was
 * previously reasoned-from-v2e and labelled unverified.
 *
 *   npm run verify:r2      (needs the scratch dev server on :3012 with the R2_* vars)
 *
 * Safety: every object it writes goes under the scratch tenant prefix and is
 * deleted at the end, and the run finishes by asserting the bucket is EMPTY
 * again — the peer confirmed KeyCount 0 beforehand, so anything left behind is
 * ours. It only ever touches R2_BUCKET; the same credentials also reach
 * v2e-attachments and lbd-attachment and this must never go near them.
 */
import fs from 'node:fs'
import { S3Client, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const BASE = process.env.WRITE_BASE_URL ?? 'http://127.0.0.1:3012'
const COOKIE_NAME = 'rgb_session'

const SEED = {
  tenantA: '0000000a-0000-4000-8000-000000000001',
  subA: '0000000a-0000-4000-8000-000000000050',
  adminA: '0000000a-0000-4000-8000-000000000011',
}

function readEnv(key) {
  if (process.env[key]) return process.env[key]
  const m = fs.readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
}

const BUCKET = readEnv('R2_BUCKET')
const ENDPOINT = readEnv('R2_ENDPOINT')
if (BUCKET !== 'sfacrm') {
  console.error(`REFUSING TO RUN: R2_BUCKET is "${BUCKET}", expected "sfacrm".`)
  process.exit(1)
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: readEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: readEnv('R2_SECRET_ACCESS_KEY'),
  },
})

const scratchUrl = readEnv('SCRATCH_DATABASE_URL')
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

const listAll = async () => {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }))
  return r.Contents ?? []
}

/** A genuinely valid 1x1 PNG, so content-type checks mean something. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

async function main() {
  const probe = await fetch(`${BASE}/login`, { redirect: 'manual' }).catch(() => null)
  if (!probe) { console.error(`No server at ${BASE}. Start the scratch dev server with the R2_* vars set.`); process.exit(1) }

  const SUB = await mint({ phone: '9000000002', userId: SEED.subA, name: 'Scratch Subordinate', role: 'Administrator', tenantId: SEED.tenantA, cv: 1 })
  const MGR = await mint({ phone: '9000000001', userId: SEED.adminA, name: 'Scratch Admin', role: 'Administrator', tenantId: SEED.tenantA, cv: 1 })

  const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: `${COOKIE_NAME}=${SUB}` } })).json()
  if (me.tenantName !== 'Scratch Tenant A') {
    console.error(`SAFETY ABORT: server is not on the scratch database (tenantName="${me.tenantName}").`)
    process.exit(1)
  }

  section('bucket starts empty (anything found afterwards is ours)')
  const before = await listAll()
  ok(`KeyCount is 0 before the run (found ${before.length})`, before.length === 0, before.map(o => o.Key).slice(0, 5))

  const written = []

  try {
    // ===== upload =========================================================
    section('POST /api/expenses/upload — a REAL PutObject to Cloudflare')
    const fd = new FormData()
    fd.append('file', new File([PNG_1x1], 'receipt.png', { type: 'image/png' }))
    const ur = await fetch(`${BASE}/api/expenses/upload`, {
      method: 'POST', headers: { cookie: `${COOKIE_NAME}=${SUB}` }, body: fd,
    })
    const ub = await ur.json()
    ok('-> 200', ur.status === 200, { status: ur.status, ub })
    ok('returns { url }', typeof ub.url === 'string', ub)
    ok('url is APP-RELATIVE, never an R2 address',
      ub.url.startsWith('/api/expenses/photo/') && !ub.url.includes('r2.cloudflarestorage.com') && !ub.url.includes(BUCKET),
      ub.url)
    const photoFile = ub.url.replace('/api/expenses/photo/', '')
    ok('url ends in <uuid>.png', /^[0-9a-f-]{36}\.png$/.test(photoFile), photoFile)

    section('the object landed at exactly receipts/{tenantId}/{uuid}.{ext}')
    const after = await listAll()
    written.push(...after.map(o => o.Key))
    ok('exactly one object in the bucket', after.length === 1, after.map(o => o.Key))
    const expectedKey = `receipts/${SEED.tenantA}/${photoFile}`
    ok(`key is ${expectedKey}`, after[0]?.Key === expectedKey, after[0]?.Key)
    ok('size matches the bytes uploaded', after[0]?.Size === PNG_1x1.length, { got: after[0]?.Size, expected: PNG_1x1.length })

    const head = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: expectedKey }))
    ok('stored ContentType is image/png', head.ContentType === 'image/png', head.ContentType)

    section('upload validation still rejects what it always rejected')
    const badType = new FormData()
    badType.append('file', new File([Buffer.from('x')], 'a.txt', { type: 'text/plain' }))
    const btr = await fetch(`${BASE}/api/expenses/upload`, { method: 'POST', headers: { cookie: `${COOKIE_NAME}=${SUB}` }, body: badType })
    ok('a non-image -> 400', btr.status === 400, btr.status)
    ok('message unchanged', (await btr.json()).error === 'Only JPG and PNG files are allowed')
    const tooBig = new FormData()
    tooBig.append('file', new File([Buffer.alloc(6 * 1024 * 1024)], 'big.png', { type: 'image/png' }))
    const tbr = await fetch(`${BASE}/api/expenses/upload`, { method: 'POST', headers: { cookie: `${COOKIE_NAME}=${SUB}` }, body: tooBig })
    ok('over 5 MB -> 400', tbr.status === 400, tbr.status)
    ok('message unchanged', (await tbr.json()).error === 'Photo must be 5 MB or less')
    ok('neither rejected upload wrote an object', (await listAll()).length === 1)

    // ===== the private-bucket assertion ===================================
    section('THE BUCKET IS GENUINELY PRIVATE — unsigned access must be refused')
    const directUrl = `${ENDPOINT}/${BUCKET}/${expectedKey}`
    const direct = await fetch(directUrl, { redirect: 'manual' })
    const directBody = await direct.text()
    // R2 answers an unsigned read on a private bucket with 400
    // InvalidArgument/Authorization, NOT 401/403. Assert the error CODE rather
    // than the status, because a bare status check cannot tell an auth refusal
    // from a malformed request — and a malformed URL would make this test
    // vacuous. The two assertions after it close that gap.
    ok(`an UNSIGNED GET to the R2 object is refused (${direct.status})`,
      direct.status >= 400 && /InvalidArgument|AccessDenied|Unauthorized/.test(directBody), { status: direct.status, body: directBody.slice(0, 120) })
    ok('the refusal is specifically about Authorization', /Authorization|AccessDenied/.test(directBody), directBody.slice(0, 120))
    ok('and returns no image bytes', !(direct.headers.get('content-type') ?? '').startsWith('image/'), direct.headers.get('content-type'))

    // Proof the URL above is well-formed, so the refusal is real: the SAME url
    // with a signature returns the object.
    const provingSigned = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: expectedKey }), { expiresIn: 300 })
    const proving = await fetch(provingSigned)
    ok('the SAME url, signed, returns 200 — so the unsigned refusal is auth, not a bad URL',
      proving.status === 200 && (await proving.arrayBuffer()).byteLength === PNG_1x1.length, proving.status)

    // R2 refuses auth BEFORE key lookup, so a missing object is indistinguishable
    // from a present one to an unauthenticated caller — no existence leak.
    const ghost = await fetch(`${ENDPOINT}/${BUCKET}/receipts/${SEED.tenantA}/does-not-exist.png`, { redirect: 'manual' })
    ok('an unsigned GET for a NONEXISTENT key is refused identically (no existence leak)',
      ghost.status === direct.status, { ghost: ghost.status, real: direct.status })

    // ===== photo route end to end =========================================
    section('GET /api/expenses/photo/[id] — 302 to a signed inline URL')
    const expense = await prisma.expenses.create({
      data: {
        tenant_id: SEED.tenantA, user_id: SEED.subA, expense_date: new Date(),
        category: 'Travel', amount: 12.34, photo_url: ub.url,
      },
    })

    const pr = await fetch(`${BASE}${ub.url}`, { headers: { cookie: `${COOKIE_NAME}=${SUB}` }, redirect: 'manual' })
    ok('-> 302', pr.status === 302, pr.status)
    const signed = pr.headers.get('location')
    ok('Location is a signed R2 URL', Boolean(signed) && signed.includes('X-Amz-Signature'), signed?.slice(0, 80))
    ok('the signed URL points at our bucket and key', signed.includes(BUCKET) && signed.includes(photoFile))

    section('the signed URL expires in 300 seconds')
    const params = new URL(signed).searchParams
    ok('X-Amz-Expires is exactly 300', params.get('X-Amz-Expires') === '300', params.get('X-Amz-Expires'))
    ok('it carries a credential and a signed-headers list', Boolean(params.get('X-Amz-Credential')) && Boolean(params.get('X-Amz-SignedHeaders')))

    section('following the redirect returns the exact bytes uploaded, INLINE')
    const fetched = await fetch(signed)
    ok('-> 200', fetched.status === 200, fetched.status)
    const disp = fetched.headers.get('content-disposition') ?? ''
    ok('Content-Disposition is INLINE, not attachment', disp.startsWith('inline'), disp)
    ok('filename is the photo file name', disp.includes(photoFile), disp)
    ok('Content-Type is image/png', (fetched.headers.get('content-type') ?? '').startsWith('image/png'), fetched.headers.get('content-type'))
    const bytes = Buffer.from(await fetched.arrayBuffer())
    ok(`bytes are byte-identical to what was uploaded (${bytes.length} B)`, bytes.equals(PNG_1x1), { got: bytes.length, expected: PNG_1x1.length })

    section('a TAMPERED signature is refused')
    const tampered = signed.replace(/X-Amz-Signature=([0-9a-f]+)/, (m, s) => `X-Amz-Signature=${s.replace(/^./, c => (c === 'a' ? 'b' : 'a'))}`)
    const tr = await fetch(tampered, { redirect: 'manual' })
    ok(`a bad signature is rejected (${tr.status})`, tr.status === 401 || tr.status === 403, tr.status)

    section('authorisation still gates the signed URL (now with R2 reachable)')
    // Create the outsider rather than hoping the seed left one behind. This is
    // the assertion that proves an unauthorised caller never receives a signed
    // URL, and it is worth the most when R2 is genuinely reachable — a SKIP here
    // would leave exactly the wrong branch unproven.
    const outsider = await prisma.users.create({
      data: {
        tenant_id: SEED.tenantA, name: 'R2 Outsider', email: 'r2-outsider@example.invalid',
        contact: '9000008888', password: '', profile: 'Standard', status: 'Active',
      },
      select: { id: true, contact: true, name: true },
    })
    if (outsider) {
      await prisma.role_permissions.upsert({
        where: { tenant_id_profile_section: { tenant_id: SEED.tenantA, profile: 'Scratch Role', section: 'expenses' } },
        create: { tenant_id: SEED.tenantA, profile: 'Scratch Role', section: 'expenses', can_view: true, can_create: false, can_edit: false, can_delete: false, data_scope: 'own' },
        update: { data_scope: 'own' },
      })
      await prisma.users.update({ where: { id: outsider.id }, data: { role_id: (await prisma.roles.findFirst({ where: { tenant_id: SEED.tenantA, name: 'Scratch Role' } })).id } })
      const outToken = await mint({ phone: outsider.contact, userId: outsider.id, name: outsider.name, role: 'Scratch Role', tenantId: SEED.tenantA, cv: 1 })
      const outRes = await fetch(`${BASE}${ub.url}`, { headers: { cookie: `${COOKIE_NAME}=${outToken}` }, redirect: 'manual' })
      ok('a user who cannot see the owner -> 403, and NO Location header', outRes.status === 403 && !outRes.headers.get('location'), { status: outRes.status, loc: outRes.headers.get('location') })
      const outBody = await outRes.text()
      ok('the 403 body leaks no signed URL and no R2 address',
        !outBody.includes('X-Amz-Signature') && !outBody.includes('r2.cloudflarestorage.com'), outBody.slice(0, 120))
      await prisma.users.deleteMany({ where: { id: outsider.id } })
    }

    const mgrRes = await fetch(`${BASE}${ub.url}`, { headers: { cookie: `${COOKIE_NAME}=${MGR}` }, redirect: 'manual' })
    ok('a manager who CAN see the owner -> 302 with a signed URL', mgrRes.status === 302 && (mgrRes.headers.get('location') ?? '').includes('X-Amz-Signature'), mgrRes.status)

    const anon = await fetch(`${BASE}${ub.url}`, { redirect: 'manual' })
    ok('an unauthenticated request never reaches a signed URL', anon.status !== 302 || !(anon.headers.get('location') ?? '').includes('X-Amz-Signature'), { status: anon.status, loc: anon.headers.get('location') })

    await prisma.expenses.deleteMany({ where: { id: expense.id } })
  } finally {
    // ===== cleanup ========================================================
    section('cleanup — every object written by this run is removed')
    const remaining = await listAll()
    for (const o of remaining) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: o.Key }))
    }
    const finalList = await listAll()
    ok(`bucket is EMPTY again (KeyCount ${finalList.length})`, finalList.length === 0, finalList.map(o => o.Key))
  }

  console.log(`\n${fail === 0 ? 'R2 VERIFICATION PASSED' : `R2 VERIFICATION FAILED — ${fail}`}   (${pass} passed, ${fail} failed)`)
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(fail ? 1 : 0) })
  .catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
