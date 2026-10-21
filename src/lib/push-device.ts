'use client'

import * as React from 'react'

import { unsubscribePush, usePushPermission } from '@/lib/push'

/**
 * Phone notifications - this product's side of lib/push.ts (the kit's):
 * talking to the API contract and knowing whether THIS phone is subscribed.
 *
 *   POST   /api/push/subscribe  body = subscription.toJSON()   -> { ok: true }
 *   DELETE /api/push/subscribe  body = { endpoint }            -> { ok: true }
 *
 * "On" for a person means the phone allowed notifications AND this phone
 * holds a subscription. Turning them off removes the subscription (and the
 * server's copy) but cannot take the phone's permission back, so the
 * permission alone is not the answer; hence the per-person "off" flag,
 * which also stops the sign-in re-sync from quietly turning them back on.
 */

const DEADLINE_MS = 10_000

async function request(method: 'POST' | 'DELETE', body: unknown): Promise<void> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), DEADLINE_MS)
  try {
    const response = await fetch('/api/push/subscribe', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`push subscribe ${method}: ${response.status}`)
  } finally {
    window.clearTimeout(timer)
  }
}

/* ---- the per-person "turned off" flag ---------------------------------- */

const OFF_PREFIX = 'push-off|'

function offKey(person: string) {
  return `${OFF_PREFIX}${encodeURIComponent(person)}`
}

function isTurnedOff(person: string): boolean {
  try {
    return window.localStorage.getItem(offKey(person)) === '1'
  } catch {
    return false
  }
}

function setTurnedOff(person: string, off: boolean) {
  try {
    if (off) window.localStorage.setItem(offKey(person), '1')
    else window.localStorage.removeItem(offKey(person))
  } catch {
    // Storage unavailable: the flag is simply not kept.
  }
}

/* ---- "is this phone subscribed" as a tiny store ------------------------ */

const changed = new Set<() => void>()
const emitChanged = () => changed.forEach(listener => listener())

async function readSubscribed(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
    const registration = await navigator.serviceWorker.getRegistration()
    return Boolean(await registration?.pushManager.getSubscription())
  } catch {
    return false
  }
}

/** true / false once read; null until then. Re-read when the app is shown again. */
export function useSubscribed(): boolean | null {
  const [value, setValue] = React.useState<boolean | null>(null)
  React.useEffect(() => {
    let alive = true
    const read = () => {
      void readSubscribed().then(next => {
        if (alive) setValue(next)
      })
    }
    read()
    changed.add(read)
    const onVisible = () => {
      if (document.visibilityState === 'visible') read()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      changed.delete(read)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return value
}

/* ---- the actions ------------------------------------------------------- */

/** Hands a new subscription to the server. Rejects when it was not saved. */
export async function saveSubscription(person: string, subscription: PushSubscriptionJSON): Promise<void> {
  await request('POST', subscription)
  setTurnedOff(person, false)
  emitChanged()
}

/**
 * Turns notifications off on this phone: drops the subscription, then tells
 * the server. Rejects only when the server could not be told, in which case
 * the phone no longer receives anything (the server's copy is removed the
 * next time a send to it fails).
 */
export async function turnOffThisPhone(person: string): Promise<void> {
  setTurnedOff(person, true)
  const endpoint = await unsubscribePush()
  emitChanged()
  if (endpoint) await request('DELETE', { endpoint })
}

/**
 * Sign-out: remove the subscription and the server's copy, best effort,
 * never holding sign-out for longer than `maxMs`. Not the "off" flag: this
 * is the phone leaving the person, not the person's choice.
 */
export async function releasePushOnSignOut(maxMs = 2000): Promise<void> {
  const work = (async () => {
    try {
      const endpoint = await unsubscribePush()
      if (endpoint) await request('DELETE', { endpoint })
    } catch {
      // Best effort.
    }
  })()
  await Promise.race([work, new Promise<void>(resolve => window.setTimeout(resolve, maxMs))])
}

/**
 * At every phone start while signed in: a person who allowed notifications
 * and has not turned them off gets the current subscription handed to the
 * server again (lib/push.ts: the push service renews subscriptions by
 * itself, and this also re-subscribes after sign-out removed it). Once per
 * browser session.
 */
export function usePushSync(person: string | undefined) {
  const push = usePushPermission(person ?? '')
  const ready = Boolean(person) && push.ready && push.configured && push.supported && push.permission === 'granted'
  const { subscribe } = push
  React.useEffect(() => {
    if (!person || !ready || isTurnedOff(person)) return
    const mark = `push-synced|${encodeURIComponent(person)}`
    try {
      if (window.sessionStorage.getItem(mark)) return
    } catch {
      // Without storage it syncs on every start: harmless.
    }
    let alive = true
    void (async () => {
      try {
        const subscription = await subscribe()
        if (!alive || !subscription) return
        await request('POST', subscription)
        try {
          window.sessionStorage.setItem(mark, '1')
        } catch {
          // Not kept.
        }
        emitChanged()
      } catch {
        // Nothing to show: the next start tries again.
      }
    })()
    return () => {
      alive = false
    }
  }, [person, ready, subscribe])
}
