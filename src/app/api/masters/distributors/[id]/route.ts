import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'distributors', 'edit')) return forbidden()
  const body = await req.json()
  delete body.type
  if (body.mobile_1 && !/^\d{10}$/.test(String(body.mobile_1).trim()))
    return NextResponse.json({ error: 'Mobile Number 1 must be exactly 10 digits' }, { status: 400 })
  if (body.mobile_2 && !/^\d{10}$/.test(String(body.mobile_2).trim()))
    return NextResponse.json({ error: 'Mobile Number 2 must be exactly 10 digits' }, { status: 400 })
  if (body.pincode && !/^\d{6}$/.test(String(body.pincode).trim()))
    return NextResponse.json({ error: 'Pin Code must be exactly 6 digits' }, { status: 400 })
  if (body.gst_number && !GSTIN_RE.test(String(body.gst_number).trim().toUpperCase()))
    return NextResponse.json({ error: 'Please enter a valid GST Number' }, { status: 400 })
  if (body.gst_number) body.gst_number = String(body.gst_number).trim().toUpperCase()
  try {
    // The `type` guard is kept alongside the primary key and tenant_id, so a
    // Distributor endpoint still cannot edit a row of the other partner type.
    const data = await prisma.companies.update({
      where: { id: params.id, tenant_id: getTenantId(), type: 'Distributor' },
      data: body,
    })
    return NextResponse.json(serialize(data, 'companies'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'distributors', 'delete')) return forbidden()
  try {
    // deleteMany, NOT delete: the previous .delete() returned ok when nothing
    // matched; delete() would throw P2025 and turn that into a 500.
    await prisma.companies.deleteMany({
      where: { id: params.id, tenant_id: getTenantId(), type: 'Distributor' },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
