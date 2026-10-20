import { NextRequest, NextResponse } from 'next/server'
import { requireUser, type SessionUser } from '@/lib/auth'
import { prisma, dbErrorResult } from '@/lib/db'
import { signSession, sessionMaxAgeSecondsFor, COOKIE_NAME } from '@/lib/session'
import { getRequestLayout } from '@/lib/layout.server'
import { getTenantId } from '@/lib/tenant'
import bcrypt from 'bcryptjs'
import { PASSWORD_TOO_SHORT, passwordTooShort } from '@/lib/password-policy'

/**
 * A signed-in user changing their own password.
 *
 * The update increments credentials_version, so every session minted under the
 * old password — on every other device — fails requireUser() on its next
 * request. The device that made the change is re-issued a session carrying the
 * new version, built exactly as /api/auth/login builds one, so it stays signed in.
 *
 * `field` on a 400 names the form field the message is about, so the screen can
 * put it under that field rather than in a banner.
 */
export async function POST(req: NextRequest) {
  let user: SessionUser
  let tid: string
  let userId: string
  try {
    user = await requireUser()
    tid = getTenantId()
    // A SuperAdmin session carries no tenant, so getTenantId() has already
    // thrown for it; there was a separate 403 for it here that nothing could
    // reach. A session naming no user row has no password to change either,
    // and gets the same 401.
    if (!user.userId) throw new Error('Unauthorized')
    userId = user.userId
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (user.role === 'Deactivated')
    return NextResponse.json({ error: 'Account is inactive. Contact your administrator.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { currentPassword, newPassword } = body ?? {}

  if (typeof currentPassword !== 'string' || !currentPassword)
    return NextResponse.json({ error: 'Enter your current password.', field: 'currentPassword' }, { status: 400 })
  // The shared minimum (see `password-policy`), and no stricter.
  if (typeof newPassword !== 'string' || passwordTooShort(newPassword))
    return NextResponse.json({ error: PASSWORD_TOO_SHORT, field: 'newPassword' }, { status: 400 })

  // Prisma throws where the old client returned errors as values; every DB failure
  // here leaves through dbErrorResult(), which maps the status and never
  // returns the raw text.
  try {
    const row = await prisma.users.findFirst({
      where: { id: userId, tenant_id: tid },
      select: {
        id: true,
        name: true,
        profile: true,
        contact: true,
        password: true,
        tenant_id: true,
        credentials_version: true,
        roles: { select: { name: true } },
      },
    })
    if (!row) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verified the way login verifies: bcrypt for a hash, and a straight compare
    // for a legacy cleartext row — which this update then migrates to a hash.
    const isValid = row.password?.startsWith('$2')
      ? await bcrypt.compare(currentPassword, row.password)
      : row.password === currentPassword
    if (!isValid)
      return NextResponse.json({ error: 'Your current password is incorrect.', field: 'currentPassword' }, { status: 400 })

    if (newPassword === currentPassword)
      return NextResponse.json({ error: 'Choose a password different from your current one.', field: 'newPassword' }, { status: 400 })

    const hash = await bcrypt.hash(newPassword, 12)
    const nextVersion = row.credentials_version + 1
    // Conditional on the version just read, so the version put into the new
    // token below is exactly the one stored. If a reset or an administrator's
    // edit landed in between, nothing is written and the user is asked to retry.
    //
    // Any reset link emailed before this change dies in the same write: left
    // alive, it would let whoever holds that email set the password all over
    // again — the very thing someone changing a password they suspect is known
    // is trying to stop. The same two columns reset-password clears.
    const { count } = await prisma.users.updateMany({
      where: { id: row.id, tenant_id: tid, credentials_version: row.credentials_version },
      data: {
        password: hash,
        credentials_version: nextVersion,
        password_reset_token: null,
        password_reset_expires: null,
      },
    })
    if (count === 0)
      return NextResponse.json({ error: 'Your account changed while this was saving. Try again.' }, { status: 409 })

    // The same payload, cookie name, attributes and maxAge as /api/auth/login.
    const effectiveRole =
      row.profile === 'Administrator' ? 'Administrator' : (row.roles?.name ?? 'NoRole')
    const maxAge = sessionMaxAgeSecondsFor(getRequestLayout(req))
    const token = await signSession({
      phone: row.contact,
      userId: row.id,
      name: row.name,
      role: effectiveRole,
      tenantId: row.tenant_id,
      cv: nextVersion,
    }, maxAge)
    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge })
    return res
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
