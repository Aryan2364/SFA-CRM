/**
 * How accurate a captured location was, in metres — stored beside the lat/lng
 * it describes:
 *
 *   daily_visits.accuracy_m / end_accuracy_m   a meeting's Start / Stop
 *   todo_outcomes.accuracy_m                   "Couldn't meet"
 *   attendance.check_in_accuracy_m / check_out_accuracy_m
 *
 * Same trap as `src/lib/next-meeting-time.ts` and `src/lib/visit-contact.ts`:
 * these `real` columns come from `docs/local-db-updates.sql` section 10, which
 * the owner runs on RDS by hand, so they may not exist. They are therefore NOT
 * in `prisma/schema.prisma` (a model field makes every default select ask for
 * the column) and nothing touches them through Prisma's model API. The main
 * write happens first, exactly as before; the accuracy goes in afterwards with
 * a separate `UPDATE ... WHERE id AND tenant_id`, and a missing column (42703)
 * is swallowed and remembered for a minute so it costs nothing after the first
 * miss. A reading is decoration on a save that already succeeded, so any other
 * failure is logged, not turned into a 500 for a request that did its job.
 */

import { Prisma } from '@prisma/client'
import { prisma } from './db'

export type AccuracyColumn =
  | 'daily_visits.accuracy_m'
  | 'daily_visits.end_accuracy_m'
  | 'todo_outcomes.accuracy_m'
  | 'attendance.check_in_accuracy_m'
  | 'attendance.check_out_accuracy_m'

/** Identifiers cannot be bound, so they are spliced in ONLY from this map. */
const COLUMNS: Record<AccuracyColumn, { table: Prisma.Sql; column: Prisma.Sql }> = {
  'daily_visits.accuracy_m': { table: Prisma.raw('daily_visits'), column: Prisma.raw('accuracy_m') },
  'daily_visits.end_accuracy_m': { table: Prisma.raw('daily_visits'), column: Prisma.raw('end_accuracy_m') },
  'todo_outcomes.accuracy_m': { table: Prisma.raw('todo_outcomes'), column: Prisma.raw('accuracy_m') },
  'attendance.check_in_accuracy_m': { table: Prisma.raw('attendance'), column: Prisma.raw('check_in_accuracy_m') },
  'attendance.check_out_accuracy_m': { table: Prisma.raw('attendance'), column: Prisma.raw('check_out_accuracy_m') },
}

/** A finite number in (0, 100000) metres, else null. The body is never trusted. */
export function parseAccuracy(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value > 0 && value < 100000 ? value : null
}

const MISSING_TTL_MS = 60_000
const missingUntil = new Map<string, number>()

function isKnownMissing(key: string): boolean {
  const until = missingUntil.get(key)
  return until !== undefined && until > Date.now()
}

/**
 * Postgres 42703 for THIS column. Prisma wraps a raw failure as P2010 and the
 * Postgres code survives only inside its message ("Raw query failed. Code:
 * `42703`. Message: `column "accuracy_m" of relation ... does not exist`"), so
 * the text is what holds; it must name the column so an unrelated fault is
 * never read as "not run yet".
 */
function isColumnMissing(err: unknown, column: string): boolean {
  const e = err as { message?: unknown; meta?: { driverAdapterError?: { cause?: { originalMessage?: unknown } } } }
  const named = (text: unknown) => typeof text === 'string' && new RegExp(`\\b${column}\\b`).test(text) && /42703|does not exist|undefined column/i.test(text)
  return named(e?.message) || named(e?.meta?.driverAdapterError?.cause?.originalMessage)
}

/**
 * Store an accuracy on one row of the caller's tenant. A missing or invalid
 * accuracy stores NULL, so a re-start without a reading cannot keep a stale
 * one. Never throws, and does nothing for a column already known to be
 * missing. `id` must be a row the route already proved is the caller's.
 */
export async function writeAccuracy(key: AccuracyColumn, tenantId: string, id: string, accuracy: unknown): Promise<void> {
  const value = parseAccuracy(accuracy)
  if (isKnownMissing(key)) return
  const t = COLUMNS[key]
  try {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE ${t.table} SET ${t.column} = ${value}::real
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `)
    missingUntil.delete(key)
  } catch (err) {
    if (isColumnMissing(err, key.split('.')[1])) missingUntil.set(key, Date.now() + MISSING_TTL_MS)
    else console.error(`[location-accuracy] could not store ${key}`, err)
  }
}

export type VisitAccuracy = { accuracy_m: number | null; end_accuracy_m: number | null }

/** A meeting's start/stop accuracy; both null while the columns are missing. */
export async function readVisitAccuracy(tenantId: string, visitId: string): Promise<VisitAccuracy> {
  const none = { accuracy_m: null, end_accuracy_m: null }
  if (isKnownMissing('daily_visits.accuracy_m')) return none
  try {
    const rows = await prisma.$queryRaw<VisitAccuracy[]>`
      SELECT accuracy_m, end_accuracy_m FROM daily_visits
       WHERE id = ${visitId}::uuid AND tenant_id = ${tenantId}::uuid`
    return rows[0] ?? none
  } catch (err) {
    if (isColumnMissing(err, 'accuracy_m') || isColumnMissing(err, 'end_accuracy_m')) {
      missingUntil.set('daily_visits.accuracy_m', Date.now() + MISSING_TTL_MS)
      return none
    }
    throw err
  }
}
