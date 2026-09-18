import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { awardPoint } from '@/lib/points'
import { checkPermission, forbidden } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  // `meetings` exists in role_permissions and drives nav visibility, but no
  // route enforced it before P4-T1. A scope filter without a permission check
  // is half a fix.
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  // Was hard-wired `user_id: user.userId` — Self for everyone, so a Team-scoped
  // manager could not see their team at all.
  const ids = intersectScope(
    await scopedUserIds(user, 'meetings'),
    req.nextUrl.searchParams.get('userId')
  )
  try {
    const data = await prisma.daily_visits.findMany({
      where: {
        tenant_id: getTenantId(),
        ...scopeWhere(ids),
        // visit_date is @db.Date.
        visit_date: new Date(date),
      },
      orderBy: { created_at: 'asc' },
    })
    return NextResponse.json(serialize(data, 'daily_visits'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  const {
    visit_type, entity_id, entity_name, is_new_entity, visit_date, new_prospect, weekly_plan_item_id,
    is_manual_entry, manual_start_time, manual_end_time,
  } = await req.json()
  if (!visit_type) return NextResponse.json({ error: 'visit_type is required' }, { status: 400 })
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const effectiveDate = visit_date ?? todayStr
  if (effectiveDate > todayStr) return NextResponse.json({ error: 'Cannot create meetings for future dates' }, { status: 400 })
  const tid = getTenantId()
  const visitDate = new Date(effectiveDate)

  /*
   * P3-T10, §5.4. A past meeting that was not logged live is entered by
   * hand: the caller types Start and End, which the spec calls
   * "tentative" — there is no real GPS fix behind them. So this branch
   * never writes latitude/longitude/address/end_* location fields (they
   * stay at their column defaults, null), and it stores exactly the
   * wall-clock instant the browser sent — no "now" substitution, no
   * fabricated accuracy.
   *
   * `manual_start_time`/`manual_end_time` arrive as ISO strings built by
   * the browser from LOCAL date+time components (`new Date(...)` on a
   * "YYYY-MM-DDTHH:mm" literal is parsed in the browser's own zone), so
   * the UTC instant is already correct regardless of what zone this
   * server process happens to run in. Reading it back is just
   * `toLocaleTimeString()` in the viewer's own browser — see
   * `formatTime` in `types.ts`. Nothing here does zone arithmetic, which
   * is the one thing that would actually introduce the IST/UTC skew.
   */
  let manualFields: {
    status: 'Completed'
    is_manual_entry: true
    start_time: Date
    end_time: Date
    duration_secs: number
  } | null = null
  if (is_manual_entry) {
    if (!manual_start_time || !manual_end_time) {
      return NextResponse.json({ error: 'Start and end time are required for a manual entry' }, { status: 400 })
    }
    const start = new Date(manual_start_time)
    const end = new Date(manual_end_time)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Start and end time are not valid' }, { status: 400 })
    }
    if (end.getTime() <= start.getTime()) {
      return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 })
    }
    manualFields = {
      status: 'Completed',
      is_manual_entry: true,
      start_time: start,
      end_time: end,
      duration_secs: Math.floor((end.getTime() - start.getTime()) / 1000),
    }
  }

  /*
   * §5.3 rule 1. A meeting started from an approved plan line carries
   * that line's id, which is what lets the screen show one row instead
   * of a planned line and a meeting that look unrelated.
   *
   * The id is VALIDATED rather than trusted: it must be this tenant's,
   * on this caller's own plan, that plan must be Approved, and the line
   * must be for the day being written. Otherwise a client could stamp a
   * visit with any uuid and the planned/actual join would silently point
   * at someone else's plan.
   */
  let planItemId: string | null = null
  if (weekly_plan_item_id) {
    const item = await prisma.weekly_plan_items.findFirst({
      where: {
        id: weekly_plan_item_id,
        tenant_id: tid,
        plan_date: visitDate,
        weekly_plans: { tenant_id: tid, user_id: user.userId ?? undefined, status: 'Approved' },
      },
      select: { id: true },
    })
    if (!item) return NextResponse.json({ error: 'Plan line not found for this day' }, { status: 400 })
    planItemId = item.id
  }

  try {
    // New Prospect mode: create business_partner first, then link visit
    if (new_prospect) {
      if (!new_prospect.name?.trim()) return NextResponse.json({ error: 'Prospect name is required' }, { status: 400 })
      const bp = await prisma.companies.create({
        data: {
          tenant_id: tid,
          type: visit_type,
          stage: 'Prospect',
          name: new_prospect.name.trim(),
          mobile_1: new_prospect.mobile_1?.trim() || null,
          state_id: new_prospect.state_id || null,
          district_id: new_prospect.district_id || null,
          taluka_id: new_prospect.taluka_id || null,
          village_id: new_prospect.village_id || null,
          created_by_user_id: user.userId || null,
        },
      })
      const data = await prisma.daily_visits.create({
        data: {
          tenant_id: tid, user_id: user.userId!, visit_date: visitDate,
          visit_type, entity_id: bp.id, entity_name: bp.name, is_new_entity: true, status: 'Pending',
          weekly_plan_item_id: planItemId,
          ...manualFields,
        },
      })
      void awardPoint(tid, user.userId!, 'meeting_logged', { refType: 'daily_visit', refId: data.id, description: `Meeting with ${bp.name} on ${effectiveDate}` })
      return NextResponse.json(serialize(data, 'daily_visits'), { status: 201 })
    }

    if (!entity_name?.trim()) return NextResponse.json({ error: 'entity_name is required' }, { status: 400 })
    const data = await prisma.daily_visits.create({
      data: {
        tenant_id: tid, user_id: user.userId!, visit_date: visitDate,
        visit_type, entity_id: entity_id || null, entity_name: entity_name.trim(),
        is_new_entity: is_new_entity ?? false, status: 'Pending',
        weekly_plan_item_id: planItemId,
        ...manualFields,
      },
    })
    void awardPoint(tid, user.userId!, 'meeting_logged', { refType: 'daily_visit', refId: data.id, description: `Meeting with ${entity_name.trim()} on ${effectiveDate}` })
    return NextResponse.json(serialize(data, 'daily_visits'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
