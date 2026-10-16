'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarIcon, ChevronRightIcon, DownloadIcon, LogOutIcon, ReceiptIcon, UserIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useLayout } from '@/lib/layout'
import { invalidateMeCache, useMe } from '@/hooks/useMe'

/** package.json's own version — the one source, so this never drifts from the build. */
import pkg from '../../../../package.json'

/**
 * Phone foundation — §41.12 rules 7-8: the install option lives in More
 * only, never a pop-up, and is hidden once installed. Android uses the
 * browser's own beforeinstallprompt; iPhone gets a sheet with the
 * Share → Add to Home Screen steps, since Safari exposes no install
 * prompt API.
 */
function useInstallPrompt() {
  const [installed, setInstalled] = useState(false)
  const [deferred, setDeferred] = useState<Event | null>(null)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    setInstalled(standalone)

    const onPrompt = (event: Event) => {
      event.preventDefault()
      setDeferred(event)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)

  return { installed, canPromptAndroid: deferred !== null, isIOS, deferred }
}

export default function MorePage() {
  const { layout } = useLayout()
  const router = useRouter()
  const me = useMe()
  const [signingOut, setSigningOut] = useState(false)
  const [iosSheetOpen, setIosSheetOpen] = useState(false)
  const install = useInstallPrompt()

  useEffect(() => {
    if (layout === 'desktop') router.replace('/')
  }, [layout, router])

  if (layout === 'desktop') return null

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      invalidateMeCache()
      router.push('/login')
    } catch {
      setSigningOut(false)
    }
  }

  async function promptInstall() {
    if (install.isIOS) {
      setIosSheetOpen(true)
      return
    }
    const event = install.deferred as (Event & { prompt?: () => Promise<void> }) | null
    await event?.prompt?.()
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
  rows.push({ label: 'Profile', icon: UserIcon, onClick: () => router.push('/profile') })
  if (!install.installed) {
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

      {iosSheetOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install app"
          className="fixed inset-0 z-[--z-shell] flex items-end bg-black/40"
          onClick={() => setIosSheetOpen(false)}
        >
          <div
            className="w-full rounded-t-2xl bg-surface p-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)]"
            onClick={event => event.stopPropagation()}
          >
            <p className="text-card-heading font-medium text-text-primary">Install RGB SFA</p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-body text-text-primary">
              <li>Tap the Share button in Safari&apos;s toolbar.</li>
              <li>Scroll down and tap &quot;Add to Home Screen&quot;.</li>
            </ol>
            <button
              type="button"
              className="mt-4 h-11 w-full rounded-lg bg-primary text-body font-medium text-primary-foreground"
              onClick={() => setIosSheetOpen(false)}
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
