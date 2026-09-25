/**
 * `deal_stages.stage_type` — Open or Closed, per stage, set by the admin in the
 * Lead Stages master.
 *
 * **Closed means terminal.** A stage marked Closed is the end of the road for
 * the deal sitting in it — Won and Lost are the two obvious ones. Open means
 * the deal is still in play. Which stages are terminal is therefore tenant
 * configuration, not a list of names hardcoded in the software.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL — read before adding a `stage_type` to any
 * Prisma call.
 *
 * The column is declared in `prisma/schema.prisma` but **has not been pushed to
 * any database**; only a human may run `prisma db push`. A Prisma `findMany`
 * with no `select` asks for every scalar the generated client knows about, so
 * the moment the client is regenerated, every unselected read of `deal_stages`
 * would ask Postgres for a column it does not have and fail with 42703 — the
 * Lead Stages master and the Deals board would both go down, in production,
 * with nothing in the diff that looks like a database change.
 *
 * So: **nothing reads or writes `stage_type` through Prisma's model API.** The
 * two functions below do it in raw SQL and return "unavailable" instead of
 * throwing when the column is absent. Callers degrade to "no stage type set
 * yet" and keep working. Once the column is pushed, the same code starts
 * returning real values with no further change.
 *
 * Every Prisma query that reads `deal_stages` rows carries an explicit `select`
 * for the same reason. Adding one without it re-introduces the failure.
 */

import { prisma } from './db'

export const STAGE_TYPES = ['Open', 'Closed'] as const
export type StageType = (typeof STAGE_TYPES)[number]

export function isStageType(value: unknown): value is StageType {
  return typeof value === 'string' && (STAGE_TYPES as readonly string[]).includes(value)
}

/**
 * "The `stage_type` column has not been pushed yet" — and nothing else.
 * Anything else is a real fault and is rethrown, so a genuine outage still
 * surfaces as a 500 instead of being silently read as "unavailable".
 *
 * ⚠️ **`err.code` is NOT the Postgres code.** Prisma reports a failed raw query
 * as `PrismaClientKnownRequestError` with `code: 'P2010'`; the Postgres code is
 * nested. `err.cause` is undefined. Probed through this repo's own client on
 * Prisma 7.10.0 with the column genuinely absent:
 *
 *   code: 'P2010'
 *   meta.driverAdapterError.cause = {
 *     originalCode: '42703',
 *     originalMessage: 'column "stage_type" does not exist',
 *     kind: 'ColumnNotFound',
 *     column: 'stage_type',            // '$executeRaw' says
 *   }                                  // 'stage_type of relation deal_stages'
 *
 * So the structured check reads `meta.driverAdapterError.cause`, and it also
 * checks WHICH column: a different column going missing is a real fault and
 * must not be read as "the feature is not deployed". The same probe on a
 * missing TABLE returns `originalCode: '42P01'`, `kind: 'TableDoesNotExist'`,
 * which this correctly rethrows.
 *
 * The message match at the end is a fallback for a Prisma release that moves
 * the nested shape — not the primary check. If it is ever the only thing
 * firing, the structured branch above has gone stale and needs re-probing.
 */
const STAGE_TYPE_COLUMN = /\bstage_type\b/

function isColumnMissing(err: unknown): boolean {
  const e = err as {
    code?: unknown
    message?: unknown
    meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; kind?: unknown; column?: unknown } } }
  }

  const cause = e?.meta?.driverAdapterError?.cause
  if (cause) {
    const isUndefinedColumn = cause.originalCode === '42703' || cause.kind === 'ColumnNotFound'
    return isUndefinedColumn && typeof cause.column === 'string' && STAGE_TYPE_COLUMN.test(cause.column)
  }

  return (
    typeof e?.message === 'string' &&
    STAGE_TYPE_COLUMN.test(e.message) &&
    /42703|does not exist|undefined column/i.test(e.message)
  )
}

/**
 * Every stage's type in one tenant, keyed by stage id.
 *
 * Returns `null` — not an empty map — when the column has not been pushed.
 * `null` means "the software cannot answer this yet"; an empty map would mean
 * "this tenant has no stages", and a caller that could not tell them apart
 * would render every stage as Open and look like it had lost the setting.
 */
export async function readStageTypes(tenantId: string): Promise<Map<string, StageType> | null> {
  try {
    const rows = await prisma.$queryRaw<{ id: string; stage_type: string | null }[]>`
      SELECT id::text AS id, stage_type FROM deal_stages WHERE tenant_id = ${tenantId}::uuid
    `
    const map = new Map<string, StageType>()
    // The column is NOT NULL DEFAULT 'Open' once pushed, but a row written
    // before a later widening, or any value outside the pair, reads as Open —
    // "not marked terminal" is the safe assumption in both directions.
    for (const row of rows) map.set(row.id, row.stage_type === 'Closed' ? 'Closed' : 'Open')
    return map
  } catch (err) {
    if (isColumnMissing(err)) return null
    throw err
  }
}

/** One stage's type, or `null` when the column is absent or the id is unknown. */
export async function readStageType(tenantId: string, stageId: string): Promise<StageType | null> {
  const map = await readStageTypes(tenantId)
  return map?.get(stageId) ?? null
}

/** Whether this tenant has configured any terminal stage at all. `false` while
 *  the column is unpushed, which is what keeps the close route's check inert
 *  until there is something to check against. */
export async function hasClosedStage(tenantId: string): Promise<boolean> {
  const map = await readStageTypes(tenantId)
  if (!map) return false
  for (const value of map.values()) if (value === 'Closed') return true
  return false
}

/**
 * Set one stage's type. Returns `false` when the column is not there yet, so
 * the caller can tell the user their other edits saved and this one did not,
 * rather than dropping it silently.
 *
 * Tenant-scoped in the predicate: an id from another tenant updates nothing.
 */
export async function writeStageType(tenantId: string, stageId: string, type: StageType): Promise<boolean> {
  try {
    await prisma.$executeRaw`
      UPDATE deal_stages SET stage_type = ${type}
      WHERE id = ${stageId}::uuid AND tenant_id = ${tenantId}::uuid
    `
    return true
  } catch (err) {
    if (isColumnMissing(err)) return false
    throw err
  }
}

/**
 * Hang `stage_type` on serialised stage rows for the wire.
 *
 * `null` where the column is unpushed. The client renders that as "not set"
 * and shows the pending-migration note; it must never render it as Open.
 */
export function attachStageTypes<T extends { id: string }>(
  rows: T[],
  types: Map<string, StageType> | null
): (T & { stage_type: StageType | null })[] {
  return rows.map(row => ({ ...row, stage_type: types?.get(row.id) ?? null }))
}
