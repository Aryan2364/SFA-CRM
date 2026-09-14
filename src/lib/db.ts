import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * Prisma client singleton + the JSON serialisation helper every API route uses.
 *
 * Connection is built at RUNTIME from DATABASE_URL — nothing is baked into the
 * image at build time (PLAN.md §2.4).
 */

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Pool size. NOTE: we use the `@prisma/adapter-pg` driver adapter (same as v2e),
 * which routes queries through node-postgres. node-postgres does NOT understand
 * Prisma's `?connection_limit=` URL parameter — left alone it would be silently
 * ignored and the pool would default to 10 regardless of what the URL says. So
 * we parse it out of the URL ourselves and feed it to the pg Pool as `max`.
 *
 * RDS max_connections ~= DBInstanceClassMemory/9531392 (~85 on db.t3.micro).
 * Instance class is still an open question (PLAN.md §10 Q1), so the default is
 * the conservative 10 the plan mandates.
 */
const DEFAULT_POOL_MAX = 10

function buildAdapter(): PrismaPg {
  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) throw new Error('DATABASE_URL env var is not set')

  const url = new URL(rawUrl)
  const limitParam = url.searchParams.get('connection_limit')
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : NaN
  const max = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_POOL_MAX

  // `sslmode` and `connection_limit` are Prisma-engine parameters; node-postgres
  // rejects/ignores them, so strip both and express SSL through the pg option.
  const sslMode = url.searchParams.get('sslmode')
  url.searchParams.delete('sslmode')
  url.searchParams.delete('connection_limit')

  const needsSsl = Boolean(sslMode) && sslMode !== 'disable'

  return new PrismaPg({
    connectionString: url.toString(),
    // RDS presents an Amazon-issued cert that is not in the default Node trust
    // store. Same posture as v2e in production.
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max,
  })
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function getClient(): PrismaClient {
  // Cached on globalThis so Next.js hot-reload in dev does not open a new pool
  // on every recompile until the database refuses further connections.
  if (globalForPrisma.prisma) return globalForPrisma.prisma
  const client = new PrismaClient({ adapter: buildAdapter() })
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client
  return client
}

/**
 * The client is created on FIRST USE, not on import (PLAN.md §5.7). `next build`
 * runs with no database and no DATABASE_URL; if the adapter were constructed at
 * module scope, merely importing this file from a route would throw and break
 * the build. Behind the proxy, importing is free and only an actual query
 * connects.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver)
  },
  has(_target, prop) {
    return Reflect.has(getClient(), prop)
  },
})

// ---------------------------------------------------------------------------
// JSON serialisation (PLAN.md §5.1)
// ---------------------------------------------------------------------------

/**
 * Supabase returned JSON over HTTP: timestamps arrived as ISO strings and
 * numerics as JS numbers. Prisma returns `Date` and `Decimal` objects instead.
 * Every route must run its payload through `serialize()` before returning it, so
 * the client keeps receiving exactly the shapes it receives today.
 *
 * Two distinct date shapes have to be preserved, because PostgREST distinguished
 * them and the UI renders both directly:
 *   - `timestamptz` -> full ISO string  ("2026-09-14T10:20:30.123Z")
 *   - `date`        -> date-only string ("2026-09-14")
 * At runtime both are plain `Date`, so date-only columns are identified by field
 * name. Verified against prisma/schema.prisma: these eight are the only `@db.Date`
 * columns, and no `@db.Timestamptz` column shares a name with any of them — so
 * keying on the name is unambiguous. Re-check this list if the schema changes.
 */
const DATE_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'expense_date',
  'next_follow_up_date',
  'order_date',
  'payment_due_date',
  'plan_date',
  'visit_date',
  'week_end_date',
  'week_start_date',
])

function isDecimal(value: unknown): value is Prisma.Decimal {
  return value instanceof Prisma.Decimal
}

/** A `Date` at UTC, rendered as the calendar date PostgREST would have sent. */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/**
 * Deep-convert a Prisma result for JSON output. Returns `unknown`-typed data by
 * design: the conversion changes types (Date -> string, Decimal -> number) and
 * pretending otherwise would let the old types leak into route code.
 */
export function serialize<T>(value: T): unknown {
  return convert(value, undefined)
}

function convert(value: unknown, fieldName: string | undefined): unknown {
  if (value === null || value === undefined) return value

  if (value instanceof Date) {
    return fieldName && DATE_ONLY_FIELDS.has(fieldName)
      ? toDateOnly(value)
      : value.toISOString()
  }

  // Decimal -> number. PostgREST sent numerics as JSON numbers, and the UI does
  // arithmetic on them directly; leaving a Decimal object here produces silently
  // wrong totals rather than an error (PLAN.md §5.1).
  if (isDecimal(value)) return value.toNumber()

  if (typeof value === 'bigint') return Number(value)

  if (Array.isArray(value)) {
    // Array elements inherit the field name so `plan_dates: Date[]` still works.
    return value.map(item => convert(item, fieldName))
  }

  // Only recurse into plain objects. Anything else (Buffer, custom class) is
  // passed through untouched rather than being silently flattened.
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = convert(item, key)
    }
    return out
  }

  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
