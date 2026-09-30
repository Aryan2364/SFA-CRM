import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { SessionUser } from '@/lib/auth'
import { getDataScope } from '@/lib/permissions'
import { canView, getVisibleUserIds } from '@/lib/visibility'
import { awardPoint } from '@/lib/points'
import { notActionableReason } from '@/components/weekly-plan/approval-types'

/**
 * Shared by the manager verbs (approve / reject / hold / suggest /
 * edit-by-manager / accept-reopen / decline-reopen) and the approval queue.
 *
 * The allowed-from table itself lives in `approval-types.ts`, beside
 * `DECISIONS`, so the review panel disables exactly what these routes refuse.
 */

/**
 * WHO may act on a plan — the one rule the queue lists by and the verbs
 * enforce. The two used to differ: the queue listed by `data_scope` (Company
 * scope = every plan in the tenant), the verbs gated on `canView`, so an
 * Administrator saw forty plans and got 403 on most of them.
 *
 * The rule:
 *  - An ADMINISTRATOR may act on any plan in their tenant except their own.
 *    This is the backstop that guarantees every plan has a reviewer: a user
 *    with no manager, or whose manager is deactivated or Self-scoped, has
 *    nobody above them in `user_visibility`, and without it their plan could
 *    never be approved. The test is `user.role === 'Administrator'` — the
 *    same one `checkPermission` / `getDataScope` use — which `requireUser()`
 *    re-resolves from `users.profile` and `users.status` on every request, so
 *    a forged cookie role and a deactivated Administrator both fail it.
 *  - Everyone else: the owner is below the caller in `user_visibility` (the
 *    manager chain, plus any manual grant) — approval authority follows
 *    reporting lines, and Company scope is a READ setting, not a licence to
 *    decide anyone's week — and the caller's `weekly_plan` scope is not Self.
 *  - Never the caller's own plan, even if a manual (me, me) grant exists.
 */
function isAdministrator(user: SessionUser): boolean {
  return user.role === 'Administrator'
}

/**
 * The owners whose plans the caller may act on. `null` means "every user in
 * the tenant except the caller" (an Administrator) — the caller's own filter
 * must then be `{ user_id: { not: user.userId } }` alongside `tenant_id`.
 */
export async function reviewableUserIds(
  user: SessionUser,
  tenantId: string,
): Promise<string[] | null> {
  if (!user.userId) return []
  if (isAdministrator(user)) return null
  if ((await getDataScope(user, 'weekly_plan')) === 'own') return []
  const ids = await getVisibleUserIds(user.userId, tenantId)
  return ids.filter(id => id !== user.userId)
}

/**
 * `reviewableUserIds` for one owner, without loading the whole set. Callers
 * pass the `user_id` of a plan they loaded by (id, tenant_id), so for an
 * Administrator "in the tenant" is already established.
 */
export async function canReview(
  user: SessionUser,
  ownerId: string,
  tenantId: string,
): Promise<boolean> {
  if (!user.userId || ownerId === user.userId) return false
  if (isAdministrator(user)) return true
  if ((await getDataScope(user, 'weekly_plan')) === 'own') return false
  return canView(user.userId, ownerId, tenantId)
}

/**
 * May the caller READ this owner's plan (the plan, its audit trail, its
 * checklist)? Their own, anyone below them in `user_visibility`, OR anyone
 * they may review.
 *
 * The last clause is the Administrator backstop: the queue lists every plan in
 * the tenant for an Administrator (see `canReview`), so a read gated on
 * `canView` alone 403'd the panel for exactly the plans the backstop exists
 * for — a rep with no manager, or a deactivated one — and the decision the
 * routes would accept was unreachable on screen.
 *
 * `reviewable` lets a caller that has already asked `canReview` skip the
 * second lookup.
 */
export async function canReadPlan(
  user: SessionUser,
  ownerId: string,
  tenantId: string,
  reviewable?: boolean,
): Promise<boolean> {
  if (!user.userId) return false
  if (ownerId === user.userId) return true
  if (reviewable ?? (await canReview(user, ownerId, tenantId))) return true
  return canView(user.userId, ownerId, tenantId)
}

/**
 * Thrown inside a transition's transaction when the conditional status write
 * matched no row — another request moved the plan between our read and our
 * write. Throwing (rather than returning) is what rolls the transaction back.
 */
export class StaleStatus extends Error {
  constructor() {
    super('stale status')
  }
}

/**
 * The status write every transition makes, conditional on the status it READ.
 *
 * Postgres re-checks the predicate after waiting on a concurrent writer's row
 * lock, so of two managers acting on the same Submitted plan exactly one gets
 * count 1; the other gets 0 and its whole transaction is discarded. Matching
 * the exact status read (not merely "any allowed status") is also what makes
 * the audit row's `previous_status` true.
 *
 * With `version`, the plan must also still be at that version (see
 * `PLAN_VERSION`) — a write that keeps the status cannot then slip past.
 *
 * Every claim bumps `updated_at`, whether or not the caller's `data` does: in
 * production the `weekly_plans_updated_at` trigger would move it anyway, so
 * setting it here is what makes a scratch database (no trigger) behave the
 * same. It is also the intended behaviour: a reopen request, a declined one or
 * an undone submit changes what the other side may do, so a screen opened
 * before it should reload rather than act on the old picture.
 */
export async function claimStatus(
  tx: Prisma.TransactionClient,
  /** Any extra predicate (e.g. `reopen_requested: true`) is claimed too. */
  where: Prisma.weekly_plansWhereInput & { id: string; tenant_id: string; status: string },
  data: Prisma.weekly_plansUpdateManyMutationInput,
  version?: string,
): Promise<void> {
  if (version !== undefined) await claimVersion(tx, where.id, where.tenant_id, version)
  const { count } = await tx.weekly_plans.updateMany({ where, data: { updated_at: new Date(), ...data } })
  if (count !== 1) throw new StaleStatus()
}

/**
 * A plan's VERSION: `updated_at` as whole microseconds since the epoch, as
 * text, computed by Postgres. The second half of every claim is "and this is
 * still the version I was shown" (see `claimStatus`).
 *
 * Why the version exists at all: the status alone is not enough once a write
 * can leave it unchanged. The owner's PUT keeps Edited by Manager, and so does
 * a manager's second edit, so two such writes both match the status and the
 * second silently replaces the first's lines. Every write that can leave the
 * status as it was (PUT, edit-by-manager) bumps `updated_at`, and every claim
 * that could race one (those two, submit and the decisions) claims a version.
 *
 * Why it is computed IN SQL and never round-tripped through a JS `Date`:
 * `@prisma/adapter-pg` is not timezone-safe for timestamptz. It READS a value
 * by replacing whatever offset Postgres printed with `+00:00`
 * (`normalize_timestamptz`), and it SENDS a `Date` parameter as a naive
 * `YYYY-MM-DD HH:MM:SS.mmm` that Postgres interprets in the session TimeZone
 * (`formatDateTime`). On a UTC session both are right. On any other session
 * the value Prisma hands us is shifted by the session offset, so:
 *  - a claim that casts that value explicitly (`$1::timestamptz` with a `Z`)
 *    misses on EVERY request and every plan write 409s; and
 *  - a claim that sends it back as a Prisma `Date` only matches because the
 *    two shifts cancel — it depends on the adapter's bug staying as it is.
 * `extract(epoch from timestamptz)` is defined on the instant, not on how it is
 * printed, so the version is the same whatever the session TimeZone, and the
 * DB computes both sides, so the comparison is exact (no ±1 ms window, no
 * ms/µs truncation). Proven against a throwaway Postgres 18 cluster with the
 * adapter's own codec: under Asia/Kolkata, America/New_York and
 * Pacific/Chatham the explicit-`Z` claim matched 0 times, the version claim 1.
 *
 * ⚠️ Production has a `weekly_plans_updated_at` trigger that moves `updated_at`
 * on ANY update of the row; a scratch database built by `prisma db push` does
 * not (it drops triggers), so the write-path suites cannot see this. Any write
 * to a plan row — even an incidental one, like clearing `week_goal` — changes
 * the version and makes every open screen's next write 409. So: a read path
 * that writes the plan must do so BEFORE it reads the version it returns, and
 * a write that is meant to invalidate open screens bumps `updated_at` itself
 * (see `claimStatus`) so scratch and production agree.
 */
const PLAN_VERSION = Prisma.sql`(extract(epoch from updated_at) * 1000000)::bigint::text`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Is `id` shaped like a plan id? The version SQL casts it (`::uuid`), and a
 * malformed one fails the cast with a 500; every `[id]` route that reaches
 * that SQL answers `planNotFound()` first instead — nothing has that id.
 */
export function isPlanId(id: string): boolean {
  return UUID.test(id)
}

export function planNotFound() {
  return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
}

/**
 * The version of one plan, or null when there is no such plan in the tenant.
 *
 * A caller that also reads the plan reads the version FIRST: if a write lands
 * between the two reads, the version is the older one and the next claim
 * 409s. Read the other way round, it could pair OLD content with the NEW
 * version, and a claim would then accept a decision on content never shown.
 */
export async function readPlanVersion(
  id: string,
  tenantId: string,
  /** A transaction, to read the version a write inside it just left. */
  client: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma,
): Promise<string | null> {
  if (!isPlanId(id)) return null
  const rows = await client.$queryRaw<{ version: string }[]>`
    SELECT ${PLAN_VERSION} AS version FROM weekly_plans
     WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
  `
  return rows[0]?.version ?? null
}

/**
 * The versions of every plan these owners have, by plan id — for a list read.
 * Read before the list, for the reason in `readPlanVersion`.
 */
export async function readPlanVersionsByOwner(
  ownerIds: string[],
  tenantId: string,
): Promise<Map<string, string>> {
  if (ownerIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw<{ id: string; version: string }[]>`
    SELECT id::text AS id, ${PLAN_VERSION} AS version FROM weekly_plans
     WHERE tenant_id = ${tenantId}::uuid AND user_id = ANY(${ownerIds}::uuid[])
  `
  return new Map(rows.map(r => [r.id, r.version]))
}

/**
 * The `expected_version` a screen sent with a write — the version it rendered.
 * `undefined` when absent (an older client or a script: the route then claims
 * the version it reads itself, which still stops overlapping requests but not
 * a stale screen), `false` when present but malformed (the route 400s).
 */
export function expectedVersion(body: unknown): string | undefined | false {
  const raw = (body as { expected_version?: unknown } | null)?.expected_version
  if (raw === undefined || raw === null) return undefined
  return typeof raw === 'string' && /^\d{1,19}$/.test(raw) ? raw : false
}

export function badVersion() {
  return NextResponse.json({ error: 'expected_version must be the version the plan was read at' }, { status: 400 })
}

/** The one message for a write whose version no longer matches. */
export const CHANGED_SINCE_OPENED = 'This plan changed since you opened it. Reload to see the latest version.'

/**
 * Lock the plan row, provided it is still at `version`. Run first inside the
 * transaction, before the status write.
 *
 * `FOR UPDATE` is what makes the check and the write one step: a concurrent
 * writer holding the row makes this wait, and Postgres then re-evaluates the
 * predicate against the row that writer committed — so the loser sees no row
 * (also proven on the throwaway cluster). Holding the lock, nothing can change
 * the row between here and `claimStatus`'s conditional update.
 */
async function claimVersion(
  tx: Prisma.TransactionClient,
  id: string,
  tenantId: string,
  version: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM weekly_plans
     WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND ${PLAN_VERSION} = ${version}
       FOR UPDATE
  `
  if (rows.length !== 1) throw new StaleStatus()
}

/** The 409 for a verb refused from `status`. */
export function notActionable(status: string) {
  return NextResponse.json({ error: notActionableReason(status) }, { status: 409 })
}

/**
 * The 409 after a `StaleStatus`: re-read what the plan became, so the message
 * names the state that won ("already approved") rather than a generic clash.
 * When the status is still the one read, what won was a write that kept it
 * (an owner save, another manager edit — see `PLAN_VERSION`), or the plan
 * moved on since the screen was loaded, and the status reason would be wrong,
 * so say the plan changed.
 */
export async function staleConflict(id: string, tenantId: string, readStatus?: string) {
  const now = await prisma.weekly_plans.findFirst({
    where: { id, tenant_id: tenantId },
    select: { status: true },
  })
  if (now && now.status === readStatus) {
    return NextResponse.json(
      { error: CHANGED_SINCE_OPENED },
      { status: 409 },
    )
  }
  return notActionable(now?.status ?? '')
}

/**
 * A transition's notification, written AFTER its transaction commits and never
 * allowed to fail it.
 *
 * Deliberately outside the transaction: the notification is secondary to the
 * decision. Inside it, a notification row that fails for a data reason — a
 * recipient id whose user row is gone, say — would roll back a decision that
 * was otherwise valid and 500 it, and because the bad data does not go away,
 * the same plan would be blocked on every retry, forever. So it is logged and
 * swallowed; the status and audit row already stand.
 */
export async function notifyAfterCommit(
  data: Prisma.notificationsUncheckedCreateInput,
): Promise<void> {
  try {
    await prisma.notifications.create({ data })
  } catch (err) {
    console.error(
      `[weekly-plans] notification for plan ${data.context_id} to ${data.recipient_id} failed`,
      err,
    )
  }
}

/**
 * A plan's point, at most once per (plan, action) — called after the
 * transition has COMMITTED, never inside it: a points failure must not undo a
 * decision, and a rolled-back decision must not have awarded anything.
 *
 * The status guard already stops a repeat approve of the SAME decision; this
 * stops the longer loop (approve → reopen → resubmit → approve, or submit →
 * undo → submit) from paying out again for one week's plan. `awardPoint` only
 * de-duplicates through `cap_per_day`, which is nullable.
 *
 * Fire-and-forget by design, so the `.catch` is load-bearing: without it a
 * rejected promise is an unhandledRejection, which can take the process down.
 */
export function awardOncePerPlan(
  tenantId: string,
  userId: string,
  actionType: 'weekly_plan_submitted' | 'weekly_plan_approved',
  planId: string,
  description: string,
): void {
  void (async () => {
    const already = await prisma.point_events.count({
      where: {
        tenant_id: tenantId, user_id: userId, action_type: actionType,
        ref_type: 'weekly_plan', ref_id: planId,
      },
    })
    if (already > 0) return
    await awardPoint(tenantId, userId, actionType, {
      refType: 'weekly_plan', refId: planId, description,
    })
  })().catch(err => {
    console.error(`[weekly-plans] ${actionType} point for plan ${planId} failed`, err)
  })
}

/**
 * One manager decision — approve / reject / hold / suggest — end to end.
 *
 * Order, and why:
 *  1. Load the plan by (id, tenant) → 404.
 *  2. `canReview` → 403. Same rule the queue lists by.
 *  3. Current status in `allowedFrom` → else 409 naming the state it is in.
 *     This is what stops a second Approve (and its second point), a Rejected
 *     Draft, or a decision reversed three weeks later from the Decided tab.
 *  4. ONE transaction: the conditional status write and the audit row. A
 *     failure in either rolls both back, so the caller is never told "could
 *     not approve" about a plan that IS approved — which is what used to make
 *     the retry double-award.
 *  5. After commit, best-effort: the owner's notification (`notifyAfterCommit`).
 *
 * Returns the response, and the plan owner's id only when the transition
 * committed — the caller runs any post-commit side effect (points) on that.
 */
export async function runDecision(opts: {
  user: SessionUser
  tenantId: string
  planId: string
  allowedFrom: readonly string[]
  newStatus: string
  actionType: string
  comment: string | null
  /** The `weekly_plans` fields the decision writes besides the status. */
  planData: Prisma.weekly_plansUpdateManyMutationInput
  message: string
  /** The request body's `expected_version` (see `expectedVersion`). */
  expectedVersion: string | undefined | false
}): Promise<{ response: NextResponse; ownerId: string | null }> {
  const { user, tenantId: tid, planId } = opts
  if (!isPlanId(planId)) return { response: planNotFound(), ownerId: null }
  if (opts.expectedVersion === false) return { response: badVersion(), ownerId: null }
  // The version the manager's screen showed. Without one (an older client),
  // the version read here, before the plan — see `readPlanVersion`.
  const version = opts.expectedVersion ?? (await readPlanVersion(planId, tid))
  const plan = await prisma.weekly_plans.findFirst({
    // tenant_id, not the id alone: the id is a global key, so without this
    // a guessed uuid reaches another tenant plan and nothing crashes.
    where: { id: planId, tenant_id: tid },
    select: { status: true, user_id: true },
  })
  if (!plan || version === null) {
    return { response: NextResponse.json({ error: 'Plan not found' }, { status: 404 }), ownerId: null }
  }
  if (!(await canReview(user, plan.user_id, tid))) {
    return { response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }), ownerId: null }
  }
  if (!opts.allowedFrom.includes(plan.status)) {
    return { response: notActionable(plan.status), ownerId: null }
  }

  try {
    await prisma.$transaction(async tx => {
      await claimStatus(
        tx,
        { id: planId, tenant_id: tid, status: plan.status },
        { ...opts.planData, status: opts.newStatus, last_status_changed_at: new Date(), updated_at: new Date() },
        version,
      )
      await tx.weekly_plan_audit_logs.create({
        data: {
          tenant_id: tid, weekly_plan_id: planId,
          actor_user_id: user.userId, actor_role: 'Manager',
          action_type: opts.actionType,
          previous_status: plan.status, new_status: opts.newStatus,
          comment: opts.comment,
        },
      })
    })
  } catch (err) {
    if (err instanceof StaleStatus) return { response: await staleConflict(planId, tid, plan.status), ownerId: null }
    throw err
  }

  await notifyAfterCommit({
    tenant_id: tid,
    recipient_id: plan.user_id,
    actor_id: user.userId,
    section: 'weekly_plan',
    context_type: 'weekly_plan',
    context_id: planId,
    redirect_path: '/weekly-plan',
    message: opts.message,
  })

  return { response: NextResponse.json({ ok: true }), ownerId: plan.user_id }
}
