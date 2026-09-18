/**
 * Shared handling for `weekly_goals` — the §5.1 Weekly Goal Checklist that
 * replaces the single free-text `weekly_plans.week_goal` column.
 *
 * ⚠️ `weekly_goals` has **no Prisma relation field** on `weekly_plans`: the
 * table was added without a foreign key that `prisma db pull` could turn into
 * one, so it cannot be reached through `include`. Every read here is a separate
 * `findMany` keyed on `weekly_plan_id` AND `tenant_id` — the second half is not
 * decoration, it is the only tenant filter the query gets.
 *
 * Not a route, for the usual reason: a `route.ts` is type-checked against a
 * fixed set of allowed exports.
 */

import { prisma, serialize } from '@/lib/db'

export type GoalRow = {
  id: string
  text: string
  is_done: boolean
  sort_order: number
}

/** Ordered by `sort_order`, then `created_at` so two rows at 0 keep a stable order. */
export async function loadGoals(planId: string, tenantId: string) {
  const rows = await prisma.weekly_goals.findMany({
    where: { weekly_plan_id: planId, tenant_id: tenantId },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
  })
  return serialize(rows, 'weekly_goals')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type IncomingGoal = { id: string | null; text: string; is_done: boolean; sort_order: number }

/**
 * The checklist ships with five BLANK rows by default, and blank rows are not
 * data — they are an empty form. Only rows with text are stored, so an untouched
 * plan does not accumulate five empty goals a week.
 */
function readGoals(value: unknown): IncomingGoal[] {
  if (!Array.isArray(value)) return []
  const out: IncomingGoal[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const g = raw as Record<string, unknown>
    const text = typeof g.text === 'string' ? g.text.trim() : ''
    if (!text) continue
    out.push({
      id: typeof g.id === 'string' && UUID.test(g.id) ? g.id : null,
      text,
      is_done: g.is_done === true,
      // Position is the client's index, not a value the user typed; falling back
      // to the array position keeps the list in the order it was shown.
      sort_order: Number.isFinite(Number(g.sort_order)) ? Math.trunc(Number(g.sort_order)) : out.length,
    })
  }
  return out
}

/**
 * Reconcile the stored checklist against what the client sent.
 *
 * This deliberately does NOT delete-then-recreate. Goal ids are referenced from
 * the Weekly Review (§5.1: "ticking at one place reflects at the other"), so a
 * save that reissues every id would break the other screen's tick targets and
 * lose the tick a user made there a second earlier. Rows the client still knows
 * about are updated in place; only rows it dropped are deleted.
 *
 * Returns `false` when `goals` was absent from the body, so a caller that only
 * meant to change items does not wipe the checklist.
 */
export async function saveGoals(
  planId: string,
  tenantId: string,
  value: unknown,
): Promise<boolean> {
  if (value === undefined) return false

  const incoming = readGoals(value)
  const keptIds = incoming.map(g => g.id).filter((id): id is string => id !== null)

  await prisma.weekly_goals.deleteMany({
    where: {
      weekly_plan_id: planId,
      tenant_id: tenantId,
      ...(keptIds.length ? { id: { notIn: keptIds } } : {}),
    },
  })

  for (const goal of incoming) {
    if (goal.id) {
      // updateMany, not update: the id came from the client, so a row that no
      // longer exists (or belongs to another tenant) must be a no-op, not a throw.
      await prisma.weekly_goals.updateMany({
        where: { id: goal.id, weekly_plan_id: planId, tenant_id: tenantId },
        data: { text: goal.text, is_done: goal.is_done, sort_order: goal.sort_order, updated_at: new Date() },
      })
    } else {
      await prisma.weekly_goals.create({
        data: {
          tenant_id: tenantId,
          weekly_plan_id: planId,
          text: goal.text,
          is_done: goal.is_done,
          sort_order: goal.sort_order,
        },
      })
    }
  }

  return true
}

/**
 * One-time migration of the retired `weekly_plans.week_goal` text into the
 * checklist, run lazily on read.
 *
 * §5.1 replaces the free-text box with a checklist, and the old text is a real
 * sentence a user wrote — discarding it on the release that swaps the control
 * would be silent data loss. It becomes the first checklist row instead.
 *
 * It only fires when the plan still has `week_goal` text AND no checklist rows,
 * so it cannot resurrect a goal the user has since deleted: the same update that
 * writes the row also clears `week_goal`, which is what makes it idempotent.
 */
export async function migrateWeekGoal(planId: string, tenantId: string, weekGoal: string | null) {
  const text = weekGoal?.trim()
  if (!text) return false

  const existing = await prisma.weekly_goals.count({
    where: { weekly_plan_id: planId, tenant_id: tenantId },
  })
  if (existing > 0) {
    // Checklist already won; drop the stale column value so this stops running.
    await prisma.weekly_plans.updateMany({
      where: { id: planId, tenant_id: tenantId },
      data: { week_goal: null },
    })
    return false
  }

  await prisma.weekly_goals.create({
    data: { tenant_id: tenantId, weekly_plan_id: planId, text, is_done: false, sort_order: 0 },
  })
  await prisma.weekly_plans.updateMany({
    where: { id: planId, tenant_id: tenantId },
    data: { week_goal: null },
  })
  return true
}
