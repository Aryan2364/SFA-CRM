import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // `users!actor_user_id(name)` arrived under the key `users`, and the
    // introspected relation field is also called `users`, so no rename is needed.
    const data = await prisma.weekly_plan_audit_logs.findMany({
      where: { weekly_plan_id: params.id, tenant_id: getTenantId() },
      include: { users: { select: { name: true } } },
      orderBy: { timestamp: 'desc' },
    })
    return NextResponse.json(serialize(data, 'weekly_plan_audit_logs'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
