import { NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenantId = getTenantId()

  try {
  const rows = await prisma.user_visibility.findMany({
    where: { tenant_id: tenantId },
    select: { viewer_user_id: true, target_user_id: true },
  })
  if (!rows.length) return NextResponse.json([])

  const allIds = [...new Set([...rows.map(r => r.viewer_user_id), ...rows.map(r => r.target_user_id)])]

  const users = await prisma.users.findMany({
    where: { tenant_id: tenantId, id: { in: allIds } },
    select: { id: true, name: true, manager_user_id: true },
  })

  const userMap: Record<string, { name: string; manager_user_id: string | null }> = {}
  for (const u of users) {
    userMap[u.id] = {
      name: u.name,
      manager_user_id: u.manager_user_id ?? null,
    }
  }

  const result = rows.map(r => ({
    viewer_user_id: r.viewer_user_id,
    viewer_name: userMap[r.viewer_user_id]?.name ?? '',
    target_user_id: r.target_user_id,
    target_name: userMap[r.target_user_id]?.name ?? '',
    target_manager_user_id: userMap[r.target_user_id]?.manager_user_id ?? null,
  }))

  // Ids, names and nulls only — nothing to serialise.
  return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
