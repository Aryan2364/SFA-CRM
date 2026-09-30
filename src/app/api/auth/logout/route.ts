import { NextResponse } from 'next/server'
import { COOKIE_NAME } from '@/lib/session'

/**
 * Clearing the cookie is the whole of logout, and it is enough here BECAUSE
 * tokens now expire: the cookie is the only copy the browser holds, and the
 * token it held dies on its own within SESSION_MAX_AGE_DAYS.
 *
 * What this does NOT do is revoke the token server-side. A copy captured off
 * the wire before logout stays valid until its `exp`. Closing that needs a
 * revocation list (a denylist of jti, or a per-session counter beside
 * credentials_version) and is deliberately out of scope here. The blunt
 * instrument that already exists: bumping `users.credentials_version` kills
 * every session for that account at once — see requireUser() in src/lib/auth.ts.
 *
 * The attributes below must MATCH the ones the cookie was set with in
 * auth/login — a browser discards a clear whose path, domain or `secure` differ
 * from the original, which leaves the user holding a live session after being
 * told they are signed out.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}
