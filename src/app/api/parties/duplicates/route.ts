import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { findDuplicates } from '@/lib/account-kind'

/**
 * GET /api/parties/duplicates?mobile=&name=&account_id= — docs/accounts-contacts-spec.md §6.
 * Never blocks creation; the client calls it as a warning, before or after
 * saving. Returns every match the caller has `view` on at least one of
 * companies/contacts (gated on either — a rep able to see either surface
 * should see the warning).
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  const canCompanies = await checkPermission(user, 'companies', 'view')
  const canContacts = await checkPermission(user, 'contacts', 'view')
  if (!canCompanies && !canContacts) return forbidden()
  const tid = getTenantId()
  const mobile = req.nextUrl.searchParams.get('mobile')
  const name = req.nextUrl.searchParams.get('name')
  const accountId = req.nextUrl.searchParams.get('account_id')
  const matches = await findDuplicates(tid, { mobile, name, accountId })
  return NextResponse.json(
    matches.filter(m => (m.kind === 'account' ? canCompanies : canContacts))
  )
}
