import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { computeItemsDiff, isEmptyDiff } from '@/lib/weekly-plan-diff'
import { toItemRows } from '../../_items'
import { loadPartyLabels, toDiffLines, writesToDiffLines } from '../../_diff'
import { EDIT_ALLOWED_FROM } from '@/components/weekly-plan/approval-types'
import {
  StaleStatus, notifyAfterCommit, canReview, claimStatus, notActionable, staleConflict,
  badVersion, expectedVersion, isPlanId, planNotFound, readPlanVersion,
} from '../../_transition'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  // .catch: a malformed body is an empty edit below, not an unhandled throw.
  const body = await req.json().catch(() => ({}))
  const { items, comment } = body
  const expected = expectedVersion(body)
  if (expected === false) return badVersion()
  const tid = getTenantId()
  // Before the raw version SQL, whose `::uuid` cast would 500 on it.
  if (!isPlanId(params.id)) return planNotFound()

  try {
    const now = new Date()

    /*
      ⚠️ Same hole as `submit`, and worse in effect: this route REPLACES the
      plan's entire item list and forces the status to 'Edited by Manager', yet
      it selected only `{status}` — it never loaded `user_id`, so it had no
      authorisation of any kind. Any authenticated caller could rewrite any
      plan's lines while the audit row recorded them as actor_role 'Manager'.
      The unfiltered plan id meant it did not stop at the tenant boundary either.

      Every sibling manager verb (approve / reject / hold / suggest /
      accept-reopen / decline-reopen) gates on `canReview` — the rule the
      approval queue lists by; this one is held to the same rule, so a manager
      edits exactly the plans their queue offers and nobody else's.
    */
    // The version the manager's screen showed. Without one (an older client),
    // the version read here, before the plan and its lines — see
    // `readPlanVersion`.
    const version = expected ?? (await readPlanVersion(params.id, tid))
    const plan = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { status: true, user_id: true },
    })
    if (!plan || version === null) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (!(await canReview(user, plan.user_id, tid))) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }
    // A manager edits a plan that is waiting on them, or one they (or a
    // suggest) already sent back — edit again, then approve. Draft was never
    // submitted and Approved / Rejected are decided. From Edited by Manager the
    // owner may be editing it right now through PUT, which replaces the same
    // item list; the version claim below makes exactly one land.
    if (!EDIT_ALLOWED_FROM.includes(plan.status)) return notActionable(plan.status)

    /*
      §5.2: "The User must be able to see what changes his Manager made."

      The before/after is captured HERE and nowhere else. `deleteMany` two
      statements down destroys the only copy of the previous lines, so a diff
      computed at read time is not merely expensive — it is impossible. See the
      header of `src/lib/weekly-plan-diff.ts` for the decision and its
      alternatives.

      Party names are resolved in ONE pair of queries covering both sides, so
      adding a line and removing another costs the same two reads as changing a
      count, and both sides agree on the spelling of a name.
    */
    const previous = await prisma.weekly_plan_items.findMany({
      where: { weekly_plan_id: params.id, tenant_id: tid },
      orderBy: [{ plan_date: 'asc' }, { created_at: 'asc' }],
    })
    const rows = toItemRows(items, tid, params.id)
    const labels = await loadPartyLabels(
      [...previous, ...rows]
        .map(r => r.party_id)
        .filter((id): id is string => Boolean(id)),
      tid,
    )
    const diff = computeItemsDiff(
      await toDiffLines(previous, tid, labels),
      writesToDiffLines(rows, labels),
    )

    // Replace items. deleteMany is required anyway (the original .delete() never
    // errored on zero matches), and plan_date is @db.Date so the incoming
    // "YYYY-MM-DD" strings must become Date objects.
    // Shares `toItemRows` with the user's own save path so a manager edit cannot
    // silently drop the party a line carries: the old `{ ...item }` spread wrote
    // back exactly the keys the manager screen happened to send, which is how a
    // new column gets lost the first time a manager touches a plan.
    //
    // ONE transaction, status claim first. The delete destroys the only copy of
    // the owner's lines, so it must never survive a failed insert, status write
    // or audit row — before this, a createMany failure left the plan Submitted
    // with no lines and nothing recorded. Claiming the status first also takes
    // the row lock, so a concurrent decision or second edit gets a 409, not a
    // half-applied interleaving.
    try {
      await prisma.$transaction(async tx => {
        await claimStatus(
          tx,
          { id: params.id, tenant_id: tid, status: plan.status },
          { status: 'Edited by Manager', manager_comment: comment || null, last_status_changed_at: now, updated_at: now },
          // The status AND the version: from Edited by Manager this write
          // leaves the status as it was, so the status alone would let it and
          // an owner PUT both commit (see `PLAN_VERSION`). It also keeps the
          // diff above true — it was computed from the lines at that version,
          // which is the version the manager was looking at.
          version,
        )

        await tx.weekly_plan_items.deleteMany({ where: { weekly_plan_id: params.id, tenant_id: tid } })
        if (rows.length) await tx.weekly_plan_items.createMany({ data: rows })

        await tx.weekly_plan_audit_logs.create({
          data: {
            tenant_id: tid, weekly_plan_id: params.id,
            actor_user_id: user.userId, actor_role: 'Manager',
            action_type: 'EditByManager',
            previous_status: plan.status, new_status: 'Edited by Manager',
            comment: comment || null,
            // An edit that changed no line writes NO payload rather than an empty
            // one, so the owner's screen does not announce "your manager changed
            // your plan" and then list nothing. The status change and the comment
            // still stand on their own.
            edited_fields: isEmptyDiff(diff) ? undefined : diff,
          },
        })
      })
    } catch (err) {
      if (err instanceof StaleStatus) return staleConflict(params.id, tid, plan.status)
      throw err
    }

    // Notify plan owner. The other four manager verbs each do this; this one —
    // the only one that rewrites the owner's actual lines — did not, so the
    // person whose plan changed was the last to hear about it.
    // After commit, best-effort: see `notifyAfterCommit`.
    await notifyAfterCommit({
      tenant_id: tid,
      recipient_id: plan.user_id,
      actor_id: user.userId,
      section: 'weekly_plan',
      context_type: 'weekly_plan',
      context_id: params.id,
      redirect_path: '/weekly-plan',
      message: comment
        ? `Your manager edited your weekly plan. Comment: ${comment}`
        : 'Your manager edited your weekly plan.',
    }, { title: 'Weekly plan', body: 'Your manager edited your weekly plan' })

    return NextResponse.json({ ok: true, changes: diff })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
