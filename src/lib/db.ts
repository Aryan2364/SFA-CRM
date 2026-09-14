import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  DATE_ONLY_FIELDS,
  DATE_ONLY_FIELD_NAMES,
  AMBIGUOUS_DATE_FIELD_NAMES,
} from './generated/date-only-fields'

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
 * Pool size (PLAN.md §6.2). The database is `db.t4g.micro` — 1 GB RAM — and is
 * SHARED BY FOUR APPLICATIONS. The binding constraint is memory, not the
 * ~112 max_connections: each Postgres backend costs ~5–10 MB, so 4 apps × 10
 * would be ~320 MB of backend memory on a box that also wants ~256 MB of
 * shared_buffers plus work_mem and the OS. 4 × 5 = 20 leaves real headroom.
 * Do not raise this without raising the instance class.
 *
 * The instance is also burstable: sustained load drains CPU credits and
 * throttles all four applications together, so CPU credit balance is the metric
 * to watch, not connection count.
 *
 * NOTE: we use the `@prisma/adapter-pg` driver adapter (same as v2e), which
 * routes queries through node-postgres. node-postgres does NOT understand
 * Prisma's `?connection_limit=` URL parameter — it is a query-engine parameter,
 * so left alone it would be silently ignored. We parse it out of the URL and
 * feed it to the pg Pool as `max`. A value in the URL therefore OVERRIDES the
 * default below: keep `.env.production` at `connection_limit=5`, or omit the
 * parameter entirely and inherit this default.
 */
const DEFAULT_POOL_MAX = 5

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

  // PRISMA_QUERY_LOG=<path> appends every emitted statement to that file. This
  // exists for the tenant-scope audit (PLAN.md §8.2): exercise the routes, then
  // assert that every statement touching a tenant-scoped table carries a
  // tenant_id predicate. Off unless the variable is set — it must never be set
  // in production, where it would write query text to disk unbounded.
  const queryLogPath = process.env.PRISMA_QUERY_LOG
  const client = queryLogPath
    ? new PrismaClient({ adapter: buildAdapter(), log: [{ emit: 'event', level: 'query' }] })
    : new PrismaClient({ adapter: buildAdapter() })

  if (queryLogPath) {
    const { appendFileSync } = require('node:fs') as typeof import('node:fs')
    ;(client as unknown as {
      $on: (e: 'query', cb: (ev: { query: string; params: string }) => void) => void
    }).$on('query', ev => {
      try {
        appendFileSync(queryLogPath, JSON.stringify({ query: ev.query, params: ev.params }) + '\n')
      } catch {
        // Never let audit instrumentation break a request.
      }
    })
  }

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
 *
 * Detection is keyed on MODEL + FIELD, from a map generated out of
 * prisma/schema.prisma (src/lib/generated/date-only-fields.ts). Note that the
 * runtime DMMF cannot answer this on its own: `Prisma.dmmf` omits `nativeType`,
 * so `@db.Date` and `@db.Timestamptz` both appear as plain `DateTime`. DMMF is
 * still used for what it does carry reliably — relation structure — so nested
 * `include`/`select` payloads are walked with the correct model at each level.
 *
 * Pass the model when you have it. Without it, detection falls back to the bare
 * field name, which is safe only while no name is date-only on one model and a
 * timestamp on another; the generated AMBIGUOUS set makes that condition throw
 * loudly instead of degrading silently.
 */

/** model -> (relation field -> related model), built once from the DMMF. */
const RELATION_TARGETS: ReadonlyMap<string, ReadonlyMap<string, string>> = (() => {
  const outer = new Map<string, Map<string, string>>()
  for (const model of Prisma.dmmf.datamodel.models) {
    const inner = new Map<string, string>()
    for (const field of model.fields) {
      if (field.kind === 'object') inner.set(field.name, field.type)
    }
    outer.set(model.name, inner)
  }
  return outer
})()

function isDecimal(value: unknown): value is Prisma.Decimal {
  return value instanceof Prisma.Decimal
}

/** A `Date` rendered as the calendar date PostgREST would have sent. */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function isDateOnly(model: string | undefined, field: string | undefined): boolean {
  if (!field) return false
  if (model) return DATE_ONLY_FIELDS.has(`${model}.${field}`)
  if (AMBIGUOUS_DATE_FIELD_NAMES.has(field)) {
    throw new Error(
      `serialize(): field "${field}" is date-only on one model and a timestamp on ` +
      `another. Pass the model name — serialize(rows, 'model_name') — so the ` +
      `correct shape can be chosen.`
    )
  }
  return DATE_ONLY_FIELD_NAMES.has(field)
}

/**
 * Deep-convert a Prisma result for JSON output. Returns `unknown` by design: the
 * conversion changes types (Date -> string, Decimal -> number) and pretending
 * otherwise would let the pre-conversion types leak into route code.
 *
 * @param model the Prisma model the row(s) came from, e.g. 'expenses'. Optional,
 *              but supply it: it makes date detection exact and lets nested
 *              relations be resolved through the DMMF.
 */
export function serialize<T>(value: T, model?: Prisma.ModelName): unknown {
  return convert(value, model, undefined)
}

function convert(value: unknown, model: string | undefined, fieldName: string | undefined): unknown {
  if (value === null || value === undefined) return value

  if (value instanceof Date) {
    return isDateOnly(model, fieldName) ? toDateOnly(value) : value.toISOString()
  }

  // Decimal -> number. PostgREST sent numerics as JSON numbers and the UI does
  // arithmetic on them directly; leaving a Decimal here produces silently wrong
  // totals rather than an error (PLAN.md §5.1).
  if (isDecimal(value)) return value.toNumber()

  if (typeof value === 'bigint') return Number(value)

  // Array elements inherit their parent's model and field context.
  if (Array.isArray(value)) return value.map(item => convert(item, model, fieldName))

  // Only recurse into plain objects. Anything else (Buffer, custom class) is
  // passed through untouched rather than being silently flattened.
  if (isPlainObject(value)) {
    const relations = model ? RELATION_TARGETS.get(model) : undefined
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      // If this key is a relation, the nested rows belong to the related model.
      out[key] = convert(item, relations?.get(key), key)
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

// ---------------------------------------------------------------------------
// Error shaping (PLAN.md §5.4)
// ---------------------------------------------------------------------------

/**
 * Supabase returned failures as a value, and routes answered with
 * `{ error: error.message }`. Prisma throws instead, so converted routes catch
 * and run the thrown value through this to keep the same response body.
 */
export function dbErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
