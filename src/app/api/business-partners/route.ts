import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { getAccessibleCompanyIds } from '@/lib/sharing'
import { attachAccountKinds } from '@/lib/account-kind'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/business-partners?type=Dealer&status=existing|lead`
 *
 * A narrow `{id, name}` picker over the `companies` table (renamed from
 * `business_partners` in a1d43e0 — the URL keeps the old noun because the
 * Daily Activity meeting modal calls it by that name). It is NOT a duplicate
 * of `/api/companies`: that route returns the full party shape with addresses,
 * contacts and completeness, which is far more than a `<select>` needs. This
 * one returns two columns and is the only thing the modal reads.
 *
 * `stage: 'Existing'` is a sentinel meaning "master record, not a funnel row".
 * `status=existing` selects those; `status=lead` selects everything else
 * (`{ not: 'Existing' }`). Do not rename the sentinel — several routes hardcode
 * the literal.
 *
 * F6 added `status=all`, which applies no stage filter, and put `type` in the
 * projection. Both are additive: `existing` is still the default and the two
 * pre-existing values behave exactly as before. They exist because the Daily
 * Activity meeting form no longer asks the user to pick a lead type or a
 * stage before picking a party — it offers one list of parties and files the
 * meeting under the party's OWN `companies.type`, which is the only honest
 * source for `daily_visits.visit_type` once the selector is gone.
 *
 * Authorisation is `companies.view`: it reads the same rows `/api/companies`
 * does, so it must not be a side door around that permission (01-GAP-ANALYSIS
 * G4 — it previously called `requireUser()` and discarded the result, leaving
 * any authenticated user free to enumerate every company in the tenant).
 *
 * Default: no data scope. `?mine=1` narrows to the caller's own parties
 * (`owner_user_id` = the caller), whatever the role's scope, and is what the
 * Daily Activity meeting form sends. That is a product decision (Aryan,
 * 2026-10-12), the same one as commit 73b1918: Daily Activity is where a person
 * enters their OWN work, so its pickers offer their own parties only, and an
 * Administrator's Company scope no longer floods the form with every
 * colleague's leads. It was once tried as a plain scope and blocked field work
 * on colleagues' or unowned parties; the way through for those is the form's
 * "new lead" path, or an approved weekly-plan line, which carries its own
 * party and does not go through this list. Without the param the route
 * behaves exactly as before.
 *
 * Widened on purpose (sharing, Aryan 2026-10-13): "own parties" now means
 * owned OR shared with the caller at 'work' (`account_members`, see
 * src/lib/sharing.ts). A 'work' member is someone the owner asked to do field
 * work on the account, so it belongs in the meeting picker; a 'view' share does
 * not. Until the table exists the shared list is empty and this is the
 * owner-only filter above, unchanged.
 *
 * Phase 3 owns the Daily Activity screen and may fold this into the meeting
 * flow; until then it stays, response shape unchanged.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'view')) return forbidden()

  const type   = req.nextUrl.searchParams.get('type') ?? ''
  const status = req.nextUrl.searchParams.get('status') ?? 'existing'
  const mine   = req.nextUrl.searchParams.get('mine') === '1'
  // A session with no user row owns nothing. Without this, `owner_user_id:
  // undefined` would drop the predicate and return every party.
  if (mine && !user.userId) return NextResponse.json([])
  const tid = getTenantId()
  try {
    const shared = mine ? await getAccessibleCompanyIds(user, tid, 'work') : []
    const data = await prisma.companies.findMany({
      where: {
        tenant_id: tid,
        is_active: true,
        ...(mine
          ? shared.length
            ? { OR: [{ owner_user_id: user.userId }, { id: { in: shared } }] }
            : { owner_user_id: user.userId }
          : {}),
        ...(type ? { type } : {}),
        ...(status === 'all'
          ? {}
          : { stage: status === 'lead' ? { not: 'Existing' } : 'Existing' }),
      },
      select: { id: true, name: true, type: true, stage: true },
      orderBy: { name: 'asc' },
    })
    // Ids and names only — nothing to serialise. `account_kind` defaults to
    // Company while docs/accounts-contacts-spec.md's column is unset (see
    // src/lib/account-kind.ts); callers like the meeting picker use it to
    // label an Individual account distinctly ("Name · Individual").
    const withKind = await attachAccountKinds(data, tid)
    return NextResponse.json(withKind)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
