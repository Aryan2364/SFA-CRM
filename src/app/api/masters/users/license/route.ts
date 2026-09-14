import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { getTenantId } from '@/lib/tenant'

export async function GET() {
  await requireUser()
  const tid = getTenantId()

  // count({ where }) is the counterpart of .select('*', { count: 'exact', head: true }).
  const [used, tenant] = await Promise.all([
    prisma.users.count({ where: { tenant_id: tid, status: 'Active' } }),
    prisma.tenants.findUnique({ where: { id: tid }, select: { license_count: true } }),
  ])

  // Both values are plain integers, so no serialize() is needed here.
  return NextResponse.json({
    used,
    limit: tenant?.license_count ?? null,
  })
}
