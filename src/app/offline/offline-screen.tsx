'use client'

import { CircleAlertIcon } from 'lucide-react'

import { PhoneAppBar } from '@/components/shell/app-bar'
import { Button } from '@/components/ui/button'
import { APP_NAME } from '@/lib/install-settings'

/**
 * Section 41.14 rules 9 and 10: a static app bar with the product name (no
 * back arrow, no actions, no tab bar: each needs the network), the offline
 * banner, and a failed state with "Try again", which reloads the address
 * the person asked for.
 */
export function OfflineScreen() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <PhoneAppBar title={APP_NAME} />
      <main className="flex flex-col gap-4 px-4 pt-4">
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-border-light bg-surface-sunken px-3 py-2 text-body text-text-primary"
        >
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-text-secondary" />
          <span>You are offline. Changes cannot be saved until you are back online.</span>
        </div>
        <section className="flex flex-col items-start gap-2 py-6">
          <h2 className="text-card-heading font-medium text-text-primary">Could not load this screen</h2>
          <p className="text-body text-text-primary">
            Check your connection, then try again. Nothing you have saved is lost.
          </p>
          <div className="pt-2">
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </div>
        </section>
      </main>
    </div>
  )
}
