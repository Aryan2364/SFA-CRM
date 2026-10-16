import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { listUnmetReasons, createUnmetReason } from '@/lib/todo-outcomes'

export const dynamic = 'force-dynamic'

/**
 * "Couldn't-meet reasons" master. Backed by `todo_unmet_reasons`, a table
 * not yet pushed to any database (see src/lib/todo-outcomes.ts) — every
 * access goes through that file's raw-SQL helpers, never `prisma.<model>`,
 * and a database without the table answers an empty list / a 503 rather
 * than crashing.
 *
 * GET is gated on `meetings:view`, not `todo_unmet_reasons:view` — the
 * Couldn't-meet dialog (src/components/daily-activity/couldnt-meet-dialog.tsx)
 * needs the active list for ANY caller who can reach that dialog, regardless
 * of whether they hold the `todo_unmet_reasons` master permission itself.
 * Write actions (POST/this route's PUT/DELETE) are gated on `todo_unmet_reasons`
 * like any other master, and are now grantable to any role via Access Control
 * (see masters-registry.ts — `todo_unmet_reasons` is an ordinary MASTERS entry).
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'meetings', 'view')) return forbidden()
  const includeInactive = req.nextUrl.searchParams.get('include_inactive') === '1'
  const { rows, available } = await listUnmetReasons(getTenantId(), includeInactive)
  if (!available) return NextResponse.json([])
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'todo_unmet_reasons', 'create')) return forbidden()
  const { name, sort_order } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const result = await createUnmetReason(getTenantId(), name.trim(), sort_order ?? 0)
  if (result === 'unavailable') {
    return NextResponse.json({ error: 'This needs a database update first.' }, { status: 503 })
  }
  return NextResponse.json(result, { status: 201 })
}
