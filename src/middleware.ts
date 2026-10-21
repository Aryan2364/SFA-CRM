import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME, decodeSessionPayload, isSessionExpired } from '@/lib/session'
import { PUBLIC_AUTH_API_PATHS } from '@/lib/auth-paths'

// Middleware runs in the EDGE runtime, and a self-hosted `next start` does not
// inject SESSION_SECRET into the edge sandbox (only `__NEXT_*` keys are
// allowlisted in .next/server/middleware-manifest.json). So middleware CANNOT
// verify a session here, and must not pretend to: it previously called
// verifySession(), which threw on the missing secret, was swallowed into
// `null`, and redirected every valid login back to /login. On Vercel the secret
// IS injected, which is why this only appeared after the move to EC2.
//
// So this file now does ONE job: redirect requests that carry no session cookie
// at all — and, by decoding (never verifying) the payload, turn away a cookie
// that has visibly expired: a redirect for a page, a 401 for an API call. It is
// a UX guard, not a security boundary.
//
// THE SECURITY BOUNDARY IS IN NODE, and was already:
//   - requireUser() (src/lib/auth.ts) verifies the token AND re-resolves the
//     caller's role from the database, so a role forged into a cookie has no
//     effect — covered by the forged-cookie tests in the smoke suite.
//   - getTenantId() (src/lib/tenant.ts) verifies the cookie itself and reads
//     the tenant from the verified payload.
//   - Every /api/superadmin/* route calls its own requireSuperAdmin(), which
//     checks `role === 'SuperAdmin'` via getCurrentUser() and returns 403
//     otherwise. Verified across all six data routes before this change.
//
// DO NOT reintroduce an `x-tenant-id` request header here. Setting it from an
// unverified payload would let anyone forge a cookie naming another tenant and
// read that tenant's data. See the note in src/lib/tenant.ts.
//
// DO NOT try to fix this by inlining the secret via next.config.mjs `env: {}`
// either — that bakes it into the image layers and makes rotation a rebuild.

// /offline: the phone's service worker caches it as the no-connection screen. It
// must be the real page even when the session has lapsed, or the login page is
// cached in its place. It reads no data.
const PUBLIC = ['/login', '/reset-password', '/offline', ...PUBLIC_AUTH_API_PATHS]

/**
 * Has this cookie's payload already passed its `exp`?
 *
 * READ THIS BEFORE CHANGING IT. The payload is plain base64url and is NOT
 * verified here — it cannot be, for the reason above. So this is an extension
 * of the presence check, not a security check, and it is safe only because it
 * can only ever REJECT: forging a distant `exp` buys nothing, since Node
 * verifies the signature AND the same `exp` (src/lib/session.ts) before any
 * data is returned. It exists so an expired tab gets a clean trip to the login
 * screen instead of rendering a shell in which every call answers 401.
 *
 * Anything unreadable - no payload, not JSON, no numeric `exp` - is reported
 * as NOT expired, so a token this cannot parse keeps today's behaviour and
 * falls through to Node. Tokens minted before `exp` existed are in that class:
 * Node rejects them, and the browser's 401 handler takes it from there.
 */
function isPayloadExpired(token: string): boolean {
  try {
    const [data] = token.split('.')
    if (!data) return false
    const exp = (decodeSessionPayload(data) as { exp?: unknown } | null)?.exp
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return false
    // The 60s skew tolerance lives in session.ts. This guard is cosmetic and
    // only ever defers to Node, so it does not need to match to the second.
    return Math.floor(Date.now() / 1000) > exp + 60
  } catch {
    return false
  }
}

/**
 * Is this cookie one Node would certainly refuse on expiry grounds? The API
 * counterpart of isPayloadExpired() above, and deliberately STRICTER: anything
 * unreadable counts as dead, and so does a payload with no `exp`.
 *
 * The same framing applies — the payload is NOT verified, so this can only
 * ever REJECT. It uses session.ts's own isSessionExpired(), the exact rule Node
 * applies after checking the signature (SuperAdmin tokens are minted by the
 * same signSession() and carry the same `exp`), so it refuses nothing Node
 * would accept. A forged signature or a stale credentials_version still passes
 * here and is caught by requireUser() in Node.
 *
 * Pages keep the lenient rule above; only API calls use this one, because an
 * API call is answered with a 401 the browser handler acts on
 * (src/lib/session-expiry.ts), not with a redirect.
 */
function isApiSessionDead(token: string): boolean {
  try {
    const [data] = token.split('.')
    if (!data) return true
    const payload = decodeSessionPayload(data)
    if (!payload || typeof payload !== 'object') return true
    return isSessionExpired(payload as Record<string, unknown>)
  } catch {
    return true
  }
}

/** A 401 for an API call with no session or a dead one. Never a redirect:
 *  `fetch` follows a 302 and would hand the calling screen a 200 of login HTML
 *  instead of the 401 it is watching for.
 *
 *  The dead cookie is deliberately NOT cleared. This response answers a
 *  request that may have left long before it arrives — a screen polling in a
 *  stale tab — and a Set-Cookie that lands after the user has signed in again
 *  in another tab would wipe the NEW session. Leaving it costs nothing: every
 *  call carrying it gets this same 401, and the next login overwrites it. */
function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/** Redirect to `to`, clearing the dead cookie on the way so the next request
 *  does not repeat the round trip. */
function expire(req: NextRequest, to: string, next?: string): NextResponse {
  const url = new URL(to, req.url)
  // `next` is this app's own pathname, taken from the request, never from
  // anything a caller supplied - so there is no open redirect to build here.
  if (next && next !== '/') url.searchParams.set('next', next)
  const res = NextResponse.redirect(url)
  res.cookies.set(COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const cookie = req.cookies.get(COOKIE_NAME)?.value
  const hasSession = Boolean(cookie)
  // An expired cookie is a cookie, so `hasSession` alone would wave it through.
  // Only page navigations act on this: an /api/* request must never be
  // redirected, because `fetch` FOLLOWS a 302 and would hand the calling screen
  // a 200 full of login HTML instead of the 401 it is watching for
  // (src/lib/session-expiry.ts). API calls answer 401 via isApiSessionDead().
  const expired = Boolean(cookie) && isPayloadExpired(cookie as string)

  // /kitchen-sink is the component reference page (AGENTS.md 2.2 brand swap
  // test and 6.4 state matrix). It holds no data and needs no session, but it
  // is NOT public: outside development it does not exist at all, so it can
  // never be reached on a deployed environment even by an authenticated user.
  // state-matrix-check.tsx compiles away outside development for the same
  // reason.
  if (pathname === '/kitchen-sink' || pathname.startsWith('/kitchen-sink/')) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.rewrite(new URL('/404', req.url))
    }
    return NextResponse.next()
  }

  // ── Super Admin routes ──────────────────────────────────────────
  if (pathname === '/superadmin' || pathname.startsWith('/superadmin/')) {
    if (pathname === '/superadmin/login') return NextResponse.next()
    // Presence only. The role check lives in each /api/superadmin/* route, so a
    // non-SuperAdmin reaching a page here gets a shell whose every data call
    // answers 403 — degraded, not a leak.
    if (!hasSession) return NextResponse.redirect(new URL('/superadmin/login', req.url))
    if (expired) return expire(req, '/superadmin/login')
    return NextResponse.next()
  }

  // The cron route authenticates itself (Bearer CRON_SECRET, constant-time) and
  // never accepts a session, so it needs no cookie here. Exactly this prefix.
  if (pathname === '/api/cron' || pathname.startsWith('/api/cron/')) return NextResponse.next()

  if (pathname === '/api/superadmin/auth/login') return NextResponse.next()

  if (pathname.startsWith('/api/superadmin/')) {
    // 401 for no cookie; the route itself answers 403 for a valid session that
    // is not a SuperAdmin, exactly as before.
    if (!hasSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (isApiSessionDead(cookie as string)) return unauthorized()
    return NextResponse.next()
  }

  // ── Regular public routes ────────────────────────────────────────
  if (PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  // ── Regular protected routes ─────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    // An API never answers with login HTML: no cookie and a dead cookie are
    // both a 401, which the browser handler turns into the trip to login.
    if (!hasSession || isApiSessionDead(cookie as string)) return unauthorized()
    return NextResponse.next()
  }
  if (!hasSession) return NextResponse.redirect(new URL('/login', req.url))
  if (expired) return expire(req, '/login', `${pathname}${req.nextUrl.search}`)
  return NextResponse.next()
}

export const config = {
  // sw.js / sw-push.js: the browser fetches a service worker WITHOUT credentials
  // semantics we can rely on, and a redirect to /login makes registration fail.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|site.webmanifest|sw.js|sw-push.js).*)'],
}
