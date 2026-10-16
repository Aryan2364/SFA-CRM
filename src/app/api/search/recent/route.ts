import { NextRequest, NextResponse } from 'next/server'
import { dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { SEARCHERS, type ResultType } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/search/recent?items=account:ID,contact:ID,...` — re-checks the
 * client's "Recent" list (src/lib/recent-items.ts) against the server before
 * it is shown.
 *
 * The client only ever has a {type,id,title,...} snapshot taken at the moment
 * the record was opened, in localStorage — never re-validated. By the next
 * visit the record may have been deleted, reassigned to someone outside the
 * caller's scope, unshared, or the caller's role may have lost that section's
 * view permission entirely. Showing the stale snapshot anyway would leak
 * whether a record the caller can no longer reach still exists (its title),
 * which is the same class of mistake `findScopedCompany` et al. exist to
 * avoid everywhere else. So this re-runs each type's own `checkPermission` +
 * scope + sharing — the exact functions `/api/search` uses — filtered to just
 * the requested ids, and returns only the rows that are still really there
 * and still really visible. A record that drops out of scope just silently
 * disappears from Recent; the client never learns anything about why.
 */
function parseItems(raw: string | null): Partial<Record<ResultType, string[]>> {
  const byType: Partial<Record<ResultType, string[]>> = {}
  if (!raw) return byType
  for (const pair of raw.split(',')) {
    const [type, id] = pair.split(':')
    if (!type || !id || !(type in SEARCHERS)) continue
    const t = type as ResultType
    ;(byType[t] ??= []).push(id)
  }
  return byType
}

export async function GET(req: NextRequest) {
  const user = await requireUser()
  const tid = getTenantId()
  const byType = parseItems(req.nextUrl.searchParams.get('items'))

  try {
    const pages = await Promise.all(
      (Object.keys(byType) as ResultType[]).map(type =>
        SEARCHERS[type](user, tid, { ids: byType[type], take: (byType[type] as string[]).length })
      )
    )
    return NextResponse.json({ results: pages.flatMap(p => p.rows) })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
