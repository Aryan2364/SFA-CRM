'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { useLayout } from '@/lib/layout'
import { useToast } from '@/contexts/ToastContext'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField, usePhoneFormGuard } from '@/components/ui/phone-form'
import { PickerSheetField, StaticPickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { NextMeetingDialog } from '@/components/daily-activity/next-meeting-dialog'
import { OTHER_VISIT_TYPE } from '@/components/daily-activity/add-meeting-dialog'
import { toDateStr } from '@/components/daily-activity/types'
import { TimePicker, type TimeValue } from '@/components/ui/time-picker'
import { Label } from '@/components/ui/label'

/**
 * Log meeting — phone create form for POST /api/daily-activity.
 *
 * One column, every field visible (no "More details" toggle): Account,
 * Visit type, Date & time, Contact, Opportunity, Notes. "Set next meeting"
 * is offered right after save (reused NextMeetingDialog / next-meeting API),
 * then the caller lands back on /today for the meeting's own date.
 *
 * ?account=<id> prefills the account (resolved through /api/companies/[id]).
 * ?deal=<id> prefills the opportunity, still constrained to that account's
 * own open deals once one is chosen. ?date=YYYY-MM-DD prefills the date; with
 * no ?date= it defaults to today.
 *
 * Date & time, mirroring add-meeting-dialog.tsx's `isPast` branch exactly:
 * - Today (the common "logging a meeting that just ended" case): no
 *   `is_manual_entry` is sent at all — same as desktop's default (the toggle
 *   off). The server leaves `status` as `'Pending'`; it is not told a
 *   fabricated start/end, so no duration is invented. (Desktop's own
 *   "already happened" toggle is independent of the date shown — it exists
 *   because the same dialog is also opened for a date that is *not* today.
 *   This form only ever shows one date field, so the date itself stands in
 *   for that toggle: today behaves like the toggle off, a past date like the
 *   toggle on.)
 * - A past date: desktop requires BOTH a start and an end time and sends
 *   `is_manual_entry: true` with both as ISO timestamps on that date; this
 *   form shows the same two required fields, with the same "end after
 *   start" validation, and sends the identical shape.
 * - A future date: the create route itself rejects `visit_date` after today
 *   (`Cannot create meetings for future dates`), and desktop's dialog has no
 *   future-planning mode either — so the date input's `max` is today.
 */

const VISIT_TYPE_OPTIONS: PickerOption[] = [
  { id: 'Dealer', label: 'Dealer' },
  { id: 'Distributor', label: 'Distributor' },
  { id: 'Retailer', label: 'Retailer' },
  { id: OTHER_VISIT_TYPE, label: 'Other' },
]

/** `TimeValue` (12-hour, as the kit models it) to "HH:MM" on a 24-hour clock.
 *  Mirrors `to24h` in add-meeting-dialog.tsx (not exported there). */
function to24h(v: TimeValue | undefined): string | null {
  if (!v) return null
  let h = v.hour % 12
  if (v.meridiem === 'PM') h += 12
  return `${String(h).padStart(2, '0')}:${String(v.minute).padStart(2, '0')}`
}

export default function LogMeetingPage() {
  const { layout } = useLayout()
  const router = useRouter()

  useEffect(() => {
    if (layout === 'desktop') router.replace('/daily-activity')
  }, [layout, router])

  if (layout === 'desktop') return null
  return (
    <Suspense fallback={null}>
      <LogMeetingForm />
    </Suspense>
  )
}

function LogMeetingForm() {
  usePhoneAppBar({ title: 'Log meeting', back: '/today' })
  const router = useRouter()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const presetAccountId = searchParams.get('account')
  const presetDealId = searchParams.get('deal')
  const presetDate = searchParams.get('date')

  const todayStr = toDateStr(new Date())
  const [account, setAccount] = useState<PickerOption | null>(null)
  const [visitType, setVisitType] = useState<PickerOption | null>(null)
  const [date, setDate] = useState(() => presetDate || todayStr)
  const [startTime, setStartTime] = useState<TimeValue | undefined>(undefined)
  const [endTime, setEndTime] = useState<TimeValue | undefined>(undefined)
  const [timeError, setTimeError] = useState<{ start?: string; end?: string }>({})
  const [deal, setDeal] = useState<PickerOption | null>(null)
  const [contact, setContact] = useState<PickerOption | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [createdVisitId, setCreatedVisitId] = useState<string | null>(null)
  // Where to land after the next-meeting prompt: the day's list, or the meeting
  // itself when its notes did not save so they can be typed again.
  const [afterHref, setAfterHref] = useState<string | null>(null)

  // Same rule as add-meeting-dialog.tsx's `isPast` toggle, standing in for
  // it: a date before today means "this already happened" — the only mode
  // this single-date form can express.
  const isPast = date < todayStr

  const changed = !!account || !!visitType || !!deal || !!contact || !!notes.trim()
  const { requestLeave, warning } = usePhoneFormGuard(changed)

  // Prefill account from ?account=
  useEffect(() => {
    if (!presetAccountId || account) return
    ;(async () => {
      try {
        const r = await fetch(`/api/companies/${presetAccountId}`)
        if (!r.ok) return
        const c = await r.json()
        if (c?.id) setAccount({ id: c.id, label: c.name })
      } catch {
        /* best-effort prefill only */
      }
    })()
  }, [presetAccountId, account])

  const fetchAccounts = useCallback(async (q: string): Promise<PickerOption[]> => {
    const r = await fetch(`/api/companies?q=${encodeURIComponent(q)}`)
    if (!r.ok) return []
    const d = await r.json()
    const rows = Array.isArray(d) ? d : d.rows ?? []
    return rows.map((c: { id: string; name: string; type?: string }) => ({
      id: c.id,
      label: c.name,
      sublabel: c.type || undefined,
    }))
  }, [])

  const fetchDeals = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      if (!account) return []
      const r = await fetch(`/api/deals?companyId=${account.id}&q=${encodeURIComponent(q)}`)
      if (!r.ok) return []
      const d = await r.json()
      const rows = (Array.isArray(d) ? d : d.rows ?? []) as { id: string; name: string; closed_at?: string | null }[]
      return rows.filter(r2 => !r2.closed_at).map(r2 => ({ id: r2.id, label: r2.name }))
    },
    [account]
  )

  const fetchContacts = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      const r = await fetch(`/api/contacts?q=${encodeURIComponent(q)}${account ? `&companyId=${account.id}` : ''}`)
      if (!r.ok) return []
      const d = await r.json()
      const rows = Array.isArray(d) ? d : d.rows ?? []
      return rows.map((c: { id: string; name: string }) => ({ id: c.id, label: c.name }))
    },
    [account]
  )

  // Prefill the opportunity from ?deal= once the account's open deals can be
  // checked against it (fetchDeals already filters to this account).
  useEffect(() => {
    if (!presetDealId || deal || !account) return
    ;(async () => {
      try {
        const r = await fetch(`/api/deals/${presetDealId}`)
        if (!r.ok) return
        const d = await r.json()
        if (d?.id && d.company_id === account.id && !d.closed_at) setDeal({ id: d.id, label: d.name })
      } catch {
        /* best-effort prefill only */
      }
    })()
  }, [presetDealId, deal, account])

  useEffect(() => {
    // Clear the opportunity choice if the account changes out from under it.
    setDeal(null)
  }, [account?.id])

  async function save() {
    if (!account) { toast('Choose an account', 'error'); return }
    if (!visitType) { toast('Choose a visit type', 'error'); return }

    // Mirrors add-meeting-dialog.tsx's `isPast` branch exactly: only a past
    // date requires (and sends) explicit start/end times.
    let manual: { is_manual_entry: true; manual_start_time: string; manual_end_time: string } | Record<string, never> = {}
    if (isPast) {
      const s = to24h(startTime)
      const e = to24h(endTime)
      const errs: { start?: string; end?: string } = {}
      if (!s) errs.start = 'Enter a start time'
      if (!e) errs.end = 'Enter an end time'
      const sIso = s ? new Date(`${date}T${s}:00`).toISOString() : null
      const eIso = e ? new Date(`${date}T${e}:00`).toISOString() : null
      if (sIso && eIso && eIso <= sIso) errs.end = 'End time must be after start time'
      setTimeError(errs)
      if (Object.keys(errs).length > 0 || !sIso || !eIso) return
      manual = { is_manual_entry: true, manual_start_time: sIso, manual_end_time: eIso }
    }

    setSaving(true)
    try {
      const r = await fetch('/api/daily-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visit_type: visitType.id,
          entity_id: account.id,
          entity_name: account.label,
          is_new_entity: false,
          visit_date: date,
          ...manual,
          deal_id: deal?.id || presetDealId || undefined,
          contact_id: contact?.id || undefined,
        }),
      })
      if (!r.ok) {
        toast((await r.json().catch(() => ({}))).error ?? 'Could not log the meeting', 'error')
        return
      }
      const created = await r.json()
      let notesSaved = true
      if (notes.trim()) {
        try {
          const nr = await fetch('/api/remarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context_type: 'meeting', context_id: created.id, body: notes.trim() }),
          })
          notesSaved = nr.ok
        } catch {
          notesSaved = false
        }
      }
      if (notesSaved) {
        toast('Meeting logged', 'success')
      } else {
        // The meeting exists, so the form is done; the notes are not, so the
        // way on is the meeting, where they can be added again.
        toast('Meeting logged, but your notes were not saved. Open the meeting to add them again.', 'error')
        setAfterHref(`/daily-activity/meeting/${created.id}`)
      }
      setCreatedVisitId(created.id)
    } catch {
      // The form is kept as typed so nothing has to be re-entered.
      toast('The connection dropped. Nothing was saved.', 'error')
    } finally {
      setSaving(false)
    }
  }

  // After save, offer "Set next meeting" as a sheet, then return to /today
  // on the meeting's own date.
  if (createdVisitId) {
    return (
      <NextMeetingDialog
        visitId={createdVisitId}
        mode="prompt"
        onClose={() => router.push(afterHref ?? `/today?date=${date}`)}
        onSaved={() => router.push(afterHref ?? `/today?date=${date}`)}
      />
    )
  }

  return (
    <>
      <PhoneForm onSave={save} saving={saving} changed={changed} onDiscard={() => requestLeave(() => router.push('/today'))}>
        <PhoneFormField label="Account" required>
          <PickerSheetField
            label="Account"
            value={account}
            onChange={setAccount}
            fetchOptions={fetchAccounts}
            onCreate={name => {
              // The phone account form hands the new account back as ?account=.
              const back = `/daily-activity/new?date=${encodeURIComponent(date)}`
              router.push(`/parties/new?name=${encodeURIComponent(name)}&next=${encodeURIComponent(back)}`)
            }}
          />
        </PhoneFormField>
        <PhoneFormField label="Visit type" required>
          <StaticPickerSheetField label="Visit type" value={visitType} onChange={setVisitType} options={VISIT_TYPE_OPTIONS} />
        </PhoneFormField>
        <PhoneFormField label="Date">
          <input
            type="date"
            value={date}
            max={todayStr}
            onChange={e => { setDate(e.target.value); setTimeError({}) }}
            className="w-full h-11 rounded-md border border-input bg-background px-3 text-base"
          />
        </PhoneFormField>
        {isPast && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="da-new-start">Start time</Label>
              <TimePicker
                id="da-new-start"
                className="max-w-none"
                value={startTime}
                onValueChange={v => { setStartTime(v); setTimeError(f => ({ ...f, start: undefined })) }}
                invalid={!!timeError.start}
              />
              {timeError.start && <p className="text-meta text-danger">{timeError.start}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="da-new-end">End time</Label>
              <TimePicker
                id="da-new-end"
                className="max-w-none"
                value={endTime}
                onValueChange={v => { setEndTime(v); setTimeError(f => ({ ...f, end: undefined })) }}
                invalid={!!timeError.end}
              />
              {timeError.end && <p className="text-meta text-danger">{timeError.end}</p>}
            </div>
          </div>
        )}
        <PhoneFormField label="Contact">
          <PickerSheetField label="Contact" value={contact} onChange={setContact} fetchOptions={fetchContacts} />
        </PhoneFormField>
        <PhoneFormField label="Opportunity" hint={account ? undefined : 'Choose an account first'}>
          <PickerSheetField
            label="Opportunity"
            value={deal}
            onChange={setDeal}
            fetchOptions={fetchDeals}
            disabled={!account}
          />
        </PhoneFormField>
        <PhoneFormField label="What was discussed">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
            placeholder="Notes from the meeting"
          />
        </PhoneFormField>
      </PhoneForm>
      {warning}
    </>
  )
}
