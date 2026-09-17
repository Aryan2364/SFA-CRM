'use client'

import { useCallback, useSyncExternalStore } from 'react'

import {
  readSidebarPreference,
  writeSidebarPreference,
} from './sidebar-storage'

/**
 * The sidebar's state, which is THREE states across TWO boundaries and
 * not two states across one.
 *
 * Section 9's table:
 *
 *   1280 and above   sidebar open          (260px)
 *   1024 to 1279     sidebar icon rail     (64px)
 *   below 1024       sidebar hidden
 *
 * The second boundary is section 9 rule 7, and it changes what the
 * toggle DOES rather than only what the sidebar looks like: at 1024 and
 * above the sidebar is a column in the layout and toggling it pushes the
 * content sideways; below 1024 it is not in the layout at all and the
 * same button opens it as an overlay over the content. Same button, two
 * behaviours. `mode` is which one is live.
 *
 * Section 12.1 adds a saved preference on top of the width default. The
 * two compose as: the width decides what happens until the user says
 * otherwise, and then the user's choice holds at every width at or above
 * 1024.
 *
 * Toggling below 1024 opens and closes the overlay and deliberately does
 * NOT write the preference. A visit on a tablet would otherwise silently
 * rewrite the choice the user made at their desk, where the setting is
 * the only one that has any meaning.
 */

export type SidebarSize = 'desktop' | 'laptop' | 'tablet'
export type SidebarMode = 'push' | 'overlay'

const DESKTOP_QUERY = '(min-width: 1280px)'
const LAPTOP_QUERY = '(min-width: 1024px)'

type Snapshot = {
  size: SidebarSize
  /** The section 12.1 preference. `null` = never chosen. */
  preference: boolean | null
  /** Section 9 rule 7's overlay. Meaningful only below 1024. */
  overlayOpen: boolean
}

/*
 * What the server renders. It cannot measure a viewport, so it renders
 * the widest case and `useSyncExternalStore` swaps in the measured
 * snapshot during hydration, before paint. Guessing here rather than
 * rendering nothing is what keeps the sidebar out of the first-paint
 * flicker on the common case.
 */
const SERVER_SNAPSHOT: Snapshot = {
  size: 'desktop',
  preference: null,
  overlayOpen: false,
}

function measure(): SidebarSize {
  if (window.matchMedia(DESKTOP_QUERY).matches) return 'desktop'
  if (window.matchMedia(LAPTOP_QUERY).matches) return 'laptop'
  return 'tablet'
}

/*
 * One store for the whole shell rather than state per component. The
 * top bar's toggle and the sidebar itself are in different subtrees, and
 * a context would put a provider above both for a value that is a single
 * object.
 */
let snapshot: Snapshot =
  typeof window === 'undefined'
    ? SERVER_SNAPSHOT
    : {
        size: measure(),
        preference: readSidebarPreference(),
        overlayOpen: false,
      }

const listeners = new Set<() => void>()
let queries: MediaQueryList[] = []

function publish(next: Snapshot) {
  snapshot = next
  listeners.forEach(listener => listener())
}

function handleWidthChange() {
  const size = measure()
  if (size === snapshot.size) return
  /*
   * Crossing back above 1024 leaves the overlay mounted with the button
   * that opened it now meaning something else, so the two behaviours
   * hand over cleanly instead of both being on screen at once.
   */
  publish({ ...snapshot, size, overlayOpen: false })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    queries = [
      window.matchMedia(DESKTOP_QUERY),
      window.matchMedia(LAPTOP_QUERY),
    ]
    queries.forEach(query =>
      query.addEventListener('change', handleWidthChange)
    )
    /* The window can have been resized between module evaluation and
       the first subscription. */
    handleWidthChange()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      queries.forEach(query =>
        query.removeEventListener('change', handleWidthChange)
      )
      queries = []
    }
  }
}

function getSnapshot() {
  return snapshot
}

function getServerSnapshot() {
  return SERVER_SNAPSHOT
}

export type Sidebar = {
  /** `push` at 1024 and above, `overlay` below it. Section 9 rule 7. */
  mode: SidebarMode
  /** Full 260px panel when true, 64px icon rail when false. */
  expanded: boolean
  /** Whether the overlay is on screen. Always false in `push` mode. */
  overlayOpen: boolean
  /** The action, for the tooltip and the screen reader. Section 23.2. */
  toggleLabel: string
  toggle: () => void
  close: () => void
}

export function useSidebar(): Sidebar {
  const { size, preference, overlayOpen } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  )

  const mode: SidebarMode = size === 'tablet' ? 'overlay' : 'push'
  const expanded = preference ?? size === 'desktop'

  /*
   * These read `snapshot` rather than the destructured values so the
   * callbacks never go stale, which is what lets them keep a stable
   * identity for the life of the shell.
   */
  const toggle = useCallback(() => {
    if (snapshot.size === 'tablet') {
      publish({ ...snapshot, overlayOpen: !snapshot.overlayOpen })
      return
    }
    const next = !(snapshot.preference ?? snapshot.size === 'desktop')
    writeSidebarPreference(next)
    publish({ ...snapshot, preference: next })
  }, [])

  const close = useCallback(() => {
    if (!snapshot.overlayOpen) return
    publish({ ...snapshot, overlayOpen: false })
  }, [])

  /*
   * Section 23.2: one icon in every state, and the label is what carries
   * the action. An icon that swaps as well as its label reads as two
   * different buttons.
   */
  const toggleLabel =
    mode === 'overlay'
      ? 'Open navigation'
      : expanded
        ? 'Collapse sidebar'
        : 'Expand sidebar'

  return { mode, expanded, overlayOpen, toggleLabel, toggle, close }
}
