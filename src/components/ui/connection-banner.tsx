'use client'

import * as React from 'react'
import { CircleAlertIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useLayout } from '@/lib/layout'
import { useServiceWorker } from '@/lib/service-worker'
import { Button } from '@/components/ui/button'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.14 rule 6: while the
 * phone has no connection, a neutral banner sits above the content and
 * never goes away until the connection returns.
 *
 * Simplified port of the kit's connection-banner.tsx: no unsaved-changes
 * gate, since there is no shared form-draft system yet to consult. The
 * new-version banner (§41.14 rule 11) is here now that the service worker
 * exists (lib/service-worker.ts): "A new version is ready" with Reload.
 * Phone only; renders nothing on desktop.
 */
export function ConnectionBanner({ className }: { className?: string }) {
  const { layout } = useLayout()
  const online = useOnline()
  const { updateReady, reload } = useServiceWorker()

  if (layout !== 'phone') return null
  if (online && updateReady) {
    return (
      <div
        role="status"
        className={cn(
          'flex items-center gap-2 rounded-lg border border-border-light bg-surface-sunken px-3 py-2 text-body text-text-primary',
          className
        )}
      >
        <span className="min-w-0 flex-1">A new version is ready.</span>
        <Button variant="secondary" onClick={reload}>
          Reload
        </Button>
      </div>
    )
  }
  if (online) return null

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
