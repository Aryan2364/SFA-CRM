import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const viewerId = req.nextUrl.searchParams.get('viewerId')
  if (!viewerId) return NextResponse.json({ error: 'viewerId is required' }, { status: 400 })

  const tenantId = getTenantId()

  try {
    const rows = await prisma.user_visibility.findMany({
      where: { viewer_user_id: viewerId, tenant_id: tenantId },
      select: { id: true, target_user_id: true },
    })
    if (!rows.length) return NextResponse.json([])

    const targetIds = rows.map(r => r.target_user_id)
    const users = await prisma.users.findMany({
      where: { tenant_id: tenantId, id: { in: targetIds } },
      select: { id: true, name: true },
    })

    const userMap: Record<string, { name: string }> = {}
    for (const u of users) {
      userMap[u.id] = { name: u.name }
    }

    const result = rows.map(r => ({
      id: r.id,
      target_user_id: r.target_user_id,
      name: userMap[r.target_user_id]?.name ?? '',
    }))

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { viewerId, targetId } = await req.json()
  if (!viewerId || !targetId) return NextResponse.json({ error: 'viewerId and targetId are required' }, { status: 400 })

  const tenantId = getTenantId()

  try {
    // onConflict 'viewer_user_id,target_user_id' is the real unique constraint.
    // The row carries nothing else to update, so `update` is empty.
    await prisma.user_visibility.upsert({
      where: { viewer_user_id_target_user_id: { viewer_user_id: viewerId, target_user_id: targetId } },
      create: { tenant_id: tenantId, viewer_user_id: viewerId, target_user_id: targetId },
      update: {},
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const tenantId = getTenantId()

  try {
    // deleteMany: a no-match was silent before (PLAN.md 8.4).
    await prisma.user_visibility.deleteMany({ where: { id, tenant_id: tenantId } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
