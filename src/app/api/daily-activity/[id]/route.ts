import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { isLocationFlagged } from '@/lib/geo'
import { getTenantSettings } from '@/lib/settings'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  const body = await req.json()
  const { action, latitude, longitude, address } = body
  const tid = getTenantId()

  try {
    if (action === 'start') {
      // Find any other active visits for this user
      const active = await prisma.daily_visits.findMany({
        where: {
          tenant_id: tid,
          user_id: user.userId ?? undefined,
          status: 'Active',
          id: { not: params.id },
        },
        select: { id: true, start_time: true },
      })

      if (active.length > 0) {
        const todayStr = new Date().toISOString().slice(0, 10)
        // start_time is a timestamptz. The original called .slice(0, 10) on the
        // ISO STRING Supabase returned; a Date has no .slice() and this line
        // would throw (PLAN.md 5.1, the crash form). Reduce to the date string
        // first and the two comparisons below are unchanged.
        const startDay = (v: { start_time: Date | null }) =>
          v.start_time ? v.start_time.toISOString().slice(0, 10) : null
        const staleIds = active.filter(v => { const d = startDay(v); return !d || d < todayStr }).map(v => v.id)
        const todayActive = active.filter(v => startDay(v) === todayStr)

        // Auto-stop stale meetings from previous days
        if (staleIds.length > 0) {
          await prisma.daily_visits.updateMany({
            where: { id: { in: staleIds } },
            data: { status: 'Completed', end_time: new Date() },
          })
        }

        // Still block if there's an active visit from today
        if (todayActive.length > 0) {
          return NextResponse.json({ error: 'Another meeting is already active today. Stop it first.' }, { status: 400 })
        }
      }
      // update(), not updateMany(): the original ended in .select().single().
      const data = await prisma.daily_visits.update({
        where: { id: params.id, tenant_id: tid, user_id: user.userId ?? undefined },
        data: { status: 'Active', start_time: new Date(), latitude: latitude ?? null, longitude: longitude ?? null, address: address ?? null },
      })
      return NextResponse.json(serialize(data, 'daily_visits'))
    }

    if (action === 'stop') {
      const { end_latitude, end_longitude, end_address } = body
      const visit = await prisma.daily_visits.findUnique({
        where: { id: params.id },
        // latitude/longitude join the select for the §5.4 location flag below.
        select: { start_time: true, latitude: true, longitude: true },
      })
      // start_time is already a Date; .getTime() works on it directly.
      const durationSecs = visit?.start_time
        ? Math.floor((Date.now() - visit.start_time.getTime()) / 1000)
        : 0

      /*
       * §5.4, P3-T8: the location flag, computed HERE rather than in the
       * browser. It used to be a hardcoded 0.001-degree box in
       * `review/[userId]/page.tsx` — degrees, not metres; a square, not a
       * circle; and a different real distance at every latitude. See
       * `src/lib/geo.ts` for what was wrong with it.
       *
       * `latitude`/`longitude` are Decimal columns, so Prisma hands back
       * Decimal objects — .toNumber() before arithmetic, or the comparison is
       * against a string (PLAN.md §5.1). The incoming end pair is already a
       * JSON number.
       *
       * ⚠️ Either pair may be null and that is NORMAL: the browser aborts on
       * PERMISSION_DENIED but proceeds with nulls on a geolocation timeout.
       * isLocationFlagged() returns false for an unknown distance — unknown is
       * not the same as clean, but it is not evidence of anything either, and
       * flagging it would train reviewers to ignore the flag.
       *
       * ⚠️ DISPLAY ONLY. §5.4 triggers no action: nothing is blocked, nobody is
       * notified, no approval is required.
       */
      const { location_flag_threshold_m } = await getTenantSettings(tid)
      const locationFlagged = isLocationFlagged(
        { latitude: visit?.latitude?.toNumber(), longitude: visit?.longitude?.toNumber() },
        { latitude: end_latitude ?? null, longitude: end_longitude ?? null },
        location_flag_threshold_m
      )

      const data = await prisma.daily_visits.update({
        where: { id: params.id, tenant_id: tid },
        data: {
          status: 'Completed', end_time: new Date(), duration_secs: durationSecs,
          end_latitude: end_latitude ?? null, end_longitude: end_longitude ?? null, end_address: end_address ?? null,
          location_flagged: locationFlagged,
        },
      })
      return NextResponse.json(serialize(data, 'daily_visits'))
    }

    if (action === 'delete') {
      // deleteMany: a no-match was silent before (PLAN.md 8.4).
      await prisma.daily_visits.deleteMany({ where: { id: params.id, tenant_id: tid } })
      return NextResponse.json({ ok: true })
    }

    if (action === 'update_notes') {
      const data = await prisma.daily_visits.update({
        where: { id: params.id, tenant_id: tid },
        data: { notes: body.notes ?? null },
      })
      return NextResponse.json(serialize(data, 'daily_visits'))
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
