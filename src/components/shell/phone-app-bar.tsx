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

type ContextValue = {
  config: PhoneAppBarConfig | null
  setConfig: (config: PhoneAppBarConfig | null) => void
}

const PhoneAppBarContext = React.createContext<ContextValue | null>(null)

/** Mounted once by PhoneShell, around both the header and `children`. */
export function PhoneAppBarProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = React.useState<PhoneAppBarConfig | null>(null)
  const value = React.useMemo(() => ({ config, setConfig }), [config])
  return React.createElement(PhoneAppBarContext.Provider, { value }, children)
}

/** Read by PhoneShell. Returns null when no page below it has registered a config. */
export function usePhoneAppBarState(): PhoneAppBarConfig | null {
  return React.useContext(PhoneAppBarContext)?.config ?? null
}

/**
 * Called by a page to own the phone app bar for as long as it is mounted.
 * See the module doc above for a full example.
 */
export function usePhoneAppBar(config: PhoneAppBarConfig) {
  const ctx = React.useContext(PhoneAppBarContext)
  const { title, back, actions, menu } = config
  React.useEffect(() => {
    if (!ctx) return
    ctx.setConfig({ title, back, actions, menu })
    return () => ctx.setConfig(null)
  }, [ctx, title, back, actions, menu])
}
