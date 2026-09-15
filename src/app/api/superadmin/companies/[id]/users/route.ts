import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

async function requireSuperAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'SuperAdmin') return null
  return user
}

/**
 * SuperAdmin per-company user intelligence is DEAD — see PLAN.md 13.6.
 *
 * This route depended on two things that do not exist in the database:
 *   - `users.level_id`, selected in its primary query. PostgREST rejected the
 *     whole select, `allUsers` came back null, and the route returned
 *     `{ error: 'Failed to load users' }` with a 500.
 *   - `user_login_logs`, the source of every login metric (PLAN.md 13.1).
 *
 * So the response was already a 500 before this migration, and that is preserved
 * exactly — same status, same body. What changes is that the reason is now
 * stated instead of being a generic failure.
 *
 * Reviving it means deciding what replaces `level_id` and whether login history
 * is recreated at all, which is a product decision, not a migration task. The
 * sibling ../usage-summary route is NOT dead: it tolerated the missing login
 * table and still answers 200 with the login metrics at zero.
 */
export async function GET(_req: NextRequest, { params: _params }: { params: { id: string } }) {
  if (!await requireSuperAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({ error: 'Failed to load users' }, { status: 500 })
}
