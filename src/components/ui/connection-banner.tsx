'use client'

import * as React from 'react'
import { CircleAlertIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useLayout } from '@/lib/layout'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.14 rule 6: while the
 * phone has no connection, a neutral banner sits above the content and
 * never goes away until the connection returns.
 *
 * Simplified port of the kit's connection-banner.tsx: no new-version /
 * service-worker banner (§41.14 rule 11 — no service worker was built,
 * see the phone-foundation build report), and no unsaved-changes gate,
 * since there is no shared form-draft system yet to consult. Phone only;
 * renders nothing on desktop.
 */
export function ConnectionBanner({ className }: { className?: string }) {
  const { layout } = useLayout()
  const online = useOnline()

  if (layout !== 'phone' || online) return null

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg border border-border-light bg-surface-sunken px-3 py-2 text-body text-text-primary',
        className
      )}
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-text-secondary" />
      <span>You are offline. Changes cannot be saved until you are back online.</span>
    </div>
  )
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function useOnline(): boolean {
  return React.useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  )
}
