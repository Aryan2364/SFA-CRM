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
 *    (rule 1). Nothing is read in the background (rule 11).
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
  const [saving, setSaving] = useState(false)
  // A reading still in flight when the sheet closes, or replaced by "Read
  // again", must not land on the next one.
  const attempt = useRef(0)

  const read = useCallback(() => {
    const mine = ++attempt.current
    setState({ kind: 'reading' })
    if (!window.isSecureContext || !navigator.geolocation) {
      setState({ kind: 'unsupported' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude, longitude, accuracy } = pos.coords
        // The address is decoration; a geocoding miss still shows the reading.
        const address = await reverseGeocode(latitude, longitude)
        if (attempt.current === mine) setState({ kind: 'found', reading: { latitude, longitude, accuracy, address } })
      },
      err => {
        if (attempt.current !== mine) return
        setState({
          kind: err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.POSITION_UNAVAILABLE ? 'off' : 'timeout',
        })
      },
      // maximumAge 0: the place at the moment of the tap (rule 9), never a
      // cached fix from the last stop — and "Read again" really reads again.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }, [])

  useEffect(() => {
    if (open) read()
    else attempt.current++
  }, [open, read])

  const reading = state.kind === 'found' ? state.reading : null
  const canConfirm =
    state.kind === 'found' ||
    state.kind === 'unsupported' ||
    (!requireLocation && (state.kind === 'off' || state.kind === 'timeout'))

  async function confirm() {
    if (!canConfirm || saving) return
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
                {state.reading.address ?? 'No address found for this spot. The place is still recorded.'}
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
              {requireLocation ? null : ` Or ${confirmLabel.toLowerCase()} without a place.`}
            </p>
          </>
        ) : state.kind === 'timeout' ? (
          <>
            <p className="text-body text-text-primary">Your location could not be found in time.</p>
            <p className="text-body text-text-secondary">
              Move to an open spot and tap Read again.
              {requireLocation ? null : ` Or ${confirmLabel.toLowerCase()} without a place.`}
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
