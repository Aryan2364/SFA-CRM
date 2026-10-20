'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeftIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useMeStatus } from '@/hooks/useMe'
import { ConnectionBanner } from '@/components/ui/connection-banner'
import { PHONE_TABS, visiblePhoneTabs, type PhoneTab } from './phone-tabs'
import { usePhoneTabBadge } from './phone-tab-badges'
import { PhoneAppBarProvider, usePhoneAppBarState } from './phone-app-bar'
import { PhoneAppBar } from './app-bar'
import { PhoneLeaveGuardProvider, useGuardedNavigate, useInterceptLeave } from './phone-leave-guard'
import { usePermissionRefresh } from './use-permission-refresh'
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
      <PhoneLeaveGuardProvider>
        <PhoneShellInner title={title} actions={actions}>
          {children}
        </PhoneShellInner>
      </PhoneLeaveGuardProvider>
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
  const navigate = useGuardedNavigate()
  const { me, retry } = useMeStatus()
  usePermissionRefresh(retry)
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
  // A screen that names no back target goes to the tab it sits under, never
  // router.back(): straight after sign-in the previous history entry is
  // /login, so "back" would leave the app.
  const backHref =
    barConfig?.back ??
    PHONE_TABS.find(tab => pathname.startsWith(`${tab.href}/`))?.href ??
    '/today'

  // Tab bar hides, not just scrolls under, while the keyboard covers it
  // (§41.4 rule 19 / §41.7 rule 4) — otherwise it sits uselessly behind
  // the keyboard and still eats layout space the form needs.
  const showTabBar = topLevel && !keyboardOpen

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-surface-sunken"
      // An ActionBar on a tab root (Today's "+ Log meeting") sits on top of
      // the tab bar, not underneath it; it reads these two values.
      style={
        {
          '--tab-bar-offset': showTabBar ? 'calc(var(--h-tab-bar) + var(--safe-bottom))' : '0px',
          '--action-bar-safe': showTabBar ? '0px' : 'var(--safe-bottom)',
        } as React.CSSProperties
      }
    >
      <PhoneAppBar
        title={resolvedTitle}
        leading={
          showBack ? (
            <button
              type="button"
              aria-label="Back"
              onClick={() => navigate(backHref)}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg active:bg-white/10"
            >
              <ChevronLeftIcon className="size-[22px]" />
            </button>
          ) : null
        }
        actions={
          resolvedActions || resolvedMenu ? (
            <>
              {resolvedActions}
              {resolvedMenu}
            </>
          ) : null
        }
      />

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
  const intercept = useInterceptLeave()
  if (tabs.length < 2) return null
  return (
    <nav
      aria-label="Main"
      data-fixed-bottom="tab-bar"
      className="fixed inset-x-0 bottom-0 z-(--z-shell) flex border-t border-border-light bg-surface"
      style={{
        height: 'calc(var(--h-tab-bar) + var(--safe-bottom))',
        paddingBottom: 'var(--safe-bottom)',
        paddingLeft: 'var(--safe-left)',
        paddingRight: 'var(--safe-right)',
      }}
    >
      {tabs.map(tab => (
        <PhoneTabBadged key={tab.href} tab={tab} active={tab.href === pathname} userId={userId} intercept={intercept} />
      ))}
    </nav>
  )
}

/** Reads the count the tab's own screen published (phone-tab-badges.ts). */
function PhoneTabBadged({
  tab,
  active,
  userId,
  intercept,
}: {
  tab: PhoneTab
  active: boolean
  userId: string | undefined
  intercept: (href: string) => boolean
}) {
  const badge = usePhoneTabBadge(tab.href, userId)
  return <PhoneTabItem tab={tab} active={active} badge={badge} intercept={intercept} />
}

function PhoneTabItem({
  tab,
  active,
  badge,
  intercept,
}: {
  tab: PhoneTab
  active: boolean
  badge?: number
  intercept: (href: string) => boolean
}) {
  const Icon = tab.icon
  const count = badge && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : null
  return (
    <Link
      href={tab.href}
      onClick={event => {
        // A form with unsaved changes asks before the tab opens.
        if (!active && intercept(tab.href)) event.preventDefault()
      }}
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
