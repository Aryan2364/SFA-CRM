import { cookies } from 'next/headers'
import { verifySession, COOKIE_NAME } from './session'
import { prisma } from './db'

export type SessionUser = {
  phone: string
  userId: string | null
  name: string
  role: string
  tenantId: string
  cv?: number
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null
  const payload = await verifySession(token)
  if (!payload) return null
  return payload as SessionUser
}

type TenantHealth = { is_active: boolean; payment_status: string }

/**
 * A firm's `{ is_active, payment_status }`, cached per tenant for 30 seconds.
 *
 * THE ONLY MODULE-LEVEL CACHE IN THE AUTH PATH, and it exists for throughput:
 * without it, every requireUser() would hold a second connection (against
 * `connection_limit=5`) just to re-read two columns that change a few times a
 * year. The price is that a SuperAdmin suspending or disabling a firm takes
 * effect on its live sessions within 30 seconds, not instantly.
 *
 * Why it is safe: it is keyed by tenant id and holds nothing but those two
 * flags — no user, no role, no credentials — so one firm's entry can only ever
 * answer for that firm, and credentials_version is still read fresh on every
 * call. A tenant row that does not exist is cached as `null` ("refuses
 * nothing", as login treats it). A lookup that FAILS throws and is never
 * cached, so a database blip is retried on the next request rather than
 * remembered. Per process: each server instance keeps its own copy.
 */
const TENANT_HEALTH_TTL_MS = 30_000
const tenantHealthCache = new Map<string, { value: TenantHealth | null; expiresAt: number }>()

/**
 * Drop a firm's cached health, so a SuperAdmin's change to `is_active` or
 * `payment_status` applies on the next request rather than after the TTL — in
 * both directions: a reactivated firm is not bounced to login by a stale
 * "suspended", and a suspension bites at once. PER PROCESS: it clears this
 * server's copy only; any other instance keeps its entry until the 30s expire.
 */
export function evictTenantHealth(tenantId: string): void {
  tenantHealthCache.delete(tenantId)
}

async function tenantHealth(tenantId: string): Promise<TenantHealth | null> {
  const hit = tenantHealthCache.get(tenantId)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  const value = await prisma.tenants.findUnique({
    where: { id: tenantId },
    select: { is_active: true, payment_status: true },
  })
  tenantHealthCache.set(tenantId, { value, expiresAt: Date.now() + TENANT_HEALTH_TTL_MS })
  return value
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')

  if (user.userId) {
    // Declared out here so the credentials check below can tell "the lookup
    // failed" from "the lookup said no". Only a lookup that actually answered
    // may kill a session — a database blip must not log the whole firm out.
    let data: {
      profile: string | null
      status: string | null
      credentials_version: number
      roles: { name: string } | null
    } | null = null
    let tenant: TenantHealth | null = null
    let lookupSucceeded = false

    try {
      // Lookup by primary key, exactly as before. `roles` is a to-one relation,
      // so this is a single object (or null) — not an array (PLAN.md §5.2).
      // A missing row yields `null` here, matching the old client's .single() error
      // path, which also left `data` null and fell through to 'NoRole'.
      //
      // `credentials_version` rides along in the query that was already being
      // made, so revocation costs no extra round-trip.
      //
      // The firm's health is read alongside it, in parallel so it adds no
      // latency, and usually from tenantHealth()'s 30s cache so it adds no
      // query either. It cannot ride in the same query: prisma/schema.prisma
      // has no users → tenants relation. The tenant is the one the signed token
      // names, which is the tenant every route scopes by (getTenantId()).
      ;[data, tenant] = await Promise.all([
        prisma.users.findUnique({
          where: { id: user.userId },
          select: {
            profile: true,
            status: true,
            credentials_version: true,
            roles: { select: { name: true } },
          },
        }),
        user.tenantId ? tenantHealth(user.tenantId) : Promise.resolve(null),
      ])
      lookupSucceeded = true
    } catch {
      // Fall back to session role if DB lookup fails
    }

    // A password reset bumps credentials_version, so a token minted before it
    // no longer matches and every session held by the old password is dead on
    // its next request. Deliberately outside the try: this throw is the point,
    // and the catch above would have swallowed it.
    if (lookupSucceeded && data && user.cv !== undefined && data.credentials_version !== user.cv) {
      throw new Error('Unauthorized')
    }

    // A firm disabled or suspended by the SuperAdmin loses its live sessions
    // too, not just new logins. The same test as denialFor() in
    // /api/auth/login — `is_active` false, or `payment_status` 'Suspended', and
    // a missing tenant row refuses nothing — so the user lands on login and is
    // shown the reason there. Outside the try for the same reason as above.
    if (lookupSucceeded && tenant && (!tenant.is_active || tenant.payment_status === 'Suspended')) {
      throw new Error('Unauthorized')
    }

    if (data?.status === 'Inactive') {
      user.role = 'Deactivated'
    } else if (data?.profile === 'Administrator') {
      user.role = 'Administrator'
    } else if (lookupSucceeded) {
      const roleName = data?.roles?.name
      user.role = roleName ?? 'NoRole'
    }
  }

  return user
}
