import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { forbidden } from '@/lib/permissions'

/**
 * User change auditing is GONE, not migrated — see PLAN.md §13.1.
 *
 * `user_audit_logs` does not exist in the database. It is present only in the
 * obsolete supabase/migrations.sql, so `prisma db pull` produces no model for it
 * and there is nothing to query. Before this migration the Supabase client
 * returned the missing-relation error as a value and this route answered 500;
 * the user-visible result was a "Failed to load audit log" toast.
 *
 * That outcome is preserved exactly: same status, same toast. What changes is
 * that the reason is now stated instead of surfacing a raw PostgREST error.
 * Restoring the capability means recreating the table and reinstating the
 * writes, which is a product decision and open follow-up work.
 */
export async function GET() {
  const user = await requireUser()
  if (user.role !== 'Administrator') return forbidden()

  return NextResponse.json(
    { error: 'User audit logging is unavailable: the user_audit_logs table does not exist in this database. See PLAN.md 13.1.' },
    { status: 500 }
  )
}
