/**
 * `companies.landline` and `contacts.landline` — an optional office or
 * landline number, kept apart from the mobile numbers.
 *
 * Aryan decided (2026-10-13) on a SEPARATE field rather than turning
 * "Alternate number" into one: the alternate fields are checked as mobiles
 * (`checkMobile` / `checkPhone`), already hold second mobiles on real rows,
 * and the bulk import matches companies on `mobile_1`/`mobile_2`. A landline
 * mixed into them would weaken all three. So it is its own column, it is never
 * used for duplicate detection or import matching, and its check is the loose
 * one in `checkLandline` (src/lib/validation.ts).
 *
 * ---------------------------------------------------------------------------
 * WHY THE COLUMN IS NOT IN THE PRISMA MODEL — read before adding it.
 *
 * Neither column has been pushed to any database; only a human may run the
 * schema change. The repo's other pending column, `daily_visits.contact_id`
 * (src/lib/visit-contact.ts), is declared in the model and every Prisma read
 * of that table carries an explicit `select`. That is workable for one table
 * with a handful of reads. `companies` and `contacts` have dozens — finds,
 * creates and updates (which return every scalar by default) and nested
 * `include`s from deals, orders, meetings and the party pages. Declaring
 * `landline` would make every one of them ask Postgres for a column it does
 * not have, and the whole Party surface would 500 with nothing in the diff
 * that looks like a database change.
 *
 * So the column is deliberately ABSENT from `prisma/schema.prisma` until it
 * exists, and everything goes through the raw SQL below, which reports
 * "unavailable" (42703) instead of throwing. Reads then carry `landline: null`
 * and writes save every other field and skip this one; the caller tells the
 * user so. Once the column is added the same code starts storing and
 * returning real values with no change.
 *
 * ⚠️ After the column is added, `npm run prisma:sync` (db pull) brings it into
 * the model, which is then harmless because the column exists. Until then,
 * `npm run scratch:push` (db push --accept-data-loss) would DROP a landline
 * column added by hand to the local database, because the schema does not
 * declare it — add it locally with the same SQL as RDS and run `prisma:sync`
 * before any later push.
 */

import { prisma } from './db'

export type LandlineTable = 'companies' | 'contacts'

/** Anything with Prisma's raw-SQL tags: the client, or an interactive `tx`. */
type RawDb = Pick<typeof prisma, '$queryRaw' | '$executeRaw'>

/** The message a write route returns beside a save whose landline was dropped. */
export const LANDLINE_NOT_SAVED =
  'Saved. The landline was not stored because the database needs an update first.'

/**
 * Postgres 42703 is the one error meaning "not added yet"; anything else is a
 * real fault and is rethrown. As src/lib/visit-contact.ts measured, Prisma
 * wraps raw-query failures as P2010, so the message check is the branch that
 * actually fires; it demands this column's name so an unrelated failure is
 * never mistaken for a pending column.
 */
function isLandlineMissing(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown }; message?: unknown }
  if (e?.code === '42703' || e?.meta?.code === '42703' || e?.cause?.code === '42703') return true
  return typeof e?.message === 'string' && /landline/.test(e.message) && /does not exist|undefined column/i.test(e.message)
}

/**
 * The landline of each of these rows, keyed by id. `null` — not an empty map —
 * when the column is not there yet. Tenant-scoped: an id from another tenant
 * matches nothing.
 */
export async function readLandlines(
  tenantId: string,
  table: LandlineTable,
  ids: string[],
  db: RawDb = prisma
): Promise<Map<string, string | null> | null> {
  if (ids.length === 0) return new Map()
  try {
    // Two literal statements rather than an interpolated identifier: a table
    // name cannot be a bound parameter, and `$queryRawUnsafe` is not worth it
    // for two tables.
    const rows = table === 'companies'
      ? await db.$queryRaw<{ id: string; landline: string | null }[]>`
          SELECT id::text AS id, landline FROM companies
           WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])`
      : await db.$queryRaw<{ id: string; landline: string | null }[]>`
          SELECT id::text AS id, landline FROM contacts
           WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])`
    return new Map(rows.map(r => [r.id, r.landline]))
  } catch (err) {
    if (isLandlineMissing(err)) return null
    throw err
  }
}

/** `landline` on each serialised row; `null` where unset or not yet available. */
export async function attachLandlines<T extends { id: string }>(
  rows: T[],
  tenantId: string,
  table: LandlineTable,
  db: RawDb = prisma
): Promise<(T & { landline: string | null })[]> {
  const map = await readLandlines(tenantId, table, rows.map(r => r.id), db)
  return rows.map(row => ({ ...row, landline: map?.get(row.id) ?? null }))
}

/**
 * Store (or clear, with `null`) one row's landline. `false` when the column is
 * not there yet: the rest of the record is already saved, so the caller
 * reports `LANDLINE_NOT_SAVED` rather than failing the request.
 */
export async function writeLandline(
  tenantId: string,
  table: LandlineTable,
  id: string,
  value: string | null,
  db: RawDb = prisma
): Promise<boolean> {
  try {
    if (table === 'companies') {
      await db.$executeRaw`
        UPDATE companies SET landline = ${value}
         WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`
    } else {
      await db.$executeRaw`
        UPDATE contacts SET landline = ${value}
         WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`
    }
    return true
  } catch (err) {
    if (isLandlineMissing(err)) return false
    throw err
  }
}
