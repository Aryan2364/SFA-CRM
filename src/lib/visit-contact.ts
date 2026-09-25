/**
 * `daily_visits.contact_id` — the PERSON a meeting was with.
 *
 * A meeting is with a person as often as with a company. Until now the only
 * party a meeting could name was `entity_id`, a `companies.id`, so "I met
 * Ramesh" could be recorded only as text inside `entity_name`. This column is
 * the structured half, and it mirrors `deals.contact_id` exactly.
 *
 * ---------------------------------------------------------------------------
 * ENTITY_ID IS STILL THE COMPANY. THIS IS ADDITIVE.
 *
 * Five places read `daily_visits.entity_id` as a `companies.id`:
 * `/api/daily-activity/[id]`, `/api/orders`, `src/lib/summary.ts`,
 * `src/lib/reports/sources.ts` and `src/lib/weekly-review.ts`. None of them
 * changes. A contact who belongs to a company keeps that company in
 * `entity_id`; only a contact who belongs to NO company leaves it null.
 *
 * All five already handle a null `entity_id`, and this was checked rather than
 * assumed: the meeting page guards with `companyId ? … : null` and omits the
 * Deals and Orders panels; `/api/orders` applies its company predicate only
 * `if (entityId)`; `summary.ts` filters nulls out of `visitedIds` and falls
 * back to a `name:` key; `reports/run.ts#uniqueIds` collects only non-empty
 * strings, so the Party dimension resolves through its `entity_name` fallback
 * and labels the row "No company"; and `weekly-review.ts` matches
 * `entity_id: { in: plannedPartyIds }`, which a null correctly never satisfies
 * — a meeting with no company cannot tick off a planned company.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL — read before adding `contact_id` to any Prisma
 * call. This is the same trap `src/lib/deal-stage-type.ts` documents.
 *
 * The column is declared in `prisma/schema.prisma` but **has not been pushed to
 * any database**; only a human may run `prisma db push`. A Prisma read with no
 * `select` asks for every scalar the generated client knows about, so the
 * moment the client is regenerated, every unselected read of `daily_visits`
 * would ask Postgres for a column it does not have and fail with 42703 — the
 * Daily Activity screen, the meeting page and the review screen would all go
 * down, with nothing in the diff that looks like a database change.
 *
 * So: **nothing reads or writes `contact_id` through Prisma's model API**, the
 * declared `contacts` relation is never `include`d, and every Prisma read of
 * `daily_visits` carries an explicit `select`. The functions below use raw SQL
 * and report "unavailable" instead of throwing when the column is absent.
 * Callers degrade to the denormalised `entity_name` text, which is exactly the
 * behaviour that shipped before this column existed. Once it is pushed the
 * same code starts returning real values with no further change.
 *
 * ⚠️ `npm run prisma:sync` runs `prisma db pull`, which regenerates the schema
 * FROM the database — running it before the push silently deletes the column
 * from `schema.prisma`.
 */

import { prisma } from './db'

/**
 * Postgres 42703 — undefined_column — is the one error meaning "not pushed
 * yet". Anything else is a real fault and is rethrown, so a genuine outage
 * still surfaces as a 500 rather than being silently read as "unavailable".
 *
 * ⚠️ THE MESSAGE CHECK IS NOT A FALLBACK. IT IS THE BRANCH THAT FIRES.
 *
 * This was measured against the local database through this repo's own client
 * (`@prisma/adapter-pg`), not assumed. Raw Postgres hands back
 * `error.code === '42703'`, but Prisma wraps `$queryRaw` and `$executeRaw`
 * failures in a `PrismaClientKnownRequestError` whose code is **`P2010`**
 * ("raw query failed"); `code`, `meta.code` and `cause.code` are then all
 * something other than 42703. What survives is the text, which reads
 * `column v.contact_id does not exist`.
 *
 * So the three code checks below are the belt — they cost nothing and would
 * catch a future Prisma version that stops wrapping — and the message check is
 * the braces that actually hold. It is deliberately narrow: it demands THIS
 * column's name as well as the shape of the message, so an unrelated failure
 * cannot be mistaken for a pending migration.
 *
 * `P2010` alone is never enough on its own: every failed raw query carries it.
 */
function isColumnMissing(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown }; message?: unknown }
  if (e?.code === '42703' || e?.meta?.code === '42703' || e?.cause?.code === '42703') return true
  return typeof e?.message === 'string' && /contact_id/.test(e.message) && /does not exist|undefined column/i.test(e.message)
}

/**
 * Every scalar on `daily_visits` EXCEPT `contact_id`, for the reads that used
 * to return the whole row.
 *
 * This is the guard described above, made concrete. A `findMany` with no
 * `select` asks the generated client for every scalar it knows about, so once
 * the client learns about `contact_id` those reads start asking Postgres for a
 * column that is not there. Listing the columns pins the query to the ones
 * that exist.
 *
 * It preserves the payload exactly as it was — including `tenant_id`, which
 * the full-row reads already returned. Narrowing the wire is a separate change
 * and is not smuggled in here.
 *
 * ⚠️ A column added to `daily_visits` in future must be added here too, or the
 * reads using this constant will silently stop returning it.
 */
export const VISIT_SELECT = {
  id: true,
  tenant_id: true,
  user_id: true,
  visit_date: true,
  visit_type: true,
  entity_id: true,
  entity_name: true,
  is_new_entity: true,
  start_time: true,
  end_time: true,
  duration_secs: true,
  latitude: true,
  longitude: true,
  address: true,
  status: true,
  notes: true,
  created_at: true,
  updated_at: true,
  end_latitude: true,
  end_longitude: true,
  end_address: true,
  is_manual_entry: true,
  location_flagged: true,
  weekly_plan_item_id: true,
} as const

/** The person on a meeting, resolved for display. */
export type VisitContact = {
  id: string
  name: string
  designation: string | null
}

/**
 * The contact on each of these visits, keyed by visit id.
 *
 * Returns `null` — not an empty map — when the column has not been pushed.
 * `null` means "the software cannot answer this yet"; an empty map would mean
 * "none of these meetings named a person", and a caller that could not tell
 * them apart would render every meeting as company-only and look like it had
 * lost the data.
 *
 * Tenant-scoped on BOTH sides of the join: a visit id from another tenant
 * matches nothing, and a contact row from another tenant is never read.
 */
export async function readVisitContacts(
  tenantId: string,
  visitIds: string[]
): Promise<Map<string, VisitContact> | null> {
  if (visitIds.length === 0) return new Map()
  try {
    const rows = await prisma.$queryRaw<
      { visit_id: string; id: string; name: string; designation: string | null }[]
    >`
      SELECT v.id::text AS visit_id,
             c.id::text AS id,
             c.name     AS name,
             c.designation AS designation
        FROM daily_visits v
        JOIN contacts c
          ON c.id = v.contact_id
         AND c.tenant_id = ${tenantId}::uuid
       WHERE v.tenant_id = ${tenantId}::uuid
         AND v.id = ANY(${visitIds}::uuid[])
    `
    const map = new Map<string, VisitContact>()
    for (const row of rows) {
      map.set(row.visit_id, { id: row.id, name: row.name, designation: row.designation })
    }
    return map
  } catch (err) {
    if (isColumnMissing(err)) return null
    throw err
  }
}

/** One meeting's contact, or `null` when the column is absent or none is set. */
export async function readVisitContact(
  tenantId: string,
  visitId: string
): Promise<VisitContact | null> {
  const map = await readVisitContacts(tenantId, [visitId])
  return map?.get(visitId) ?? null
}

/**
 * Attach `contact` to serialised visit rows for the wire.
 *
 * `null` where the column is unpushed OR where the meeting simply named no
 * person — the client renders both the same way, by falling back to
 * `entity_name`, which already carries the person's name as text. That is the
 * one place the two cases are deliberately not distinguished: the display is
 * correct either way, and the client has nothing different to do.
 */
export function attachVisitContacts<T extends { id: string }>(
  rows: T[],
  contacts: Map<string, VisitContact> | null
): (T & { contact: VisitContact | null })[] {
  return rows.map(row => ({ ...row, contact: contacts?.get(row.id) ?? null }))
}

/**
 * Write the contact on a meeting that has just been created.
 *
 * Returns `false` when the column is not there yet. The caller does NOT treat
 * that as a failure: the meeting is already saved, `entity_name` already reads
 * "Ramesh Kumar · ACME Traders", and the only thing lost is the joinable
 * reference. Failing the request would mean refusing to log a meeting because
 * of a pending migration.
 *
 * Tenant-scoped in the predicate: a visit id from another tenant updates
 * nothing.
 */
export async function writeVisitContact(
  tenantId: string,
  visitId: string,
  contactId: string | null
): Promise<boolean> {
  try {
    await prisma.$executeRaw`
      UPDATE daily_visits
         SET contact_id = ${contactId}::uuid
       WHERE id = ${visitId}::uuid AND tenant_id = ${tenantId}::uuid
    `
    return true
  } catch (err) {
    if (isColumnMissing(err)) return false
    throw err
  }
}

/**
 * Resolve a `contact_id` a client supplied, or an error MESSAGE explaining why
 * it cannot be used — the single-string 400 every other route answers with.
 *
 * Two checks, and the second is the one that matters:
 *
 * 1. The contact is in THIS tenant. Without it a caller could stamp a meeting
 *    with another tenant's person by posting its id.
 * 2. When the meeting also names a company, the contact must actually be
 *    linked to it through `company_contacts`. Otherwise "met Ramesh at ACME"
 *    could be recorded for a Ramesh who has nothing to do with ACME, and the
 *    Deal and Order panels on the meeting page would sit under a person who
 *    was never there.
 *
 * `company_contacts` carries its own `tenant_id` and it is repeated in the
 * predicate. Redundant given check 1, and it stays: a join row reaching
 * another tenant is exactly the mistake that leaks with nothing crashing.
 *
 * Returns the contact's own name so the caller can build `entity_name` from
 * the master rather than from a string the client sent.
 */
export async function resolveVisitContact(
  tenantId: string,
  contactId: string,
  companyId: string | null
): Promise<{ contact: { id: string; name: string } } | { error: string }> {
  const contact = await prisma.contacts.findFirst({
    where: { id: contactId, tenant_id: tenantId, is_active: true },
    select: { id: true, name: true },
  })
  if (!contact) return { error: 'The contact selected could not be found' }

  if (companyId) {
    const link = await prisma.company_contacts.findFirst({
      where: { tenant_id: tenantId, company_id: companyId, contact_id: contactId },
      select: { id: true },
    })
    if (!link) return { error: 'That contact is not linked to the lead selected' }
  }

  return { contact }
}
