import { NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function GET() {
  const user = await requireUser()
  if (!await checkPermission(user, 'points_config', 'view')) return forbidden()

  try {
    const data = await prisma.point_config_history.findMany({
      where: { tenant_id: getTenantId() },
      orderBy: { changed_at: 'desc' },
      take: 200,
    })
    return NextResponse.json(serialize(data, 'point_config_history'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
