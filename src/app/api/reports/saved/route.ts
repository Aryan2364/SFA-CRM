import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { parseConfig, normaliseName } from './config'

export const dynamic = 'force-dynamic'

/**
 * /api/reports/saved — REBUILD-PLAN.md §7.1, P5-T3.
 *
 * GET  — this user's saved reports.
 * POST — save the current builder combination under a name.
 *
 * ---------------------------------------------------------------------------
 * SCOPED TO THEIR OWNER, AND ONLY TO THEIR OWNER.
 *
 * Every query here filters on BOTH `tenant_id` and `user_id`, and there is no
 * §6.6 data scope in this file on purpose. A manager whose scope is `team` can
 * see Amit's orders; that does not mean they may see Amit's saved reports. A
 * saved report is a personal shortcut — a bookmark — not a record about a
 * person, and the §7.1 line is "scope saved reports to their owner" with no
 * exception for a manager or for the Administrator.
 *
 * So `getDataScope` is deliberately not imported. Widening this to `team` or
 * `all` would not leak any figure the caller cannot already run, but it would
 * put one person's private list of shortcuts on another person's screen.
 *
 * ⚠️ The `tenant_id` filter is not redundant beside `user_id`. Ids are UUIDs so
 * a collision is not the risk; the risk is the day a `user_id` arrives from
 * somewhere other than the verified session. Both predicates, every query.
 * ---------------------------------------------------------------------------
 */

const SELECT = {
  id: true,
  name: true,
  config: true,
  created_at: true,
  updated_at: true,
} as const

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET() {
  try {
    const user = await requireUser()
    if (!user.userId) return unauthorized()
    const tenantId = getTenantId()

    const rows = await prisma.saved_reports.findMany({
      where: { tenant_id: tenantId, user_id: user.userId },
      select: SELECT,
      orderBy: { name: 'asc' },
    })

    return NextResponse.json(serialize(rows, 'saved_reports'))
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user.userId) return unauthorized()
    const tenantId = getTenantId()

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
    }
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Body must be a saved report' }, { status: 400 })
    }
    const input = body as Record<string, unknown>

    const named = normaliseName(input.name)
    if ('error' in named) return NextResponse.json({ error: named.error }, { status: 400 })

    const parsed = parseConfig(input.config)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

    // Case-insensitive, because "Q3 orders" and "q3 orders" in one list are two
    // rows a person cannot tell apart. Checked rather than enforced by a unique
    // index so the message names the problem instead of surfacing a 23505.
    const clash = await prisma.saved_reports.findFirst({
      where: {
        tenant_id: tenantId,
        user_id: user.userId,
        name: { equals: named.name, mode: 'insensitive' },
      },
      select: { id: true },
    })
    if (clash) {
      return NextResponse.json(
        { error: 'You already have a saved report with that name.' },
        { status: 409 }
      )
    }

    const row = await prisma.saved_reports.create({
      data: {
        tenant_id: tenantId,
        user_id: user.userId,
        name: named.name,
        config: parsed.config,
      },
      select: SELECT,
    })

    return NextResponse.json(serialize(row, 'saved_reports'), { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') return unauthorized()
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
