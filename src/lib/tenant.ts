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
 */
export function getTenantId(): string {
  const token = cookies().get(COOKIE_NAME)?.value
  if (token) {
    const payload = verifySessionSync(token)
    const tenantId = (payload as { tenantId?: string } | null)?.tenantId
    if (tenantId) return tenantId
  }

  // No session, or a session carrying no tenant (the SuperAdmin payload sets
  // `userId: null` and no tenantId). The public auth routes — forgot-password
  // and reset-password — reach here by design; PLAN.md §13.2 records that this
  // fallback is why password reset only works for DEFAULT_TENANT_ID. That is a
  // pre-existing product bug and is deliberately NOT changed here.
  const id = process.env.DEFAULT_TENANT_ID
  if (!id) throw new Error('DEFAULT_TENANT_ID env var is not set')
  return id
}
