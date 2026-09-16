import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME } from '@/lib/session'

// Middleware runs in the EDGE runtime, and a self-hosted `next start` does not
// inject SESSION_SECRET into the edge sandbox (only `__NEXT_*` keys are
// allowlisted in .next/server/middleware-manifest.json). So middleware CANNOT
// verify a session here, and must not pretend to: it previously called
// verifySession(), which threw on the missing secret, was swallowed into
// `null`, and redirected every valid login back to /login. On Vercel the secret
// IS injected, which is why this only appeared after the move to EC2.
//
// So this file now does ONE job: redirect requests that carry no session cookie
// at all. It is a UX guard, not a security boundary.
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

const PUBLIC = ['/login', '/reset-password', '/api/auth/login', '/api/auth/logout', '/api/auth/forgot-password', '/api/auth/reset-password']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const hasSession = Boolean(req.cookies.get(COOKIE_NAME)?.value)

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
    return NextResponse.next()
  }

  if (pathname === '/api/superadmin/auth/login') return NextResponse.next()

  if (pathname.startsWith('/api/superadmin/')) {
    // 401 for no cookie; the route itself answers 403 for a valid session that
    // is not a SuperAdmin, exactly as before.
    if (!hasSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.next()
  }

  // ── Regular public routes ────────────────────────────────────────
  if (PUBLIC.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  // ── Regular protected routes ─────────────────────────────────────
  if (!hasSession) return NextResponse.redirect(new URL('/login', req.url))
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|site.webmanifest).*)'],
}
