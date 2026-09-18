import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

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
 * Authorisation is `companies.view`: it reads the same rows `/api/companies`
 * does, so it must not be a side door around that permission (01-GAP-ANALYSIS
 * G4 — it previously called `requireUser()` and discarded the result, leaving
 * any authenticated user free to enumerate every company in the tenant).
 *
 * Phase 3 owns the Daily Activity screen and may fold this into the meeting
 * flow; until then it stays, response shape unchanged.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'view')) return forbidden()

  const type   = req.nextUrl.searchParams.get('type') ?? ''
  const status = req.nextUrl.searchParams.get('status') ?? 'existing'
  try {
    const data = await prisma.companies.findMany({
      where: {
        tenant_id: getTenantId(),
        is_active: true,
        ...(type ? { type } : {}),
        stage: status === 'lead' ? { not: 'Existing' } : 'Existing',
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    // Ids and names only — nothing to serialise.
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
