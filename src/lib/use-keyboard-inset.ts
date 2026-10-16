'use client'

import * as React from 'react'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.4 rule 19 / §41.7 rule 4:
 * the on-screen keyboard must never cover the thing the user is typing
 * into, or sit uselessly under a tab bar that no longer reaches anywhere.
 *
 * There is no reliable "keyboard opened" event; `visualViewport` is the
 * only stable signal across iOS Safari and Android Chrome — the keyboard
 * shrinks it without shrinking `window.innerHeight`. A gap bigger than
 * 120px between the layout viewport and the visual viewport is treated
 * as "keyboard open" (small gaps come from browser chrome, not a keyboard).
 */
const KEYBOARD_THRESHOLD_PX = 120

/** True while the on-screen keyboard is covering part of the viewport. */
export function useKeyboardInset(): boolean {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    function update() {
      const gap = window.innerHeight - vv!.height
      setOpen(gap > KEYBOARD_THRESHOLD_PX)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return open
}

/**
 * The live inset height (px) to pad a fixed bottom bar by, so it sits
 * just above the keyboard instead of under it. 0 when the keyboard is
 * closed.
 */
export function useKeyboardInsetHeight(): number {
  const [inset, setInset] = React.useState(0)

  React.useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    function update() {
      const gap = window.innerHeight - vv!.height
      setInset(gap > KEYBOARD_THRESHOLD_PX ? gap : 0)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
