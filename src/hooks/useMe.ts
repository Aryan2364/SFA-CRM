'use client'

import { useCallback, useEffect, useState } from 'react'

import { redirectToLogin } from '@/lib/session-expiry'

/** `create` is optional so a client reading a response from before it was
 *  added still type-checks; screens fall back to `edit`, which is what every
 *  screen read before this field existed. */
/** `scope` mirrors getDataScope() for the section (see /api/auth/me). */
export type SectionPerm = { view: boolean; create?: boolean; edit: boolean; delete: boolean; scope?: 'own' | 'team' | 'all' }
export type MePermissions = Record<string, SectionPerm>

export type Me = {
  /** Already on the wire from /api/auth/me; typed here so screens that
   *  separate "my rows" from "my team's rows" do not re-fetch it. */
  userId: string
  name: string
  phone: string
  role: string
  tenantName: string
  /** The server's Administrator-only rules (creating users, passwords,
   *  roles, deactivation), which no permission section expresses. Derived
   *  by /api/auth/me from the database role, so screens never compare
   *  role names themselves. */
  isAdministrator: boolean
  hasSubordinates: boolean
  permissions: MePermissions
}

let _cache: Me | null = null
/** One request shared by every screen mounted while it is out. */
let _inflight: Promise<Me | null> | null = null
/** Bumped by invalidateMeCache(), so a request that was already out when the
 *  cache was invalidated cannot write its now-stale answer back into it. */
let _generation = 0
/** Every mounted useMeStatus(). A successful load — including one that a
 *  single Retry started — reaches all of them, so the shell's Retry revives
 *  the controls on the page underneath rather than only its own copy. */
const _listeners = new Set<(me: Me) => void>()

/** Long enough for a slow mobile connection; short enough that a hung
 *  request surfaces as an error the screen can retry rather than a spinner
 *  that never ends. */
const ME_TIMEOUT_MS = 15_000

export function invalidateMeCache() {
  _cache = null
  _inflight = null
  _generation++
}

/**
 * Resolves to the user, or to null when a 401 has sent them to sign in.
 * Rejects on every other failure — a 5xx, a timeout, a body that is not a
 * user — and caches nothing then, so the next mount or retry asks again.
 * An error body is never cached as if it were a user: that is what used to
 * leave every control disabled for the rest of the session, and an
 * Administrator reading "Only someone who can…" under a user with no
 * permissions at all.
 */
function loadMe(): Promise<Me | null> {
  if (_cache) return Promise.resolve(_cache)
  if (_inflight) return _inflight
  const generation = _generation
  const request = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ME_TIMEOUT_MS)
    try {
      const r = await fetch('/api/auth/me', { signal: controller.signal })
      if (r.status === 401) {
        // Clear the cache BEFORE navigating. The 401 branch used to sit
        // behind the `if (_cache) return` above with nothing ever clearing
        // the cache, so once a session had been read successfully a later
        // 401 could not be seen at all - harmless while nothing expired,
        // and a permanently broken screen the moment tokens did.
        _cache = null
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
        redirectToLogin()
        return null
      }
      if (!r.ok) throw new Error(`/api/auth/me answered ${r.status}`)
      const d = (await r.json()) as Me
      if (!d || typeof d !== 'object' || !d.permissions) {
        throw new Error('/api/auth/me answered without a user')
      }
      if (generation === _generation) {
        _cache = d
        _listeners.forEach(l => l(d))
      }
      return d
    } finally {
      clearTimeout(timer)
      // A request from before an invalidation must not clear the one that
      // replaced it.
      if (generation === _generation) _inflight = null
    }
  })()
  _inflight = request
  return request
}

export type MeStatus = {
  /** null while not known yet — which screens must treat as "not known",
   *  never as "not allowed". */
  me: Me | null
  /** The last attempt failed for a reason other than an expired session.
   *  `me` stays null; nothing here is ever a refusal. */
  error: boolean
  /** A request is out. The error stays set while a retry is pending, so a
   *  banner reporting it does not blink away and back on a second failure. */
  pending: boolean
  /** Ask again now. A remount, or the window regaining focus, also retries,
   *  and a success anywhere updates every mounted caller. */
  retry: () => void
}

export function useMeStatus(): MeStatus {
  const [me, setMe] = useState<Me | null>(_cache)
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(a => a + 1), [])

  useEffect(() => {
    const listener = (d: Me) => { setMe(d); setError(false) }
    _listeners.add(listener)
    return () => { _listeners.delete(listener) }
  }, [])

  useEffect(() => {
    let live = true
    setPending(true)
    loadMe()
      .then(d => { if (live && d) { setMe(d); setError(false) } })
      .catch(() => { if (live) setError(true) })
      .finally(() => { if (live) setPending(false) })
    return () => { live = false }
  }, [attempt])

  // No dead end: a failure is retried the next time the user comes back to
  // the tab, without anything on screen having to offer a button for it.
  useEffect(() => {
    if (!error) return
    window.addEventListener('focus', retry)
    return () => window.removeEventListener('focus', retry)
  }, [error, retry])

  return { me, error, pending, retry }
}

export function useMe(): Me | null {
  return useMeStatus().me
}
