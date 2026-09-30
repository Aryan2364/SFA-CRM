// The auth API routes that must answer without a live session: they are how a
// session starts, ends or is recovered. Shared by middleware (which lets them
// through with no session check) and src/lib/session-expiry.ts (which never
// treats their 401 as "the session is over"), so the two lists cannot drift.
//
// No 'use client' and no imports: middleware runs in the edge runtime and
// session-expiry.ts runs in the browser, and both import this.
export const PUBLIC_AUTH_API_PATHS = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
]
