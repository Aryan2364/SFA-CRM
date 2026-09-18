import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import type { SessionUser } from '@/lib/auth'
import type { PermSection } from '@/lib/permissions'
import { intersectScope, scopedUserIds } from '@/lib/scope'
import {
  CONTEXT_TYPES,
  isContextType,
  isPeriod,
  isSummaryContext,
  resolveContextOwner,
  summaryContextId,
  type ContextType,
} from './_context'

/**
 * Turning a request into a `(context_id, owner)` pair, with authorisation.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `GET /api/remarks` PREVIOUSLY HAD NO AUTHORISATION AT ALL
 *
 * It took `contextType` and `contextId` from the query string and returned
 * every matching remark in the tenant. Any signed-in user who knew — or
 * guessed, or saw in a list response — another person's meeting or expense id
 * could read the whole remark thread on it, including a manager's private
 * comments about them. POST checked visibility; GET did not.
 *
 * That is why this module exists rather than the owner lookup simply being
 * extended inline: read and write now go through the SAME check, so the two
 * cannot drift again. Both call `resolveRemarkContext()`.
 *
 * ---------------------------------------------------------------------------
 * TWO SHAPES ON THE WIRE, AND WHY
 *
 *   ordinary:  { context_type, context_id }
 *   summary:   { context_type, user_id, date }
 *
 * A summary's `context_id` is derived (see `summaryContextId`) and cannot be
 * reversed to find whose summary it is. Accepting a raw `context_id` for those
 * two types would therefore be an authorisation bypass: nothing could tell
 * whose thread was being read. So for `daily_summary` and `weekly_summary` a
 * raw id is REFUSED, the caller must name the person and the period, and the
 * visibility check runs against that person BEFORE the id is derived.
 *
 * ---------------------------------------------------------------------------
 * WHY `scopedUserIds` AND NOT `canView`
 *
 * A remark thread must be readable by exactly the people who can open the
 * thing it is attached to. Any narrower and a manager cannot discuss a sheet
 * they can read; any wider and somebody reads comments about a record they are
 * not allowed to see.
 *
 * `canView()` is the wrong instrument for that, twice over:
 *
 *   1. It asks only "is this person in my visibility closure" — the manager
 *      chain — and IGNORES `role_permissions.data_scope`. A Self-scoped role
 *      sitting above someone in the hierarchy would still read their remarks,
 *      while being refused the record itself by any route that scopes properly.
 *   2. `user_visibility` has no self rows, so `canView(me, me)` is FALSE. Every
 *      caller has to remember an `ownerId === user.userId` special case, and
 *      forgetting it denies a user their own data.
 *
 * `scopedUserIds()` resolves Self / Team / Company from `data_scope` and always
 * includes the caller, so both problems disappear and no special case is
 * needed — not for self, and not for Administrator, whose scope is already
 * 'all'. `intersectScope()` then narrows by the named person and can never
 * widen: an id outside the allowed set collapses to `[]`, which is a refusal.
 *
 * This is deliberately the same composition `GET /api/review/daily-summary`
 * uses, and with the same section for the summary types — a comment on a sheet
 * and the sheet itself must not disagree about who may read them.
 */

/**
 * The permission section each context borrows its scope from. A remark is not
 * its own kind of record; it inherits the reach of whatever it is attached to.
 *
 * `daily_summary` and `weekly_summary` map to `meetings` because that is what
 * `/api/review/daily-summary` gates on. If that route ever moves to a section
 * of its own, this map moves with it — otherwise the sheet and its comment
 * thread drift apart, which is precisely the seam this replaced.
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

export type ResolvedContext = {
  contextType: ContextType
  contextId: string
  /** The person the context belongs to, or `null` if it belongs to nobody. */
  ownerId: string | null
}

export type ContextRequest = {
  contextType?: unknown
  contextId?: unknown
  userId?: unknown
  /** `YYYY-MM-DD` — the day, or the week-start date. */
  date?: unknown
  /**
   * Which half of the route is asking, so an error can name the key the
   * caller actually has to send.
   *
   * ⚠️ THE TWO HALVES TAKE DIFFERENT SPELLINGS, AND THAT IS DELIBERATE.
   *
   *   GET   query string, camelCase:  ?contextType=deal&contextId=…
   *   POST  JSON body,   snake_case:  {"context_type":"deal","context_id":…}
   *
   * Both predate this module — see the file at HEAD — and
   * `src/components/ui/RemarksPanel.tsx` already calls both halves in exactly
   * that split. Aligning them would be internal symmetry bought by breaking a
   * live caller in a file this task does not own, so each half keeps the
   * spelling its own convention already had, and the ERROR MESSAGES carry the
   * difference instead: they quote the key for the shape you are using.
   */
  style: 'query' | 'body'
}

/** `contextType` on the query string, `context_type` in a JSON body. */
function key(style: 'query' | 'body', camel: string): string {
  if (style === 'query') return camel
  return camel.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function resolveRemarkContext(
  user: SessionUser,
  tenantId: string,
  req: ContextRequest
): Promise<ResolvedContext | NextResponse> {
  const { contextType, style } = req

  /*
   * A MISSING KEY AND AN UNKNOWN VALUE ARE DIFFERENT MISTAKES and used to
   * produce one message. "contextType is required and must be a known remark
   * context" reads as a bad value, so somebody who spelled the KEY wrong —
   * easy, given the two shapes above — went looking at their value. These two
   * branches say which it was, and the second lists what is accepted.
   */
  if (contextType === null || contextType === undefined || contextType === '') {
    return NextResponse.json(
      { error: `${key(style, 'contextType')} is required` },
      { status: 400 }
    )
  }
  if (!isContextType(contextType)) {
    return NextResponse.json(
      {
        error:
          `Unknown ${key(style, 'contextType')} ${JSON.stringify(contextType)}. ` +
          `Expected one of: ${CONTEXT_TYPES.join(', ')}`,
      },
      { status: 400 }
    )
  }

  if (isSummaryContext(contextType)) {
    const { userId, date } = req
    if (typeof userId !== 'string' || !UUID.test(userId) || !isPeriod(date)) {
      return NextResponse.json(
        {
          error:
            `${contextType} is addressed by ${key(style, 'userId')} and ` +
            `${key(style, 'date')} (YYYY-MM-DD), not by ${key(style, 'contextId')}`,
        },
        { status: 400 }
      )
    }
    // The person must be in the tenant. Without this, a caller could name a
    // user id from another tenant: `scopedUserIds` would not include them and
    // refuse, so it is not a leak — but the 403 would be misleading and the
    // derived id would belong to a person this tenant does not have.
    const target = await prisma.users.findFirst({
      where: { id: userId, tenant_id: tenantId },
      select: { id: true },
    })
    if (!target) return NextResponse.json({ error: 'No such user' }, { status: 404 })

    const denied = await denyIfHidden(user, contextType, userId)
    if (denied) return denied

    return {
      contextType,
      contextId: summaryContextId(contextType, userId, date),
      ownerId: userId,
    }
  }

  const { contextId } = req
  if (contextId === null || contextId === undefined || contextId === '') {
    return NextResponse.json(
      { error: `${key(style, 'contextId')} is required` },
      { status: 400 }
    )
  }
  if (typeof contextId !== 'string' || !UUID.test(contextId)) {
    return NextResponse.json(
      { error: `${key(style, 'contextId')} must be a UUID` },
      { status: 400 }
    )
  }

  const ownerId = await resolveContextOwner(contextType, contextId, tenantId)
  /*
   * A null owner means the context belongs to nobody — an unassigned deal, or
   * a row that does not exist. There is no user to scope against, so the
   * section permission the caller already passed is the only gate. That is the
   * same answer this gave before and it is the honest one: null is "not owned
   * by a person", not "allowed".
   */
  const denied = ownerId ? await denyIfHidden(user, contextType, ownerId) : null
  if (denied) return denied

  return { contextType, contextId, ownerId }
}

/**
 * `null` when the viewer may reach this person's records for this context, a
 * 403 when not.
 *
 * No self case and no Administrator case: `scopedUserIds` always includes the
 * caller, and an Administrator's `data_scope` is already 'all', which is
 * `null` — no user predicate at all. Both used to be hand-written here, which
 * is exactly the kind of special case that rots.
 */
async function denyIfHidden(
  user: SessionUser,
  contextType: ContextType,
  ownerId: string
): Promise<NextResponse | null> {
  const allowed = intersectScope(
    await scopedUserIds(user, CONTEXT_SECTION[contextType]),
    ownerId
  )
  // `null` is Company scope — everyone is reachable. A non-empty array means
  // the owner survived the intersection. `[]` is the refusal.
  if (allowed === null || allowed.length > 0) return null
  return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
}

/**
 * §6.5 — ONE COMMENT, ONE REPLY, and nothing else.
 *
 * A manager leaves ONE comment against a team member's summary; that member
 * may reply ONCE. Enforced here, in the route, because the UI is not a
 * security boundary and "the button was disabled" is not an answer to a
 * second POST from curl.
 *
 * ⚠️ §9 item 5 is explicit that this carries NO workflow: no approval, no
 * resolved/unresolved state, no notification chain. There is deliberately no
 * status column and none should be added — the two limits below are counts of
 * existing rows, not a state machine. If you find yourself adding a field to
 * record where a comment "is", stop.
 *
 * The two author rules are part of the same shape, not extra workflow: the
 * root comment is the MANAGER's (so its author must not be the person whose
 * summary it is) and the single reply is the team member's (so its author must
 * be). Without them "one comment, one reply" is satisfied by a manager
 * replying to themselves.
 *
 * Returns a 409 to refuse, or `null` to allow.
 */
export async function denySummaryThreadViolation(
  user: SessionUser,
  tenantId: string,
  ctx: ResolvedContext,
  parentRemarkId: string | null
): Promise<NextResponse | null> {
  if (!isSummaryContext(ctx.contextType)) return null

  const isOwner = ctx.ownerId === user.userId

  if (!parentRemarkId) {
    if (isOwner) {
      return NextResponse.json(
        { error: 'A summary comment is left by the reviewer, not by its owner' },
        { status: 403 }
      )
    }
    const existing = await prisma.contextual_remarks.count({
      where: {
        tenant_id: tenantId,
        context_type: ctx.contextType,
        context_id: ctx.contextId,
        parent_remark_id: null,
      },
    })
    if (existing > 0) {
      return NextResponse.json(
        { error: 'This summary already has a comment. Only one is allowed.' },
        { status: 409 }
      )
    }
    return null
  }

  // A reply. It must answer a root comment ON THIS context — otherwise a
  // caller could hang a reply off a remark belonging to a different summary,
  // or off another reply, and the "one reply" count would never see it.
  const parent = await prisma.contextual_remarks.findFirst({
    where: {
      id: parentRemarkId,
      tenant_id: tenantId,
      context_type: ctx.contextType,
      context_id: ctx.contextId,
    },
    select: { id: true, parent_remark_id: true },
  })
  if (!parent) {
    return NextResponse.json(
      { error: 'The comment being replied to is not on this summary' },
      { status: 400 }
    )
  }
  if (parent.parent_remark_id) {
    return NextResponse.json(
      { error: 'A reply cannot be replied to' },
      { status: 409 }
    )
  }
  if (!isOwner) {
    return NextResponse.json(
      { error: 'Only the owner of the summary can reply to its comment' },
      { status: 403 }
    )
  }
  const replies = await prisma.contextual_remarks.count({
    where: { tenant_id: tenantId, parent_remark_id: parent.id },
  })
  if (replies > 0) {
    return NextResponse.json(
      { error: 'This comment has already been replied to. Only one reply is allowed.' },
      { status: 409 }
    )
  }
  return null
}
