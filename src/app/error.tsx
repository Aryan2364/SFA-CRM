'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

import { EmptyState } from '@/components/ui/empty-state'

/**
 * Catches a render throw on any page that is not inside the app shell -
 * login, password reset, the SuperAdmin screens - so a fault there is a
 * recoverable state rather than the browser's bare error page.
 *
 * The shell's own boundary is (protected)/error.tsx, which keeps the
 * navigation on screen. This one has no navigation above it, so it
 * carries its own way back.
 *
 * Section 7.2 rule 3: the raw message goes to the console, never to the
 * user.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Unhandled error:', error)
  }, [error])

  // This boundary also catches the SuperAdmin screens, whose way back is
  // their own landing page - the tenant dashboard would bounce them.
  const superAdmin = usePathname()?.startsWith('/superadmin') ?? false
  const home = superAdmin ? '/superadmin/companies' : '/'

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState variant="failed" heading="This page could not be shown" onAction={reset}>
        Something went wrong while the page was loading. Try again, or{' '}
        <a
          href={home}
          className="text-primary underline underline-offset-2 outline-none hover:text-primary-hover focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
        >
          {superAdmin ? 'go back to Companies' : 'go to the dashboard'}
        </a>
        .
      </EmptyState>
    </main>
  )
}
