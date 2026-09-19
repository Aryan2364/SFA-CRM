import { prisma } from '@/lib/db'
import type { SessionUser } from '@/lib/auth'
import { checkPermission, type PermSection } from '@/lib/permissions'
import { scopedUserIds } from '@/lib/scope'
import { isSummaryContext, type ContextType } from '../remarks/_context'
import { groupKey, type SummaryAddress } from './_summary-address'

/**
 * WHO MAY SEE WHICH CONVERSATION.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ WHAT WAS WRONG
 *
 * `/api/conversations` authenticated and filtered by `tenant_id`, and that was
 * the whole of its authorisation. Every signed-in user in a tenant received
 * every remark thread in it. A remark is attached to a record, so an executive
 * received a manager's written feedback on another executive's daily summary,
 * and notes on deals and orders he cannot open. In-tenant, not cross-tenant —
 * authenticated but not authorised, the same shape as the weekly-plan holes.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, WHICH IS NOT A NEW ONE
 *
 * `../remarks/_access.ts` already writes it down: a remark is not its own kind
 * of record, it inherits the reach of whatever it is attached to. So a thread
 * is listed to exactly the people who could open its parent — the section's
 * `view` permission, then `scopedUserIds()` over the parent's owner.
 *
 *   1. `checkPermission(section, 'view')` — a role with no view on Deals is
 *      not shown deal notes, whatever its data scope says.
 *   2. `scopedUserIds(section)` — Self / Team / Company, read from
 *      `role_permissions.data_scope`, with the caller always included.
 *
 * ⚠️ NOT `canView()`. `user_visibility` has no self rows, so `canView(me, me)`
 * is false for everybody and the check would deny people their own threads.
 * That was R-15. `scopedUserIds()` includes the caller by construction, which
 * is the reason it exists.
 *
 * ⚠️ A thread the caller may not see is ABSENT, not present-and-locked. A row
 * saying "you cannot open this" still discloses that the record exists and
 * that somebody commented on it.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ THE SECTION MAP IS A MIRROR, AND IT HAS TO STAY ONE
 *
 * `CONTEXT_SECTION` below is the same map as the one in
 * `../remarks/_access.ts`. It is duplicated rather than imported because that
 * one is a module-private `const` and this task does not own that file. The
 * duplication is the risk, so it is named here: if the two ever disagree, a
 * thread is listed that the remarks route then refuses to open, or hidden
 * though it opens fine. Both are typed `Record<ContextType, PermSection>`
 * against the same vocabulary, so at least a NEW context type cannot be
 * forgotten by either — it fails the build. Changing an existing mapping there
 * without changing it here is the drift no type can catch; if you touch one,
 * grep for the other.
 */
const CONTEXT_SECTION: Record<ContextType, PermSection> = {
  meeting: 'meetings',
  expense: 'expenses',
  weekly_plan: 'weekly_plan',
  weekly_plan_day: 'weekly_plan',
  deal: 'deals',
  order: 'orders',
  daily_summary: 'meetings',
  weekly_summary: 'meetings',
}

export type ConversationGroup = {
  context_type: string
  context_id: string
}

/**
 * The owner of each group's parent record, keyed by `${type}::${id}`.
 *
 * A key ABSENT from the map means "no owner could be resolved" — an unassigned
 * deal, or a parent row that is gone. That is not the same as a null owner and
 * it is handled explicitly below; see the note there.
 */
export async function resolveOwners(
  tenantId: string,
  groups: ConversationGroup[],
  summaryAddresses: Map<string, SummaryAddress>
): Promise<Map<string, string>> {
  const owners = new Map<string, string>()
  const idsOf = (type: string) =>
    groups.filter(g => g.context_type === type).map(g => g.context_id)

  const put = (type: string, id: string, userId: string | null) => {
    if (userId) owners.set(groupKey(type, id), userId)
  }

  const meetingIds = idsOf('meeting')
  if (meetingIds.length > 0) {
    const rows = await prisma.daily_visits.findMany({
      where: { tenant_id: tenantId, id: { in: meetingIds } },
      select: { id: true, user_id: true },
    })
    for (const r of rows) put('meeting', r.id, r.user_id)
  }

  const expenseIds = idsOf('expense')
  if (expenseIds.length > 0) {
    const rows = await prisma.expenses.findMany({
      where: { tenant_id: tenantId, id: { in: expenseIds } },
      select: { id: true, user_id: true },
    })
    for (const r of rows) put('expense', r.id, r.user_id)
  }

  const planIds = idsOf('weekly_plan')
  if (planIds.length > 0) {
    const rows = await prisma.weekly_plans.findMany({
      where: { tenant_id: tenantId, id: { in: planIds } },
      select: { id: true, user_id: true },
    })
    for (const r of rows) put('weekly_plan', r.id, r.user_id)
  }

  /* A plan DAY is an item on a plan, and the plan carries the owner — the same
     two hops `resolveContextOwner` makes, done in bulk. */
  const dayIds = idsOf('weekly_plan_day')
  if (dayIds.length > 0) {
    const items = await prisma.weekly_plan_items.findMany({
      where: { tenant_id: tenantId, id: { in: dayIds } },
      select: { id: true, weekly_plan_id: true },
    })
    const plans = await prisma.weekly_plans.findMany({
      where: {
        tenant_id: tenantId,
        id: { in: [...new Set(items.map(i => i.weekly_plan_id))] },
      },
      select: { id: true, user_id: true },
    })
    const planOwner = new Map(plans.map(p => [p.id, p.user_id]))
    for (const i of items) put('weekly_plan_day', i.id, planOwner.get(i.weekly_plan_id) ?? null)
  }

  /* `deals.owner_user_id` is nullable — an unassigned deal belongs to nobody. */
  const dealIds = idsOf('deal')
  if (dealIds.length > 0) {
    const rows = await prisma.deals.findMany({
      where: { tenant_id: tenantId, id: { in: dealIds } },
      select: { id: true, owner_user_id: true },
    })
    for (const r of rows) put('deal', r.id, r.owner_user_id)
  }

  const orderIds = idsOf('order')
  if (orderIds.length > 0) {
    const rows = await prisma.orders.findMany({
      where: { tenant_id: tenantId, id: { in: orderIds } },
      select: { id: true, user_id: true },
    })
    for (const r of rows) put('order', r.id, r.user_id)
  }

  /* A summary has no parent row; its owner is the person the derived id was
     built from, which `_summary-address.ts` has already recovered. */
  for (const [key, address] of summaryAddresses) owners.set(key, address.userId)

  return owners
}

/**
 * The keys of the groups this caller may be shown. Everything else is dropped
 * from the list entirely.
 */
export async function visibleGroupKeys(
  user: SessionUser,
  groups: ConversationGroup[],
  owners: Map<string, string>
): Promise<Set<string>> {
  const visible = new Set<string>()

  /* One permission read and one scope resolution per SECTION, not per row.
     Several context types share a section, and a list of threads can be long. */
  const sections = new Map<
    PermSection,
    { canView: boolean; allowed: string[] | null }
  >()
  for (const g of groups) {
    const section = CONTEXT_SECTION[g.context_type as ContextType]
    if (!section || sections.has(section)) continue
    sections.set(section, {
      canView: await checkPermission(user, section, 'view'),
      allowed: null,
    })
    const entry = sections.get(section)!
    if (entry.canView) entry.allowed = await scopedUserIds(user, section)
  }

  for (const g of groups) {
    const type = g.context_type as ContextType
    const section = CONTEXT_SECTION[type]
    /*
     * An unknown context type has no section to borrow, so there is nothing to
     * authorise it against. It is dropped. A row written by a future version
     * of the app must not become readable by everyone because this one does
     * not recognise it yet.
     */
    if (!section) continue
    const entry = sections.get(section)
    if (!entry?.canView) continue

    const key = groupKey(g.context_type, g.context_id)
    const owner = owners.get(key)

    if (!owner) {
      /*
       * Nobody owns the parent — an unassigned deal, or a row that is gone.
       * There is no user to scope against, so the section's view permission is
       * the only gate. That is exactly the answer `../remarks/_access.ts`
       * gives, and the two MUST agree: stricter here would hide a thread the
       * remarks route will happily open, which is over-tightening rather than
       * safety.
       *
       * A summary is never in this branch — a summary whose owner could not be
       * recovered is not listed at all, because it also cannot be opened.
       */
      if (isSummaryContext(type)) continue
      visible.add(key)
      continue
    }

    // `null` is Company scope: no user predicate, everyone is reachable.
    if (entry.allowed === null || entry.allowed.includes(owner)) visible.add(key)
  }

  return visible
}
