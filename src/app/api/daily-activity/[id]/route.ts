import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { isLocationFlagged } from '@/lib/geo'
import { checkPermission, forbidden } from '@/lib/permissions'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
import { getTenantSettings } from '@/lib/settings'

/**
 * How many Deals and how many past Orders the meeting screen is given.
 *
 * §5.5 asks for "open Deals" and "the last few Orders (**not all**)". Both
 * bounds are in the specification, not a pagination convenience: the point of
 * the screen is what is live at this party right now, and a rep standing in a
 * shop does not read a year of order history on a phone. The counts alongside
 * them are what makes "View All" honest rather than a mystery.
 */
const OPEN_DEALS_LIMIT = 8
const RECENT_ORDERS_LIMIT = 5

/**
 * `GET /api/daily-activity/[id]` — everything the Inside-a-Meeting screen
 * (§5.5) shows, in one request.
 *
 * It is one endpoint rather than five because every part of it is scoped
 * against the SAME meeting: if the caller may not reach this visit, there is
 * no company to look up, no Deals to filter and no Orders to count. Splitting
 * it would mean repeating that gate four times, and a gate repeated four times
 * is a gate that will be missing from one of them.
 *
 * ⚠️ THREE DIFFERENT SCOPES APPLY, AND THEY ARE NOT INTERCHANGEABLE.
 *
 *   meetings  decides whether this visit is reachable at all
 *   deals     decides which of the company's Deals are listed
 *   orders    decides which of the company's Orders are listed
 *
 * A Sales Executive on Self scope standing in a shop sees the shop's Deals
 * only if they own them — the Deals another rep owns at the same party are not
 * theirs to read, and this screen is not a side door into them. That is why
 * each section runs its own `scopedUserIds()` rather than inheriting the
 * meeting's, and why each section is omitted entirely (not merely empty) when
 * the caller lacks `view` on it. `deals_visible` / `orders_visible` say which
 * happened, so the screen can tell "nothing here" from "not for you".
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    // findFirst with the tenant AND the scope in the where: a visit id from
    // another tenant, or another rep's visit under Self scope, resolves to
    // null and gets a plain 404. Telling an unauthorised caller that a row
    // exists is itself a leak (the same answer `findScopedDeal` gives).
    const visit = await prisma.daily_visits.findFirst({
      where: {
        id: params.id,
        tenant_id: tid,
        ...scopeWhere(await scopedUserIds(user, 'meetings')),
      },
      include: { users: { select: { id: true, name: true } } },
    })
    if (!visit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const companyId = visit.entity_id
    const company = companyId
      ? await prisma.companies.findFirst({
          where: { id: companyId, tenant_id: tid },
          select: {
            id: true, name: true, type: true, stage: true,
            mobile_1: true, is_complete: true, completeness_missing: true,
          },
        })
      : null

    /*
     * Which Deals this meeting was about. `deal_meetings` is the join §5.5
     * asks for — "the user marks which Deals were discussed" — and it is read
     * for the visit, unfiltered by the Deals scope on purpose: it is a list of
     * ids, and the ids are only ever rendered against the scoped Deal list
     * below, so an id the caller cannot see simply matches nothing.
     */
    const discussed = await prisma.deal_meetings.findMany({
      where: { tenant_id: tid, visit_id: visit.id },
      select: { deal_id: true },
    })

    const canViewDeals = await checkPermission(user, 'deals', 'view')
    const canViewOrders = await checkPermission(user, 'orders', 'view')

    /*
     * OPEN Deals, not every Deal. `closed_at` is written by the close route
     * (§4.6) and `is_active` is the soft-delete flag; a Deal that is either
     * closed or inactive is history, and history is not what someone sitting
     * across a table needs. `open_deal_count` is the unbounded number so the
     * screen can say "showing 8 of 12" rather than silently truncating.
     */
    const dealWhere = {
      tenant_id: tid,
      company_id: companyId ?? '',
      is_active: true,
      closed_at: null,
      ...scopeWhere(await scopedUserIds(user, 'deals'), 'owner_user_id'),
    }
    const [openDeals, openDealCount] = canViewDeals && companyId
      ? await Promise.all([
          prisma.deals.findMany({
            where: dealWhere,
            select: {
              id: true, name: true, expected_value: true, probability: true,
              expected_close_date: true, stage_entered_at: true, deal_stage_id: true,
              deal_stages: { select: { id: true, name: true, sort_order: true } },
              users: { select: { id: true, name: true } },
            },
            orderBy: [{ created_at: 'desc' }],
            take: OPEN_DEALS_LIMIT,
          }),
          prisma.deals.count({ where: dealWhere }),
        ])
      : [[], 0]

    /*
     * THE COMPANY'S ORDERS ARE REACHED TWO WAYS, and missing either one loses
     * half of them.
     *
     * A direct order (`/orders` → Create order) carries `entity_id`. An order
     * punched against a meeting carries `visit_id` and NO `entity_id` at all —
     * see the meeting branch of `POST /api/orders`, which writes neither
     * `entity_type` nor `entity_id`. So "this company's orders" is the union
     * of the two, and the second half is a relation filter through the visit.
     *
     * `tenant_id` is repeated inside the relation filter. It is redundant given
     * the outer predicate, and it stays: a relation filter that reaches another
     * tenant's visit row is exactly the mistake that leaks with nothing
     * crashing, and the cost of the extra predicate is an index lookup.
     */
    const companyOrderWhere = companyId
      ? {
          tenant_id: tid,
          OR: [
            { entity_id: companyId },
            { daily_visits: { is: { tenant_id: tid, entity_id: companyId } } },
          ],
          ...scopeWhere(await scopedUserIds(user, 'orders')),
        }
      : null

    const orderSelect = {
      id: true, order_date: true, status: true, entity_name: true,
      total_amount: true, gross_amount: true, has_discount: true,
      blocked_reason: true, visit_id: true, order_source: true,
      users: { select: { id: true, name: true } },
      _count: { select: { order_items: true } },
    }

    const [recentOrders, orderCount, draftOrders] =
      canViewOrders && companyOrderWhere
        ? await Promise.all([
            prisma.orders.findMany({
              where: companyOrderWhere,
              select: orderSelect,
              orderBy: [{ order_date: 'desc' }, { created_at: 'desc' }],
              take: RECENT_ORDERS_LIMIT,
            }),
            prisma.orders.count({ where: companyOrderWhere }),
            /*
             * §5.5: "If an Order is already drafted for that party and not yet
             * placed, it is visible here." Draft is §4.10's word for exactly
             * that state, so this is a status filter over the same union — not
             * a second concept.
             */
            prisma.orders.findMany({
              where: { ...companyOrderWhere, status: 'Draft' },
              select: orderSelect,
              orderBy: [{ order_date: 'desc' }, { created_at: 'desc' }],
              take: RECENT_ORDERS_LIMIT,
            }),
          ])
        : [[], 0, []]

    /*
     * The order punched against THIS meeting, with its lines, so the inline
     * entry grid opens already filled in rather than blank over an order that
     * exists. `orders.visit_id` is @unique, so there is at most one.
     */
    const visitOrder = canViewOrders
      ? await prisma.orders.findFirst({
          where: { tenant_id: tid, visit_id: visit.id },
          include: { order_items: { orderBy: { created_at: 'asc' } } },
        })
      : null

    const shape = (rows: unknown) =>
      (serialize(rows, 'orders') as Record<string, unknown>[]).map(row => {
        const { _count, ...rest } = row as { _count?: { order_items: number } }
        return { ...rest, item_count: _count?.order_items ?? 0 }
      })

    return NextResponse.json({
      visit: serialize(visit, 'daily_visits'),
      company: company ? serialize(company, 'companies') : null,
      discussed_deal_ids: discussed.map(d => d.deal_id),
      deals_visible: canViewDeals,
      deals: serialize(openDeals, 'deals'),
      open_deal_count: openDealCount,
      orders_visible: canViewOrders,
      recent_orders: shape(recentOrders),
      order_count: orderCount,
      draft_orders: shape(draftOrders),
      visit_order: visitOrder ? serialize(visitOrder, 'orders') : null,
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const body = await req.json()
  const { action, latitude, longitude, address } = body
  const tid = getTenantId()

  try {
    if (action === 'start') {
      // Find any other active visits for this user
      const active = await prisma.daily_visits.findMany({
        where: {
          tenant_id: tid,
          user_id: user.userId ?? undefined,
          status: 'Active',
          id: { not: params.id },
        },
        select: { id: true, start_time: true },
      })

      if (active.length > 0) {
        const todayStr = new Date().toISOString().slice(0, 10)
        // start_time is a timestamptz. The original called .slice(0, 10) on the
        // ISO STRING Supabase returned; a Date has no .slice() and this line
        // would throw (PLAN.md 5.1, the crash form). Reduce to the date string
        // first and the two comparisons below are unchanged.
        const startDay = (v: { start_time: Date | null }) =>
          v.start_time ? v.start_time.toISOString().slice(0, 10) : null
        const staleIds = active.filter(v => { const d = startDay(v); return !d || d < todayStr }).map(v => v.id)
        const todayActive = active.filter(v => startDay(v) === todayStr)

        // Auto-stop stale meetings from previous days
        if (staleIds.length > 0) {
          await prisma.daily_visits.updateMany({
            where: { id: { in: staleIds } },
            data: { status: 'Completed', end_time: new Date() },
          })
        }

        // Still block if there's an active visit from today
        if (todayActive.length > 0) {
          return NextResponse.json({ error: 'Another meeting is already active today. Stop it first.' }, { status: 400 })
        }
      }
      // update(), not updateMany(): the original ended in .select().single().
      const data = await prisma.daily_visits.update({
        where: { id: params.id, tenant_id: tid, user_id: user.userId ?? undefined },
        data: { status: 'Active', start_time: new Date(), latitude: latitude ?? null, longitude: longitude ?? null, address: address ?? null },
      })
      return NextResponse.json(serialize(data, 'daily_visits'))
    }

    if (action === 'stop') {
      const { end_latitude, end_longitude, end_address } = body
      const visit = await prisma.daily_visits.findUnique({
        where: { id: params.id },
        // latitude/longitude join the select for the §5.4 location flag below.
        select: { start_time: true, latitude: true, longitude: true },
      })
      // start_time is already a Date; .getTime() works on it directly.
      const durationSecs = visit?.start_time
        ? Math.floor((Date.now() - visit.start_time.getTime()) / 1000)
        : 0

      /*
       * §5.4, P3-T8: the location flag, computed HERE rather than in the
       * browser. It used to be a hardcoded 0.001-degree box in
       * `review/[userId]/page.tsx` — degrees, not metres; a square, not a
       * circle; and a different real distance at every latitude. See
       * `src/lib/geo.ts` for what was wrong with it.
       *
       * `latitude`/`longitude` are Decimal columns, so Prisma hands back
       * Decimal objects — .toNumber() before arithmetic, or the comparison is
       * against a string (PLAN.md §5.1). The incoming end pair is already a
       * JSON number.
       *
       * ⚠️ Either pair may be null and that is NORMAL: the browser aborts on
       * PERMISSION_DENIED but proceeds with nulls on a geolocation timeout.
       * isLocationFlagged() returns false for an unknown distance — unknown is
       * not the same as clean, but it is not evidence of anything either, and
       * flagging it would train reviewers to ignore the flag.
       *
       * ⚠️ DISPLAY ONLY. §5.4 triggers no action: nothing is blocked, nobody is
       * notified, no approval is required.
       */
      const { location_flag_threshold_m } = await getTenantSettings(tid)
      const locationFlagged = isLocationFlagged(
        { latitude: visit?.latitude?.toNumber(), longitude: visit?.longitude?.toNumber() },
        { latitude: end_latitude ?? null, longitude: end_longitude ?? null },
        location_flag_threshold_m
      )

      const data = await prisma.daily_visits.update({
        where: { id: params.id, tenant_id: tid },
        data: {
          status: 'Completed', end_time: new Date(), duration_secs: durationSecs,
          end_latitude: end_latitude ?? null, end_longitude: end_longitude ?? null, end_address: end_address ?? null,
          location_flagged: locationFlagged,
        },
      })
      return NextResponse.json(serialize(data, 'daily_visits'))
    }

    if (action === 'delete') {
      // deleteMany: a no-match was silent before (PLAN.md 8.4).
      await prisma.daily_visits.deleteMany({ where: { id: params.id, tenant_id: tid } })
      return NextResponse.json({ ok: true })
    }

    if (action === 'update_notes') {
      const data = await prisma.daily_visits.update({
        where: { id: params.id, tenant_id: tid },
        data: { notes: body.notes ?? null },
      })
      return NextResponse.json(serialize(data, 'daily_visits'))
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
