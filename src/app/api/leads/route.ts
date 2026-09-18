import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'leads', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const type = req.nextUrl.searchParams.get('type') ?? ''
  const tid = getTenantId()

  try {
    const rows = await prisma.companies.findMany({
      where: {
        tenant_id: tid,
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(type ? { type } : {}),
      },
      include: {
        districts: { select: { name: true } },
        talukas: { select: { name: true } },
        villages: { select: { name: true } },
        // `created_by:created_by_user_id(id, name)` is an ALIASED embed; the
        // introspected relation field has a different name, so it is renamed
        // back to `created_by` below.
        //
        // The relation is no longer plain `users`: companies now has TWO FKs to
        // users (created_by_user_id and owner_user_id), so Prisma disambiguates
        // both by the @relation name rather than the model name.
        users_companies_created_by_user_idTousers: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    })

    // NUMERIC latitude/longitude and DATE next_follow_up_date (PLAN.md 5.1).
    const data = (serialize(rows, 'companies') as Record<string, unknown>[])
      .map(({ users_companies_created_by_user_idTousers: createdBy, ...rest }) =>
        ({ ...rest, created_by: createdBy ?? null }))

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'leads', 'edit')) return forbidden()
  const {
    name, type, contact_person_name, pincode, gst_number,
    mobile_1, mobile_2, address, description,
    state_id, district_id, taluka_id, village_id,
    latitude, longitude, temperature, next_follow_up_date,
  } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!type?.trim()) return NextResponse.json({ error: 'Type is required' }, { status: 400 })
  if (mobile_1 && !/^\d{10}$/.test(String(mobile_1).trim()))
    return NextResponse.json({ error: 'Mobile Number 1 must be exactly 10 digits' }, { status: 400 })
  if (mobile_2 && !/^\d{10}$/.test(String(mobile_2).trim()))
    return NextResponse.json({ error: 'Mobile Number 2 must be exactly 10 digits' }, { status: 400 })

  try {
    const data = await prisma.companies.create({
      data: {
        tenant_id: getTenantId(),
        type: type.trim(),
        stage: 'Prospect',
        name: name.trim(),
        contact_person_name: contact_person_name?.trim() || null,
        pincode: pincode?.trim() || null,
        gst_number: gst_number?.trim().toUpperCase() || null,
        mobile_1: mobile_1?.trim() || null,
        mobile_2: mobile_2?.trim() || null,
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
        created_by_user_id: user.userId || null,
      },
    })
    return NextResponse.json(serialize(data, 'companies'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
