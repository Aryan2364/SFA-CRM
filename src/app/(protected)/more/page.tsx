'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BellIcon, CalendarCheckIcon, CalendarIcon, ChevronRightIcon, DownloadIcon, LogOutIcon, ReceiptIcon, UserIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useLayout } from '@/lib/layout'
import { invalidateMeCache, useMe } from '@/hooks/useMe'
import { useInstall } from '@/lib/install'
import { releasePushOnSignOut } from '@/lib/push-device'
import { resetNotifications } from '@/lib/phone-notifications'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'

/** package.json's own version — the one source, so this never drifts from the build. */
import pkg from '../../../../package.json'

export default function MorePage() {
  const { layout } = useLayout()
  const router = useRouter()
  const me = useMe()
  const [signingOut, setSigningOut] = useState(false)
  const [stepsSheetOpen, setStepsSheetOpen] = useState(false)
  // §41.12 rules 7-8: the install option lives in More only, never a
  // pop-up, and is hidden once installed. The kit's useInstall (lib/install.ts)
  // keeps the browser's own question from the moment the page opens.
  const install = useInstall()

  useEffect(() => {
    if (layout === 'desktop') router.replace('/')
  }, [layout, router])

  if (layout === 'desktop') return null

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      // Before the session ends, so the next person on this phone does not
      // get this person's notifications (lib/push.ts). Best effort; sign-out
      // never waits on it for more than about 2 seconds.
      await releasePushOnSignOut()
      await fetch('/api/auth/logout', { method: 'POST' })
      invalidateMeCache()
      resetNotifications()
      router.push('/login')
    } catch {
      setSigningOut(false)
    }
  }

  async function promptInstall() {
    // Where the browser can ask itself (Chrome-based on Android) it does;
    // everywhere else (Safari on iPhone, other browsers) the steps are shown.
    if (install.canPrompt) {
      const outcome = await install.prompt()
      if (outcome !== 'unavailable') return
    }
    setStepsSheetOpen(true)
  }

  // Permission-aware (CLAUDE.md, kit §4): a whole area the user cannot see
  // is hidden, not shown-disabled. `expenses:view` / `weekly_plan:view`
  // gate whether the row appears at all, matching what `/api/expenses` and
  // `/api/weekly-plans/my` themselves check — "not known yet" (me === null)
  // shows nothing extra rather than guessing.
  const canViewExpenses = me?.permissions?.expenses?.view
  const canViewWeeklyPlan = me?.permissions?.weekly_plan?.view

  const rows: { label: string; icon: typeof UserIcon; onClick: () => void }[] = []
  if (canViewExpenses) {
    rows.push({ label: 'Expenses', icon: ReceiptIcon, onClick: () => router.push('/expenses') })
  }
  if (canViewWeeklyPlan) {
    rows.push({ label: 'Weekly plan', icon: CalendarIcon, onClick: () => router.push('/weekly-plan') })
  }
  // Plans waiting on a manager: only someone who reviews anyone has this area
  // (the queue route answers "you review nobody" for everyone else), so it is
  // hidden, not shown disabled. The Approvals chip on Today lists the same plans.
  if (canViewWeeklyPlan && (me?.isAdministrator || me?.hasSubordinates)) {
    rows.push({ label: 'Plan approvals', icon: CalendarCheckIcon, onClick: () => router.push('/weekly-plan/approval') })
  }
  rows.push({ label: 'Profile', icon: UserIcon, onClick: () => router.push('/profile') })
  rows.push({ label: 'Phone notifications', icon: BellIcon, onClick: () => router.push('/notifications#phone-notifications') })
  if (install.ready && !install.installed) {
    rows.push({ label: 'Install app', icon: DownloadIcon, onClick: promptInstall })
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-border-light rounded-xl border border-border-light bg-surface">
        {rows.map(row => (
          <li key={row.label}>
            <button
              type="button"
              onClick={row.onClick}
              className={cn(
                'flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left text-body text-text-primary active:bg-surface-control'
              )}
            >
              <row.icon className="size-5 text-text-secondary" aria-hidden />
              <span className="min-w-0 flex-1">{row.label}</span>
              <ChevronRightIcon className="size-4 text-text-secondary" aria-hidden />
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left text-body text-danger active:bg-surface-control disabled:opacity-60"
          >
            <LogOutIcon className="size-5" aria-hidden />
            <span className="min-w-0 flex-1">{signingOut ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </li>
      </ul>

      <p className="px-1 text-center text-meta text-text-muted">RGB SFA v{pkg.version}</p>

      <BottomSheet
        open={stepsSheetOpen}
        onOpenChange={setStepsSheetOpen}
        title="Install RGB SFA"
        footer={<Button onClick={() => setStepsSheetOpen(false)}>Got it</Button>}
      >
        {install.platform === 'ios' ? (
          <ol className="list-decimal space-y-2 pl-5 text-body text-text-primary">
            <li>Tap the Share button in Safari&apos;s toolbar.</li>
            <li>Scroll down and tap &quot;Add to Home Screen&quot;.</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-body text-text-primary">
            <li>Open your browser&apos;s menu.</li>
            <li>Tap &quot;Install app&quot; or &quot;Add to Home screen&quot;.</li>
          </ol>
        )}
      </BottomSheet>
    </div>
  )
}
