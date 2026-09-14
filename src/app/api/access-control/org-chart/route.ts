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
    const data = await prisma.users.findMany({
      where: { tenant_id: tenantId, status: 'Active' },
      select: {
        id: true, name: true, profile: true, manager_user_id: true,
        designations: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    })

    const result = data.map(u => ({
      id: u.id,
      name: u.name,
      role: u.designations?.name ?? u.profile ?? '',
      manager_user_id: u.manager_user_id ?? null,
    }))

    // Strings and nulls only — nothing to serialise.
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
