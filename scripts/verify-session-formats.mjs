#!/usr/bin/env node
/**
 * Proves the two session implementations agree on the wire format.
 *
 * `src/lib/session.ts` signs with Web Crypto (edge-safe). `src/lib/session-node.ts`
 * verifies with node:crypto (Node-only). If they ever disagree, every request
 * silently 307s to /login — which is exactly the production bug this pair was
 * written to fix, so the agreement is asserted rather than assumed.
 *
 * Run:  node --experimental-strip-types scripts/verify-session-formats.mjs
 *       (or `npm run verify:session`)
 */
import { signSession } from '../src/lib/session.ts'
import { verifySessionSync } from '../src/lib/session-node.ts'

process.env.SESSION_SECRET ||= 'test-secret-at-least-32-characters-long-ok'

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

const payload = {
  phone: '7878038514',
  userId: '40000000-0000-4000-8000-000000000001',
  name: 'RGB SFA',
  role: 'Administrator',
  tenantId: '00000000-0000-0000-0000-000000000001',
  cv: 1,
}

console.log('session format cross-check')

const token = await signSession(payload)
const out = verifySessionSync(token)

check('a signSession() token verifies', out !== null)
check('payload round-trips intact', JSON.stringify(out) === JSON.stringify(payload),
  `got ${JSON.stringify(out)}`)
check('tenantId survives — the value getTenantId() depends on',
  out?.tenantId === payload.tenantId)

// Tampering must fail. These are the assertions that make the verifier a
// security control rather than a decoder.
const [data, sig] = token.split('.')
const forged = Buffer.from(JSON.stringify({ ...payload, tenantId: 'other-tenant' }))
  .toString('base64')

check('tampered PAYLOAD is rejected', verifySessionSync(`${forged}.${sig}`) === null)
check('tampered SIGNATURE is rejected',
  verifySessionSync(`${data}.${'A'.repeat(sig.length)}`) === null)
check('truncated token is rejected', verifySessionSync(data) === null)
check('empty token is rejected', verifySessionSync('') === null)

// A different secret must not validate, or rotation would be meaningless.
const realSecret = process.env.SESSION_SECRET
process.env.SESSION_SECRET = 'a-completely-different-secret-32-chars-min'
check('token signed with another secret is rejected', verifySessionSync(token) === null)
process.env.SESSION_SECRET = realSecret

// A missing secret must THROW, not return null. Returning null here is the
// original bug: it presents as "bad token" and loops the user back to /login
// with nothing in the log.
delete process.env.SESSION_SECRET
let threw = false
try { verifySessionSync(token) } catch { threw = true }
check('missing SESSION_SECRET THROWS rather than returning null', threw)
process.env.SESSION_SECRET = realSecret

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
