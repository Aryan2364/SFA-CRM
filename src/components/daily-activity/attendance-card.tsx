'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ClockIcon, LogInIcon, LogOutIcon, MapPinIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  ATTENDANCE_LABEL,
  ATTENDANCE_SENTENCE,
  AttendanceRecord,
  attendanceState,
  formatTime,
  formatWorked,
  getPosition,
  reverseGeocode,
  toDateStr,
} from './types'

/**
 * Attendance, as a COMPACT CONTROL rather than a block.
 *
 * F4 — the old card was a full-width panel pinned above the tabs
 * carrying Present / Day closed / In / Out / worked / coordinates / the
 * can-still-add sentence, roughly 84px of fixed chrome including its
 * gap, on a screen whose only scrolling region is the list underneath.
 * Everything it said is still here; it is now a chip that states the
 * day's reading and opens the detail on demand, sitting on the header
 * row beside the day's actions.
 *
 * F5 — check-in/check-out moved here too, into the space freed by
 * merging the two meeting buttons into one.
 *
 * ⚠️ The sentence "Meetings, orders and expenses can still be added for
 * this day" survives, in the panel. §12 closed the decision that
 * check-out locks NOTHING, and users assume the opposite, so the screen
 * has to keep saying it.
 *
 * F3 — "Absent" is a claim about the past. The reading comes from
 * `attendanceState()` in `types.ts`, shared by the chip and the panel so
 * the two can never disagree, and a future date reads "Not yet".
 *
 * F2 — the panel leads with a place name, resolved through
 * `/api/daily-activity/reverse-geocode`, and falls back to the raw
 * coordinates when the lookup returns null. The coordinates are always
 * reachable: they are the evidence.
 *
 * F1 — see `clockBase` below.
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
  const [open, setOpen] = useState(false)

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
  const checkInTime = record?.check_in_time ?? null

  /**
   * F1, THE BUG AND THE FIX.
   *
   * `now` was seeded once with `useState(() => Date.now())` at MOUNT and
   * refreshed only by an interval that did not start until `checkedIn`
   * turned true — and that interval's first tick is 30 seconds later.
   * So the render immediately after a successful check-in still held the
   * mount-time clock and computed `mountTime − checkInTime`: negative by
   * exactly however long the tab had been open. Aryan's tab had been
   * open 1h1m, the old formatter printed the negative components
   * literally, and it read `-1h -1m` until the interval caught up 30s
   * later and it appeared to "self-correct".
   *
   * It is not the IST/UTC skew — that would be a constant 5h30m, and it
   * would never correct itself.
   *
   * Two fixes, both needed. Here, the clock is resynchronised the moment
   * the check-in timestamp changes, so the first render after check-in
   * measures against a fresh `Date.now()`. In `formatWorked()`, a
   * negative can no longer be printed at all, whatever the cause — a
   * clock that disagrees with itself reads `0h 0m`.
   */
  useEffect(() => {
    if (!checkInTime) return
    setNow(Date.now())
  }, [checkInTime])

  // A live "worked so far" needs a clock; it is pointless once the day is
  // closed, so the interval only exists while the day is running.
  useEffect(() => {
    if (!checkedIn || checkedOut) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [checkedIn, checkedOut])

  /*
   * F2 — the place, not the numbers.
   *
   * `check_in_address` is written at check-in time by `mark()` below, so
   * a row created by this screen already carries it. Rows created before
   * P3-T7, and every seeded row, carry coordinates and a null address —
   * which is the case Aryan hit. Those are resolved here, on demand,
   * through the same cached, rate-limited server route. A null answer is
   * kept as null and the coordinates are shown instead: never a blank,
   * never a guess.
   */
  const [resolved, setResolved] = useState<Record<string, string | null>>({})
  const asked = useRef<Set<string>>(new Set())

  const place = useCallback(
    async (lat: number | null, lng: number | null) => {
      if (lat == null || lng == null) return
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
      if (asked.current.has(key)) return
      asked.current.add(key)
      const address = await reverseGeocode(lat, lng)
      setResolved(prev => ({ ...prev, [key]: address }))
    },
    []
  )

  useEffect(() => {
    if (!open || !record) return
    if (!record.check_in_address) void place(record.check_in_latitude, record.check_in_longitude)
    if (!record.check_out_address) void place(record.check_out_latitude, record.check_out_longitude)
  }, [open, record, place])

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
      // Updated in place — same node, no remount, no flicker. The clock
      // effect above re-runs off the new check_in_time (F1).
      setNow(Date.now())
      setRecord(data)
      toast(kind === 'in' ? 'Marked present' : 'Working day closed', 'success')
      onChanged?.()
    }
    setActing(null)
  }

  if (record === undefined) {
    return <div className="h-control w-40 animate-pulse rounded-lg border border-border-light bg-surface-sunken" />
  }

  const state = attendanceState(selectedDate, record)

  const workedMs = checkedIn
    ? (checkedOut ? new Date(record!.check_out_time!).getTime() : now) - new Date(record!.check_in_time!).getTime()
    : 0
  const workedLabel = formatWorked(workedMs)

  const coordText = (lat: number | null, lng: number | null) =>
    lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : null

  /** Place name if we have or can get one, else the coordinates, else nothing. */
  function locationLine(lat: number | null, lng: number | null, stored: string | null) {
    const coords = coordText(lat, lng)
    if (!coords) return null
    const key = `${lat!.toFixed(4)},${lng!.toFixed(4)}`
    const address = stored ?? resolved[key] ?? null
    return { address, coords }
  }

  const inLoc = locationLine(
    record?.check_in_latitude ?? null,
    record?.check_in_longitude ?? null,
    record?.check_in_address ?? null
  )
  const outLoc = locationLine(
    record?.check_out_latitude ?? null,
    record?.check_out_longitude ?? null,
    record?.check_out_address ?? null
  )

  const dot =
    state === 'present'
      ? checkedOut ? 'bg-text-muted' : 'bg-success'
      : state === 'absent'
        ? 'bg-danger'
        : 'bg-border-strong'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The chip states the day's reading and nothing else; the detail
          is one press away rather than 84px of permanent chrome. */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="secondary"
              size="sm"
              aria-label="Attendance detail"
              className="min-h-11 gap-2 sm:min-h-0"
            />
          }
        >
          <span className={`size-2 shrink-0 rounded-full transition-colors duration-200 ${dot}`} />
          <span className="font-medium">{ATTENDANCE_LABEL[state]}</span>
          {checkedIn && (
            <span className="tabular-nums text-text-secondary">
              · {workedLabel}
            </span>
          )}
        </PopoverTrigger>

        <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-card-heading font-medium text-text-primary">
              {ATTENDANCE_LABEL[state]}
            </span>
            {checkedOut && <Badge variant="neutral">Day closed</Badge>}
            {checkedIn && !checkedOut && <Badge variant="success">Working</Badge>}
          </div>

          {!checkedIn && (
            <p className="mt-2 text-body text-text-secondary">{ATTENDANCE_SENTENCE[state]}</p>
          )}

          {checkedIn && (
            <div className="mt-3 space-y-2 text-body text-text-secondary">
              <div className="flex items-center gap-2">
                <LogInIcon className="size-3.5 shrink-0 text-text-muted" />
                <span>In {formatTime(record!.check_in_time!)}</span>
              </div>
              {inLoc && (
                <div className="flex items-start gap-2 pl-[1.375rem]">
                  <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
                  <span className="min-w-0">
                    {/* Lead with the place; keep the numbers as the evidence. */}
                    {inLoc.address ? (
                      <>
                        <span className="text-text-primary">{inLoc.address}</span>
                        <span className="block text-meta tabular-nums text-text-muted">{inLoc.coords}</span>
                      </>
                    ) : (
                      <span className="tabular-nums">{inLoc.coords}</span>
                    )}
                  </span>
                </div>
              )}

              {checkedOut && (
                <>
                  <div className="flex items-center gap-2">
                    <LogOutIcon className="size-3.5 shrink-0 text-text-muted" />
                    <span>Out {formatTime(record!.check_out_time!)}</span>
                  </div>
                  {outLoc && (
                    <div className="flex items-start gap-2 pl-[1.375rem]">
                      <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
                      <span className="min-w-0">
                        {outLoc.address ? (
                          <>
                            <span className="text-text-primary">{outLoc.address}</span>
                            <span className="block text-meta tabular-nums text-text-muted">{outLoc.coords}</span>
                          </>
                        ) : (
                          <span className="tabular-nums">{outLoc.coords}</span>
                        )}
                      </span>
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center gap-2 tabular-nums">
                <ClockIcon className="size-3.5 shrink-0 text-text-muted" />
                <span>{workedLabel} {checkedOut ? 'worked' : 'so far'}</span>
              </div>
            </div>
          )}

          {checkedOut && (
            /* §5.3 rule 4 / §12 — check-out locks nothing, said out loud
               on the screen it governs. Load-bearing: users assume the
               opposite. */
            <p className="mt-3 border-t border-border-light pt-3 text-meta text-text-secondary">
              Working hours are closed. Meetings, orders and expenses can still be added for this day.
            </p>
          )}
        </PopoverContent>
      </Popover>

      {/* F5 — check-in/check-out now live on the header row, in the space
          the merged meeting button freed. Shown only when they can
          succeed: the routes write TODAY's row, so a past or future day
          has nothing to press, and a user without edit rights is never
          offered a button that would fail. */}
      {isToday && canMark && !checkedIn && (
        <Button size="sm" onClick={() => void mark('in')} disabled={acting !== null} className="min-h-11 sm:min-h-0">
          <LogInIcon />
          {acting === 'in' ? 'Locating…' : 'Check in'}
        </Button>
      )}
      {isToday && canMark && checkedIn && !checkedOut && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void mark('out')}
          disabled={acting !== null}
          className="min-h-11 sm:min-h-0"
        >
          <LogOutIcon />
          {acting === 'out' ? 'Locating…' : 'Check out'}
        </Button>
      )}
    </div>
  )
}
