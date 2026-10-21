import { prisma } from '@/lib/db'

/**
 * Phone push, server side. Ported from v2e's PushService.sendToUser.
 *
 * What goes on the lock screen: `{ title, body, url, tag? }`. `body` must be
 * lock-screen safe - a person's name and what happened, NEVER a manager
 * comment, remark text or any other free text. The caller composes it.
 *
 * Never throws: a push is secondary to the thing that caused it. Missing VAPID
 * keys make this a no-op (one console warning per process), so a build or a
 * dev box without keys is fine. `web-push` is loaded lazily for the same reason.
 */

export type PushPayload = { title: string; body: string; url: string; tag?: string }

type WebPush = typeof import('web-push')

let webpush: WebPush | null = null
let disabledWarned = false

/** web-push wants a mailto: or https: URL; a bare address would switch push off. */
function vapidSubject(): string {
  const raw = process.env.VAPID_SUBJECT?.trim()
  if (!raw) return 'mailto:admin@rgbindia.com'
  if (/^(mailto:|https:\/\/)/i.test(raw)) return raw
  return raw.includes('@') ? `mailto:${raw}` : 'mailto:admin@rgbindia.com'
}

async function getWebPush(): Promise<WebPush | null> {
  if (webpush) return webpush
  const pub = process.env.VAPID_PUBLIC_KEY?.trim()
  const priv = process.env.VAPID_PRIVATE_KEY?.trim()
  if (!pub || !priv) {
    if (!disabledWarned) {
      disabledWarned = true
      console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set - phone push is disabled')
    }
    return null
  }
  try {
    const mod = (await import('web-push')) as unknown as { default?: WebPush } & WebPush
    const wp = (mod.default ?? mod) as WebPush
    wp.setVapidDetails(vapidSubject(), pub, priv)
    webpush = wp
    return wp
  } catch (err) {
    if (!disabledWarned) {
      disabledWarned = true
      console.warn('[push] could not initialise web-push - phone push is disabled', err)
    }
    return null
  }
}

export async function sendPushToUser(
  tenantId: string,
  userId: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const wp = await getWebPush()
    if (!wp) return
    const subs = await prisma.push_subscriptions.findMany({
      where: { tenant_id: tenantId, user_id: userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    })
    if (subs.length === 0) return
    const body = JSON.stringify(payload)
    const results = await Promise.allSettled(
      subs.map(s =>
        wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600 }),
      ),
    )
    // 404 / 410: the phone has dropped this subscription for good - prune it.
    const dead: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const code = (r.reason as { statusCode?: number })?.statusCode
        if (code === 404 || code === 410) dead.push(subs[i].id)
        else console.warn(`[push] send to user ${userId} failed (${code ?? 'no status'})`)
      }
    })
    if (dead.length) {
      await prisma.push_subscriptions.deleteMany({
        where: { id: { in: dead }, tenant_id: tenantId, user_id: userId },
      })
    }
  } catch (err) {
    console.warn('[push] sendPushToUser failed', err)
  }
}
