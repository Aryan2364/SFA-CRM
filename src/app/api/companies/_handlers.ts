import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { recomputeCompanyCompleteness } from '@/lib/completeness'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'
import { COMPANY_INCLUDE, shapeCompany } from './_shape'
import {
  checkEmail,
  checkGstin,
  checkMobile,
  checkPincode,
  firstError,
  normaliseGstin,
  trimmed,
} from '@/lib/validation'


/**
 * Companies — the Party surface. `/api/leads` re-exports these handlers while
 * the Leads page is still on the old URL (P1-T13 retires it).
 *
 * `companies` is the renamed `business_partners` table (commit a1d43e0), so a
 * Dealer, a Distributor and an Institution are rows here too, separated by
 * `type` + `stage = 'Existing'`. This route does NOT filter on stage — it never
 * did — so it lists every party in the tenant.
 */

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const type = req.nextUrl.searchParams.get('type') ?? ''
  const tid = getTenantId()
  // §6.6 Self/Team/Company. This list was tenant-wide for anyone with view
  // rights. ⚠️ A Party scopes on `owner_user_id`, not `user_id`, so the column
  // is passed explicitly — and an unowned company (owner_user_id NULL) is
  // therefore invisible below Company scope, which is the filter working: no
  // one owns it, so it is nobody's row.
  const ids = intersectScope(
    await scopedUserIds(user, 'companies'),
    req.nextUrl.searchParams.get('userId')
  )

  try {
    const rows = await prisma.companies.findMany({
      where: {
        tenant_id: tid,
        ...scopeWhere(ids, 'owner_user_id'),
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(type ? { type } : {}),
      },
      include: COMPANY_INCLUDE,
      orderBy: { name: 'asc' },
    })

    // NUMERIC latitude/longitude and DATE next_follow_up_date (PLAN.md 5.1).
    const data = (serialize(rows, 'companies') as Record<string, unknown>[]).map(shapeCompany)

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  // 'create', not 'edit' (P1-T10.3). The old route checked 'edit', which let a
  // role with edit-but-not-create create companies and stopped a create-only
  // role from doing the one thing it was granted.
  if (!await checkPermission(user, 'companies', 'create')) return forbidden()
  const {
    name, type, contact_person_name, pincode, gst_number,
    mobile_1, mobile_2, address, description,
    state_id, district_id, taluka_id, village_id,
    latitude, longitude, temperature, next_follow_up_date,
    email, website, industry_id, owner_user_id,
  } = await req.json()

  // Quick Create compulsory: Name and a mobile number (REBUILD-PLAN.md:181).
  // Company Type is explicitly NOT compulsory (REBUILD-PLAN.md:126) — the 400
  // the old route returned for a missing `type` is gone.
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  // POST validated neither GSTIN nor pincode before; PUT validated GSTIN only.
  // Both verbs now run the identical set (P1-T10.6).
  const bad = firstError(
    checkMobile(mobile_1, 'Mobile Number 1'),
    checkMobile(mobile_2, 'Mobile Number 2'),
    checkPincode(pincode),
    checkGstin(gst_number),
    checkEmail(email),
  )
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  try {
    const created = await prisma.companies.create({
      data: {
        tenant_id: getTenantId(),
        // `companies.type` is NOT NULL with no default, so "blank" is the empty
        // string until a migration makes the column nullable. It reads as blank
        // everywhere and matches no `?type=` filter, which is the intent.
        type: trimmed(type) ?? '',
        stage: 'Prospect',
        name: name.trim(),
        contact_person_name: trimmed(contact_person_name),
        pincode: trimmed(pincode),
        gst_number: normaliseGstin(gst_number),
        mobile_1: trimmed(mobile_1),
        mobile_2: trimmed(mobile_2),
        address: address || null,
        description: description || null,
        state_id: state_id || null,
        district_id: district_id || null,
        taluka_id: taluka_id || null,
        village_id: village_id || null,
        latitude: latitude != null ? Number(latitude) : null,
        longitude: longitude != null ? Number(longitude) : null,
        temperature: temperature || null,
        // next_follow_up_date is @db.Date — the client sends "YYYY-MM-DD".
        next_follow_up_date: next_follow_up_date ? new Date(next_follow_up_date) : null,
        email: trimmed(email),
        website: trimmed(website),
        industry_id: industry_id || null,
        owner_user_id: owner_user_id || null,
        created_by_user_id: user.userId || null,
      },
    })

    // is_complete / completeness_missing are derived, never taken from the body
    // (P1-T10.7). A brand-new company has no addresses, so this always resolves
    // to "incomplete" — it is written anyway so the row never carries the
    // column default as if it had been computed.
    const completeness = await recomputeCompanyCompleteness(created.id, created.tenant_id)

    return NextResponse.json(
      { ...(serialize(created, 'companies') as Record<string, unknown>), ...completeness },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
