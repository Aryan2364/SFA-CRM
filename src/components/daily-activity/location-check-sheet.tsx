'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MapPinIcon } from 'lucide-react'

import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { isApproximateLocation } from '@/lib/accuracy-label'
import { reverseGeocode } from './types'

/**
 * Location check-in on phone — FRONTEND_RULES_PHONE.md §41.16 rules 1-3 and
 * 9-11, built once and used by every phone tap that records where the person
 * is: attendance check-in/check-out, and a meeting's Start and Stop.
 *
 *  - The phone is asked only when this sheet opens, which only a tap does
 *    (rule 1). Nothing is read before that or after the sheet closes (rule 11);
 *    while it is open the reading keeps refining for a short window, and a
 *    network fix requested late can still land (see `giveUp`).
 *  - Before anything is saved the person sees the address found, and how
 *    accurate the reading was, with a warning past 100 metres (rule 10).
 *  - A refusal says how to allow it and offers the reading again (rule 3).
 *
 * The caller saves; this sheet only reads and confirms. `onConfirm` gets the
 * reading (null when there is none) and resolves true when the save worked,
 * which closes the sheet. A failed save keeps it open with its reading, so
 * the press can be repeated without asking the phone again.
 *
 * `requireLocation`: attendance refuses to save without a place; a meeting
 * proceeds with no place when the phone cannot find one (desktop's own rule,
 * see `getPosition`), but never past an explicit refusal.
 */

export type LocationReading = {
  latitude: number
  longitude: number
  /** Metres, as the phone reports it. */
  accuracy: number
  address: string | null
}

type ReadState =
  | { kind: 'reading' }
  | { kind: 'found'; reading: LocationReading }
  | { kind: 'denied' }
  | { kind: 'off' }
  | { kind: 'timeout' }
  /** No geolocation at all: an old browser, or a plain-http test address. */
  | { kind: 'unsupported' }

const ACCURATE_ENOUGH_M = 100
/** Even when a place is required, this many failed reads let the person go on without one. */
const FAILED_READS_TO_SKIP = 2
/** Keep refining a fix for this long after the sheet opens, then settle. */
const REFINE_WINDOW_MS = 20000
/** No fix by now: also ask for a network/Wi-Fi/cell location. */
const FALLBACK_AFTER_MS = 6000
/** The oldest network fix accepted: two minutes is still the same place. */
const FALLBACK_MAX_AGE_MS = 120000
/** Nothing at all by now: show the timeout state. */
const GIVE_UP_MS = 25000
/** Re-look-up the address only when the reading moves this far. */
const REGEOCODE_MOVE_M = 50

/** Great-circle distance in metres (haversine). */
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Which platform's steps to show for Precise location; both when unknown. */
function preciseSteps(): { android: boolean; ios: boolean } {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const ios = /iPhone|iPad|iPod/i.test(ua)
  const android = /Android/i.test(ua)
  return ios || android ? { android, ios } : { android: true, ios: true }
}

export function LocationCheckSheet({
  open,
  onOpenChange,
  title,
  confirmLabel,
  busyLabel,
  requireLocation,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "Start meeting here?", "Check in here?" */
  title: string
  /** "Start meeting", "Check in" — the verb the person tapped. */
  confirmLabel: string
  /** "Starting…" */
  busyLabel: string
  requireLocation: boolean
  onConfirm: (reading: LocationReading | null) => Promise<boolean>
}) {
  const [state, setState] = useState<ReadState>({ kind: 'reading' })
  // The address arrives after the fix and never gates it (see `lookUpAddress`).
  const [address, setAddress] = useState<string | null>(null)
  const [addressPending, setAddressPending] = useState(false)
  const [saving, setSaving] = useState(false)
  // Full reads that ended with no fix (timeout or off). Counts across "Read again",
  // resets when the sheet closes.
  const [failedReads, setFailedReads] = useState(0)
  // A reading still in flight when the sheet closes, or replaced by "Read
  // again", must not land on the next one.
  const attempt = useRef(0)
  const watchId = useRef<number | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  // The spot the current address was asked for.
  const geocoded = useRef<{ latitude: number; longitude: number } | null>(null)

  const stop = useCallback(() => {
    if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current)
    watchId.current = null
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  const lookUpAddress = useCallback((mine: number, latitude: number, longitude: number) => {
    const last = geocoded.current
    // Only a materially different spot is worth another (slow, rate-limited)
    // lookup; a watch tick a few metres away keeps the address it has.
    if (last && distanceM(last.latitude, last.longitude, latitude, longitude) <= REGEOCODE_MOVE_M) return
    geocoded.current = { latitude, longitude }
    setAddress(null)
    setAddressPending(true)
    void reverseGeocode(latitude, longitude).then(a => {
      if (attempt.current !== mine || geocoded.current?.latitude !== latitude || geocoded.current?.longitude !== longitude) return
      setAddress(a)
      setAddressPending(false)
    })
  }, [])

  const read = useCallback(() => {
    stop()
    const mine = ++attempt.current
    setState({ kind: 'reading' })
    setAddress(null)
    setAddressPending(false)
    geocoded.current = null
    if (!window.isSecureContext || !navigator.geolocation) {
      setState({ kind: 'unsupported' })
      return
    }
    const geo = navigator.geolocation
    let best: number | null = null // accuracy of the reading on screen
    let fallbackFired = false
    let fallbackFailed = false
    let lastErr: number | null = null
    // Give-up runs once per attempt, however many late errors arrive: it counts
    // ONE failed read and shows one failure state.
    let gaveUp = false

    const accept = (pos: GeolocationPosition) => {
      if (attempt.current !== mine) return
      const { latitude, longitude, accuracy } = pos.coords
      // Accept the first fix at once; after that only a better one replaces it.
      if (best != null && accuracy >= best) return
      best = accuracy
      setState({ kind: 'found', reading: { latitude, longitude, accuracy, address: null } })
      lookUpAddress(mine, latitude, longitude)
      if (accuracy <= ACCURATE_ENOUGH_M) stop()
    }
    const fail = (err: GeolocationPositionError): boolean => {
      if (attempt.current !== mine) return true
      if (err.code === err.PERMISSION_DENIED) {
        stop()
        setState({ kind: 'denied' })
        return true
      }
      lastErr = err.code
      return false
    }
    // A fix that arrives AFTER give-up (the network fallback cannot be cancelled)
    // is accepted: `accept` switches the sheet to "found", because a place is good
    // news and the person is still looking at the sheet. The failed read it
    // already counted stays counted (it was a real failure at the time), and the
    // `gaveUp` guard keeps a later fallback error from counting a second one.
    const giveUp = () => {
      if (attempt.current !== mine || best != null || gaveUp) return
      gaveUp = true
      stop()
      setFailedReads(n => n + 1)
      setState({ kind: lastErr === 2 ? 'off' : 'timeout' })
    }
    const fireFallback = () => {
      if (fallbackFired || attempt.current !== mine) return
      fallbackFired = true
      // Network/Wi-Fi/cell location for when GPS is slow: a fix up to two
      // minutes old is the same place in practice, not "the last stop"
      // (rule 9 is about not reusing the previous visit's reading).
      geo.getCurrentPosition(
        accept,
        err => {
          if (fail(err)) return
          fallbackFailed = true
          if (lastErr === 2 && best == null) giveUp()
        },
        { enableHighAccuracy: false, maximumAge: FALLBACK_MAX_AGE_MS, timeout: GIVE_UP_MS }
      )
    }

    watchId.current = geo.watchPosition(
      accept,
      err => {
        if (fail(err)) return
        if (err.code === err.POSITION_UNAVAILABLE) {
          fireFallback()
          if (fallbackFailed && best == null) giveUp()
        }
      },
      // maximumAge 0: the place at the moment of the tap (rule 9) — and "Read
      // again" really reads again.
      { enableHighAccuracy: true, maximumAge: 0 }
    )
    timers.current = [
      setTimeout(fireFallback, FALLBACK_AFTER_MS),
      // Once a fix is on screen, stop refining at the window's end; with none
      // yet, keep waiting for the give-up timer.
      setTimeout(() => { if (best != null) stop() }, REFINE_WINDOW_MS),
      setTimeout(() => { giveUp(); stop() }, GIVE_UP_MS),
    ]
  }, [stop, lookUpAddress])

  useEffect(() => {
    if (open) read()
    else { attempt.current++; stop(); setFailedReads(0) }
  }, [open, read, stop])

  useEffect(() => stop, [stop])

  const reading = state.kind === 'found' ? { ...state.reading, address } : null
  const noFix = state.kind === 'off' || state.kind === 'timeout'
  // A required place never leaves someone stuck: after repeated failed reads
  // they may continue without one (a refusal in settings, `denied`, still blocks).
  const canSkipPlace = noFix && (!requireLocation || failedReads >= FAILED_READS_TO_SKIP)
  const canConfirm = state.kind === 'found' || state.kind === 'unsupported' || canSkipPlace

  const skipText = !canSkipPlace
    ? null
    : requireLocation
      ? ` Or ${confirmLabel.toLowerCase()} without a place. Your manager will see this was recorded with no location.`
      : ` Or ${confirmLabel.toLowerCase()} without a place.`

  async function confirm() {
    if (!canConfirm || saving) return
    stop()
    setSaving(true)
    try {
      if (await onConfirm(reading)) onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={o => { if (!saving) onOpenChange(o) }}
      title={title}
      footer={
        <>
          <Button variant="secondary" disabled={state.kind === 'reading' || saving} onClick={read}>
            Read again
          </Button>
          <Button disabled={!canConfirm || saving} onClick={() => void confirm()}>
            {saving ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.kind === 'reading' ? (
          <>
            <p className="text-body text-text-secondary">Finding where you are…</p>
            <Skeleton className="h-5 w-3/4" />
          </>
        ) : state.kind === 'found' ? (
          <>
            <div className="flex items-start gap-2">
              <MapPinIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-text-secondary" />
              <p className="text-body text-text-primary">
                {address ??
                  (addressPending
                    ? 'Finding the address…'
                    : 'No address found for this spot. The place is still recorded.')}
              </p>
            </div>
            {isApproximateLocation(state.reading.accuracy) ? (
              <div className="flex flex-col gap-1">
                <p className="text-body text-warning">
                  Your phone is sharing approximate location only. Turn on Precise location.
                </p>
                {preciseSteps().android ? (
                  <p className="text-body text-text-secondary">
                    Android (Chrome): Settings &gt; Apps &gt; Chrome &gt; Permissions &gt; Location &gt; turn on
                    &quot;Use precise location&quot;.
                  </p>
                ) : null}
                {preciseSteps().ios ? (
                  <p className="text-body text-text-secondary">
                    iPhone (Safari): Settings &gt; Privacy &amp; Security &gt; Location Services &gt; Safari Websites
                    &gt; turn on &quot;Precise Location&quot;.
                  </p>
                ) : null}
                <p className="text-label text-text-secondary">Then tap Read again.</p>
              </div>
            ) : state.reading.accuracy > ACCURATE_ENOUGH_M ? (
              <p className="text-body text-warning">
                Accurate only to about {Math.round(state.reading.accuracy)} m. Move to an open spot and read again for a
                better reading.
              </p>
            ) : (
              <p className="text-label text-text-secondary">Accurate to about {Math.round(state.reading.accuracy)} m.</p>
            )}
          </>
        ) : state.kind === 'denied' ? (
          <>
            <p className="text-body text-text-primary">Location is blocked for this app.</p>
            <p className="text-body text-text-secondary">
              In the browser, tap the icon beside the address, open Permissions and set Location to Allow. Then tap Read
              again.
            </p>
          </>
        ) : state.kind === 'off' ? (
          <>
            <p className="text-body text-text-primary">Your phone&apos;s location is turned off.</p>
            <p className="text-body text-text-secondary">
              Turn on Location, then tap Read again.
              {skipText}
            </p>
          </>
        ) : state.kind === 'timeout' ? (
          <>
            <p className="text-body text-text-primary">Your location could not be found in time.</p>
            <p className="text-body text-text-secondary">
              Move to an open spot and tap Read again.
              {skipText}
            </p>
          </>
        ) : (
          <p className="text-body text-text-secondary">
            This browser cannot give a location, so this is saved without a place.
          </p>
        )}
      </div>
    </BottomSheet>
  )
}
