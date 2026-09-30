import { cookies } from 'next/headers'
import { COOKIE_NAME } from './session'
import { verifySessionSync } from './session-node'

/**
 * The tenant for the current request, taken from the VERIFIED session cookie.
 *
 * This used to read an `x-tenant-id` header that middleware set. That is gone,
 * and it must not come back:
 *
 *   - Middleware runs in the edge runtime and cannot read SESSION_SECRET when
 *     self-hosted, so it can no longer verify anything (see session-node.ts).
 *     A middleware that DECODED the payload without verifying it would let
 *     anyone forge a cookie naming another tenant — the payload is plain
 *     base64, not encrypted — turning a login bug into cross-tenant exposure.
 *   - And a header middleware does not set is a header a CLIENT can send. On
 *     PUBLIC routes middleware returns `next()` without stripping request
 *     headers, so trusting `x-tenant-id` was reachable from outside.
 *
 * Verifying here, in Node, closes both: the tenant id is only ever read from a
 * payload whose HMAC we have just checked.
 *
 * Stays synchronous so the 158 existing call sites are unchanged.
 *
 * THERE IS NO FALLBACK HERE. It used to fall back to DEFAULT_TENANT_ID whenever
 * verification failed, so a route that called this without requireUser()
 * answered an expired, forged or garbled cookie with the DEFAULT tenant's data
 * — another company's, for everyone not in that tenant. Once logins began to
 * expire, every timed-out user hit it in normal use. So anything short of a
 * verified payload naming a tenant now throws the same `Unauthorized` that
 * requireUser() throws: no cookie (middleware already keeps those off every
 * non-public route), a cookie that fails verification, and a verified payload
 * with no tenant (the SuperAdmin payload, which sets `userId: null` and no
 * tenantId — SuperAdmin has its own routes and never needs a tenant here).
 *
 * The public auth routes that genuinely need the default tenant use
 * getPublicTenantId() below instead.
 */
export function getTenantId(): string {
  const tenantId = verifiedTenantId()
  if (!tenantId) throw new Error('Unauthorized')
  return tenantId
}

/**
 * For the PUBLIC auth routes only — forgot-password and reset-password, which
 * run with no session by design. This is the old getTenantId(), unchanged: the
 * verified session's tenant if there is one, else DEFAULT_TENANT_ID. A stale
 * cookie falls back too, deliberately: someone whose login just expired is
 * exactly who asks for a reset, and these routes return no tenant data to the
 * caller — they act on a phone number or a reset token.
 *
 * PLAN.md §13.2 records that this fallback is why password reset only works
 * for DEFAULT_TENANT_ID. That is a pre-existing product bug and is deliberately
 * NOT changed here. NEVER call this from a route that returns tenant data.
 */
export function getPublicTenantId(): string {
  const tenantId = verifiedTenantId()
  if (tenantId) return tenantId

  const id = process.env.DEFAULT_TENANT_ID
  if (!id) throw new Error('DEFAULT_TENANT_ID env var is not set')
  return id
}

/** The tenant named by a session cookie whose HMAC and expiry have just been
 *  checked, or null. */
function verifiedTenantId(): string | null {
  const token = cookies().get(COOKIE_NAME)?.value
  if (!token) return null
  const payload = verifySessionSync(token)
  const tenantId = (payload as { tenantId?: string } | null)?.tenantId
  return tenantId || null
}
