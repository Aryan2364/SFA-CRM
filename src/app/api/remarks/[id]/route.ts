import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { resolveRemarkContext } from '../_access'
import { businessDate } from '@/lib/business-date'

export const dynamic = 'force-dynamic'

/**
 * Only `meeting` minutes can be edited/deleted for now. Named once so
 * widening to another context later is a one-line change here, not a new
 * message to track down across the route.
 */
const NOT_YET_SUPPORTED = "Editing isn't available for this kind of entry yet."

async function loadOwnedRemark(id: string, tenantId: string) {
  return prisma.contextual_remarks.findFirst({
    where: { id, tenant_id: tenantId },
    include: { other_contextual_remarks: { select: { id: true } } },
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const tenantId = getTenantId()

  const remark = await loadOwnedRemark(params.id, tenantId)
  if (!remark) {
    return NextResponse.json({ error: 'This record no longer exists.' }, { status: 404 })
  }
  if (remark.context_type !== 'meeting') {
    return NextResponse.json({ error: NOT_YET_SUPPORTED }, { status: 403 })
  }

  const ctx = await resolveRemarkContext(user, tenantId, {
    contextType: remark.context_type,
    contextId: remark.context_id,
    style: 'body',
  })
  if (ctx instanceof NextResponse) return ctx

  if (remark.author_user_id !== user.userId) {
    return NextResponse.json(
      { error: 'Only the person who wrote this entry can change it.' },
      { status: 403 }
    )
  }

  const payload = await req.json()
  const body = payload?.body
  if (!body?.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 })
  }

  try {
    const updated = await prisma.contextual_remarks.update({
      where: { id: remark.id },
      data: { body: body.trim(), updated_at: new Date() },
      include: { users: { select: { id: true, name: true } } },
    })
    const data = serialize(updated, 'contextual_remarks') as Record<string, unknown>
    return NextResponse.json({ ...data, edited: true })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const tenantId = getTenantId()

  const remark = await loadOwnedRemark(params.id, tenantId)
  if (!remark) {
    return NextResponse.json({ error: 'This record no longer exists.' }, { status: 404 })
  }
  if (remark.context_type !== 'meeting') {
    return NextResponse.json({ error: NOT_YET_SUPPORTED }, { status: 403 })
  }

  const ctx = await resolveRemarkContext(user, tenantId, {
    contextType: remark.context_type,
    contextId: remark.context_id,
    style: 'body',
  })
  if (ctx instanceof NextResponse) return ctx

  if (remark.author_user_id !== user.userId) {
    return NextResponse.json(
      { error: 'Only the person who wrote this entry can change it.' },
      { status: 403 }
    )
  }

  if (businessDate(remark.created_at) !== businessDate()) {
    return NextResponse.json(
      { error: 'Entries can only be deleted on the day they were written.' },
      { status: 403 }
    )
  }

  if (remark.other_contextual_remarks.length > 0) {
    return NextResponse.json(
      { error: "This entry has replies, so it can't be deleted. Edit it instead." },
      { status: 409 }
    )
  }

  try {
    await prisma.$transaction([
      prisma.notifications.deleteMany({ where: { remark_id: remark.id, tenant_id: tenantId } }),
      prisma.contextual_remarks.delete({ where: { id: remark.id } }),
    ])
    return NextResponse.json({ ok: true })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
