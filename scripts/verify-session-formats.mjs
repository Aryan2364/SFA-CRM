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
import { createHmac } from 'node:crypto'
import { signSession, verifySession, decodeSessionPayload } from '../src/lib/session.ts'
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
// `iat`/`exp` are added by signSession() itself, so they are in `out` and never
// in `payload`. They are excluded rather than added to the fixture because what
// this line asserts is that the CALLER's fields survive the round trip; the
// expiry pair is signSession()'s own business, and hard-coding a timestamp into
// the fixture would only make this line fail a second later.
const withoutClaims = o => {
  if (!o) return o
  const rest = { ...o }
  delete rest.iat
  delete rest.exp
  return rest
}
check('payload round-trips intact',
  JSON.stringify(withoutClaims(out)) === JSON.stringify(payload),
  `got ${JSON.stringify(out)}`)
check('tenantId survives — the value getTenantId() depends on',
  out?.tenantId === payload.tenantId)

// Names above U+00FF. signSession() used `btoa()`, which THROWS on these, so
// login answered 500 and the user was locked out for good. Each name must
// survive all three decoders: the Node verifier, the Web Crypto verifier, and
// the unverified peek middleware takes.
for (const [label, name] of [
  ['a Devanagari name', 'आर्यन जैन'],
  ['a curly apostrophe (D’Souza)', 'Maria D’Souza'],
]) {
  let t = null
  try { t = await signSession({ ...payload, name }) } catch (e) { t = null; console.log(`       signSession threw: ${e.message}`) }
  check(`${label}: signSession() does not throw`, t !== null)
  if (!t) continue
  const viaNode = verifySessionSync(t)
  const viaEdge = await verifySession(t)
  let viaPeek = null
  try { viaPeek = decodeSessionPayload(t.split('.')[0]) } catch { viaPeek = null }
  check(`${label}: round-trips through verifySessionSync()`, viaNode?.name === name, `got ${viaNode?.name}`)
  check(`${label}: round-trips through verifySession()`, viaEdge?.name === name, `got ${viaEdge?.name}`)
  check(`${label}: middleware's decode agrees`, viaPeek?.name === name, `got ${viaPeek?.name}`)
  check(`${label}: all three decoders return the same payload`,
    JSON.stringify(viaNode) === JSON.stringify(viaEdge) && JSON.stringify(viaEdge) === JSON.stringify(viaPeek))
}

// A token in the OLD encoding — `btoa(JSON)`, standard base64 with `+ / =` —
// correctly signed. It is not accepted for compatibility's sake (tokens that
// old carry no `exp` and die on that anyway); it is here to prove no decoder
// CRASHES on one. An ASCII payload must decode identically everywhere, and a
// Latin-1 one (a byte above 0x7F, which is not UTF-8) must be refused cleanly.
const legacyToken = p => {
  const d = Buffer.from(JSON.stringify(p), 'latin1').toString('base64')
  return `${d}.${createHmac('sha256', process.env.SESSION_SECRET).update(d, 'utf8').digest('base64url')}`
}
const future = Math.floor(Date.now() / 1000) + 3600
// `?>?>` makes the old encoding emit `/` and `+`, the characters the two
// alphabets disagree on.
const legacyAscii = legacyToken({ ...payload, name: 'x?>?>~~', exp: future })
check('old-encoding token actually contains + or / (the case under test)', /[+/]/.test(legacyAscii.split('.')[0]))
{
  const a = verifySessionSync(legacyAscii)
  const b = await verifySession(legacyAscii)
  let c = null
  try { c = decodeSessionPayload(legacyAscii.split('.')[0]) } catch { c = 'threw' }
  check('old-encoding ASCII token decodes identically in all three',
    a?.name === 'x?>?>~~' && JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(b) === JSON.stringify(c),
    `node=${JSON.stringify(a)} edge=${JSON.stringify(b)} peek=${JSON.stringify(c)}`)
}
const legacyLatin1 = legacyToken({ ...payload, name: 'José', exp: future })
{
  let crashed = false, a, b
  try { a = verifySessionSync(legacyLatin1); b = await verifySession(legacyLatin1) } catch { crashed = true }
  check('old-encoding Latin-1 token is rejected cleanly by both verifiers', !crashed && a === null && b === null)
  let peekThrew = false
  try { decodeSessionPayload(legacyLatin1.split('.')[0]) } catch { peekThrew = true }
  // middleware wraps the peek in try/catch, so a throw is a clean refusal there
  check('middleware\'s decode refuses it (throws, caught by its caller)', peekThrew)
}

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
