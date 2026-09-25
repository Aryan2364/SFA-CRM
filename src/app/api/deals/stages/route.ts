import { NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { FUNNEL_STAGE_WHERE } from '../_shape'
import { attachStageTypes, readStageTypes } from '@/lib/deal-stage-type'

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
  const tid = getTenantId()
  try {
    // ⚠️ The select is explicit because `stage_type` is declared in
    // `schema.prisma` and is not in the database yet; it is read separately, in
    // raw SQL. See `src/lib/deal-stage-type.ts`.
    const [rows, types] = await Promise.all([
      prisma.deal_stages.findMany({
        where: { tenant_id: tid, is_active: true, ...FUNNEL_STAGE_WHERE },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        select: { id: true, tenant_id: true, name: true, sort_order: true, is_fixed: true, is_active: true, created_at: true },
      }),
      readStageTypes(tid),
    ])
    // `stage_type: 'Closed'` is how a caller knows a column on the board ends
    // the deal rather than advancing it; `null` means the setting is not
    // available yet and nothing should be inferred from it.
    const serialised = serialize(rows, 'deal_stages') as ({ id: string } & Record<string, unknown>)[]
    return NextResponse.json(attachStageTypes(serialised, types))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
