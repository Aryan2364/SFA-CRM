import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const MAX_ENDPOINT = 2048
const MAX_KEY = 512

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null
}

/**
 * Register this phone for push. Upserts by endpoint: an endpoint that already
 * exists (any tenant, any user - a shared phone moves between people) is
 * reassigned to the caller, so the previous person stops receiving theirs here.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tid = getTenantId()

  const body = await req.json().catch(() => null) as
    { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = str(body?.endpoint, MAX_ENDPOINT)
  const p256dh = str(body?.keys?.p256dh, MAX_KEY)
  const auth = str(body?.keys?.auth, MAX_KEY)
  if (!endpoint || !/^https:\/\//i.test(endpoint) || !p256dh || !auth) {
    return NextResponse.json({ error: 'A valid push subscription is required' }, { status: 400 })
  }
  const userAgent = (req.headers.get('user-agent') ?? '').trim().slice(0, 300) || null

  try {
    await prisma.push_subscriptions.upsert({
      where: { endpoint },
      create: { tenant_id: tid, user_id: user.userId, endpoint, p256dh, auth, user_agent: userAgent },
      update: { tenant_id: tid, user_id: user.userId, p256dh, auth, user_agent: userAgent },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const r = dbErrorResult(err)
    return NextResponse.json({ error: r.error }, { status: r.status })
  }
}

/** Stop pushing to this phone for the caller. */
export async function DELETE(req: NextRequest) {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tid = getTenantId()

  const body = await req.json().catch(() => null) as { endpoint?: unknown } | null
  const endpoint = str(body?.endpoint, MAX_ENDPOINT)
  if (!endpoint) return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })

  try {
    await prisma.push_subscriptions.deleteMany({
      where: { endpoint, tenant_id: tid, user_id: user.userId },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const r = dbErrorResult(err)
    return NextResponse.json({ error: r.error }, { status: r.status })
  }
}
