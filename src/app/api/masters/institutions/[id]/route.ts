import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

const INSTITUTION_TYPES = ['Institution', 'End Consumer']

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'institutions', 'edit')) return forbidden()
  const body = await req.json()
  delete body.tenant_id
  // type is allowed to change between Institution / End Consumer
  if (body.type && !INSTITUTION_TYPES.includes(body.type))
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  if (body.mobile_1 && !/^\d{10}$/.test(String(body.mobile_1).trim()))
    return NextResponse.json({ error: 'Mobile Number 1 must be exactly 10 digits' }, { status: 400 })
  if (body.mobile_2 && !/^\d{10}$/.test(String(body.mobile_2).trim()))
    return NextResponse.json({ error: 'Mobile Number 2 must be exactly 10 digits' }, { status: 400 })
  if (body.pincode && !/^\d{6}$/.test(String(body.pincode).trim()))
    return NextResponse.json({ error: 'Pin Code must be exactly 6 digits' }, { status: 400 })
  if (body.gst_number && !GSTIN_RE.test(String(body.gst_number).trim().toUpperCase()))
    return NextResponse.json({ error: 'Please enter a valid GST Number' }, { status: 400 })
  if (body.gst_number) body.gst_number = String(body.gst_number).trim().toUpperCase()
  if (body.latitude != null && (isNaN(Number(body.latitude)) || Number(body.latitude) < -90 || Number(body.latitude) > 90))
    return NextResponse.json({ error: 'Latitude must be between -90 and 90' }, { status: 400 })
  if (body.longitude != null && (isNaN(Number(body.longitude)) || Number(body.longitude) < -180 || Number(body.longitude) > 180))
    return NextResponse.json({ error: 'Longitude must be between -180 and 180' }, { status: 400 })
  try {
    // The `type IN (...)` guard rides along in `where`, so this endpoint cannot
    // edit a Dealer or Distributor row (PLAN.md 8.4).
    const data = await prisma.companies.update({
      where: { id: params.id, tenant_id: getTenantId(), type: { in: INSTITUTION_TYPES } },
      data: body,
    })
    return NextResponse.json(serialize(data, 'companies'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'institutions', 'delete')) return forbidden()
  try {
    // deleteMany, NOT delete: a no-match was silent before (PLAN.md 8.4).
    await prisma.companies.deleteMany({
      where: { id: params.id, tenant_id: getTenantId(), type: { in: INSTITUTION_TYPES } },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
