/**
 * Turns `weekly_plan_items` rows — stored ones and about-to-be-written ones —
 * into the flat `DiffLine` shape `src/lib/weekly-plan-diff.ts` compares.
 *
 * Not a route: `route.ts` is type-checked against a fixed set of exports, which
 * is the same reason `_items.ts` and `_goals.ts` sit beside it.
 *
 * The one thing worth spelling out is why party NAMES are resolved here rather
 * than at render time. See the header of `src/lib/weekly-plan-diff.ts`: the
 * record of what a manager did is frozen when it is written, so renaming or
 * deleting a company later cannot rewrite history or blank it out.
 */

import { prisma } from '@/lib/db'
import { dateOnlyString } from '@/lib/db'
import type { DiffLine } from '@/lib/weekly-plan-diff'
import { readOthers, carriedNote, type WeeklyPlanItemWrite } from './_items'

/** The columns a diff needs. Anything with these fields is acceptable. */
export type ItemLike = {
  plan_date: Date
  party_id: string | null
  party_type: string | null
  new_dealers_goal: number | null
  existing_dealers_goal: number | null
  others_goal: number | null
  notes: string | null
  expected_order_value: unknown
}

/**
 * Resolve display names for a set of party ids.
 *
 * Both reads carry `tenant_id`. The ids arrive from stored rows and from a
 * client payload; without the predicate a guessed uuid would let one tenant
 * read another tenant's company names through a diff, and nothing would crash.
 */
export async function loadPartyLabels(
  ids: string[],
  tenantId: string,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const labels = new Map<string, string>()
  if (!unique.length) return labels

  const [companies, contacts] = await Promise.all([
    prisma.companies.findMany({
      where: { id: { in: unique }, tenant_id: tenantId },
      select: { id: true, name: true },
    }),
    prisma.contacts.findMany({
      where: { id: { in: unique }, tenant_id: tenantId },
      select: { id: true, name: true },
    }),
  ])
  for (const c of companies) labels.set(c.id, c.name)
  for (const c of contacts) labels.set(c.id, c.name)
  return labels
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  // Prisma hands back a Decimal object for `@db.Decimal`; `Number()` on it goes
  // through its `toString`, which is exact at this column's 12,2 precision.
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * A party that has since been deleted (or was never readable in this tenant)
 * still has to render as something. The id is not a name, so the line says so
 * in words rather than showing a uuid to a salesperson.
 */
const MISSING_PARTY = 'Party no longer available'

function toLine(item: ItemLike, labels: Map<string, string>): DiffLine {
  return {
    // `plan_date` is `@db.Date`. It becomes a "YYYY-MM-DD" string HERE, before
    // anything compares it — PLAN.md §8.4.
    plan_date: dateOnlyString(item.plan_date),
    party_label: item.party_id ? labels.get(item.party_id) ?? MISSING_PARTY : null,
    party_type: item.party_id ? item.party_type ?? null : null,
    new_dealers_goal: item.new_dealers_goal ?? 0,
    existing_dealers_goal: item.existing_dealers_goal ?? 0,
    // A legacy row's Others count is still stranded in `notes`; `readOthers`
    // lifts it out and `carriedNote` keeps it out of the prose, so a manager
    // edit of such a row does not read as "Others 0 → 3, notes '3' → ''".
    others_goal: readOthers(item.others_goal, item.notes),
    expected_order_value: toNumberOrNull(item.expected_order_value),
    notes: carriedNote(item.notes),
  }
}

/** Flatten stored rows, resolving party names in one pair of queries. */
export async function toDiffLines(
  items: ItemLike[],
  tenantId: string,
  labels?: Map<string, string>,
): Promise<DiffLine[]> {
  const resolved =
    labels ??
    (await loadPartyLabels(
      items.map(i => i.party_id).filter((id): id is string => Boolean(id)),
      tenantId,
    ))
  return items.map(i => toLine(i, resolved))
}

/** The same flattening for rows `toItemRows` has produced but not yet written. */
export function writesToDiffLines(
  rows: WeeklyPlanItemWrite[],
  labels: Map<string, string>,
): DiffLine[] {
  return rows.map(r => toLine(r, labels))
}
