'use client'

import { useEffect, useState } from 'react'

import { useToast } from '@/contexts/ToastContext'
import { useLayout } from '@/lib/layout'
import { Button } from '@/components/ui/button'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { TimePicker, type TimeValue } from '@/components/ui/time-picker'
import { formatHHMM, toDateStr } from './types'
import { requestNotificationOffer } from '@/components/shell/notification-offer-host'

type OpenDeal = { id: string; name: string }
type CurrentNextMeeting = {
  source: 'deal' | 'company'
  due_date: string
  due_time: string | null
  deal_id: string | null
  deal_name: string | null
}

/** "HH:MM" (24h) -> the TimePicker's 12-hour shape. */
function hhmmToTimeValue(hhmm: string | null): TimeValue | undefined {
  if (!hhmm) return undefined
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined
  return { hour: h % 12 === 0 ? 12 : h % 12, minute: m, meridiem: h >= 12 ? 'PM' : 'AM' }
}

/** The TimePicker's 12-hour shape -> "HH:MM" (24h), for the API and for comparing against "now". */
function timeValueToHHMM(value: TimeValue | undefined): string | null {
  if (!value) return null
  let hour24 = value.hour % 12
  if (value.meridiem === 'PM') hour24 += 12
  return `${String(hour24).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`
}

function businessNowHHMM(): string {
  // The browser's own local clock — the dialog lives on the rep's phone,
  // which runs IST like the server's business calendar.
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/**
 * "Set next meeting" — one dialog for both places it is opened from:
 *
 *   - `prompt` — right after Stop: the date is picked in the field below;
 *     nothing saves until "Save" is pressed. Skip closes with nothing saved.
 *   - `manage` — the "Set next meeting" button, always available later
 *     (meeting page, Completed card): shows what is currently set, if
 *     anything, with Change (the same form) and Remove.
 *
 * The date is always shown and editable with the kit `DatePicker`; the time
 * is optional (`TimePicker`, blank allowed). Past dates are refused, and a
 * time on today must still be ahead of now.
 *
 * All reading and writing goes through `GET`/`PUT`/`DELETE
 * /api/daily-activity/[visitId]/next-meeting` — see that route for how the
 * date and time are stored (an Opportunity's `deal_follow_ups` row, or
 * `companies.next_follow_up_date`/`next_follow_up_time` when none is
 * picked).
 *
 * On phone the same content and the same calls sit in a bottom sheet
 * (FRONTEND_RULES_PHONE §41.8 rule 10: a small dialog becomes a sheet), so
 * callers never choose between two components.
 */
export function NextMeetingDialog({
  visitId,
  mode,
  onClose,
  onSaved,
}: {
  visitId: string
  mode: 'prompt' | 'manage'
  onClose: () => void
  onSaved?: () => void
}) {
  const { toast } = useToast()
  const { layout } = useLayout()
  const phone = layout === 'phone'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [accountRequired, setAccountRequired] = useState(false)
  const [openDeals, setOpenDeals] = useState<OpenDeal[]>([])
  const [current, setCurrent] = useState<CurrentNextMeeting | null>(null)
  const [editing, setEditing] = useState(mode === 'prompt')
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [time, setTime] = useState<TimeValue | undefined>(undefined)
  const [dealId, setDealId] = useState<string>('')
  const [dateError, setDateError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetch(`/api/daily-activity/${visitId}/next-meeting`)
      if (cancelled) return
      if (!r.ok) { setLoading(false); return }
      const d = await r.json()
      setAccountRequired(!!d.account_required)
      setOpenDeals(Array.isArray(d.open_deals) ? d.open_deals : [])
      setCurrent(d.next_meeting ?? null)
      if (d.next_meeting) {
        setDate(new Date(`${d.next_meeting.due_date}T00:00:00`))
        setTime(hhmmToTimeValue(d.next_meeting.due_time))
        setDealId(d.next_meeting.deal_id ?? '')
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [visitId])

  function validate(d: Date | undefined, t: TimeValue | undefined): string | null {
    if (!d) return 'A date is required'
    const dateStr = toDateStr(d)
    const today = toDateStr(new Date())
    if (dateStr < today) return 'The next meeting must be today or later'
    if (dateStr === today) {
      const hhmm = timeValueToHHMM(t)
      if (hhmm && hhmm <= businessNowHHMM()) return 'That time has already passed today'
    }
    return null
  }

  async function save(dueDate: Date, dueTime: TimeValue | undefined, deal: string) {
    const err = validate(dueDate, dueTime)
    if (err) { setDateError(err); return }
    setDateError(null)
    setSaving(true)
    try {
      const r = await fetch(`/api/daily-activity/${visitId}/next-meeting`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: toDateStr(dueDate), due_time: timeValueToHHMM(dueTime), deal_id: deal || null }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast(data.error ?? 'Could not set the next meeting', 'error')
        return
      }
      toast(data.warning ?? 'Next meeting set', data.warning ? 'warning' : 'success')
      // §41.12 rule 4: a reminder will come back - offer phone notifications.
      requestNotificationOffer()
      onSaved?.()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setSaving(true)
    try {
      const r = await fetch(`/api/daily-activity/${visitId}/next-meeting`, { method: 'DELETE' })
      if (!r.ok) {
        toast((await r.json()).error ?? 'Could not remove the next meeting', 'error')
        return
      }
      toast('Next meeting removed', 'success')
      onSaved?.()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'prompt' ? 'Next meeting?' : 'Set next meeting'
  const description = mode === 'prompt' ? 'When should this account be met again?' : undefined

  const body = loading ? null : accountRequired ? (
    <p className="text-body text-text-secondary">
      This meeting has no account attached, so there is nothing to attach a next meeting
      to.
    </p>
  ) : (
    <>
      {!editing && current && (
        <div className="flex flex-col gap-1 rounded-lg border border-border-light bg-surface-secondary px-3 py-2">
          <p className="text-body text-text-primary">
            Next meeting: {fmtShort(current.due_date, current.due_time)}
            {current.deal_name ? ` · ${current.deal_name}` : ''}
          </p>
        </div>
      )}

      {!editing && !current && mode === 'manage' && (
        <p className="text-body text-text-secondary">No next meeting is set.</p>
      )}

      {editing && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="next-meeting-date" required>Date</Label>
            {date && (
              <p className="text-label text-text-secondary">{fmtLong(date)}</p>
            )}
            <DatePicker
              id="next-meeting-date"
              value={date}
              invalid={Boolean(dateError)}
              onValueChange={d => { setDate(d); setDateError(null) }}
            />
            {dateError && <p className="text-label text-danger">{dateError}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="next-meeting-time">Time (optional)</Label>
            <TimePicker
              id="next-meeting-time"
              value={time}
              onValueChange={setTime}
            />
          </div>

          {openDeals.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="next-meeting-deal">About opportunity (optional)</Label>
              <select
                id="next-meeting-deal"
                value={dealId}
                onChange={e => setDealId(e.target.value)}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-body sm:h-9"
              >
                <option value="">Not linked to an opportunity</option>
                {openDeals.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </>
  )

  const change = !accountRequired && !editing && (
    <Button variant="secondary" onClick={() => setEditing(true)}>Change</Button>
  )
  const removeButton = !accountRequired && !editing && current && (
    <Button variant="secondary" disabled={saving} onClick={remove}>Remove</Button>
  )
  const saveButton = !accountRequired && editing && (
    <Button disabled={saving || !date} onClick={() => date && void save(date, time, dealId)}>
      Save
    </Button>
  )
  const dismiss = (
    <Button variant={phone ? 'secondary' : 'ghost'} onClick={onClose}>
      {mode === 'prompt' ? 'Skip' : 'Close'}
    </Button>
  )

  if (phone) {
    // §41.8 rule 6: footer buttons share its width, secondary first,
    // primary on the right.
    return (
      <BottomSheet
        open
        onOpenChange={o => { if (!o) onClose() }}
        title={title}
        description={description}
        bodyClassName="flex flex-col gap-4"
        footer={<>{dismiss}{change}{removeButton}{saveButton}</>}
      >
        {body}
      </BottomSheet>
    )
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {body}
        </DialogBody>
        <DialogFooter>
          {change}
          {removeButton}
          {saveButton}
          {dismiss}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "Thu, 23 Oct" (+ " · 11:30 AM" when a time is set) — the manage-mode summary line. */
function fmtShort(dateStr: string, timeStr: string | null) {
  const d = new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  return timeStr ? `${d} · ${formatHHMM(timeStr)}` : d
}

/** "Thursday, 23 Oct" — shown above the date picker while editing. */
function fmtLong(date: Date) {
  return date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
}
