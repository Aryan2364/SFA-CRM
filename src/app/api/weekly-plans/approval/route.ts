import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, getDataScope, forbidden } from '@/lib/permissions'
import { scopedUserIds } from '@/lib/scope'

/**
 * §5.2's queue: the plans this caller is allowed to act on as a manager.
 *
 * Why this is not `/api/weekly-plans/review`:
 *
 *  - `review` answers `getVisibleUserIds()` DIRECTLY, ignoring
 *    `role_permissions.data_scope` entirely. A role configured Self-scope but
 *    holding a manual visibility grant gets rows from it that the scope setting
 *    says it must not see. This goes through `scopedUserIds`, which is the one
 *    place §6.6's Self / Team / Company rule is written.
 *  - `review` is a whole-plan read used by the review screens; a queue needs
 *    counts and an owner name, not every line of every plan.
 *
 * Both filter by tenant. Neither may stop doing so.
 */

/**
 * The statuses a manager is being asked to act on.
 *
 * ⚠️ Spelled out, never derived from `SELECT DISTINCT`: the live database holds
 * only four of the seven values `weekly_plans.status` permits, so a derived list
 * would silently omit the ones the queue exists for. Casing is load-bearing —
 * 'Edited by Manager' is a STATUS; 'EditByManager' is an audit `action_type`.
 */
const AWAITING = ['Submitted', 'Resubmitted'] as const

/** Plans a manager has touched but the owner has not yet resubmitted. */
const IN_PROGRESS = ['On Hold', 'Edited by Manager'] as const

/** Everything the queue is willing to show, in the order the tabs appear. */
const DECIDED = ['Approved', 'Rejected'] as const

const QUEUES: Record<string, readonly string[]> = {
  awaiting: AWAITING,
  in_progress: IN_PROGRESS,
  decided: DECIDED,
  all: [...AWAITING, ...IN_PROGRESS, ...DECIDED],
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'view')) return forbidden()
  if (!user.userId) return NextResponse.json({ rows: [], counts: {}, canDecide: false })

  const tid = getTenantId()
  const queue = req.nextUrl.searchParams.get('queue') ?? 'awaiting'
  const statuses = QUEUES[queue] ?? QUEUES.awaiting

  try {
    /*
      The reviewable set. `scopedUserIds` returns null for Company scope (no
      user predicate at all) and INCLUDES the caller for Team scope — which is
      right for a list of "plans I can see" and wrong for a list of "plans I
      approve". Nobody approves their own plan, so the caller is removed here
      rather than in the UI, where removing it would be a courtesy instead of a
      rule.

      Self scope collapses to `[user.userId]`, and then to `[]` — an executive's
      approval queue is empty, which is the correct answer and is what makes the
      screen's "you review nobody" state reachable rather than theoretical.
    */
    const scoped = await scopedUserIds(user, 'weekly_plan')
    const scope = await getDataScope(user, 'weekly_plan')
    const reviewable = scoped === null ? null : scoped.filter(id => id !== user.userId)
    if (reviewable !== null && reviewable.length === 0) {
      return NextResponse.json({ rows: [], counts: {}, scope, canDecide: false })
    }

    const ownerFilter =
      reviewable === null
        ? { user_id: { not: user.userId } }
        : { user_id: { in: reviewable } }

    const [rows, grouped, canDecide] = await Promise.all([
      prisma.weekly_plans.findMany({
        where: { tenant_id: tid, ...ownerFilter, status: { in: [...statuses] } },
        select: {
          id: true,
          user_id: true,
          week_start_date: true,
          week_end_date: true,
          status: true,
          submitted_at: true,
          last_status_changed_at: true,
          manager_comment: true,
          reopen_requested: true,
          reopen_request_message: true,
          users_weekly_plans_user_idTousers: { select: { id: true, name: true, contact: true } },
          _count: { select: { weekly_plan_items: true } },
        },
        orderBy: [{ week_start_date: 'desc' }, { last_status_changed_at: 'desc' }],
      }),
      // The tab counts come from one grouped read rather than four list reads,
      // so every tab's badge is consistent with the others at the same instant.
      prisma.weekly_plans.groupBy({
        by: ['status'],
        where: { tenant_id: tid, ...ownerFilter, status: { in: QUEUES.all as string[] } },
        _count: { _all: true },
      }),
      // Approve / reject / hold / suggest all gate on 'edit'. The screen hides
      // every one of them when this is false, so a viewer with view-only
      // weekly_plan permission gets a readable queue and no button that 403s.
      checkPermission(user, 'weekly_plan', 'edit'),
    ])

    const byStatus: Record<string, number> = {}
    for (const g of grouped) byStatus[g.status] = g._count._all

    const counts = {
      awaiting: AWAITING.reduce((n, s) => n + (byStatus[s] ?? 0), 0),
      in_progress: IN_PROGRESS.reduce((n, s) => n + (byStatus[s] ?? 0), 0),
      decided: DECIDED.reduce((n, s) => n + (byStatus[s] ?? 0), 0),
    }

    // serialize() first: week_start_date is @db.Date and submitted_at is a
    // timestamp, and a raw Date reaching the client through JSON.stringify is
    // exactly the corruption PLAN.md §8.4 lists.
    const serialised = serialize(rows, 'weekly_plans') as Record<string, unknown>[]
    const result = serialised.map(row => {
      const { users_weekly_plans_user_idTousers, _count, ...rest } = row as Record<string, unknown> & {
        users_weekly_plans_user_idTousers?: { id: string; name: string; contact: string } | null
        _count?: { weekly_plan_items: number }
      }
      return {
        ...rest,
        owner: users_weekly_plans_user_idTousers ?? null,
        item_count: _count?.weekly_plan_items ?? 0,
      }
    })

    return NextResponse.json({ rows: result, counts, scope, canDecide })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
