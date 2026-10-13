/**
 * `tenant_settings.gst_required_for_orders` — whether a missing GST number
 * stops an order being placed.
 *
 * Some firms deal with customers who have no GST registration. For them every
 * order against such a customer stayed in Draft for ever, because a company
 * with no GST number is "incomplete" and §3.5 blocks placing an order against
 * an incomplete party. This flag lets a firm say GST is not compulsory: when it
 * is OFF, "GST Number" stops counting as a missing field everywhere the
 * decision or the warning is made. ON — the default — is exactly the behaviour
 * that shipped before the setting existed.
 *
 * The stored `companies.is_complete` / `completeness_missing` are NOT changed by
 * the flag. `scripts/backfill-parties.mjs` and `src/lib/completeness.ts` must
 * keep computing the same five-field rule, or a re-run of the backfill would
 * rewrite every row. The flag is applied at decision and read time instead,
 * through `src/lib/gst-policy.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL — the same trap `src/lib/visit-contact.ts`
 * documents for `daily_visits.contact_id`.
 *
 * The column is declared in `prisma/schema.prisma` but has not been pushed to
 * any database; only a human may run `prisma db push`, and production gets it
 * from a one-line ALTER the owner runs. A Prisma read or write with no `select`
 * asks for every scalar the generated client knows about, so once the client is
 * regenerated, any unselected `tenant_settings` call would ask Postgres for a
 * column it does not have and fail with 42703.
 *
 * So: nothing reads or writes this column through Prisma's model API, and every
 * Prisma call on `tenant_settings` carries an explicit `select`. The functions
 * below use raw SQL. A read on a database without the column answers `true` —
 * today's behaviour — and a write answers "unavailable" so the route can say
 * the database needs updating instead of failing. Once the column exists the
 * same code starts storing real values with no further change.
 *
 * ⚠️ `npm run prisma:sync` runs `prisma db pull`, which regenerates the schema
 * FROM the database — running it before the column exists silently deletes it
 * from `schema.prisma`.
 */

import { prisma } from './db'

/**
 * Postgres 42703 (undefined_column), told apart from every other failure. As
 * `visit-contact.ts` measured, Prisma wraps raw-query failures as P2010 and the
 * Postgres code survives only in the message, so the message check is the
 * branch that actually fires; it demands this column's name so an unrelated
 * fault is never mistaken for a pending database update.
 */
function isColumnMissing(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown }; message?: unknown }
  if (e?.code === '42703' || e?.meta?.code === '42703' || e?.cause?.code === '42703') return true
  return typeof e?.message === 'string' && /gst_required_for_orders/.test(e.message) && /does not exist|undefined column/i.test(e.message)
}

/**
 * Whether this tenant requires a GST number before an order can be placed.
 *
 * `true` when the tenant has no settings row (the column default) and when the
 * column does not exist yet. Any other database failure is rethrown, so an
 * outage still surfaces rather than quietly switching GST enforcement on or off.
 */
export async function getGstRequiredForOrders(tenantId: string): Promise<boolean> {
  return (await readGstRequiredForOrders(tenantId)).value
}

/**
 * The same read, also saying whether the column exists — for the Settings
 * screen, which shows the switch disabled with a sentence until it does.
 */
export async function readGstRequiredForOrders(
  tenantId: string
): Promise<{ value: boolean; available: boolean }> {
  try {
    const rows = await prisma.$queryRaw<{ gst_required_for_orders: boolean }[]>`
      SELECT gst_required_for_orders
        FROM tenant_settings
       WHERE tenant_id = ${tenantId}::uuid
    `
    return { value: rows[0]?.gst_required_for_orders ?? true, available: true }
  } catch (err) {
    if (isColumnMissing(err)) return { value: true, available: false }
    throw err
  }
}

/**
 * Store the flag. Upserts, because a tenant that has never saved System
 * Settings has no row — the same "no row is normal" rule `settings.ts` follows.
 *
 * Returns `'unavailable'` when the column does not exist yet, so the route can
 * answer with a sentence rather than a 500.
 */
export async function setGstRequiredForOrders(
  tenantId: string,
  value: boolean,
  userId: string | null
): Promise<'ok' | 'unavailable'> {
  try {
    await prisma.$executeRaw`
      INSERT INTO tenant_settings (tenant_id, gst_required_for_orders, updated_at, updated_by_user_id)
      VALUES (${tenantId}::uuid, ${value}, now(), ${userId}::uuid)
      ON CONFLICT (tenant_id) DO UPDATE
         SET gst_required_for_orders = EXCLUDED.gst_required_for_orders,
             updated_at = now(),
             updated_by_user_id = EXCLUDED.updated_by_user_id
    `
    return 'ok'
  } catch (err) {
    if (isColumnMissing(err)) return 'unavailable'
    throw err
  }
}
