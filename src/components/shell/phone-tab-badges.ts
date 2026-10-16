'use client'

import { useSyncExternalStore } from 'react'

/**
 * Phone — FRONTEND_RULES_PHONE.md §41.4 rule 16 / §41.15 rule 8: the count
 * a phone tab carries. The screen that already loads the data publishes the
 * number (`setPhoneTabBadge`), and the tab bar reads it (`usePhoneTabBadge`),
 * so no extra request is made just for the badge.
 *
 * A module-level store rather than React state, because the tab bar must
 * keep showing the count after its screen is left. Each count is stamped
 * with the user it was computed for, so signing in as someone else in the
 * same tab never shows the last person's number.
 */

type Entry = { userId: string; count: number }

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Publish `count` for the tab at `href`. Zero (or less) clears it. */
export function setPhoneTabBadge(href: string, userId: string, count: number) {
  const prev = entries.get(href)
  const next = Math.max(0, Math.floor(count))
  if (prev && prev.userId === userId && prev.count === next) return
  entries.set(href, { userId, count: next })
  listeners.forEach(listener => listener())
}

/** The tab's count for this user, or 0 when none has been published. */
export function usePhoneTabBadge(href: string, userId: string | undefined): number {
  return useSyncExternalStore(
    subscribe,
    () => {
      const entry = entries.get(href)
      return entry && entry.userId === userId ? entry.count : 0
    },
    () => 0
  )
}
