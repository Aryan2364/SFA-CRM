/**
 * `weekly_plan_items.contact_id` - the PERSON a planned line is for, kept apart
 * from the ACCOUNT (`party_id` with `party_type = 'company'`).
 *
 * Same trap and same pattern as `src/lib/visit-contact.ts`: the column is added
 * by `docs/local-db-updates.sql` item 11 and is deliberately NOT in
 * `prisma/schema.prisma`, because only a human may run `prisma db push`. So
 * nothing reads or writes it through Prisma's model API; everything here is raw
 * SQL with a `tenant_id` predicate, and a database without the column behaves
 * exactly as it did before (contacts read as "none", writes are skipped).
 *
 * A contact-only line (a person with no account) keeps `party_type = 'contact'`
 * and `party_id = <contact id>`, with `contact_id` null. Readers resolve both.
 *
 * WARNING: `prisma db pull` regenerates the schema from the database. If it is
 * run after the column exists, the column appears in the model; that is
 * harmless, because by then the column exists everywhere.
 */

import { prisma, dateOnlyString } from './db'
import { asId, firstForeignTenantRef, type TenantFkCheck } from './tenant-fk'

type Tx = Pick<typeof prisma, '$queryRaw' | '$executeRaw'>

function isColumnMissing(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown }; message?: unknown }
  if (e?.code === '42703' || e?.meta?.code === '42703' || e?.cause?.code === '42703') return true
  // Prisma wraps raw failures as P2010; the text is what survives.
  return typeof e?.message === 'string' && /contact_id/.test(e.message) && /does not exist|undefined column/i.test(e.message)
}

// Presence of the column, cached. A positive answer is permanent; a negative one
// is re-probed after a minute so a column added while the server runs is found.
let known: { present: boolean; at: number } | null = null
const NEGATIVE_TTL_MS = 60_000

/**
 * Whether the column exists. Asked BEFORE opening a write transaction: a failed
 * statement inside a Postgres transaction aborts the whole transaction, so the
 * 42703 swallow below cannot be relied on in there.
 */
export async function planItemContactAvailable(): Promise<boolean> {
  if (known && (known.present || Date.now() - known.at < NEGATIVE_TTL_MS)) return known.present
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT 1 AS n FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'weekly_plan_items' AND column_name = 'contact_id'
  `
  known = { present: rows.length > 0, at: Date.now() }
  return known.present
}

export type PlanItemContact = { id: string; name: string }

/**
 * The contact on each of these items, keyed by item id. `null` when the column
 * is not there (distinct from an empty map: "cannot answer yet").
 * Tenant-scoped on both sides of the join.
 */
export async function readPlanItemContacts(
  tenantId: string,
  itemIds: string[],
): Promise<Map<string, PlanItemContact> | null> {
  if (itemIds.length === 0) return new Map()
  // Asked first, so a database without the column does not fire a failing SQL
  // statement on every request.
  if (!await planItemContactAvailable()) return null
  try {
    const rows = await prisma.$queryRaw<{ item_id: string; id: string; name: string }[]>`
      SELECT i.id::text AS item_id, c.id::text AS id, c.name AS name
        FROM weekly_plan_items i
        JOIN contacts c
          ON c.id = i.contact_id
         AND c.tenant_id = ${tenantId}::uuid
       WHERE i.tenant_id = ${tenantId}::uuid
         AND i.id = ANY(${itemIds}::uuid[])
    `
    const map = new Map<string, PlanItemContact>()
    for (const r of rows) map.set(r.item_id, { id: r.id, name: r.name })
    return map
  } catch (err) {
    if (isColumnMissing(err)) return null
    throw err
  }
}

/** Add `contact_id` / `contact_name` to serialised item rows (null when none/unavailable). */
export async function attachPlanItemContacts<T extends { id: string }>(
  tenantId: string,
  items: T[],
): Promise<(T & { contact_id: string | null; contact_name: string | null })[]> {
  const map = await readPlanItemContacts(tenantId, items.map(i => i.id))
  return items.map(i => {
    const c = map?.get(i.id)
    return { ...i, contact_id: c?.id ?? null, contact_name: c?.name ?? null }
  })
}

/**
 * Stamp contacts onto freshly created items. Rows with no contact are skipped
 * (new rows start null). Safe to call inside a transaction ONLY after
 * `planItemContactAvailable()` returned true; returns false when unavailable.
 */
export async function writePlanItemContacts(
  tenantId: string,
  pairs: { id: string; contactId: string | null }[],
  db: Tx = prisma,
): Promise<boolean> {
  const todo = pairs.filter(p => p.contactId)
  if (todo.length === 0) return true
  try {
    for (const p of todo) {
      await db.$executeRaw`
        UPDATE weekly_plan_items
           SET contact_id = ${p.contactId}::uuid
         WHERE id = ${p.id}::uuid AND tenant_id = ${tenantId}::uuid
      `
    }
    return true
  } catch (err) {
    if (isColumnMissing(err)) { known = { present: false, at: Date.now() }; return false }
    throw err
  }
}

function dayLabel(planDate: unknown): string {
  const s = typeof planDate === 'string' ? planDate.slice(0, 10) : ''
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return 'A line'
  const wd = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
  return `${wd} ${d.getUTCDate()}`
}

/**
 * Check the account / contact ids on an `items` payload and return the payload
 * with stale references scrubbed: `{ error }` (a plain 400 message) or `{ items }`.
 *
 *  - Only refs that are NEW or CHANGED against the plan's stored lines are
 *    refused. A line is matched to its stored twin by its id when the payload
 *    carries one, otherwise by (plan_date, party_id, contact_id). Every new id
 *    goes through `firstForeignTenantRef`, so a body id from another tenant can
 *    never be written.
 *  - An UNCHANGED ref that has since gone stale (account/contact deleted, a
 *    non-UUID, a contact unlinked) is nulled, as the old `uuidOrNull` did, and
 *    the line is kept. A plan saved last week must re-save.
 *  - Messages name the day and the party: "Tue 28: that person is not linked to X".
 *  - `planId` null = a brand-new plan, where every ref is new.
 *  - Without the contact_id column, contacts are dropped (they are not written).
 *
 * Inactive masters are not refused for the same reason.
 */
export async function checkPlanItemRefs(
  items: unknown,
  tenantId: string,
  planId: string | null,
): Promise<{ error: string; items?: undefined } | { error: null; items: unknown }> {
  if (!Array.isArray(items)) return { error: null, items }
  const columnThere = await planItemContactAvailable()
  const present = (v: unknown) => v !== undefined && v !== null && v !== ''

  type Stored = { id: string; date: string; party: string | null; contact: string | null }
  const stored: Stored[] = []
  if (planId) {
    const rows = await prisma.weekly_plan_items.findMany({
      where: { weekly_plan_id: planId, tenant_id: tenantId },
      select: { id: true, plan_date: true, party_id: true },
    })
    const contacts = columnThere ? await readPlanItemContacts(tenantId, rows.map(r => r.id)) : null
    for (const r of rows) {
      stored.push({
        id: r.id, date: String(dateOnlyString(r.plan_date) ?? ''), party: r.party_id,
        contact: contacts?.get(r.id)?.id ?? null,
      })
    }
  }
  const storedById = new Map(stored.map(s => [s.id, s]))

  type Line = {
    raw: Record<string, unknown>; day: string
    pid: string | null; ptype: string; cid: string | null
    partyNew: boolean; contactNew: boolean
  }
  const out: unknown[] = []
  const lines: Line[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') { out.push(it); continue }
    const raw = it as Record<string, unknown>
    const pid = asId(raw.party_id)
    // A malformed contact is never legitimate (the column is new). A malformed
    // account is refused on a new plan; on an existing one it is the legacy value
    // toItemRow always nulled, so it is scrubbed below rather than blocking the save.
    const day0 = dayLabel(raw.plan_date)
    if (columnThere && present(raw.contact_id) && !asId(raw.contact_id)) return { error: `${day0}: Person is invalid` }
    if (!planId && present(raw.party_id) && !pid) return { error: `${day0}: Account is invalid` }
    // Same trim toItemRow applies, or ' company' would skip the link check.
    const ptype = typeof raw.party_type === 'string' ? raw.party_type.trim() : ''
    const cid = columnThere ? asId(raw.contact_id) : null
    const date = typeof raw.plan_date === 'string' ? raw.plan_date.slice(0, 10) : ''
    const own = typeof raw.id === 'string' ? storedById.get(raw.id) : undefined
    const twins = own ? [own] : stored.filter(s => s.date === date && pid && s.party === pid)
    const partyNew = Boolean(pid) && !twins.some(s => s.party === pid)
    const contactNew = Boolean(cid) && (partyNew || !twins.some(s => s.contact === cid))
    const line: Line = { raw: { ...raw }, day: dayLabel(raw.plan_date), pid, ptype, cid, partyNew, contactNew }
    lines.push(line)
    out.push(line.raw)
  }

  // One lookup per kind for every id present, new or not: a new one that is
  // missing is refused, an unchanged one is nulled.
  const companyIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const l of lines) {
    if (l.pid) {
      if (l.ptype !== 'contact') companyIds.add(l.pid)
      if (l.ptype !== 'company') contactIds.add(l.pid)
    }
    if (l.cid) contactIds.add(l.cid)
  }
  const [companyRows, contactRows] = await Promise.all([
    companyIds.size
      ? prisma.companies.findMany({ where: { tenant_id: tenantId, id: { in: Array.from(companyIds) } }, select: { id: true, name: true } })
      : [],
    contactIds.size
      ? prisma.contacts.findMany({ where: { tenant_id: tenantId, id: { in: Array.from(contactIds) } }, select: { id: true } })
      : [],
  ])
  const companyName = new Map(companyRows.map(c => [c.id, c.name]))
  const contactOk = new Set(contactRows.map(c => c.id))
  const partyThere = (l: Line) =>
    Boolean(l.pid) &&
    ((l.ptype !== 'contact' && companyName.has(l.pid as string)) || (l.ptype !== 'company' && contactOk.has(l.pid as string)))

  // Tenant guard on every NEW id; the lookups above are the same tenant-scoped reads.
  const checks: TenantFkCheck[] = []
  for (const l of lines) {
    if (l.pid && l.partyNew) {
      const kind = l.ptype === 'contact' ? 'Person' : l.ptype === 'company' ? 'Account' : 'Account or person'
      checks.push({ value: l.pid, label: `${l.day}: ${kind}`, find: async () => (partyThere(l) ? true : null) })
    }
    if (l.cid && l.contactNew) {
      checks.push({ value: l.cid, label: `${l.day}: Person`, find: async id => (contactOk.has(id) ? true : null) })
    }
  }
  const miss = await firstForeignTenantRef(checks)
  if (miss) return { error: miss }

  // Links, for every account line that still names a contact.
  const pairs = lines.filter(l => l.pid && l.cid && l.ptype === 'company' && partyThere(l) && contactOk.has(l.cid))
  const linked = new Set<string>()
  if (pairs.length) {
    const rows = await prisma.company_contacts.findMany({
      where: {
        tenant_id: tenantId,
        company_id: { in: pairs.map(l => l.pid as string) },
        contact_id: { in: pairs.map(l => l.cid as string) },
      },
      select: { company_id: true, contact_id: true },
    })
    for (const r of rows) linked.add(`${r.company_id}:${r.contact_id}`)
  }

  for (const l of lines) {
    // Non-UUID, deleted or foreign and UNCHANGED (new ones were refused above).
    if (present(l.raw.party_id) && !partyThere(l)) {
      l.raw.party_id = null; l.raw.party_type = null; l.raw.contact_id = null
      continue
    }
    if (!present(l.raw.contact_id)) continue
    if (!l.cid || !columnThere || !contactOk.has(l.cid)) { l.raw.contact_id = null; continue }
    if (l.ptype !== 'company') continue // never written: toItemRow drops it
    if (!linked.has(`${l.pid}:${l.cid}`)) {
      if (l.contactNew) {
        return { error: `${l.day}: that person is not linked to ${companyName.get(l.pid as string) ?? 'the account selected'}` }
      }
      l.raw.contact_id = null
    }
  }
  return { error: null, items: out }
}
