import { NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function GET() {
  const user = await requireUser()
  if (!await checkPermission(user, 'users', 'view')) return forbidden()

  const tid = getTenantId()
  try {
    const data = await prisma.roles.findMany({
      where: { tenant_id: tid, name: { not: 'Administrator' } },
      select: { id: true, name: true, is_system: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(serialize(data, 'roles'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
