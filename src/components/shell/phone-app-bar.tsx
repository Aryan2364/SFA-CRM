'use client'

import * as React from 'react'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.4 rule 4: every phone
 * screen owns its own app bar (title, back target, ≤2 icon actions, and
 * an optional three-dot overflow menu), rather than the shell guessing
 * one from the route.
 *
 * `PhoneShell` (phone-shell.tsx) renders the actual bar and falls back to
 * the active tab's label with no back arrow when no page has registered
 * a config — that fallback is what every tab-ROOT page gets for free. A
 * page below the top level calls `usePhoneAppBar()` to set its own title
 * and an explicit `back` target (the parent URL, not just "whatever the
 * browser history happens to hold").
 *
 * Usage, in a phone screen below the tab root:
 *
 *   usePhoneAppBar({
 *     title: company.name,
 *     back: '/parties',
 *     actions: <ShareIconButton company={company} />,
 *     menu: (
 *       <DropdownMenu>
 *         <DropdownMenuTrigger render={<IconButton aria-label="More" />}>
 *           <MoreVerticalIcon />
 *         </DropdownMenuTrigger>
 *         <DropdownMenuContent>...</DropdownMenuContent>
 *       </DropdownMenu>
 *     ),
 *   })
 *
 * The config is registered on mount and cleared on unmount, so navigating
 * away always restores the shell's own fallback rather than leaking a
 * stale title/back target onto the next screen.
 */
export type PhoneAppBarConfig = {
  title: string
  /** Parent URL for the back arrow. Omit only on a tab-root page. */
  back?: string
  /** At most two icon buttons (rule 4) — never more. */
  actions?: React.ReactNode
  /** The three-dot overflow menu, fully built by the caller (e.g. a DropdownMenu). */
  menu?: React.ReactNode
}

// Two contexts on purpose: pages that set the bar read only the (stable)
// setter, so a change to the bar does not re-render the page that set it.
// With one context, the page re-rendered on its own setConfig, rebuilt its
// actions, set them again, and looped forever, freezing every tap.
type SetConfig = (config: PhoneAppBarConfig | null) => void

const PhoneAppBarStateContext = React.createContext<PhoneAppBarConfig | null>(null)
const PhoneAppBarSetContext = React.createContext<SetConfig | null>(null)

export function PhoneAppBarProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = React.useState<PhoneAppBarConfig | null>(null)
  return React.createElement(
    PhoneAppBarSetContext.Provider,
    { value: setConfig },
    React.createElement(PhoneAppBarStateContext.Provider, { value: config }, children)
  )
}

export function usePhoneAppBarState(): PhoneAppBarConfig | null {
  return React.useContext(PhoneAppBarStateContext)
}

/**
 * Called by a page to own the phone app bar for as long as it is mounted.
 * See the module doc above for a full example.
 */
export function usePhoneAppBar(config: PhoneAppBarConfig) {
  const setConfig = React.useContext(PhoneAppBarSetContext)
  const { title, back, actions, menu } = config
  React.useEffect(() => {
    if (!setConfig) return
    setConfig({ title, back, actions, menu })
  }, [setConfig, title, back, actions, menu])
  // Cleared only when the page leaves, not between its own updates.
  React.useEffect(() => {
    if (!setConfig) return
    return () => setConfig(null)
  }, [setConfig])
}
