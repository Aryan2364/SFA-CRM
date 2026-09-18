import { NextResponse } from 'next/server'
import { dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { sweepAutoCheckout } from '@/lib/auto-checkout'

export const dynamic = 'force-dynamic'

/**
 * Run the auto check-out sweep for the caller's tenant on demand — §5.3, P3-T6.
 *
 * The sweep normally happens lazily, on the attendance read that Daily Activity
 * makes when it loads (`src/app/api/attendance/route.ts`). This route exists so
 * the same work can be driven deliberately:
 *
 *   - by an external scheduler (a systemd timer or cron on the EC2 host) if the
 *     lazy sweep's "only when someone logs in" behaviour is not good enough;
 *   - to verify the behaviour without waiting for a page load.
 *
 * `force: true` — the caller asked for it explicitly, so the once-per-process
 * per-day guard is bypassed. The underlying UPDATE is still idempotent, so a
 * second call closes nothing.
 *
 * ⚠️ TENANT-SCOPED, deliberately. The tenant comes from the caller's verified
 * session, never from the request, so this cannot be pointed at another tenant.
 * A cron job therefore sweeps the tenant it authenticates as, not all of them —
 * which is the correct shape for a multi-tenant app where midnight is the
 * tenant's own.
 *
 * Authentication only, no permission gate: this triggers a scheduled-style
 * maintenance action on the caller's own tenant and grants no access to
 * anything. `requireUser()` throwing on an anonymous caller is the gate.
 */
export async function POST() {
  await requireUser()
  const tenantId = getTenantId()

  try {
    const result = await sweepAutoCheckout(tenantId, { force: true })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
