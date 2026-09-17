import { NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { rebuildVisibility } from '@/lib/visibility'

export async function POST() {
  const user = await requireUser()
  if (user.role !== 'Administrator') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenantId = getTenantId()

  try {
    // The whole-tenant walk that used to live here is now rebuildVisibility(),
    // shared with the three user-hierarchy write paths so they cannot drift.
    await rebuildVisibility(tenantId)

    // `inserted` was never the number of rows actually written — it counted the
    // rows OFFERED to a createMany that skipped duplicates. It now counts the
    // derived rows present after the rebuild, which is the same number unless a
    // manual grant shadows a chain-implied pair. The response shape is unchanged.
    const inserted = await prisma.user_visibility.count({
      where: { tenant_id: tenantId, is_manual: false },
    })

    return NextResponse.json({ inserted })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
