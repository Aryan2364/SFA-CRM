'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeftIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useMe, invalidateMeCache } from '@/hooks/useMe'
import { ConnectionBanner } from '@/components/ui/connection-banner'
import { PHONE_TABS, visiblePhoneTabs, type PhoneTab } from './phone-tabs'
import { usePhoneTabBadge } from './phone-tab-badges'
import { PhoneAppBarProvider, usePhoneAppBarState } from './phone-app-bar'
import { useKeyboardInset } from '@/lib/use-keyboard-inset'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.4: the phone shell.
 *
 *   ┌──────────────────────────────┐
 *   │ ‹   Page title            ⋯  │  app bar, 56px, primary
 *   ├──────────────────────────────┤
 *   │   content, surface-sunken    │
 *   ├──────────────────────────────┤
 *   │ Today  Accounts  …     More  │  tab bar, top-level screens only
 *   └──────────────────────────────┘
 *
 * This is a deliberately simplified port, not the kit's full
 * app-bar.tsx/tab-bar.tsx pair (no BandScope, no AppBarProvider override
 * for select mode, no PageHeader/first-paint contract, no keyboard-aware
 * hiding) — see the phone-foundation build report for what is deferred.
 * It still gives every phone screen: a primary app bar with back/title/
 * at most two actions, a permission-gated bottom tab bar, and safe-area
 * padding on both.
 *
 * `title` is this screen's page title; a screen below the top level
 * (any href not in PHONE_TABS) gets a back arrow instead of the tab bar.
 */
export function PhoneShell({
  title,
  actions,
  children,
}: {
  /** Fallback title, used only while no page has called usePhoneAppBar(). */
  title: string
  /** Fallback actions (At most two icon buttons — §41.4 rule 4). */
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <PhoneAppBarProvider>
      <PhoneShellInner title={title} actions={actions}>
        {children}
      </PhoneShellInner>
    </PhoneAppBarProvider>
  )
}

function PhoneShellInner({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const me = useMe()
  const tabs = visiblePhoneTabs(me)
  const topLevel = PHONE_TABS.some(tab => tab.href === pathname)
  const keyboardOpen = useKeyboardInset()

  // §41.4 rule 4: the page below the top level owns its own app bar. No
  // page has registered one (true on every tab-root screen) -> fall back
  // to the tab label, no back arrow, no menu.
  const barConfig = usePhoneAppBarState()
  const resolvedTitle = barConfig?.title ?? title
  const resolvedActions = barConfig ? barConfig.actions : actions
  const resolvedMenu = barConfig?.menu
  // A registered config with no `back` (a tab root re-registering itself)
  // still shows no arrow; a registered config WITH `back` always shows one,
  // even if the route happens to also be a tab root.
  const showBack = barConfig ? Boolean(barConfig.back) : !topLevel
  const backHref = barConfig?.back

  // Tab bar hides, not just scrolls under, while the keyboard covers it
  // (§41.4 rule 19 / §41.7 rule 4) — otherwise it sits uselessly behind
  // the keyboard and still eats layout space the form needs.
  const showTabBar = topLevel && !keyboardOpen

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-sunken">
      <header
        className="shrink-0 bg-primary text-primary-foreground"
        style={{
          paddingTop: 'var(--safe-top)',
          paddingLeft: 'var(--safe-left)',
          paddingRight: 'var(--safe-right)',
        }}
      >
        <div className="flex h-[--h-app-bar] items-center gap-2 px-2">
          {showBack ? (
            <button
              type="button"
              aria-label="Back"
              onClick={() => (backHref ? router.push(backHref) : router.back())}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg active:bg-white/10"
            >
              <ChevronLeftIcon className="size-6" />
            </button>
          ) : (
            <div className="size-11" aria-hidden />
          )}
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-medium">{resolvedTitle}</h1>
          {resolvedActions ? <div className="flex shrink-0 items-center gap-1">{resolvedActions}</div> : null}
          {resolvedMenu}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pt-4" style={{ paddingBottom: showTabBar ? 'calc(var(--h-tab-bar) + var(--safe-bottom) + 16px)' : '16px' }}>
        <ConnectionBanner className="mb-4" />
        {children}
      </main>

      {showTabBar ? <PhoneTabBar tabs={tabs} pathname={pathname} userId={me?.userId} /> : null}
    </div>
  )
}

function PhoneTabBar({
  tabs,
  pathname,
  userId,
}: {
  tabs: ReturnType<typeof visiblePhoneTabs>
  pathname: string
  userId: string | undefined
}) {
  if (tabs.length < 2) return null
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-[--z-shell] flex border-t border-border-light bg-surface"
      style={{
        height: 'calc(var(--h-tab-bar) + var(--safe-bottom))',
        paddingBottom: 'var(--safe-bottom)',
        paddingLeft: 'var(--safe-left)',
        paddingRight: 'var(--safe-right)',
      }}
    >
      {tabs.map(tab => (
        <PhoneTabBadged key={tab.href} tab={tab} active={tab.href === pathname} userId={userId} />
      ))}
    </nav>
  )
}

/** Reads the count the tab's own screen published (phone-tab-badges.ts). */
function PhoneTabBadged({ tab, active, userId }: { tab: PhoneTab; active: boolean; userId: string | undefined }) {
  const badge = usePhoneTabBadge(tab.href, userId)
  return <PhoneTabItem tab={tab} active={active} badge={badge} />
}

function PhoneTabItem({ tab, active, badge }: { tab: PhoneTab; active: boolean; badge?: number }) {
  const Icon = tab.icon
  const count = badge && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : null
  return (
    <Link
      href={tab.href}
      onClick={() => invalidateMeCache()}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 transition-colors duration-150 active:bg-surface-control',
        active ? 'text-primary' : 'text-text-secondary'
      )}
    >
      <span className="relative flex">
        <Icon className="size-[22px]" aria-hidden />
        {count !== null ? (
          // §41.4 rule 16 / §6.8: a primary pill at the top right of the
          // icon, 18px tall, a circle for one digit, "99+" over 99. Read
          // with the label (sr-only below), not before it.
          <span
            aria-hidden
            className={cn(
              'absolute -top-2 left-3 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary text-[12px] font-medium leading-none text-primary-foreground tabular-nums',
              count.length > 1 && 'px-[6px]'
            )}
          >
            {count}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate text-[12px] font-medium">{tab.label}</span>
      {count !== null ? <span className="sr-only">, {count}</span> : null}
    </Link>
  )
}
