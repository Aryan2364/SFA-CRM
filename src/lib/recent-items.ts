'use client'

/**
 * "Recent" — the last few records this user opened, shown in global search
 * when the box is focused and empty (top-bar.tsx).
 *
 * Stored in localStorage, one list per user. `users.id` is already scoped to
 * one tenant (a user row belongs to exactly one tenant_id), so keying on it
 * alone gives "per user, per tenant" without a tenantId this client never
 * otherwise has — adding one here would be a second source of truth for
 * something the id already encodes. Local only: never sent anywhere except
 * back to `/api/search/recent`, which re-checks every id is still visible
 * before the caller ever sees its title again (see that route's comment).
 *
 * Every access is wrapped in try/catch per CLAUDE.md's artifact-equivalent
 * rule for this codebase (section 39 of the frontend kit never assumes
 * storage works): a private window, cleared site data, or a blocked store
 * all throw, and this feature is a convenience, never state anything else
 * depends on.
 */
export type RecentItem = {
  type: 'account' | 'contact' | 'opportunity' | 'order' | 'meeting'
  id: string
  title: string
  subtitle: string | null
  href: string
  openedAt: number
}

const MAX_RECENTS = 5
const keyFor = (userId: string) => `rgb-sfa:recent-items:${userId}`

export function getRecentItems(userId: string): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(keyFor(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Called when a record's detail page opens, or a search result is picked. */
export function recordRecentItem(userId: string, item: Omit<RecentItem, 'openedAt'>): void {
  try {
    const existing = getRecentItems(userId).filter(r => !(r.type === item.type && r.id === item.id))
    const next = [{ ...item, openedAt: Date.now() }, ...existing].slice(0, MAX_RECENTS)
    window.localStorage.setItem(keyFor(userId), JSON.stringify(next))
  } catch {
    /* Storage unavailable — Recent just stays empty or stale. Nothing else
       in the app reads this, so there is nothing further to fall back to. */
  }
}
