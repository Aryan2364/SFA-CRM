import { NextResponse } from 'next/server'
import { prisma, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { writeStageType, type StageType } from '@/lib/deal-stage-type'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/masters/lead-stages/defaults` — "Add standard stages".
 *
 * Firms created before 18 Sep 2026 were never seeded with stages (the
 * SuperAdmin create route seeds `MASTERS[].seeded` only since then), and a
 * firm with no opportunity stages has no board and nothing to move an
 * opportunity to. This adds a sensible standard set in one action instead of
 * asking an administrator to type seven rows.
 *
 * Seven funnel stages: a short standard pipeline a firm can extend in the
 * master. The board takes any number of stages and scrolls sideways (kit
 * §35.4), so this is a starting set, not a limit. `Existing` is not a funnel
 * stage. `Prospect` and `Existing` keep the `is_fixed` flag and sort
 * order the registry seeds them with (`masters-registry.ts`): both are matched
 * BY NAME elsewhere.
 *
 * Idempotent: a name the firm already has, active or not and in any case, is
 * left alone — nothing is renamed, reactivated, reordered or retyped. Same
 * permission as adding one stage by hand (`lead_stages.create`). Tenant from
 * the session only.
 */
const STANDARD: { name: string; sort_order: number; is_fixed: boolean; stage_type: StageType }[] = [
  { name: 'Prospect',    sort_order: 1,   is_fixed: true,  stage_type: 'Open' },
  { name: 'Contacted',   sort_order: 2,   is_fixed: false, stage_type: 'Open' },
  { name: 'Qualified',   sort_order: 3,   is_fixed: false, stage_type: 'Open' },
  { name: 'Proposal',    sort_order: 4,   is_fixed: false, stage_type: 'Open' },
  { name: 'Negotiation', sort_order: 5,   is_fixed: false, stage_type: 'Open' },
  { name: 'Won',         sort_order: 6,   is_fixed: false, stage_type: 'Closed' },
  { name: 'Lost',        sort_order: 7,   is_fixed: false, stage_type: 'Closed' },
  { name: 'Existing',    sort_order: 999, is_fixed: true,  stage_type: 'Open' },
]

export async function POST() {
  const user = await requireUser()
  if (!await checkPermission(user, 'lead_stages', 'create')) return forbidden()
  const tid = getTenantId()
  try {
    const existing = await prisma.deal_stages.findMany({
      where: { tenant_id: tid },
      select: { name: true },
    })
    const have = new Set(existing.map(s => s.name.trim().toLowerCase()))
    const missing = STANDARD.filter(s => !have.has(s.name.toLowerCase()))

    const created = await prisma.$transaction(
      missing.map(s =>
        prisma.deal_stages.create({
          data: { tenant_id: tid, name: s.name, sort_order: s.sort_order, is_fixed: s.is_fixed },
          // Explicit: `stage_type` is in the schema and may not be in the
          // database yet — see src/lib/deal-stage-type.ts.
          select: { id: true, name: true },
        })
      )
    )

    // Written after the insert, as the single-stage POST does, because the
    // column may not exist yet. `typed` is false when it does not.
    let typed = true
    for (const row of created) {
      const def = STANDARD.find(s => s.name === row.name)!
      if (!await writeStageType(tid, row.id, def.stage_type)) typed = false
    }

    return NextResponse.json(
      {
        added: created.map(r => r.name),
        skipped: STANDARD.filter(s => have.has(s.name.toLowerCase())).map(s => s.name),
        ...(typed ? {} : { stage_type_unavailable: true }),
      },
      { status: created.length > 0 ? 201 : 200 }
    )
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
