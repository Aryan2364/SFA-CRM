import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function GET() {
  const user = await requireUser()
  if (!await checkPermission(user, 'points_config', 'view')) return forbidden()

  try {
    // tenant_point_settings is keyed BY tenant_id (it is the primary key), so
    // .single() with no row left `data` null and the route fell back to the
    // default object — findUnique's null takes the same branch.
    const data = await prisma.tenant_point_settings.findUnique({
      where: { tenant_id: getTenantId() },
    })

    return NextResponse.json(data ? serialize(data, 'tenant_point_settings') : { reset_period: 'monthly' })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'points_config', 'edit')) return forbidden()

  const { reset_period } = await req.json()
  if (!['monthly', 'quarterly', 'never'].includes(reset_period))
    return NextResponse.json({ error: 'Invalid reset_period' }, { status: 400 })

  const tid = getTenantId()

  try {
    const values = {
      reset_period,
      updated_at: new Date(),
      updated_by_user_id: user.userId,
    }
    await prisma.tenant_point_settings.upsert({
      where: { tenant_id: tid },
      create: { tenant_id: tid, ...values },
      update: values,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
