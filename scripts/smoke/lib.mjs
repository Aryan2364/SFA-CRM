/**
 * Shared helpers for the smoke suites. Each batch adds a module under
 * scripts/smoke/<batch>.mjs exporting { name, run }; the runner discovers them,
 * so adding a batch never means editing the runner.
 */
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { mintSession as mintTestSession } from '../test-session.mjs'
import { MASTER_SECTION_KEYS } from '../../src/lib/masters-registry.ts'

// TLS for this harness. It reads LIVE production data, so it verifies the
// certificate rather than passing rejectUnauthorized:false as it used to --
// same policy and same variable as the app (src/lib/db.ts), so a CA that works
// for one works for the other. Fails closed: no CA, no connection.
function sslSetting(sslmode) {
  if (!sslmode || sslmode === 'disable') return undefined
  const caPath = process.env.DATABASE_CA_CERT_PATH ?? readEnv('DATABASE_CA_CERT_PATH')
  if (!caPath || !fs.existsSync(caPath)) {
    throw new Error(
      `This connection requires SSL but no CA certificate was found` +
        `${caPath ? ` at "${caPath}"` : ` (DATABASE_CA_CERT_PATH is not set)`}. ` +
        `For RDS use certs/rds-global-bundle.pem. See .env.example.`
    )
  }
  return { ca: fs.readFileSync(caPath), rejectUnauthorized: true }
}

/**
 * Opt-in scratch mode: `node scripts/smoke-test.mjs --scratch` (or
 * SMOKE_SCRATCH=1). The DEFAULT is unchanged — smoke reads DATABASE_URL, the
 * live database, because proving real data shapes is its job (CLAUDE.md). In
 * scratch mode the suites read SCRATCH_DATABASE_URL instead, refuse any
 * non-local host, and default to the scratch dev server on :3012.
 */
export const SCRATCH = process.argv.includes('--scratch') || process.env.SMOKE_SCRATCH === '1'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export const BASE = process.env.SMOKE_BASE_URL ?? (SCRATCH ? 'http://127.0.0.1:3012' : 'http://127.0.0.1:3011')
export const COOKIE_NAME = 'rgb_session'

export function readEnv(key) {
  const text = fs.readFileSync('.env.local', 'utf8')
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
}

let _prisma
export function db() {
  if (_prisma) return _prisma
  let url
  if (SCRATCH) {
    const raw = process.env.SCRATCH_DATABASE_URL ?? readEnv('SCRATCH_DATABASE_URL')
    if (!raw) throw new Error('--scratch: SCRATCH_DATABASE_URL is not set (env or .env.local).')
    url = new URL(raw)
    // Hard guard. Scratch mode exists so smoke can run WITHOUT touching a hosted
    // database; a scratch URL that is not local defeats the point.
    if (!LOCAL_HOSTS.has(url.hostname))
      throw new Error(`REFUSING TO RUN: --scratch but SCRATCH_DATABASE_URL points at "${url.hostname}", not a local host.`)
  } else {
    url = new URL(process.env.DATABASE_URL ?? readEnv('DATABASE_URL'))
  }
  const sslmode = url.searchParams.get('sslmode')
  url.searchParams.delete('sslmode')
  url.searchParams.delete('connection_limit')
  _prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url.toString(),
      ssl: sslSetting(sslmode),
      max: 5,
    }),
  })
  return _prisma
}

export async function disconnect() {
  if (_prisma) await _prisma.$disconnect()
}

/**
 * Mint a session cookie with the app's own HMAC scheme (src/lib/session.ts).
 * Used so protected routes can be exercised as a specific real user without
 * needing that person's password. The signing key is the app's own
 * SESSION_SECRET, so these are genuine sessions, not a bypass. Signed by
 * signSession() itself (via ../test-session.mjs), so iat/exp and the payload
 * encoding always match what login mints.
 */
export const mintSession = payload => mintTestSession(payload, readEnv('SESSION_SECRET'))

export function req(path, { token, method = 'GET', body } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(token ? { cookie: `${COOKIE_NAME}=${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

/**
 * The viewer's permissions as the server will resolve them: the role
 * requireUser() derives from the users row (Inactive -> Deactivated, profile
 * Administrator -> Administrator, else the linked role's name or NoRole), then
 * checkPermission()'s `view` and getDataScope()'s scope over role_permissions.
 * Read-only.
 */
export async function viewerPermissions(prisma, userId, tenantId) {
  const u = await prisma.users.findUnique({
    where: { id: userId },
    select: { profile: true, status: true, roles: { select: { name: true } } },
  })
  const role = u?.status === 'Inactive' ? 'Deactivated'
    : u?.profile === 'Administrator' ? 'Administrator'
    : (u?.roles?.name ?? 'NoRole')
  const rows = role === 'Administrator' || role === 'Deactivated' || role === 'NoRole' ? []
    : await prisma.role_permissions.findMany({
      where: { tenant_id: tenantId, profile: role },
      select: { section: true, can_view: true, data_scope: true },
    })
  const row = section => rows.find(r => r.section === section)
  const masters = new Set(MASTER_SECTION_KEYS)
  return {
    role,
    view: section => role === 'Administrator' || (role !== 'Deactivated' && role !== 'NoRole' && row(section)?.can_view === true),
    scope: section => role === 'Administrator' || masters.has(section) ? 'all'
      : role === 'NoRole' ? 'own'
      : (row(section)?.data_scope ?? 'own'),
    /**
     * scopedUserIds() over the same rows: `null` for Company scope, else the
     * viewer plus (for Team) everyone user_visibility lets them see.
     */
    async userIds(section) {
      const scope = this.scope(section)
      if (scope === 'all') return null
      if (scope === 'own') return [userId]
      const vis = await prisma.user_visibility.findMany({
        where: { tenant_id: tenantId, viewer_user_id: userId },
        select: { target_user_id: true },
      })
      return [userId, ...vis.map(v => v.target_user_id)]
    },
  }
}

/** scopeWhere() for a Prisma `where`: no predicate for Company scope. */
export const within = (ids, column = 'user_id') => (ids ? { [column]: { in: ids } } : {})

/** Per-suite result collector. */
export function ctx() {
  const notExercised = []
  let pass = 0, fail = 0
  return {
    ok(name, cond, got) {
      console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `   got: ${JSON.stringify(got)}`}`)
      cond ? pass++ : fail++
    },
    /** Record a route we could NOT exercise, with the reason. Goes in the report. */
    skip(route, why) {
      console.log(`  SKIP  ${route}  (${why})`)
      notExercised.push({ route, why })
    },
    section(n) { console.log(`\n  -- ${n} --`) },
    result() { return { pass, fail, notExercised } },
  }
}
