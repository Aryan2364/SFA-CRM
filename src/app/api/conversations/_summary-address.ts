import { prisma } from '@/lib/db'
import {
  SUMMARY_CONTEXTS,
  isSummaryContext,
  summaryContextId,
  type SummaryContext,
} from '../remarks/_context'

/**
 * F32 — RECOVERING (owner, period) FOR A SUMMARY CONVERSATION.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS FOR
 *
 * `/api/conversations` groups `contextual_remarks` by `(context_type,
 * context_id)`, so a row can only carry the context id. For `daily_summary`
 * and `weekly_summary` that id is a UUIDv5 derived from (kind, user, period)
 * — and `/api/remarks` REFUSES a raw id for exactly those two types, because
 * the id cannot be reversed and accepting one would be an authorisation
 * bypass (see `../remarks/_access.ts`). So the thread always opened empty and
 * the Source link always landed on nothing.
 *
 * ⚠️ The refusal is correct and is not what gets fixed. What gets fixed is
 * that Conversations knew only the derived id. This module gives the row the
 * owner and the period, so the client addresses the thread the way the remarks
 * API requires — `?contextType=&userId=&date=` — and authorisation still runs
 * against a NAMED person before any id is derived. Nothing here decides who
 * may read anything; it only recovers a label the grouping threw away.
 *
 * ---------------------------------------------------------------------------
 * HOW, AND WHY IT IS A SEARCH
 *
 * A UUIDv5 is a hash. It has no inverse, so the only way back is to compute
 * the ids of the candidates and look for a match. The candidate set is small
 * and bounded: the tenant's users, crossed with the days in a window ending at
 * the conversation's latest remark. A comment is written about a period that
 * has already happened, so the window runs BACKWARDS from that remark; the
 * forward margin is only there for a clock skew or a plan written a few days
 * ahead.
 *
 * Days are iterated newest-first because a comment normally lands within days
 * of the period it is about, and the loop stops the moment every id is
 * resolved — so the common case costs a few hundred hashes, not the whole
 * window. `PROBE_BUDGET` caps the pathological case (a very large tenant with
 * an unresolvable id) rather than letting the list route hang; an id the
 * budget does not reach is simply returned unresolved, and the row renders
 * without a way in rather than with a broken one.
 *
 * Dates are `YYYY-MM-DD` strings throughout and are stepped with UTC
 * arithmetic — never a local `Date`, which would shift the period by a day for
 * half the world (PLAN.md §8.4).
 */

const LOOKBACK_DAYS = 400
const FORWARD_DAYS = 7
const PROBE_BUDGET = 2_000_000

export type SummaryAddress = {
  userId: string
  userName: string
  /** `YYYY-MM-DD` — the day, or the week-start date. */
  period: string
}

export type SummaryGroup = {
  context_type: string
  context_id: string
  /** ISO timestamp of the newest remark in the group. */
  updated_at: string
}

/** `${context_type}::${context_id}` — the same key the route groups on. */
function groupKey(contextType: string, contextId: string): string {
  return `${contextType}::${contextId}`
}

function addDays(day: string, delta: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

export async function resolveSummaryAddresses(
  tenantId: string,
  groups: SummaryGroup[]
): Promise<Map<string, SummaryAddress>> {
  const resolved = new Map<string, SummaryAddress>()

  // Which derived ids we are looking for, per kind.
  const wanted = new Map<SummaryContext, Set<string>>()
  let newest = ''
  let oldest = ''
  for (const g of groups) {
    if (!isSummaryContext(g.context_type)) continue
    const set = wanted.get(g.context_type) ?? new Set<string>()
    set.add(g.context_id)
    wanted.set(g.context_type, set)
    const day = g.updated_at.slice(0, 10)
    if (!newest || day > newest) newest = day
    if (!oldest || day < oldest) oldest = day
  }
  if (wanted.size === 0) return resolved

  const users = await prisma.users.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, name: true },
  })
  if (users.length === 0) return resolved

  const from = addDays(oldest, -LOOKBACK_DAYS)
  const to = addDays(newest, FORWARD_DAYS)

  let probes = 0
  let outstanding = 0
  for (const set of wanted.values()) outstanding += set.size

  for (let day = to; day >= from && outstanding > 0; day = addDays(day, -1)) {
    for (const kind of SUMMARY_CONTEXTS) {
      const set = wanted.get(kind)
      if (!set || set.size === 0) continue
      for (const u of users) {
        if (probes++ > PROBE_BUDGET) return resolved
        const id = summaryContextId(kind, u.id, day)
        if (!set.has(id)) continue
        set.delete(id)
        outstanding--
        resolved.set(groupKey(kind, id), {
          userId: u.id,
          userName: u.name,
          period: day,
        })
        if (set.size === 0) break
      }
    }
  }

  return resolved
}

export { groupKey }
