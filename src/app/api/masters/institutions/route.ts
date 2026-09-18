import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'institutions', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const tid = getTenantId()

  try {
    const data = await prisma.companies.findMany({
      where: {
        tenant_id: tid,
        type: { in: ['Institution', 'End Consumer'] },
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
    // NUMERIC latitude/longitude and DATE next_follow_up_date (PLAN.md 5.1).
    return NextResponse.json(serialize(data, 'companies'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'institutions', 'edit')) return forbidden()
  const {
    name, type, contact_person_name, pincode, gst_number,
    mobile_1, mobile_2, address, description,
    state_id, district_id, taluka_id, village_id, latitude, longitude,
  } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Account Name is required' }, { status: 400 })
  const resolvedType = ['Institution', 'End Consumer'].includes(type) ? type : 'Institution'
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
        type: resolvedType,
        stage: 'Existing',
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
        tenant_id: getTenantId(),
      },
    })
    return NextResponse.json(serialize(data, 'companies'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
