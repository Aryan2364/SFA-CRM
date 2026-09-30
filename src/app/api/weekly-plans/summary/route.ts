import { NextRequest, NextResponse } from 'next/server'
import { prisma, dateOnlyString, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { getVisibleUserIds } from '@/lib/visibility'
import { addDays, businessDate } from '@/lib/business-date'
import { mondayOf } from '@/lib/weekly-review'

export const dynamic = 'force-dynamic'


export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'weekly_plan', 'view')) return forbidden()
  if (!user.userId) return NextResponse.json({ weeks: [], subordinates: [] })

  const weeksBack = Math.min(parseInt(req.nextUrl.searchParams.get('weeksBack') ?? '11'), 51)
  const tid = getTenantId()

  const subIds = await getVisibleUserIds(user.userId, tid)
  if (!subIds.length) return NextResponse.json({ weeks: [], subordinates: [] })

  try {
  const subs = await prisma.users.findMany({
    where: { id: { in: subIds }, tenant_id: tid, status: 'Active' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  if (!subs.length) return NextResponse.json({ weeks: [], subordinates: [] })

  // Build week list: weeksBack weeks ago → current week
  // The Monday of the current BUSINESS week. The old local-clock version
  // disagreed with the plan screen for 00:00–05:30 IST on a Monday (UTC host),
  // and on an IST host `toISOString()` of local midnight printed the Sunday.
  const currentMonday = mondayOf(businessDate())
  const weeks: string[] = []
  for (let i = weeksBack; i >= 0; i--) {
    weeks.push(addDays(currentMonday, -7 * i))
  }

  const activeSubIds = subs.map(s => s.id)

  // Fetch all plans in the range for all subordinates
  const plans = await prisma.weekly_plans.findMany({
    where: {
      tenant_id: tid,
      user_id: { in: activeSubIds },
      // `weeks` are "YYYY-MM-DD" strings; a @db.Date column needs Date objects.
      week_start_date: { in: weeks.map(w => new Date(w)) },
    },
    select: {
      user_id: true, week_start_date: true, status: true,
      weekly_plan_items: { select: { plan_date: true, from_place: true, party_id: true } },
    },
  })

  type CellData = { status: string | null; planned_days: number }
  const grid: Record<string, Record<string, CellData>> = {}

  for (const sub of subs) {
    grid[sub.id] = {}
    for (const week of weeks) {
      grid[sub.id][week] = { status: null, planned_days: 0 }
    }
  }

  for (const plan of plans) {
    const items = plan.weekly_plan_items
    // Count distinct dates that have at least one item the user actually filled
    // in. ⚠️ `from_place` ALONE is no longer that test: §5.1 took Location off
    // the plan screen and a line is now identified by its party, so a plan
    // written after that release has no places at all and would have counted
    // zero planned days here — the manager grid would have gone blank with
    // nothing throwing.
    // plan_date is a Date now, so it is reduced to "YYYY-MM-DD" before going
    // into the Set — otherwise two Date objects for the same day are distinct
    // members and the count silently inflates.
    const uniqueDates = new Set(
      items.filter(i => i.party_id || i.from_place?.trim()).map(i => dateOnlyString(i.plan_date))
    )
    // The grid is keyed by "YYYY-MM-DD"; indexing it with a Date would stringify
    // to "Mon Sep 14 2026 ..." and never match, leaving every cell blank.
    const weekKey = dateOnlyString(plan.week_start_date)
    if (grid[plan.user_id]?.[weekKey] !== undefined) {
      grid[plan.user_id][weekKey] = {
        status: plan.status,
        planned_days: uniqueDates.size,
      }
    }
  }

  // Only ids, names, status strings and integers — nothing left to serialise.
  return NextResponse.json({
    weeks,
    subordinates: subs.map(sub => ({
      id: sub.id,
      name: sub.name,
      weeks: grid[sub.id],
    })),
  })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
