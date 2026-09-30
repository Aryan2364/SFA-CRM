import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { readItemsDiff } from '@/lib/weekly-plan-diff'
import { readOthers, carriedNote, toItemRows } from '../_items'
import { loadGoals, migrateWeekGoal, saveGoals } from '../_goals'
import { loadPartyLabels } from '../_diff'
import {
  CHANGED_SINCE_OPENED, StaleStatus, badVersion, canReadPlan, canReview, claimStatus, expectedVersion,
  isPlanId, planNotFound, readPlanVersion,
} from '../_transition'

/**
 * One plan, everything a reviewer needs to decide on it: the lines with their
 * party names resolved, the §5.1 goal checklist, and the audit trail with each
 * manager edit's before/after payload already parsed.
 *
 * Only PUT lived on this path. The approval screen needed a plan by id, and the
 * two alternatives were both wrong: `/my` is keyed on the CALLER's user id and
 * week, so a manager cannot reach a subordinate's plan through it, and `/review`
 * returns every plan of every subordinate to read one.
 *
 * Authorisation is the view permission, then `canReadPlan`: owner, visible, or
 * reviewable — the same rule `logs` and `goals` read through.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'view')) return forbidden()
  const tid = getTenantId()
  if (!isPlanId(params.id)) return planNotFound()

  try {
    const head = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { user_id: true, week_goal: true },
    })
    if (!head) return planNotFound()
    if (!user.userId) return NextResponse.json({ error: 'User not in DB' }, { status: 400 })
    // Asked once: it gates the read (the Administrator backstop, see
    // `canReadPlan`) and travels back as `canReview`, so the panel disables the
    // manager verbs from the server's own answer rather than re-deriving it.
    const reviewable = await canReview(user, head.user_id, tid)
    if (!(await canReadPlan(user, head.user_id, tid, reviewable))) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // The legacy `week_goal` fold `/my` does, done here too and BEFORE the
    // version: it writes the plan row, which moves the version (see
    // `PLAN_VERSION`). Otherwise a manager who opened an older plan before its
    // owner did would have their decision 409 the moment the owner looked.
    await migrateWeekGoal(params.id, tid, head.week_goal)

    // Then the version, then the plan — never the plan first: see `readPlanVersion`.
    const version = await readPlanVersion(params.id, tid)
    const plan = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      include: {
        weekly_plan_items: { orderBy: [{ plan_date: 'asc' }, { created_at: 'asc' }] },
        users_weekly_plans_user_idTousers: { select: { id: true, name: true, contact: true } },
      },
    })
    if (!plan) return planNotFound()

    const [labels, logs, goals] = await Promise.all([
      loadPartyLabels(
        plan.weekly_plan_items
          .map(i => i.party_id)
          .filter((id): id is string => Boolean(id)),
        tid,
      ),
      prisma.weekly_plan_audit_logs.findMany({
        where: { weekly_plan_id: params.id, tenant_id: tid },
        include: { users: { select: { name: true } } },
        orderBy: { timestamp: 'desc' },
      }),
      loadGoals(params.id, tid),
    ])

    const { users_weekly_plans_user_idTousers, weekly_plan_items, ...rest } = plan
    const serialised = serialize(
      { ...rest, weekly_plan_items },
      'weekly_plans',
    ) as Record<string, unknown> & { weekly_plan_items: Record<string, unknown>[] }

    return NextResponse.json({
      ...serialised,
      owner: users_weekly_plans_user_idTousers ?? null,
      // Whether the caller may act on this plan at all — the rule every
      // manager verb enforces. Status is a separate gate (`allowedFrom`).
      canReview: reviewable,
      // What every manager decision and edit sends back as `expected_version`,
      // so one made on this screen after the plan moved on is refused.
      version,
      // The party's name travels with the line so the screen renders it without
      // loading the whole company master, and a line whose party has since been
      // deleted reads as blank rather than as a uuid.
      weekly_plan_items: serialised.weekly_plan_items.map((item, i) => ({
        ...item,
        party_label: weekly_plan_items[i].party_id
          ? labels.get(weekly_plan_items[i].party_id!) ?? null
          : null,
        // The legacy Others count is still stranded in `notes` on rows written
        // before `others_goal` existed; read it the one way `_items.ts` defines.
        others_goal: readOthers(weekly_plan_items[i].others_goal, weekly_plan_items[i].notes),
        notes: carriedNote(weekly_plan_items[i].notes),
      })),
      weekly_goals: goals,
      logs: (serialize(logs, 'weekly_plan_audit_logs') as Record<string, unknown>[]).map(
        (log, i) => ({
          ...log,
          // Parsed once, here, so neither the manager's screen nor the owner's
          // has to know the payload's shape or its version rules.
          changes: readItemsDiff(logs[i].edited_fields),
        }),
      ),
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'edit')) return forbidden()
  if (!isPlanId(params.id)) return planNotFound()
  const body = await req.json()
  const { items, day_notes, goals } = body
  const expected = expectedVersion(body)
  if (expected === false) return badVersion()
  const tid = getTenantId()

  try {
    // Every write below carries tenant_id as well as the plan id. The id alone
    // is a global key: without the tenant predicate a guessed uuid would let one
    // tenant rewrite another's plan, and nothing would crash.
    // The version the owner's screen showed. Without one (an older client),
    // the version read here, before the plan — which still stops an
    // overlapping write, just not a stale screen. See `readPlanVersion`.
    const version = expected ?? (await readPlanVersion(params.id, tid))
    const target = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      select: { id: true, user_id: true, status: true },
    })
    if (!target || version === null) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    /*
      ⚠️ This route had NO authorisation at all beyond "is logged in", and it
      replaces a plan's entire item list. Measured on the local database: signed
      in as one Standard user, `PUT` on a PEER's plan id returned 200 and deleted
      all six of their lines, writing an `Update` audit row under the attacker's
      user id. Nothing in the tenant filter catches that — both users are in the
      same tenant. This is the owner's own edit path (a manager has
      `edit-by-manager`), so the owner is the only caller it should ever accept.
    */
    if (!user.userId || target.user_id !== user.userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    /*
      ...and it did not check the status either, so the same call rewrote an
      APPROVED plan. `canEdit` on the screen gates every input on exactly these
      three statuses and `handleSubmit` only PUTs while the plan is in one of
      them, so this refuses precisely what the UI already refuses to send —
      rather than leaving the freeze as a client-side courtesy.
    */
    const EDITABLE = ['Draft', 'Rejected', 'Edited by Manager']
    if (!EDITABLE.includes(target.status)) {
      return NextResponse.json(
        { error: 'Plan is not editable in its current status' },
        { status: 400 },
      )
    }

    /*
      ONE transaction: plan fields, the item replacement, the checklist and the
      audit row. The delete destroys the only copy of the lines, so it must
      never survive a failed insert.

      The first write is conditional on the status read above — the same claim
      the status verbs make. A Submit (from another tab) landing between that
      read and these writes used to let this save replace the lines of a plan
      that was already with the manager; now it matches no row and the save is
      refused whole. `updated_at` is what it writes when there are no plan
      fields to change, so the claim always has something to set.
    */
    let savedVersion: string | null = null
    try {
      await prisma.$transaction(async tx => {
        await claimStatus(
          tx,
          { id: params.id, tenant_id: tid, status: target.status },
          { updated_at: new Date(), ...(day_notes !== undefined ? { day_notes } : {}) },
          // ...and still at the version the owner was shown: a manager edit
          // also leaves Edited by Manager as it was (see `PLAN_VERSION`).
          version,
        )
        // The version THIS write left, read inside the transaction while it
        // holds the row. Read after the commit, a manager edit landing in that
        // instant would hand the owner its version, and their next Submit
        // would carry lines they never saw. Nothing below writes the plan row.
        savedVersion = await readPlanVersion(params.id, tid, tx)

        // Replace items. deleteMany is required anyway (the original .delete() never
        // errored on zero matches), and plan_date is @db.Date so the incoming
        // "YYYY-MM-DD" strings must become Date objects.
        await tx.weekly_plan_items.deleteMany({ where: { weekly_plan_id: params.id, tenant_id: tid } })
        const rows = toItemRows(items, tid, params.id)
        if (rows.length) await tx.weekly_plan_items.createMany({ data: rows })

        // §5.1 checklist. Unlike items this is reconciled, not replaced — see
        // `_goals.ts`: the ids are the Weekly Review's tick targets.
        await saveGoals(params.id, tid, goals, tx)

        // Update carries no status change, so previous_status/new_status stay null.
        await tx.weekly_plan_audit_logs.create({
          data: {
            tenant_id: tid, weekly_plan_id: params.id,
            actor_user_id: user.userId, actor_role: 'User',
            action_type: 'Update',
            edited_fields: { items: 'updated' },
          },
        })
      })
    } catch (err) {
      if (err instanceof StaleStatus) {
        return NextResponse.json({ error: CHANGED_SINCE_OPENED }, { status: 409 })
      }
      throw err
    }

    const data = await prisma.weekly_plans.findFirst({
      where: { id: params.id, tenant_id: tid },
      include: { weekly_plan_items: true },
    })
    if (!data) return NextResponse.json(null)

    return NextResponse.json({
      ...(serialize(data, 'weekly_plans') as Record<string, unknown>),
      weekly_goals: await loadGoals(params.id, tid),
      // The version this save left, for the Submit that follows it.
      version: savedVersion,
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
