'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.4: the one app-bar
 * implementation, shared by `PhoneShell` (phone-shell.tsx, which owns
 * title/back/actions/menu resolution per screen via `usePhoneAppBar`) and
 * `src/components/ui/sheet.tsx` (a `presentation="screen"` sheet, which
 * needs the same bar for its own full-screen layer).
 *
 * This used to be two copies: phone-shell.tsx drew its own header markup
 * inline, and this file was a minimal stand-in with tokens (`h-bar`,
 * `pt-safe-top`, …) that this app's `globals.css` never defined, so it
 * rendered unstyled wherever sheet.tsx used it. Both now render through
 * this one component, with phone-shell's actual (non-broken) markup and
 * safe-area handling.
 *
 *   56px, bg-primary, safe-area padding on top/left/right (the bottom
 *   safe area belongs to whatever sits below the bar, never the bar
 *   itself); an optional `leading` element (the back/close control, 44px
 *   per §41.9 rule 2), the title (20px/medium, truncated, one line), and
 *   up to two icon actions on the right per §41.4 rule 4 (sheet.tsx and
 *   phone-shell.tsx are both responsible for not exceeding that; this
 *   component does not re-check it).
 */
/**
 * Kit-compatible type and hook, added for `approval-select.tsx` (Wave 8B).
 *
 * The kit's `useAppBarOverride` (`frontend-kit/components/shell/app-bar.tsx`)
 * writes into a context `AppBarProvider` holds, which the real phone app
 * bar (`phone-app-bar.tsx`/`phone-shell.tsx`, owned by the phone session)
 * reads to draw select mode's "5 selected" + close button over the page's
 * own bar. This app has no such provider — `PhoneAppBar` above is
 * presentational, with no context — and wiring one into phone-shell.tsx
 * is a product decision (approval select mode is a new feature), not a
 * safe additive change to make here. See kit-gaps.md.
 *
 * So this hook is a NO-OP-SAFE STAND-IN: the context it reads has no
 * provider anywhere in the app, so `setOverride` is always undefined and
 * the effect below does nothing. Calling it (as `approval-select.tsx`'s
 * `SelectModeAppBar` does) is therefore always inert — it never throws,
 * and it never changes what the phone app bar shows. Once a page actually
 * wants select mode, wiring this into phone-shell.tsx is the follow-up
 * logged in kit-gaps.md.
 */
type AppBarOverride = {
  leading?: React.ReactNode
  title?: string
  actions?: React.ReactNode
  hideTabBar?: boolean
}

const AppBarSettersContext = React.createContext<
  ((owner: string, value: AppBarOverride | null) => void) | null
>(null)

function useAppBarOverride(override: AppBarOverride | null): void {
  const setOverride = React.useContext(AppBarSettersContext)
  const owner = React.useId()
  React.useLayoutEffect(() => {
    setOverride?.(owner, override)
  })
  React.useLayoutEffect(() => () => setOverride?.(owner, null), [setOverride, owner])
}

export function PhoneAppBar({
  title,
  titleAs = 'h1',
  leading,
  actions,
}: {
  title?: string
  titleAs?: 'h1' | 'h2'
  leading?: React.ReactNode
  actions?: React.ReactNode
}) {
  const Heading = titleAs
  return (
    <header
      data-slot="phone-app-bar"
      className="shrink-0 bg-primary text-primary-foreground"
      style={{
        paddingTop: 'var(--safe-top)',
        paddingLeft: 'var(--safe-left)',
        paddingRight: 'var(--safe-right)',
      }}
    >
      <div className="flex h-(--h-app-bar) items-center gap-2 px-2">
        {leading}
        {/* §41.4 rule 20: with no leading control the title lines up with
            the content's 16px edge. */}
        <Heading className={cn('min-w-0 flex-1 truncate text-[20px] font-medium', !leading && 'pl-2')}>
          {title}
        </Heading>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
    </header>
  )
}

export { useAppBarOverride }
export type { AppBarOverride }
