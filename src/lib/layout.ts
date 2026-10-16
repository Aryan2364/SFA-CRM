'use client'

import * as React from 'react'

import { LAYOUT_COOKIE, PHONE_SHORT_SIDE, type Layout, type WidthBand } from './layout-shared'

/**
 * FRONTEND_RULES_PHONE.md §41.2: which layout a device gets, and the width
 * band inside it.
 *
 * THIS IS THE ONE PLACE THAT MEASURES THE SCREEN (rule 2). Every phone
 * variant of a component asks useLayout(); nothing else calls matchMedia
 * or reads `screen` itself.
 *
 *   - THE LAYOUT comes from the SCREEN's shorter side AND the main pointer
 *     (rule 1), never the window. A narrow browser window on a computer
 *     stays desktop; a phone turned sideways stays phone.
 *   - THE BAND comes from the VIEWPORT width (§9): desktop >=1280, laptop
 *     >=1024, tablet >=768, else narrow.
 *
 * THE FIRST PAINT IS THE SERVER'S GUESS (rule 3, src/lib/layout.server.ts).
 * useLayout() answers with that guess while hydrating, then corrects once
 * to the measured answer and saves it in the `layout` cookie.
 */

const YEAR = 60 * 60 * 24 * 365

type Snapshot = { layout: Layout; band: WidthBand }

let current: Snapshot | null = null
const listeners = new Set<() => void>()
let detach: (() => void) | null = null

const TOUCH_FIRST = '(pointer: coarse)'

function isTouchFirst() {
  const hint = (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
    .userAgentData?.mobile
  return window.matchMedia(TOUCH_FIRST).matches || hint === true
}

function measure(): Snapshot {
  const shortSide = Math.min(window.screen.width, window.screen.height)
  const layout: Layout = shortSide < PHONE_SHORT_SIDE && isTouchFirst() ? 'phone' : 'desktop'
  const band: WidthBand = window.matchMedia('(min-width: 1280px)').matches
    ? 'desktop'
    : window.matchMedia('(min-width: 1024px)').matches
      ? 'laptop'
      : window.matchMedia('(min-width: 768px)').matches
        ? 'tablet'
        : 'narrow'
  return { layout, band }
}

function refresh() {
  const next = measure()
  if (current && current.layout === next.layout && current.band === next.band) return false
  current = next
  return true
}

function notify() {
  if (refresh()) listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!detach) {
    window.addEventListener('resize', notify)
    window.screen.orientation?.addEventListener('change', notify)
    window.addEventListener('orientationchange', notify)
    const pointer = window.matchMedia(TOUCH_FIRST)
    pointer.addEventListener('change', notify)
    detach = () => {
      window.removeEventListener('resize', notify)
      window.screen.orientation?.removeEventListener('change', notify)
      window.removeEventListener('orientationchange', notify)
      pointer.removeEventListener('change', notify)
    }
    notify()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && detach) {
      detach()
      detach = null
    }
  }
}

function getSnapshot(): Snapshot {
  if (!detach || !current) refresh()
  return current as Snapshot
}

const SERVER_DESKTOP: Snapshot = { layout: 'desktop', band: 'desktop' }
const SERVER_PHONE: Snapshot = { layout: 'phone', band: 'narrow' }

const InitialLayoutContext = React.createContext<Layout>('desktop')

function useMeasured(initial: Layout): Snapshot {
  return React.useSyncExternalStore(subscribe, getSnapshot, () =>
    initial === 'phone' ? SERVER_PHONE : SERVER_DESKTOP
  )
}

/**
 * The layout and width band, for any client component. On the server and
 * while hydrating it answers with the server's guess; from then on with
 * the measured screen and viewport.
 */
export function useLayout(): { layout: Layout; band: WidthBand } {
  return useMeasured(React.useContext(InitialLayoutContext))
}

function readCookie(): string | undefined {
  try {
    const prefix = `${LAYOUT_COOKIE}=`
    return document.cookie
      .split('; ')
      .find(part => part.startsWith(prefix))
      ?.slice(prefix.length)
  } catch {
    return undefined
  }
}

/**
 * Mounted once in the root layout, inside <body>. `initial` is the
 * server's guess from getInitialLayout(). Corrects data-layout on <html>
 * when the measured layout differs, and keeps the `layout` cookie holding
 * the measured answer so the next request is guessed right.
 */
export function LayoutProvider({
  initial,
  children,
}: {
  initial: Layout
  children: React.ReactNode
}): React.ReactNode {
  const { layout } = useMeasured(initial)

  React.useLayoutEffect(() => {
    const measured = getSnapshot().layout
    const root = document.documentElement
    if (root.dataset.layout !== measured) root.dataset.layout = measured
    if (readCookie() !== measured) {
      try {
        document.cookie = `${LAYOUT_COOKIE}=${measured}; path=/; max-age=${YEAR}; samesite=lax`
      } catch {}
    }
  }, [layout])

  return React.createElement(InitialLayoutContext.Provider, { value: initial }, children)
}

export { LAYOUT_COOKIE, PHONE_SHORT_SIDE }
export type { Layout, WidthBand }
