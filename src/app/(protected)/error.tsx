'use client'

import { useEffect } from 'react'

import { EmptyState } from '@/components/ui/empty-state'

/**
 * The boundary for every screen inside the app shell. Next places it
 * below this segment's layout, so the sidebar and the top bar stay on
 * screen and the user keeps their navigation - which is also why this
 * one carries no dashboard link of its own. The menu already has one,
 * and the same action twice is worse than once.
 *
 * Section 7.2 rule 3: the raw message goes to the console, never to the
 * user.
 */
export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Unhandled error on a protected screen:', error)
  }, [error])

  return (
    <EmptyState variant="failed" heading="This screen could not be shown" onAction={reset}>
      Something went wrong while the screen was loading. Try again, or choose
      another screen from the navigation menu.
    </EmptyState>
  )
}
