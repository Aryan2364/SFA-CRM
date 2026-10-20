'use client'

import { useEffect, useRef } from 'react'

import { invalidateMeCache } from '@/hooks/useMe'

/** Do not refetch /me more than once in this window, however often focus flips. */
const MIN_INTERVAL_MS = 30_000

/**
 * Kit section 26: permissions refresh when the tab regains focus (or on a
 * 403), not on every navigation. `retry` is useMeStatus().retry: it asks
 * again and, on success, updates every mounted caller in place. `me` stays
 * what it was while the request is out, so no control flashes "not known".
 */
export function usePermissionRefresh(retry: () => void) {
  const retryRef = useRef(retry)
  useEffect(() => {
    retryRef.current = retry
  })
  useEffect(() => {
    let last = Date.now()
    function refresh() {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - last < MIN_INTERVAL_MS) return
      last = now
      invalidateMeCache()
      retryRef.current()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
}
