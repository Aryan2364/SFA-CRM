import { NextRequest, NextResponse } from 'next/server'
import { dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { runReport, type ReportSpec } from '@/lib/reports/run'

export const dynamic = 'force-dynamic'

/**
 * POST /api/reports/run — REBUILD-PLAN.md §7.1, P5-T1.
 *
 * The ONE report endpoint. Body is a `ReportSpec`:
 *
 *   { measure, dimensions: [one or two], dateFrom, dateTo, filters }
 *
 * There is no per-report route and there must never be one — §7.1 is an engine,
 * not 41 screens. A named report is a spec literal in `src/lib/reports/presets.ts`.
 *
 * POST rather than GET because a spec is a structured object with a nested
 * `filters` map; squeezing it into a query string would mean inventing an
 * encoding and parsing it back. It reads no data it writes — `force-dynamic`
 * and no caching.
 *
 * Validation, permissions and the §6.6 scope filter all live in `runReport()`,
 * which returns `{ error, status }` rather than throwing, so this route has no
 * opinion about any of it.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    const tenantId = getTenantId()

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
    }

    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Body must be a report spec' }, { status: 400 })
    }

    const result = await runReport(user, tenantId, body as ReportSpec)
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
