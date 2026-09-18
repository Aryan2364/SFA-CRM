import { NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export async function GET() {
  const tid = getTenantId()

  try {
    // Seven `count: 'exact', head: true` totals. The original looped over a table
    // name array; Prisma's client is typed per model, so they are written out.
    const [dealers, distributors, states, districts, users, products, weeklyPlans] = await Promise.all([
      prisma.companies.count({ where: { tenant_id: tid, type: 'Dealer' } }),
      prisma.companies.count({ where: { tenant_id: tid, type: 'Distributor' } }),
      prisma.states.count({ where: { tenant_id: tid } }),
      prisma.districts.count({ where: { tenant_id: tid } }),
      prisma.users.count({ where: { tenant_id: tid } }),
      prisma.products.count({ where: { tenant_id: tid } }),
      prisma.weekly_plans.count({ where: { tenant_id: tid } }),
    ])

    // All integers — no serialisation needed.
    return NextResponse.json({
      states,
      districts,
      users,
      dealers,
      distributors,
      products,
      weeklyPlans,
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
