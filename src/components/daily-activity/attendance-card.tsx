'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClockIcon, LogInIcon, LogOutIcon, MapPinIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AttendanceRecord,
  formatTime,
  getPosition,
  reverseGeocode,
  toDateStr,
} from './types'

/**
 * §5.3 rule 3 — "Check-in marks Present; update its look so the meaning
 * is clear. Check-out closes the day."
 *
 * What the old card looked like, and why that was the bug: before
 * check-in it painted the row on `bg-success-bg` with a GREEN dot and
 * read "Not checked in yet". Green is this product's Present colour, so
 * the strongest signal on the card said the opposite of the sentence
 * beside it. After check-in it turned amber — the warning colour — for
 * the state that is actually fine.
 *
 * Now the colour tracks the meaning: neutral before check-in (nothing
 * asserted), success while present, sunken once the day is closed. The
 * card leads with the word Present rather than with a verb, because
 * Present is the record; Check in is only how it gets written.
 *
 * §5.3 rule 4 — the card says in as many words that closing the day
 * locks nothing. Check-in/out is attendance and working hours, and the
 * screen behind it stays fully editable.
 */
export function AttendanceCard({
  selectedDate,
  canMark,
  onChanged,
}: {
  selectedDate: string
  /** Real permission, resolved by the caller from role_permissions. */
  canMark: boolean
  onChanged?: () => void
}) {
  const { toast } = useToast()
  const [record, setRecord] = useState<AttendanceRecord | null | undefined>(undefined)
  const [acting, setActing] = useState<'in' | 'out' | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const isToday = selectedDate === toDateStr(new Date())

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/attendance?date=${selectedDate}`)
      setRecord(r.ok ? await r.json() : null)
    } catch {
      setRecord(null)
    }
  }, [selectedDate])

  useEffect(() => { void load() }, [load])

  const checkedIn = !!record?.check_in_time
  const checkedOut = !!record?.check_out_time

  // A live "worked so far" needs a clock; it is pointless once the day is
  // closed, so the interval only exists while the day is running.
  useEffect(() => {
    if (!checkedIn || checkedOut) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [checkedIn, checkedOut])

  async function mark(kind: 'in' | 'out') {
    setActing(kind)
    const pos = await getPosition()
    const body: Record<string, unknown> = {}
    if (pos && !('denied' in pos)) {
      body.latitude = pos.latitude
      body.longitude = pos.longitude
      body.address = await reverseGeocode(pos.latitude, pos.longitude)
    }
    const res = await fetch(`/api/attendance/check-${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      toast(data.error ?? `Check-${kind} failed`, 'error')
    } else {
      // Updated in place — same node, no remount, no flicker.
      setRecord(data)
      toast(kind === 'in' ? 'Marked present' : 'Working day closed', 'success')
      onChanged?.()
    }
    setActing(null)
  }

  if (record === undefined) {
    return <div className="h-[72px] animate-pulse rounded-xl border border-border-light bg-surface-sunken" />
  }

  const workedMs = checkedIn
    ? (checkedOut ? new Date(record!.check_out_time!).getTime() : now) - new Date(record!.check_in_time!).getTime()
    : 0
  const workedLabel = `${Math.floor(workedMs / 3_600_000)}h ${Math.floor((workedMs % 3_600_000) / 60_000)}m`

  const coords = (lat: number | null, lng: number | null) =>
    lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : null
  const inCoords = coords(record?.check_in_latitude ?? null, record?.check_in_longitude ?? null)

  return (
    <div
      className={[
        'flex flex-col gap-3 rounded-xl border px-4 py-3 transition-colors duration-200 sm:flex-row sm:items-center sm:gap-4',
        checkedOut
          ? 'border-border-light bg-surface-sunken'
          : checkedIn
            ? 'border-success-border bg-success-bg'
            : 'border-border bg-surface',
      ].join(' ')}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* The identifier leads: what the day IS, not what to press. */}
          <span className="text-card-heading font-medium text-text-primary">
            {checkedIn ? 'Present' : isToday ? 'Not marked present' : 'Absent'}
          </span>
          {checkedOut && <Badge variant="neutral">Day closed</Badge>}
          {checkedIn && !checkedOut && <Badge variant="success">Working</Badge>}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-text-secondary">
          {!checkedIn && (
            <span>
              {isToday
                ? 'Check in to mark yourself present and start counting working hours.'
                : 'No attendance was recorded on this day.'}
            </span>
          )}
          {checkedIn && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <LogInIcon className="size-3.5 text-text-muted" />
                In {formatTime(record!.check_in_time!)}
              </span>
              {checkedOut && (
                <span className="inline-flex items-center gap-1.5">
                  <LogOutIcon className="size-3.5 text-text-muted" />
                  Out {formatTime(record!.check_out_time!)}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <ClockIcon className="size-3.5 text-text-muted" />
                {workedLabel} {checkedOut ? 'worked' : 'so far'}
              </span>
              {inCoords && (
                <span className="inline-flex items-center gap-1.5 text-text-muted">
                  <MapPinIcon className="size-3.5" />
                  {inCoords}
                </span>
              )}
            </>
          )}
        </div>

        {checkedOut && (
          /* §5.3 rule 4, said out loud on the screen it governs. */
          <p className="mt-1 text-meta text-text-secondary">
            Working hours are closed. Meetings, orders and expenses can still be added for this day.
          </p>
        )}
      </div>

      {/* The action sits beside the state it changes, and only exists when
          it can succeed: the check-in/out routes write TODAY's row, so a
          past day has nothing to press, and a user without edit rights is
          not shown a button that would fail. */}
      {isToday && canMark && !checkedIn && (
        <Button onClick={() => void mark('in')} disabled={acting !== null} className="w-full sm:w-auto">
          <LogInIcon />
          {acting === 'in' ? 'Locating…' : 'Check in'}
        </Button>
      )}
      {isToday && canMark && checkedIn && !checkedOut && (
        <Button variant="secondary" onClick={() => void mark('out')} disabled={acting !== null} className="w-full sm:w-auto">
          <LogOutIcon />
          {acting === 'out' ? 'Locating…' : 'Check out'}
        </Button>
      )}
    </div>
  )
}
