'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftIcon, HistoryIcon, PlusIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { TimePicker, type TimeValue } from '@/components/ui/time-picker'
import { Entity, PlannedItem, Visit } from './types'

/**
 * ONE meeting form (F5), for a meeting happening now and for one that
 * already happened.
 *
 * WHAT THIS REPLACES
 *
 * Two buttons in the page header and two dialogs: this one and
 * `manual-meeting-dialog.tsx`, which is gone. The two forms asked for
 * the same party in the same way and differed only in whether they also
 * asked for a Start and an End. That is a toggle, not a second screen,
 * and it was costing a button's worth of header room that F4 wanted for
 * check-in/check-out.
 *
 * ⚠️ MERGING THE FORMS DOES NOT MERGE THE PROVENANCE. A past entry still
 * posts `is_manual_entry: true`, still sends NO coordinates (this file
 * never calls `getPosition()`, in either mode), and is still marked
 * Manually Entered · Tentative on the card once saved. A typed time must
 * never be able to pass as a captured one; the toggle changes what the
 * form asks for, never what the record claims about itself.
 *
 * F6 — THE SELECTORS ARE GONE, AND WHAT THAT MEANS FOR `visit_type`
 *
 * The form used to open with a "Type" select (Dealer / Distributor /
 * Institution, from `company_types`) and a three-way "Record" selector
 * (Existing / Lead / New). Between them they chose which parties the
 * dropdown listed, and the Type select ALSO wrote
 * `daily_visits.visit_type` — a join key with no foreign key behind it.
 * Deleting the control without deciding what it wrote would have
 * silently changed what gets stored.
 *
 * What is written now: the selected party's OWN `companies.type`, which
 * `/api/business-partners?status=all` returns. That is the same rule the
 * page already used when starting a meeting from an approved plan line
 * (`party_visit_type ?? party_type ?? 'Dealer'`), so the two paths agree
 * and the stored values stay inside the existing set. `'Dealer'` remains
 * the last-resort fallback for a party whose type is null.
 *
 * For a brand-new lead there is no party to read a type from, so the
 * create panel keeps a Lead type field. It is not the selector Aryan
 * removed: that one filtered the meeting, this one types a permanent
 * master record that will be wrong forever if it is guessed.
 *
 * F26 — every field in this form carries `max-w-none`. The kit caps a
 * bare field at `--spacing-field-max` (480px), which is right on a wide
 * page and wrong inside a 526px dialog body: the capped fields stopped
 * 46px short of the right edge that the toggle panel and the time-picker
 * grid reach, and the form read as ragged. `max-w-none` is the pattern
 * the order dialogs already use for this. Every field now shares one
 * left and one right edge at every width.
 *
 * F7 — the dropdown is labelled "Lead" here because F6 asked for it on
 * THIS form. That is a local relabel, not the repo-wide Lead/Party
 * decision, which is still Aryan's to make.
 */

/** `TimeValue` (12-hour, as the kit models it) to "HH:MM" on a 24-hour clock. */
function to24h(v: TimeValue | undefined): string | null {
  if (!v) return null
  let h = v.hour % 12
  if (v.meridiem === 'PM') h += 12
  return `${String(h).padStart(2, '0')}:${String(v.minute).padStart(2, '0')}`
}

export type MeetingDraft = Partial<Visit> & {
  weekly_plan_item_id?: string | null
  is_manual_entry?: true
  manual_start_time?: string
  manual_end_time?: string
}

export function AddMeetingDialog({
  open,
  onOpenChange,
  planItem,
  visitDate,
  onAdd,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  planItem?: PlannedItem | null
  /** "YYYY-MM-DD" — the day already selected on the screen. */
  visitDate: string
  onAdd: (v: MeetingDraft) => Promise<void> | void
}) {
  const { toast } = useToast()

  /** F5 — the one toggle that turns this into a past entry. */
  const [isPast, setIsPast] = useState(false)
  /** The create-a-lead panel, reached from the dropdown's own row. */
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  const [entities, setEntities] = useState<Entity[]>([])
  const [entLoading, setEntLoading] = useState(false)
  const [entityId, setEntityId] = useState('')

  const [leadTypes, setLeadTypes] = useState<{ id: string; name: string }[]>([])

  const [npName, setNpName] = useState('')
  const [npMobile, setNpMobile] = useState('')
  const [npPlace, setNpPlace] = useState('')
  const [npType, setNpType] = useState('')
  const [placeOptions, setPlaceOptions] = useState<Record<string, string>>({})
  const [placeMap, setPlaceMap] = useState<
    Map<string, { state_id: string; district_id: string; taluka_id: string; village_id: string | null }>
  >(new Map())

  const [startTime, setStartTime] = useState<TimeValue | undefined>(undefined)
  const [endTime, setEndTime] = useState<TimeValue | undefined>(undefined)
  const [fieldError, setFieldError] = useState<{ start?: string; end?: string }>({})

  useEffect(() => {
    if (!open) return
    setIsPast(false)
    setCreating(false)
    setEntityId('')
    setNpName('')
    setNpMobile('')
    setNpPlace('')
    setStartTime(undefined)
    setEndTime(undefined)
    setFieldError({})

    setEntLoading(true)
    // One list. No stage filter, no type filter — F6 removed both
    // questions, so the form offers every active party at once.
    fetch('/api/business-partners?status=all')
      .then(r => (r.ok ? r.json() : []))
      .then((d: Entity[]) => { setEntities(Array.isArray(d) ? d : []); setEntLoading(false) })
      .catch(() => { setEntLoading(false); toast('Failed to load leads', 'error') })

    fetch('/api/masters/lead-types')
      .then(r => r.json())
      .then((d: { id: string; name: string }[]) => {
        setLeadTypes(Array.isArray(d) ? d : [])
        if (Array.isArray(d) && d.length > 0) setNpType(v => v || d[0].name)
      })
      .catch(() => toast('Failed to load lead types', 'error'))
  }, [open])

  /* Location masters are only needed by the create panel, so they load
     when it opens rather than on every meeting. */
  useEffect(() => {
    if (!creating || placeMap.size > 0) return
    Promise.all([
      fetch('/api/masters/districts').then(r => r.json()),
      fetch('/api/masters/talukas').then(r => r.json()),
      fetch('/api/masters/villages').then(r => r.json()),
    ])
      .then(([districts, talukas, villages]) => {
        const distMap = new Map(districts.map((d: { id: string }) => [d.id, d]))
        const taluMap = new Map(talukas.map((t: { id: string }) => [t.id, t]))
        const opts: Record<string, string> = {}
        const pm = new Map<string, { state_id: string; district_id: string; taluka_id: string; village_id: string | null }>()
        for (const t of talukas as { id: string; name: string; district_id: string }[]) {
          const dist = distMap.get(t.district_id) as { id: string; name: string; state_id: string } | undefined
          if (!dist) continue
          opts[`t:${t.id}`] = `${dist.name} · ${t.name}`
          pm.set(`t:${t.id}`, { state_id: dist.state_id, district_id: t.district_id, taluka_id: t.id, village_id: null })
        }
        for (const v of villages as { id: string; name: string; taluka_id: string }[]) {
          const talu = taluMap.get(v.taluka_id) as { id: string; name: string; district_id: string } | undefined
          const dist = talu ? (distMap.get(talu.district_id) as { id: string; name: string; state_id: string } | undefined) : undefined
          if (!talu || !dist) continue
          opts[`v:${v.id}`] = `${dist.name} · ${talu.name} · ${v.name}`
          pm.set(`v:${v.id}`, { state_id: dist.state_id, district_id: talu.district_id, taluka_id: v.taluka_id, village_id: v.id })
        }
        setPlaceOptions(opts)
        setPlaceMap(pm)
      })
      .catch(() => toast('Failed to load location data', 'error'))
  }, [creating, placeMap.size])

  /* A party that is still in the funnel is marked in the list, so one
     dropdown does not lose the Lead/Existing distinction the removed
     selector used to carry — it just stops asking about it up front. */
  const entityOptions: Record<string, string> = useMemo(
    () =>
      Object.fromEntries(
        entities.map(e => [e.id, e.stage && e.stage !== 'Existing' ? `${e.name} · ${e.stage}` : e.name])
      ),
    [entities]
  )

  const canAdd = creating
    ? !!npName.trim() && !!npType && (!isPast || (!!startTime && !!endTime))
    : !!entityId && (!isPast || (!!startTime && !!endTime))

  async function handleAdd() {
    if (!canAdd || saving) return

    let manual: { is_manual_entry: true; manual_start_time: string; manual_end_time: string } | Record<string, never> = {}
    if (isPast) {
      const s = to24h(startTime)
      const e = to24h(endTime)
      const errs: { start?: string; end?: string } = {}
      if (!s) errs.start = 'Enter a start time'
      if (!e) errs.end = 'Enter an end time'
      const sIso = s ? new Date(`${visitDate}T${s}:00`).toISOString() : null
      const eIso = e ? new Date(`${visitDate}T${e}:00`).toISOString() : null
      if (sIso && eIso && eIso <= sIso) errs.end = 'End time must be after start time'
      setFieldError(errs)
      if (Object.keys(errs).length > 0 || !sIso || !eIso) return
      manual = { is_manual_entry: true, manual_start_time: sIso, manual_end_time: eIso }
    }

    const planLink = planItem ? { weekly_plan_item_id: planItem.id } : {}
    setSaving(true)
    if (creating) {
      const r = placeMap.get(npPlace)
      await onAdd({
        ...planLink,
        ...manual,
        visit_type: npType,
        new_prospect: {
          name: npName.trim(),
          mobile_1: npMobile.trim() || null,
          state_id: r?.state_id ?? null,
          district_id: r?.district_id ?? null,
          taluka_id: r?.taluka_id ?? null,
          village_id: r?.village_id ?? null,
        },
      })
    } else {
      const selected = entities.find(e => e.id === entityId)
      await onAdd({
        ...planLink,
        ...manual,
        // F6: the party's own type, not a type the user was made to pick.
        visit_type: selected?.type || 'Dealer',
        entity_id: entityId,
        entity_name: selected?.name ?? '',
        is_new_entity: false,
      })
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isPast && <HistoryIcon className="size-4 text-warning" />}
            {isPast ? 'Log a past meeting' : 'Log a meeting'}
          </DialogTitle>
          <DialogDescription>
            {planItem
              ? `On the planned line ${[planItem.from_place, planItem.to_place].filter(Boolean).join(' → ') || 'for this day'}.`
              : isPast
                ? 'For a meeting that already happened but was not logged live.'
                : 'For a visit that was not on the approved plan.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* F5 — the toggle, at the top, because it changes what the
              rest of the form asks for. */}
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border-light bg-surface-sunken px-3 py-2.5">
            <div className="min-w-0">
              <Label htmlFor="da-past-toggle" className="cursor-pointer">
                This meeting already happened
              </Label>
              <p className="mt-0.5 text-meta text-text-secondary">
                {isPast
                  ? 'Its times are typed by hand, so it is saved as Manually Entered · Tentative with no location.'
                  : 'Leave this off to time the meeting live and capture its location.'}
              </p>
            </div>
            <Switch
              id="da-past-toggle"
              aria-label="This meeting already happened"
              checked={isPast}
              onCheckedChange={v => { setIsPast(Boolean(v)); setFieldError({}) }}
            />
          </div>

          {!creating ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="da-entity">Lead</Label>
                {/* The action sits next to the control it extends. */}
                <Button variant="ghost" size="sm" type="button" onClick={() => setCreating(true)}>
                  <PlusIcon />
                  Create new lead
                </Button>
              </div>
              <SearchableSelect
                id="da-entity"
                className="max-w-none"
                options={entityOptions}
                value={entityId}
                onValueChange={setEntityId}
                disabled={entLoading}
                placeholder={entLoading ? 'Loading…' : 'Search by name'}
                emptyMessage="No lead matches that search."
              />
            </div>
          ) : (
            <div className="space-y-4 rounded-lg border border-border-light p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-label font-medium text-text-primary">New lead</p>
                <Button variant="ghost" size="sm" type="button" onClick={() => setCreating(false)}>
                  <ArrowLeftIcon />
                  Pick an existing lead
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="da-np-name">Name</Label>
                <Input id="da-np-name" className="max-w-none" value={npName} onChange={e => setNpName(e.target.value)} placeholder="Lead name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="da-np-mobile">Mobile</Label>
                <Input
                  id="da-np-mobile"
                  className="max-w-none"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={npMobile}
                  onChange={e => setNpMobile(e.target.value)}
                  placeholder="10-digit number"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="da-np-place">Place</Label>
                <SearchableSelect
                  id="da-np-place"
                  className="max-w-none"
                  options={placeOptions}
                  value={npPlace}
                  onValueChange={setNpPlace}
                  placeholder="District, taluka or village"
                  emptyMessage="No place matches that search."
                />
              </div>
              {/* Not the selector F6 removed: this one types a permanent
                  master record, and there is no party to read it from. */}
              <div className="space-y-1.5">
                <Label htmlFor="da-np-type">Lead type</Label>
                <Select value={npType} onValueChange={v => setNpType(String(v))}>
                  <SelectTrigger id="da-np-type" className="w-full max-w-none">
                    <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {leadTypes.map(t => (
                      <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* F8 — the kit's TimePicker (§20.2), not `<input type="time">`,
              which renders the operating system's own widget and matches
              nothing else in the app. */}
          {isPast && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="da-manual-start">Start time</Label>
                  <TimePicker
                    id="da-manual-start"
                    className="max-w-none"
                    value={startTime}
                    onValueChange={v => { setStartTime(v); setFieldError(f => ({ ...f, start: undefined })) }}
                    invalid={!!fieldError.start}
                  />
                  {fieldError.start && <p className="text-meta text-danger">{fieldError.start}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="da-manual-end">End time</Label>
                  <TimePicker
                    id="da-manual-end"
                    className="max-w-none"
                    value={endTime}
                    onValueChange={v => { setEndTime(v); setFieldError(f => ({ ...f, end: undefined })) }}
                    invalid={!!fieldError.end}
                  />
                  {fieldError.end && <p className="text-meta text-danger">{fieldError.end}</p>}
                </div>
              </div>
              <p className="text-meta text-text-muted">
                These times are tentative — typed from memory, not captured live.
              </p>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={!canAdd || saving}>
            {saving ? 'Saving…' : isPast ? 'Add past meeting' : 'Add meeting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
