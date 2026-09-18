/**
 * Shared shaping and validation for the Deals routes (REBUILD-PLAN.md §4).
 *
 * Not a route — `route.ts` is the only filename Next.js treats as one, and a
 * `route.ts` is type-checked against a fixed set of allowed exports, so helpers
 * shared by the list, the detail handler, the stage PATCH and the close POST
 * live here instead. Same arrangement as `api/companies/_shape.ts`.
 */

/** §4.5 Mode. Validated in the route — the column carries no CHECK. */
export const FOLLOW_UP_MODES = ['Meeting', 'Call', 'Email', 'WhatsApp', 'Other'] as const

/**
 * §4.5 Status. The column default is `not_done`; `done` is the only other
 * value any route writes, and `completed_at` is derived from it.
 */
export const FOLLOW_UP_STATUSES = ['done', 'not_done'] as const

/** §4.6 — the only two outcomes. Mirrors `deals_outcome_check`. */
export const DEAL_OUTCOMES = ['won', 'lost'] as const

/**
 * ⚠️ `deals.probability` carries
 *   CHECK (probability >= 0 AND probability <= 100 AND probability % 10 = 0)
 *
 * §4.1 allows eleven stops of ten; 33 and 54 are not allowed. The constraint is
 * real, so an unvalidated 33 is a Prisma throw and therefore a 500 — the user
 * sees "something went wrong" for a value the form should have rejected.
 * Returning the message from here makes it a 400 with a sentence in it.
 *
 * Returns an error string, or null when the value is acceptable. `undefined`
 * and `null` are acceptable: the column defaults to 0 and PUT treats an absent
 * key as "not being changed".
 */
export function checkProbability(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n)) return 'Probability must be a whole number'
  if (n < 0 || n > 100) return 'Probability must be between 0 and 100'
  if (n % 10 !== 0) return 'Probability must be a multiple of 10 (0, 10, 20 … 100)'
  return null
}

/**
 * The sentinel row in `deal_stages`. It is NOT a funnel stage — it means
 * "master record, not a lead", and five filtered views match it by that exact
 * string (`02-DATA-MODEL-PLAN.md` §6). It must never appear in a Deal Stage
 * picker and must never be deleted, so every read of the stage master from the
 * Deals side spreads this into its `where`.
 */
export const FUNNEL_STAGE_WHERE = { name: { not: 'Existing' } } as const

/**
 * §4.7 Ageing — how many whole days the Deal has stood at its current stage.
 *
 * Computed here rather than in SQL because it is wanted on every read and both
 * views render it; a generated column would need a migration and would be stale
 * the moment it was written. Whole days, floored, never negative.
 */
export function daysInStage(enteredAt: Date | string | null | undefined): number | null {
  if (!enteredAt) return null
  const t = enteredAt instanceof Date ? enteredAt.getTime() : Date.parse(String(enteredAt))
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

/**
 * What the list needs to render a row and a Kanban card without a second
 * request per Deal (§4.2, §4.3): company name, contact name, stage name, owner
 * name — plus the **earliest open follow-up**, which is item 6 on the card.
 *
 * `take: 1` on an ordered, filtered relation is what keeps that last one from
 * being an N+1: Prisma issues one extra query for the whole page, not one per
 * Deal.
 */
export const DEAL_LIST_INCLUDE = {
  companies: { select: { id: true, name: true, mobile_1: true } },
  contacts: { select: { id: true, name: true, mobile: true } },
  deal_stages: { select: { id: true, name: true, sort_order: true } },
  users: { select: { id: true, name: true } },
  reason_for_loss: { select: { id: true, name: true } },
  deal_follow_ups: {
    where: { status: { not: 'done' } },
    orderBy: { due_date: 'asc' as const },
    take: 1,
  },
} as const

/** Everything the Deal detail screen reads (§4.4 Logs, §4.5 Follow-ups, §4.8 Attachments). */
export const DEAL_DETAIL_INCLUDE = {
  companies: { select: { id: true, name: true, mobile_1: true } },
  contacts: { select: { id: true, name: true, mobile: true } },
  deal_stages: { select: { id: true, name: true, sort_order: true } },
  users: { select: { id: true, name: true } },
  products: { select: { id: true, name: true } },
  product_categories: { select: { id: true, name: true } },
  reason_for_loss: { select: { id: true, name: true } },
  deal_follow_ups: { orderBy: { due_date: 'asc' as const } },
  deal_stage_logs: { orderBy: { changed_at: 'desc' as const } },
  deal_attachments: { orderBy: { created_at: 'desc' as const } },
} as const

/**
 * Rename Prisma's relation field names to the keys the client reads, and add
 * the two derived fields (§4.7 ageing, §4.5 next follow-up).
 *
 * ⚠️ Run this AFTER serialize(), never before. serialize() walks relations by
 * their PRISMA field names to find the nested model — renaming first leaves the
 * embeds' own dates and Decimals unconverted, which is how a `due_date` comes
 * back as a full ISO timestamp instead of "YYYY-MM-DD".
 */
export function shapeDeal(row: Record<string, unknown>): Record<string, unknown> {
  const {
    companies,
    contacts,
    deal_stages,
    users,
    products,
    product_categories,
    deal_follow_ups,
    ...rest
  } = row

  const followUps = Array.isArray(deal_follow_ups) ? deal_follow_ups : []
  // The card shows the earliest OPEN follow-up. On the list the relation was
  // already filtered and limited to one; on the detail it carries all of them,
  // so filter again here rather than trusting the caller's include.
  const nextFollowUp =
    followUps.find(f => (f as Record<string, unknown>).status !== 'done') ?? null

  return {
    ...rest,
    company: companies ?? null,
    contact: contacts ?? null,
    stage: deal_stages ?? null,
    owner: users ?? null,
    product: products ?? null,
    product_category: product_categories ?? null,
    follow_ups: followUps,
    next_follow_up: nextFollowUp,
    days_in_stage: daysInStage(rest.stage_entered_at as string | null),
  }
}
