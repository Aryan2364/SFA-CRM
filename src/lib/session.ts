// Edge-safe: uses globalThis.crypto.subtle (Web Crypto API) — no Buffer, no jose
const COOKIE_NAME = 'rgb_session'
const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' }

/** Session lifetime when SESSION_MAX_AGE_DAYS is unset or unusable. */
const DEFAULT_MAX_AGE_DAYS = 7

/**
 * Tolerance on the `exp` check, in seconds. The signing server and the
 * verifying server are the same machine today, but a token minted a
 * hair before a clock correction must not be rejected outright.
 */
const CLOCK_SKEW_SECONDS = 60

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET env var is not set')
  return secret
}

/**
 * How long a freshly minted session lasts, in seconds.
 *
 * Read per call rather than at module load: this module is imported by
 * middleware, which runs in the edge sandbox where no arbitrary env var is
 * visible (see session-node.ts). Nothing in the edge bundle calls this, but a
 * module-level read would run there anyway.
 *
 * SESSION_MAX_AGE_DAYS is server-only and must NEVER be given a
 * `NEXT_PUBLIC_` prefix — that would inline it into the browser bundle.
 */
export function sessionMaxAgeSeconds(): number {
  const raw = Number(process.env.SESSION_MAX_AGE_DAYS)
  const days = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_AGE_DAYS
  return Math.floor(days * 24 * 60 * 60)
}

/**
 * The expiry half of verification. session-node.ts carries a BYTE-FOR-BYTE
 * COPY of this function and of CLOCK_SKEW_SECONDS — CHANGE BOTH OR NEITHER.
 * (Copied rather than imported because `npm run verify:session` loads
 * session-node.ts under `node --experimental-strip-types`, which does no path
 * resolution and cannot follow a relative import; the reasoning is spelled out
 * at that copy.) The two MUST agree: a token accepted in one runtime and
 * refused in the other is a session that works on some requests and not others.
 *
 * A payload with no `exp` is expired. Every token minted before expiry existed
 * falls in that class, and those tokens are otherwise valid forever — so they
 * are rejected rather than grandfathered, which costs every logged-in user one
 * re-login at deploy and is the point of the change.
 */
export function isSessionExpired(payload: Record<string, unknown> | null): boolean {
  if (!payload) return true
  const exp = payload.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return true
  return Math.floor(Date.now() / 1000) > exp + CLOCK_SKEW_SECONDS
}

async function getKey(): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(getSecret()),
    ALGORITHM,
    false,
    ['sign', 'verify']
  )
}

function base64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let str = ''
  for (const byte of bytes) str += String.fromCharCode(byte)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlDecode(str: string): ArrayBuffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')
  const bin = atob(padded)
  const buf = new ArrayBuffer(bin.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return buf
}

/**
 * The payload half of the token, decoded: base64url → bytes → UTF-8 → JSON.
 * Throws on anything malformed, including bytes that are not valid UTF-8.
 *
 * The payload is UTF-8 bytes, not `btoa(JSON)`: `btoa` throws on any character
 * above U+00FF, so a user named in Devanagari, or "D’Souza" with a curly
 * apostrophe, got a 500 from login and could never sign in.
 *
 * Shared by verifySession() here and by middleware's unverified expiry peek.
 * session-node.ts carries a COPY — CHANGE BOTH OR NEITHER. A pre-change token
 * with an ASCII-only payload decodes identically (its standard-base64 `+ / =`
 * are accepted); one with a byte above 0x7F is not valid UTF-8 and throws, and
 * every caller turns that into a rejection.
 */
export function decodeSessionPayload(data: string): unknown {
  const bytes = new Uint8Array(base64urlDecode(data))
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

export async function signSession(payload: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder()
  // `iat`/`exp` are seconds since the epoch, the JWT convention, and are set
  // here rather than by each caller so no login route can mint an eternal
  // token by forgetting them. The cookie's maxAge is set from
  // sessionMaxAgeSeconds() at every call site, so browser and token die together.
  const issuedAt = Math.floor(Date.now() / 1000)
  // UTF-8 bytes, base64url — see decodeSessionPayload() for why not btoa().
  const data = base64urlEncode(
    enc.encode(JSON.stringify({ ...payload, iat: issuedAt, exp: issuedAt + sessionMaxAgeSeconds() }))
  )
  const key = await getKey()
  const sig = await globalThis.crypto.subtle.sign(ALGORITHM, key, enc.encode(data))
  return `${data}.${base64urlEncode(sig)}`
}

export async function verifySession(token: string): Promise<Record<string, unknown> | null> {
  try {
    const [data, sigB64] = token.split('.')
    if (!data || !sigB64) return null
    const enc = new TextEncoder()
    const key = await getKey()
    const sig = base64urlDecode(sigB64)
    const valid = await globalThis.crypto.subtle.verify(ALGORITHM, key, sig, enc.encode(data))
    if (!valid) return null
    const payload = decodeSessionPayload(data) as Record<string, unknown>
    if (isSessionExpired(payload)) return null
    return payload
  } catch {
    return null
  }
}

export { COOKIE_NAME }
