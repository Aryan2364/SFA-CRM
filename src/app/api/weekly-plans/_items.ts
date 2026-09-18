/**
 * Shared normalisation for `weekly_plan_items` writes.
 *
 * Not a route — `route.ts` is the only filename Next.js treats as one and it is
 * type-checked against a fixed set of allowed exports, so code shared by POST
 * `/api/weekly-plans`, PUT `/api/weekly-plans/[id]` and
 * POST `/api/weekly-plans/[id]/edit-by-manager` lives here. Those three were
 * each doing `{ ...item, plan_date: new Date(...) }`, which spreads whatever the
 * client sent straight into `createMany` — an unknown key is a Prisma validation
 * throw and a 500, and a `party_id` that is not a UUID is the same. One mapper
 * means the three write paths cannot drift, which matters now that a line item
 * carries a party.
 *
 * ⚠️ THE "OTHERS" DATA-LOSS BUG (P3-T3), and how it is retired.
 *
 * The UI's third per-row count, "Others", had no integer column: this table
 * carried `existing_dealers_goal` (the UI's "Dist.") and `new_dealers_goal`
 * ("Dealer") and nothing else, so Others was stringified into the TEXT column
 * `notes` on write and then hardcoded back to 0 on read. Every value a user ever
 * typed was lost on the next reload.
 *
 * `others_goal Int? @default(0)` now exists and is the real home. What remains
 * is the rows written before it did, whose number is still stranded in `notes`
 * — 78 of them on live; **zero on the local demo database, whose 41 non-empty
 * `notes` are all genuine free text** ('Market day, good footfall' and the like).
 *
 * No backfill was run, deliberately. Instead the move happens per row, here:
 *
 *   READ  — `readOthers` prefers `others_goal`, and falls back to a number
 *           stranded in `notes` when the column is still at its 0 default. A
 *           legacy row therefore shows the value its user typed instead of a
 *           confident 0 that asserts "none" where the truth is "unknown".
 *   WRITE — `others_goal` takes the count and `notes` keeps only real prose, so
 *           the first save of any legacy row completes that row's migration and
 *           the fallback stops firing for it.
 *
 * ⚠️ BARE_NUMBER must stay strict. The fallback is the one place a `notes` value
 * is reinterpreted as a number, and a looser match that swallowed 'Collection
 * focus' would destroy a real note — worse than the bug being fixed.
 */

/** A `notes` value that is nothing but a number is an orphaned "Others" count. */
const BARE_NUMBER = /^\s*\d+(\.\d+)?\s*$/

/**
 * The per-row "Others" count. `others_goal` wins whenever it holds a real value;
 * 0 (the column default on every pre-existing row) falls back to a number
 * stranded in `notes`.
 */
export function readOthers(
  othersGoal: number | null | undefined,
  notes: string | null | undefined,
): number {
  if (othersGoal && othersGoal > 0) return othersGoal
  if (!notes || !BARE_NUMBER.test(notes)) return 0
  return Math.max(0, Math.trunc(Number(notes)))
}

/**
 * `notes` holds free text and only free text from here on. A bare number in it
 * is a legacy Others value that `readOthers` has already lifted out, so it is
 * dropped rather than written back — that is what completes the row's migration.
 */
export function carriedNote(notes: string | null | undefined): string {
  return notes && !BARE_NUMBER.test(notes) ? notes : ''
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `party_type` is a free text column; only these two values mean anything. */
export const PARTY_TYPES = ['company', 'contact'] as const
export type PartyType = (typeof PARTY_TYPES)[number]

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t === '' ? null : t
}

function countOrZero(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

/**
 * `expected_order_value` is `Decimal(12,2)`. A blank field is null, not 0 — the
 * §5.1 field is explicitly optional and "did not say" must stay distinguishable
 * from "said zero". Prisma takes a JS number for a Decimal column; the value is
 * clamped to the column's precision so a 14-digit paste is a 400-worthy input
 * rather than a database throw.
 */
const MAX_ORDER_VALUE = 9_999_999_999.99

function decimalOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(n, MAX_ORDER_VALUE)
}

export type WeeklyPlanItemWrite = {
  tenant_id: string
  weekly_plan_id: string
  plan_date: Date
  from_place: string | null
  to_place: string | null
  mode_of_travel: string | null
  new_dealers_goal: number
  existing_dealers_goal: number
  others_goal: number
  notes: string
  party_id: string | null
  party_type: string | null
  expected_order_value: number | null
}

/**
 * Map one client line item to a row.
 *
 * `plan_date` is `@db.Date`, so the "YYYY-MM-DD" the client sends must become a
 * `Date` — Prisma rejects the string.
 *
 * `from_place` / `to_place` / `mode_of_travel` are no longer on the screen
 * (§5.1 removes Location) but the columns stay for one release, so whatever the
 * client round-trips is written back rather than nulled. That is what stops a
 * re-save of an OLD place-based plan from silently erasing its places.
 */
export function toItemRow(
  raw: Record<string, unknown>,
  tenantId: string,
  planId: string,
): WeeklyPlanItemWrite {
  const partyType = textOrNull(raw.party_type)
  const partyId = uuidOrNull(raw.party_id)
  return {
    tenant_id: tenantId,
    weekly_plan_id: planId,
    plan_date: new Date(raw.plan_date as string),
    from_place: textOrNull(raw.from_place),
    to_place: textOrNull(raw.to_place),
    mode_of_travel: textOrNull(raw.mode_of_travel),
    new_dealers_goal: countOrZero(raw.new_dealers_goal),
    existing_dealers_goal: countOrZero(raw.existing_dealers_goal),
    others_goal: countOrZero(raw.others_goal),
    // Free text only. A bare number here is a legacy Others value the client has
    // already read out through `readOthers` and is sending back in `others_goal`,
    // so writing it again would re-strand it.
    notes: carriedNote(typeof raw.notes === 'string' ? raw.notes : ''),
    // A party_type without a party_id (or the reverse) is half a reference and
    // would make `party_type` unreadable, so the pair is written or neither is.
    party_id: partyId,
    party_type:
      partyId && partyType && (PARTY_TYPES as readonly string[]).includes(partyType)
        ? partyType
        : null,
    expected_order_value: decimalOrNull(raw.expected_order_value),
  }
}

/** Map a whole `items` payload. A non-array body yields no rows, never a throw. */
export function toItemRows(
  items: unknown,
  tenantId: string,
  planId: string,
): WeeklyPlanItemWrite[] {
  if (!Array.isArray(items)) return []
  return items
    .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === 'object')
    // A row with no date belongs to no day and would land on the epoch.
    .filter(i => typeof i.plan_date === 'string' && !Number.isNaN(new Date(i.plan_date).getTime()))
    .map(i => toItemRow(i, tenantId, planId))
}
