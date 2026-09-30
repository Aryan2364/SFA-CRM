/**
 * Mints a test session through the APP'S OWN signer, `signSession()` in
 * src/lib/session.ts.
 *
 * Every write-path suite, verify-r2 and the smoke suites used to hand-roll the
 * token (`btoa(JSON.stringify(payload))` + an HMAC). That copy drifted the
 * moment session.ts started adding `iat`/`exp`: the tokens carried no `exp`,
 * the app rejected them as expired, and every suite hit its SAFETY ABORT. The
 * payload encoding is changing too. Signing through the real function keeps
 * the encoding and the `iat`/`exp` claims identical to what login mints; the
 * caller still supplies `cv` (the credentials version), as login does.
 *
 * Loading a `.ts` file from a `.mjs` one needs Node's type stripping: on by
 * default from Node 22.18 / 23.6, behind `--experimental-strip-types` before
 * that (the flag `npm run verify:session` already passes). session.ts must
 * therefore keep importing nothing by a bare relative path, the same
 * constraint verify-session-formats.mjs already places on it.
 */

let signSessionFn

/**
 * @param {Record<string, unknown>} payload  the claims, WITHOUT iat/exp
 * @param {string | undefined} secret        the server's SESSION_SECRET
 */
export async function mintSession(payload, secret) {
  if (!secret) throw new Error('SESSION_SECRET is not set (env or .env.local); cannot mint a test session.')
  if (!signSessionFn) {
    try {
      ;({ signSession: signSessionFn } = await import('../src/lib/session.ts'))
    } catch (e) {
      console.error('Could not load src/lib/session.ts. Node 22.18+ loads .ts files natively;')
      console.error('on an older Node, rerun with: node --experimental-strip-types <script>')
      throw e
    }
  }
  // signSession() reads the secret from the environment on every call. This is
  // the test process's own environment, not the server's.
  process.env.SESSION_SECRET = secret
  return signSessionFn(payload)
}

let verifySessionFn

/**
 * Decode a token the SERVER issued (e.g. from a Set-Cookie), through the app's
 * own verifier in src/lib/session-node.ts. Returns the payload, or null when
 * the signature does not match or the token has expired. Decoding by hand
 * would re-create the drift this file exists to prevent.
 */
export async function readSession(token, secret) {
  if (!secret) throw new Error('SESSION_SECRET is not set (env or .env.local); cannot read a session.')
  if (!verifySessionFn) ({ verifySessionSync: verifySessionFn } = await import('../src/lib/session-node.ts'))
  process.env.SESSION_SECRET = secret
  return verifySessionFn(token)
}
