'use client'

import { useEffect, useRef, useState } from 'react'
import { PlayIcon, SquareIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatDuration } from './types'

/**
 * P3-T7, §5.4 — ONE button per meeting. It reads **Start**, and after it
 * is pressed the same button reads **Stop**.
 *
 * WHY THIS IS A COMPONENT AND NOT TWO `&&` BRANCHES
 *
 * The screen used to render Start inside `status === 'Pending' && …` and
 * Stop inside `status === 'Active' && …`. Those are two different
 * positions in the JSX, so React unmounts one element and mounts the
 * other: a different DOM node, no CSS transition between the two colours
 * (a transition needs one node whose properties change), the focus ring
 * dropped on the floor for a keyboard user mid-press, and a visible snap
 * from a filled primary button to a filled danger button.
 *
 * Here there is exactly ONE <Button>, rendered unconditionally, whose
 * label, icon, variant and handler change. Same node, same key, same
 * position in the tree, so `transition-colors` (the kit's base class)
 * actually animates and focus survives the change. §5.4's "turns into
 * Stop" is literal: the control does not get replaced, it changes.
 *
 * There is never a disabled twin, and never both at once.
 *
 * LOCATION
 *
 * Neither press does anything about location itself — the caller
 * captures the fix and decides what to do about a refusal (an in-app
 * dialog offering a retry; see the page). On a geolocation TIMEOUT the
 * caller proceeds with nulls, which is why nothing here assumes a
 * meeting has coordinates.
 *
 * `busy` is per-meeting and owned here, so pressing Start on one card
 * does not grey out the button on another.
 */
export function MeetingToggle({
  status,
  startTime,
  durationSecs,
  onStart,
  onStop,
  size = 'sm',
  startLabel = 'Start',
  busy: busyProp = false,
}: {
  status: 'Pending' | 'Active' | 'Completed'
  startTime?: string | null
  durationSecs?: number | null
  onStart: () => void | Promise<void>
  onStop: () => void | Promise<void>
  size?: 'sm' | 'default'
  /** The planned card says "Start meeting"; the visit card says "Start". */
  startLabel?: string
  /** For a caller that tracks the press itself (the planned card's create-
   *  then-start). ORed with this component's own pending state. */
  busy?: boolean
}) {
  const [pressing, setPressing] = useState(false)
  const busy = pressing || busyProp
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // The running clock next to the button. It ticks only while Active;
  // once stopped it shows the stored duration, so the number does not
  // jump when the row comes back from the server.
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (status === 'Active' && startTime) {
      const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000)))
      tick()
      timerRef.current = setInterval(tick, 1000)
    } else {
      setElapsed(durationSecs ?? 0)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [status, startTime, durationSecs])

  // A finished meeting has no toggle left to offer.
  if (status === 'Completed') return null

  const active = status === 'Active'

  async function press() {
    if (busy) return
    setPressing(true)
    try {
      await (active ? onStop() : onStart())
    } finally {
      // The card is re-rendered from the server list after a stop; if this
      // instance is gone, do not set state on it.
      if (mounted.current) setPressing(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        size={size}
        variant={active ? 'danger' : 'primary'}
        onClick={press}
        disabled={busy}
        aria-live="polite"
        /* 44px touch target on a phone; the kit's own 32px height on a
           pointer device, where the row would otherwise be half again as
           tall as it needs to be. `duration-200` is the §5.4 transition:
           it only means anything because this is ONE node whose variant
           changes, rather than two elements swapping places. */
        className="min-h-11 duration-200 sm:min-h-0"
      >
        {active ? <SquareIcon /> : <PlayIcon />}
        {busy ? (active ? 'Stopping…' : 'Starting…') : active ? 'Stop' : startLabel}
      </Button>
      {active && <span className="text-meta tabular-nums text-warning">{formatDuration(elapsed)}</span>}
    </div>
  )
}
