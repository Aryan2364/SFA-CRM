import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sendPushToUser } from '@/lib/push-send'

/**
 * The one choke point for "tell this person": an in-app `notifications` row,
 * then a phone push. Call it AFTER the transaction that caused it has
 * committed - never inside one - and it never throws, so a notification can
 * not fail the request that triggered it.
 *
 * `message` is the in-app text and may quote free text. `push` is what the
 * lock screen shows and must never carry free text (comments, remarks).
 */
export type NotifyInput = {
  row: Prisma.notificationsUncheckedCreateInput
  push: { title: string; body: string; tag?: string }
}

/** Returns true when the row was written (a duplicate under the unique index is not an error). */
export async function notify(input: NotifyInput): Promise<boolean> {
  const { row, push } = input
  try {
    await prisma.notifications.create({ data: row })
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') return false // already sent
    console.error(`[notify] row for ${row.context_type} ${row.context_id} to ${row.recipient_id} failed`, err)
    return false
  }
  await sendPushToUser(row.tenant_id, row.recipient_id, {
    title: push.title,
    body: push.body,
    url: row.redirect_path,
    tag: push.tag,
  })
  return true
}

export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  for (const i of inputs) await notify(i)
}
