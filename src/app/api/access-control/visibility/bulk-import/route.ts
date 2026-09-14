import { NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export async function POST() {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenantId = getTenantId()

  try {
  const users = await prisma.users.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, manager_user_id: true },
  })

  if (!users.length) return NextResponse.json({ inserted: 0 })

  // Build manager lookup map
  const managerMap: Record<string, string | null> = {}
  for (const u of users) managerMap[u.id] = u.manager_user_id ?? null

  // For each user, walk up the ancestor chain and create visibility rows
  const rowSet = new Set<string>()
  const rows: { tenant_id: string; viewer_user_id: string; target_user_id: string }[] = []

  for (const u of users) {
    if (!u.manager_user_id) continue
    let currentId: string | null = u.manager_user_id
    const visited = new Set<string>()

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const key = `${currentId}:${u.id}`
      if (!rowSet.has(key)) {
        rowSet.add(key)
        rows.push({ tenant_id: tenantId, viewer_user_id: currentId, target_user_id: u.id })
      }
      currentId = managerMap[currentId] ?? null
    }
  }

  if (!rows.length) return NextResponse.json({ inserted: 0 })

  // ignoreDuplicates: true -> skipDuplicates, against
  // @@unique([viewer_user_id, target_user_id]).
  await prisma.user_visibility.createMany({ data: rows, skipDuplicates: true })

  // NOTE: `inserted` counts the rows OFFERED, not the rows actually written —
  // duplicates are skipped. That was true before too (the upsert returned no
  // count), so the response is unchanged.
  return NextResponse.json({ inserted: rows.length })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
