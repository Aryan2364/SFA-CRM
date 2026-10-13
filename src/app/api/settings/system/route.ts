import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { getTenantSettings, validateTenantSettings } from '@/lib/settings'
import { readGstRequiredForOrders, setGstRequiredForOrders } from '@/lib/gst-setting'

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
    //
    // `gst_required_for_orders` rides beside the three numbers, read through
    // src/lib/gst-setting.ts because its column may not exist yet;
    // `gst_setting_available` is false until it does, and the screen then
    // shows the switch disabled with the reason.
    const tid = getTenantId()
    const [settings, gst] = await Promise.all([getTenantSettings(tid), readGstRequiredForOrders(tid)])
    return NextResponse.json({
      ...settings,
      gst_required_for_orders: gst.value,
      gst_setting_available: gst.available,
    })
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
    // Raw SQL, not `prisma.tenant_settings.upsert`. Measured on the local
    // database: once the client knows about the unpushed
    // `gst_required_for_orders` column, Prisma's upsert writes that column's
    // default into the INSERT even with a `select`, and fails with P2022
    // (ColumnNotFound) on a database that does not have it yet — so saving
    // these three values would break the moment the code shipped. Naming the
    // three columns leaves the GST column to its database default (or to its
    // absence). See src/lib/gst-setting.ts.
    const v = parsed.values
    await prisma.$executeRaw`
      INSERT INTO tenant_settings
        (tenant_id, auto_checkout_minutes, location_flag_threshold_m, deal_stage_ageing_days, updated_at, updated_by_user_id)
      VALUES
        (${tid}::uuid, ${v.auto_checkout_minutes}, ${v.location_flag_threshold_m}, ${v.deal_stage_ageing_days}, now(), ${user.userId ?? null}::uuid)
      ON CONFLICT (tenant_id) DO UPDATE
         SET auto_checkout_minutes     = EXCLUDED.auto_checkout_minutes,
             location_flag_threshold_m = EXCLUDED.location_flag_threshold_m,
             deal_stage_ageing_days    = EXCLUDED.deal_stage_ageing_days,
             updated_at                = EXCLUDED.updated_at,
             updated_by_user_id        = EXCLUDED.updated_by_user_id
    `
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * The "GST number required to place orders" switch.
 *
 * Its own verb because a switch commits the moment it is flipped (kit:
 * switch.tsx), while the three values above are a form with a Save button —
 * flipping the switch must not save, or discard, half-edited numbers.
 *
 * ONE value for the whole firm. It is stored on the tenant's single
 * `tenant_settings` row, keyed by the tenant from the session and nothing
 * else; there is no per-user, per-role or per-company override, and every
 * order check and warning reads this one value. Gated on
 * `system_settings.edit`, the same permission as the rest of the screen.
 */
export async function PATCH(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'system_settings', 'edit')) return forbidden()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }
  const value = (body as { gst_required_for_orders?: unknown } | null)?.gst_required_for_orders
  if (typeof value !== 'boolean') {
    return NextResponse.json({ error: 'gst_required_for_orders must be true or false.' }, { status: 400 })
  }

  try {
    const result = await setGstRequiredForOrders(getTenantId(), value, user.userId ?? null)
    if (result === 'unavailable') {
      return NextResponse.json(
        { error: 'This setting needs a database update first. Ask whoever manages the server to add it.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ ok: true, gst_required_for_orders: value })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error }, { status })
  }
}
