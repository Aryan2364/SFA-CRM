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
//   token     = base64url(utf8(JSON.stringify(payload))) + "." + base64url(HMAC-SHA256)
//   signature = HMAC-SHA256(SESSION_SECRET, the base64url payload string)
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The expiry rule, and it is a DELIBERATE COPY of `isSessionExpired()` in
 * session.ts — CHANGE BOTH OR NEITHER. A token that is live in one runtime and
 * dead in the other is a session that works on some requests and not others,
 * which is the same class of bug as the wire-format mismatch this module's
 * header describes.
 *
 * It is copied rather than imported because this module is loaded directly by
 * `npm run verify:session` under `node --experimental-strip-types`, which does
 * no path resolution: a relative `./session` import resolves under webpack and
 * fails there, taking the cross-check script with it.
 *
 * A payload with no `exp` is expired. Every token minted before expiry existed
 * falls in that class, and those tokens are otherwise valid forever — so they
 * are rejected rather than grandfathered.
 */
const CLOCK_SKEW_SECONDS = 60

function isSessionExpired(payload: Record<string, unknown> | null): boolean {
  if (!payload) return true
  const exp = payload.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return true
  return Math.floor(Date.now() / 1000) > exp + CLOCK_SKEW_SECONDS
}

/**
 * The payload half of the token, decoded: base64url → bytes → UTF-8 → JSON.
 * A DELIBERATE COPY of `decodeSessionPayload()` in session.ts — CHANGE BOTH OR
 * NEITHER, for the same reasons as isSessionExpired() above.
 *
 * `fatal: true` so bytes that are not valid UTF-8 THROW rather than decode to
 * U+FFFD, exactly as the Web Crypto half does; Buffer's own `utf8` decoding is
 * lenient and would let the two disagree. Node's `base64url` decoder also
 * accepts standard base64, so a pre-change ASCII token decodes the same here
 * as it does there.
 */
function decodeSessionPayload(data: string): unknown {
  const bytes = Buffer.from(data, 'base64url')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

/**
 * Verify a session token and return its payload, or `null` if the signature
 * does not match or the token has expired.
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

    const payload = decodeSessionPayload(data) as Record<string, unknown>
    if (isSessionExpired(payload)) return null
    return payload
  } catch {
    return null
  }
}
