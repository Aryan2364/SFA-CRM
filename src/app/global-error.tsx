'use client'

import { useEffect, useState } from 'react'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'

import './globals.css'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * The last boundary. It replaces the root layout rather than rendering
 * inside it, so it brings its own <html>, <body>, stylesheet and font
 * variables - without them this renders unstyled, in a serif, which is
 * section 3's definition of the font having failed.
 *
 * Section 7.2 rule 3: the user never sees the raw message. It goes to
 * the console, where whoever is diagnosing it will look.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Unhandled error at the application root:', error)
  }, [error])

  // This replaces the root layout, so the router's pathname context is not
  // guaranteed here; read the address bar instead. A SuperAdmin crash goes
  // back to the SuperAdmin landing page, not the tenant dashboard.
  const [superAdmin, setSuperAdmin] = useState(false)
  useEffect(() => {
    setSuperAdmin(window.location.pathname.startsWith('/superadmin'))
  }, [])
  const home = superAdmin ? '/superadmin/companies' : '/'

  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-surface-sunken text-text-primary antialiased">
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
      </body>
    </html>
  )
}
