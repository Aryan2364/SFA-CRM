'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { AppShell } from '@/components/shell/app-shell'
import { PhoneShell } from '@/components/shell/phone-shell'
import { PHONE_TABS } from '@/components/shell/phone-tabs'
import { Button } from '@/components/ui/button'
import { invalidateMeCache, useMe } from '@/hooks/useMe'
import { useLayout } from '@/lib/layout'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const me = useMe()
  const router = useRouter()
  const pathname = usePathname()
  const { layout } = useLayout()
  const [signingOut, setSigningOut] = useState(false)

  // The same sign-out as the top bar's user menu. /api/auth/logout is
  // POST-only: a plain link to it is a GET, answers 405, and leaves the user
  // signed in on a screen with no other way out.
  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      invalidateMeCache()
      router.push('/login')
    } catch {
      // Network failure: the cookie is still set, so let them try again.
      setSigningOut(false)
    }
  }

  // Show "define role" screen for users with no role assigned yet
  if (me !== null && me.role === 'NoRole') {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface-sunken px-4">
        <div className="max-w-sm w-full text-center">
          <div className="bg-surface rounded-2xl border border-border-light shadow-sm p-8">
            <div className="w-14 h-14 bg-warning-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-text-primary mb-2">Role Not Configured</h2>
            <p className="text-sm text-text-muted mb-6 leading-relaxed">
              Your account does not have a role assigned yet. Please contact your administrator to configure your access.
            </p>
            <Button className="w-full" onClick={signOut} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Desktop shell is completely unchanged. On phone, every page is wrapped
  // in the phone shell (app bar + bottom tab bar); the page's own title
  // isn't threaded through yet (no per-page PageHeader contract — see the
  // phone-foundation build report), so the top-level screen's own tab
  // label is used, falling back to the product name for screens reached
  // one tap further in (which also get a back arrow instead of the tab bar).
  if (layout === 'phone') {
    const tab = PHONE_TABS.find(item => item.href === pathname)
    return <PhoneShell title={tab?.label ?? 'RGB SFA'}>{children}</PhoneShell>
  }

  return <AppShell>{children}</AppShell>
}
