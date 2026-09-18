import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { getTenantSettings, validateTenantSettings } from '@/lib/settings'

/**
 * System Settings — 05-PHASE-3-PLAN.md P3-T1 step 3.
 *
 * Shaped on `src/app/api/points/settings/route.ts`, which solves the identical
 * problem: a table keyed BY tenant_id, where "no row" is a normal state that
 * must answer with defaults rather than a 404.
 *
 * Both handlers gate on the `system_settings` permission section and NOT on a
 * role name. `/api/settings/roles` does `user.role !== 'Administrator'` and is
 * the counter-example, not the pattern — checkPermission() already returns true
 * for Administrator without naming it, so a role-name test buys nothing and
 * makes the section ungrantable to anyone else.
 */

export async function GET() {
  const user = await requireUser()
  if (!await checkPermission(user, 'system_settings', 'view')) return forbidden()

  try {
    // Read through getTenantSettings, not a findUnique of our own: it owns the
    // defaults, and the whole point of the module is that this route and the
    // three background consumers cannot disagree about them.
    //
    // No serialize() call: all three values are `integer` columns and come back
    // as JS numbers. There is no Date and no Decimal in this response.
    return NextResponse.json(await getTenantSettings(getTenantId()))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'system_settings', 'edit')) return forbidden()

  // A malformed body throws out of req.json() before validation sees it.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  // Server-side validation of every value, in src/lib/settings.ts so the screen
  // and the route cannot drift. The screen checks the same rules for a better
  // message; this is the enforcement.
  const parsed = validateTenantSettings(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const tid = getTenantId()

  try {
    const values = {
      ...parsed.values,
      updated_at: new Date(),
      updated_by_user_id: user.userId,
    }
    await prisma.tenant_settings.upsert({
      where: { tenant_id: tid },
      create: { tenant_id: tid, ...values },
      update: values,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
