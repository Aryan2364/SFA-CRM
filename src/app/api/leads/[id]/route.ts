import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'leads', 'edit')) return forbidden()
  const body = await req.json()
  // Prevent tenant change
  delete body.tenant_id
  if (body.mobile_1 && !/^\d{10}$/.test(String(body.mobile_1).trim()))
    return NextResponse.json({ error: 'Mobile Number 1 must be exactly 10 digits' }, { status: 400 })
  if (body.mobile_2 && !/^\d{10}$/.test(String(body.mobile_2).trim()))
    return NextResponse.json({ error: 'Mobile Number 2 must be exactly 10 digits' }, { status: 400 })
  if (body.gst_number && !GSTIN_RE.test(String(body.gst_number).trim().toUpperCase()))
    return NextResponse.json({ error: 'Please enter a valid GST Number' }, { status: 400 })
  if (body.gst_number) body.gst_number = String(body.gst_number).trim().toUpperCase()
  // next_follow_up_date is @db.Date; a "YYYY-MM-DD" string has to become a Date.
  if (body.next_follow_up_date !== undefined) {
    body.next_follow_up_date = body.next_follow_up_date ? new Date(body.next_follow_up_date) : null
  }
  try {
    // update(), not updateMany(): the original ended in .select().single().
    const data = await prisma.business_partners.update({
      where: { id: params.id, tenant_id: getTenantId() },
      data: body,
    })
    return NextResponse.json(serialize(data, 'business_partners'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'leads', 'delete')) return forbidden()
  try {
    // deleteMany: a no-match was silent before (PLAN.md 8.4).
    await prisma.business_partners.deleteMany({
      where: { id: params.id, tenant_id: getTenantId() },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
