import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export async function GET(_req: NextRequest, { params }: { params: { userId: string } }) {
  const sessionUser = await requireUser()
  if (!await checkPermission(sessionUser, 'territory_mapping', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    const [user, mapping] = await Promise.all([
      // .single() here left `user` null on no-match and the route still answered
      // 200 with user: null, so findFirst reproduces it exactly.
      prisma.users.findFirst({
        where: { id: params.userId, tenant_id: tid },
        select: { id: true, name: true, contact: true },
      }),
      prisma.user_territory_mappings.findUnique({
        where: { tenant_id_user_id: { tenant_id: tid, user_id: params.userId } },
        select: { state_ids: true, district_ids: true, taluka_ids: true, village_ids: true },
      }),
    ])

    // Only uuid[] and plain strings here — nothing to serialise.
    return NextResponse.json({
      user: user ?? null,
      state_ids: mapping?.state_ids ?? [],
      district_ids: mapping?.district_ids ?? [],
      taluka_ids: mapping?.taluka_ids ?? [],
      village_ids: mapping?.village_ids ?? [],
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: { userId: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'territory_mapping', 'edit')) return forbidden()
  const { state_ids, district_ids, taluka_ids, village_ids } = await req.json()
  const tid = getTenantId()

  try {
    // .upsert(..., { onConflict: 'tenant_id,user_id' }) maps directly:
    // user_territory_mappings carries @@unique([tenant_id, user_id]).
    const values = {
      state_ids: state_ids ?? [],
      district_ids: district_ids ?? [],
      taluka_ids: taluka_ids ?? [],
      village_ids: village_ids ?? [],
    }
    await prisma.user_territory_mappings.upsert({
      where: { tenant_id_user_id: { tenant_id: tid, user_id: params.userId } },
      create: { tenant_id: tid, user_id: params.userId, ...values },
      update: values,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
