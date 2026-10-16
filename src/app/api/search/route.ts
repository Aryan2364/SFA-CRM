import { NextRequest, NextResponse } from 'next/server'
import { dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { SEARCHERS, type ResultType } from './_shared'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/search?q=...` — the top bar's global search (§12.2) AND, with
 * `?type=`, the one type-at-a-time paging the "See all results" page
 * (`/search`) needs.
 *
 * Two modes, same gating and scope (see `_shared.ts`, where the actual
 * per-type query logic lives — this file is just the two ways of calling it):
 *
 *   no `type`   the dropdown: every type, 5 rows each, no total (the
 *               dropdown never paginates — "See all results" is the way out
 *               of the 5-row cap).
 *   `type=X`    "See all results": one type, `limit`/`offset` (default 10/0,
 *               capped at 50), plus `total` for that type's own pagination.
 *
 * `tenant_id` is explicit on every query inside `_shared.ts` — the single
 * highest-consequence mistake in this codebase (CLAUDE.md "Multi-Tenancy").
 */
const MIN_LEN = 2
const DROPDOWN_PER_TYPE = 5
const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 50

function isResultType(v: string | null): v is ResultType {
  return !!v && v in SEARCHERS
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  const tid = getTenantId()
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < MIN_LEN) return NextResponse.json({ results: [], total: 0 })

  const typeParam = req.nextUrl.searchParams.get('type')

  try {
    if (isResultType(typeParam)) {
      const limit = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || DEFAULT_PAGE_SIZE)
      )
      const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset')) || 0)
      const page = await SEARCHERS[typeParam](user, tid, { q, take: limit, skip: offset, withTotal: true })
      return NextResponse.json({ results: page.rows, total: page.total })
    }

    const pages = await Promise.all(
      (Object.keys(SEARCHERS) as ResultType[]).map(type =>
        SEARCHERS[type](user, tid, { q, take: DROPDOWN_PER_TYPE })
      )
    )
    return NextResponse.json({ results: pages.flatMap(p => p.rows) })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
