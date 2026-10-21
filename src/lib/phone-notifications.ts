'use client'

import * as React from 'react'

import { loadList } from '@/lib/load-list'

/**
 * Phone notifications - the one list behind the app bar's bell (its unread
 * dot) and the Notifications screen (/notifications), so the two never
 * disagree: marking a row read there changes the bell at once.
 *
 *   GET   /api/notifications          up to 50 rows, newest first
 *   PATCH /api/notifications/[id]     { is_read: boolean }
 *   POST  /api/notifications/read-all
 *
 * Refreshed when the shell mounts and when the app comes back to the front,
 * at most every 30 seconds; there is no polling loop. A refresh in the
 * background never flips the screen back to "loading" and never replaces
 * rows with an error: only a first load (or an explicit retry) shows one.
 */

export type ApiNotification = {
  id: string
  message: string
  section: string
  redirect_path: string
  is_read: boolean
  created_at: string
}

type Status = 'loading' | 'failed' | 'ready'

export type NotificationsState = {
  status: Status
  items: ApiNotification[]
  unread: number
}

const MIN_GAP_MS = 30_000
const WRITE_DEADLINE_MS = 15_000

let owner: string | null = null
let state: NotificationsState = { status: 'loading', items: [], unread: 0 }
let lastLoadAt = 0
let inflight: Promise<boolean> | null = null
const listeners = new Set<() => void>()

function publish(next: Omit<NotificationsState, 'unread'>) {
  state = { ...next, unread: next.items.filter(item => !item.is_read).length }
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useNotificationsState(): NotificationsState {
  return React.useSyncExternalStore(subscribe, () => state, () => state)
}

/** Forget everything: sign-out, or a different person on this phone. */
export function resetNotifications() {
  owner = null
  lastLoadAt = 0
  inflight = null
  publish({ status: 'loading', items: [] })
}

/**
 * Loads the list. Without `force` it is skipped when it ran in the last 30
 * seconds. Resolves true when the list is now loaded.
 */
export function refreshNotifications(person: string, force = false): Promise<boolean> {
  if (owner !== person) {
    resetNotifications()
    owner = person
  }
  if (inflight) return inflight
  if (!force && state.status === 'ready' && Date.now() - lastLoadAt < MIN_GAP_MS) {
    return Promise.resolve(true)
  }
  if (state.status === 'failed' || lastLoadAt === 0) {
    // A first load, or a retry: show it.
    if (state.status !== 'loading') publish({ status: 'loading', items: state.items })
  }
  inflight = (async () => {
    const result = await loadList<ApiNotification>('/api/notifications')
    inflight = null
    if (owner !== person) return false
    if (result.ok) {
      lastLoadAt = Date.now()
      publish({ status: 'ready', items: result.data })
      return true
    }
    // A background refresh that fails keeps the rows the person already has.
    publish({ status: state.items.length > 0 ? 'ready' : 'failed', items: state.items })
    return false
  })()
  return inflight
}

async function write(url: string, init: RequestInit): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WRITE_DEADLINE_MS)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error(`${url}: ${response.status}`)
  } finally {
    clearTimeout(timer)
  }
}

function setRead(ids: Set<string>, isRead: boolean) {
  publish({
    status: state.status,
    items: state.items.map(item => (ids.has(item.id) ? { ...item, is_read: isRead } : item)),
  })
}

/** Marks one read or unread. The row changes at once; it changes back, and this rejects, if the server refused. */
export async function setNotificationRead(id: string, isRead: boolean): Promise<void> {
  const before = state.items.find(item => item.id === id)
  if (!before || before.is_read === isRead) return
  setRead(new Set([id]), isRead)
  try {
    await write(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_read: isRead }),
    })
  } catch (error) {
    setRead(new Set([id]), !isRead)
    throw error
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  const unreadIds = new Set(state.items.filter(item => !item.is_read).map(item => item.id))
  if (unreadIds.size === 0) return
  setRead(unreadIds, true)
  try {
    await write('/api/notifications/read-all', { method: 'POST' })
  } catch (error) {
    setRead(unreadIds, false)
    throw error
  }
}

/**
 * Mounted once by the phone shell: loads the list for `person` and again
 * whenever the app is shown, at most every 30 seconds.
 */
export function usePhoneNotificationsRefresh(person: string | undefined) {
  React.useEffect(() => {
    if (!person) return
    void refreshNotifications(person)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshNotifications(person)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [person])
}
