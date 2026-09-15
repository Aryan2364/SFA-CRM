// Node-runtime session verification.
//
// WHY THIS EXISTS, separately from src/lib/session.ts:
//
// `session.ts` is written against the Web Crypto API so it can run in the EDGE
// runtime, where middleware lives. But a self-hosted `next start` does not
// inject arbitrary env vars into the edge sandbox — `.next/server/middleware-
// manifest.json` carries an allowlist containing only `__NEXT_*` keys — so
// `process.env.SESSION_SECRET` is `undefined` there. On Vercel it is injected,
// which is why this never surfaced before the move to EC2: every valid session
// was rejected by middleware, producing a login -> redirect -> login loop while
// the login endpoint itself returned a perfectly good 200.
//
// The fix is to stop verifying in the edge runtime at all. Verification now
// happens in Node, where the secret is genuinely available. This module is the
// Node half.
//
// IT MUST NEVER BE IMPORTED BY MIDDLEWARE or anything else that ends up in the
// edge bundle — `node:crypto` is not available there and the build will break.
//
// The wire format is identical to `signSession()` in session.ts, and
// `scripts/verify-session-formats.mjs` asserts that the two agree:
//   token     = base64(JSON.stringify(payload)) + "." + base64url(HMAC-SHA256)
//   signature = HMAC-SHA256(SESSION_SECRET, utf8(base64 payload))
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify a session token and return its payload, or `null` if the signature
 * does not match.
 *
 * Synchronous on purpose. `getTenantId()` is called from 158 sites and is sync;
 * making verification async would have turned a three-file fix into a
 * hundred-file one for no benefit.
 */
export function verifySessionSync(token: string): Record<string, unknown> | null {
  // Deliberately OUTSIDE the try below. A missing secret is a deployment fault,
  // not a bad token, and swallowing it into `null` is precisely the bug this
  // module exists to fix — it would resurface as the same silent redirect loop.
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET env var is not set')

  try {
    const [data, sigB64] = token.split('.')
    if (!data || !sigB64) return null

    const expected = createHmac('sha256', secret).update(data, 'utf8').digest()
    const given = Buffer.from(sigB64, 'base64url')
    // timingSafeEqual throws on a length mismatch, so check first.
    if (given.length !== expected.length) return null
    if (!timingSafeEqual(given, expected)) return null

    // `latin1`, not `utf8`: signSession() encodes with `btoa()`, which produces
    // a binary string. Decoding as utf8 would corrupt any byte above 0x7F.
    return JSON.parse(Buffer.from(data, 'base64').toString('latin1'))
  } catch {
    return null
  }
}
