import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'dealers', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const tid = getTenantId()

  try {
    const dealers = await prisma.companies.findMany({
      where: {
        tenant_id: tid,
        type: 'Dealer',
        stage: 'Existing',
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      include: {
        states: { select: { name: true } },
        districts: { select: { name: true } },
        talukas: { select: { name: true } },
        villages: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    })

    const distIds = [...new Set(
      dealers.filter(d => d.distributor_id).map(d => d.distributor_id as string)
    )]
    let distMap = new Map<string, string>()
    if (distIds.length > 0) {
      // tenant_id is filtered here even though the pre-migration query omitted
      // it. The ids already come from the tenant-scoped query above, and live
      // was checked for cross-tenant FK references (39 tenant-scoped FK pairs,
      // zero violations), so this cannot change results — it is defence in depth
      // on a tenant-isolation boundary, and it removes an asymmetry with the
      // mirror-image lookup in distributors/route.ts, which always had it.
      const dists = await prisma.companies.findMany({
        where: { tenant_id: tid, id: { in: distIds } },
        select: { id: true, name: true },
      })
      distMap = new Map(dists.map(d => [d.id, d.name]))
    }

    // Serialise before attaching `distributors`, which is a plain object built
    // in JS and needs no conversion. companies carries NUMERIC
    // latitude/longitude and a DATE next_follow_up_date (PLAN.md §5.1).
    const serialised = serialize(dealers, 'companies') as Record<string, unknown>[]
    const result = serialised.map(d => ({
      ...d,
      distributors: d.distributor_id ? { name: distMap.get(d.distributor_id as string) ?? null } : null,
    }))

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'dealers', 'edit')) return forbidden()
  const {
    name, contact_person_name, pincode, gst_number,
    state_id, district_id, taluka_id, village_id, distributor_id,
    mobile_1, mobile_2, address, description, latitude, longitude,
  } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Account Name is required' }, { status: 400 })
  if (!state_id || !district_id || !taluka_id) return NextResponse.json({ error: 'State, District and Taluka are required' }, { status: 400 })
  if (mobile_1 && !/^\d{10}$/.test(String(mobile_1).trim()))
    return NextResponse.json({ error: 'Mobile Number 1 must be exactly 10 digits' }, { status: 400 })
  if (mobile_2 && !/^\d{10}$/.test(String(mobile_2).trim()))
    return NextResponse.json({ error: 'Mobile Number 2 must be exactly 10 digits' }, { status: 400 })
  if (pincode && !/^\d{6}$/.test(String(pincode).trim()))
    return NextResponse.json({ error: 'Pin Code must be exactly 6 digits' }, { status: 400 })
  if (gst_number && !GSTIN_RE.test(String(gst_number).trim().toUpperCase()))
    return NextResponse.json({ error: 'Please enter a valid GST Number' }, { status: 400 })
  if (latitude != null && (isNaN(Number(latitude)) || Number(latitude) < -90 || Number(latitude) > 90))
    return NextResponse.json({ error: 'Latitude must be between -90 and 90' }, { status: 400 })
  if (longitude != null && (isNaN(Number(longitude)) || Number(longitude) < -180 || Number(longitude) > 180))
    return NextResponse.json({ error: 'Longitude must be between -180 and 180' }, { status: 400 })

  try {
    const data = await prisma.companies.create({
      data: {
        type: 'Dealer',
        name: name.trim(),
        contact_person_name: contact_person_name?.trim() || null,
        pincode: pincode?.trim() || null,
        gst_number: gst_number?.trim().toUpperCase() || null,
        state_id,
        district_id,
        taluka_id,
        village_id: village_id || null,
        distributor_id: distributor_id || null,
        mobile_1: mobile_1?.trim() || null,
        mobile_2: mobile_2?.trim() || null,
        address: address || null,
        description: description || null,
        latitude: latitude != null ? Number(latitude) : null,
        longitude: longitude != null ? Number(longitude) : null,
        tenant_id: getTenantId(),
      },
    })
    return NextResponse.json(serialize(data, 'companies'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
