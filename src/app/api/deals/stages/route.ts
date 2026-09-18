import { NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { FUNNEL_STAGE_WHERE } from '../_shape'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/deals/stages` — the Deal Stage picker and the Kanban's columns.
 *
 * This exists alongside `/api/masters/lead-stages` rather than replacing it,
 * and the difference is the only reason it exists: the master endpoint returns
 * the table as it is, `Existing` included, because the Masters screen has to be
 * able to show and manage every row. **`Existing` is not a funnel stage** — it
 * is the sentinel meaning "master record, not a lead", it sorts at 999, it is
 * `is_fixed`, and five filtered views match it by that exact string
 * (`02-DATA-MODEL-PLAN.md` §6). It must never be a column on the board or an
 * option in the Deal form, and it must never be deleted to achieve that.
 *
 * Inactive stages are excluded too: a stage that was switched off should stop
 * appearing as somewhere new work can go. Deals already sitting in one keep
 * their stage — nothing here writes.
 *
 * Reference data, so any authenticated user may read it; managing the rows
 * still goes through the master's own route and its permission.
 */
export async function GET() {
  await requireUser()
  try {
    const rows = await prisma.deal_stages.findMany({
      where: { tenant_id: getTenantId(), is_active: true, ...FUNNEL_STAGE_WHERE },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    })
    return NextResponse.json(serialize(rows, 'deal_stages'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
