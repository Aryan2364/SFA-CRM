import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { POINT_ACTIONS, POINT_DEFAULTS } from '@/lib/points'

export async function GET() {
  const user = await requireUser()
  if (!await checkPermission(user, 'points_config', 'view')) return forbidden()

  const tid = getTenantId()

  try {
    const rows = await prisma.point_config.findMany({
      where: { tenant_id: tid },
      orderBy: { action_type: 'asc' },
    })
    // updated_at is a timestamptz, so rows go through serialize(); the default
    // objects below are plain data and need no conversion.
    const data = serialize(rows, 'point_config') as Record<string, unknown>[]

    // Merge DB rows with defaults for any missing action types. These are the
    // same defaults awardPoint applies, so a synthesised row is genuinely live.
    const result = POINT_ACTIONS.map(action => {
      const row = data.find(r => r.action_type === action)
      const def = POINT_DEFAULTS[action]
      return row ?? { action_type: action, tenant_id: tid, is_active: true, ...def }
    })

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'points_config', 'edit')) return forbidden()

  const tid = getTenantId()
  const updates: { action_type: string; points: number; cap_per_day: number | null; is_active: boolean }[] = await req.json()

  try {
    for (const u of updates) {
      if (!POINT_ACTIONS.includes(u.action_type as never)) continue

      // Fetch old values for history. point_config has
      // @@unique([tenant_id, action_type]), so findUnique matches .single()
      // exactly — null when the row does not exist yet.
      const old = await prisma.point_config.findUnique({
        where: { tenant_id_action_type: { tenant_id: tid, action_type: u.action_type } },
        select: { points: true, cap_per_day: true, is_active: true, label: true },
      })

      const label = old?.label ?? POINT_DEFAULTS[u.action_type as keyof typeof POINT_DEFAULTS]?.label ?? u.action_type

      const values = {
        label,
        points: u.points,
        cap_per_day: u.cap_per_day,
        is_active: u.is_active,
        updated_at: new Date(),
        updated_by_user_id: user.userId,
      }
      await prisma.point_config.upsert({
        where: { tenant_id_action_type: { tenant_id: tid, action_type: u.action_type } },
        create: { tenant_id: tid, action_type: u.action_type, ...values },
        update: values,
      })

      // Only log if something actually changed
      if (old && (old.points !== u.points || old.cap_per_day !== u.cap_per_day || old.is_active !== u.is_active)) {
        await prisma.point_config_history.create({
          data: {
            tenant_id: tid,
            action_type: u.action_type,
            label,
            old_points: old.points,
            new_points: u.points,
            old_cap_per_day: old.cap_per_day,
            new_cap_per_day: u.cap_per_day,
            old_is_active: old.is_active,
            new_is_active: u.is_active,
            changed_by_user_id: user.userId,
            changed_by_name: user.name,
          },
        })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
