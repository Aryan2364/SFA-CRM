'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LockIcon, PlusIcon, ArrowLeftIcon } from 'lucide-react'

import { useLayout } from '@/lib/layout'
import { useToast } from '@/contexts/ToastContext'
import { useMeStatus } from '@/hooks/useMe'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField, usePhoneFormGuard } from '@/components/ui/phone-form'
import { PickerSheetField, StaticPickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { NextMeetingDialog } from '@/components/daily-activity/next-meeting-dialog'
import { PhoneAttendees, useMeetingAttendees } from '@/components/daily-activity/phone-attendees'
import {
  COMPANY_PREFIX,
  CONTACT_PREFIX,
  NO_LEAD_TYPE,
  loadPlaceOptions,
  partyOptionLabel,
  personMeetingName,
  personOptionLabel,
  to24h,
  visitTypeForCompany,
  visitTypeForPerson,
  type ContactCompany,
  type LeadContact,
  type PlaceChoice,
} from '@/components/daily-activity/add-meeting-dialog'
import { toDateStr, type Entity } from '@/components/daily-activity/types'
import { TimePicker, type TimeValue } from '@/components/ui/time-picker'
import { Banner, BannerDescription, BannerTitle } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { ChoiceRow } from '@/components/ui/choice-row'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

/**
 * Log meeting — phone create form for POST /api/daily-activity.
 *
 * The same form as the computer's "Log a meeting" dialog
 * (`add-meeting-dialog.tsx`), with the same questions, rules and payload, laid
 * out as one phone screen:
 *
 * - "Who did you meet" is ONE picker over the caller's own accounts AND
 *   contacts (`/api/business-partners?status=all&mine=1`, `/api/contacts?mine=1`).
 *   There is NO visit-type question: `visit_type` is the chosen party's own
 *   type, 'Other' for an untyped party, 'Contact' for a person with no company
 *   (`visitTypeForCompany` / `visitTypeForPerson`, shared with the dialog).
 * - A person who belongs to several accounts is asked "Which account?"; one
 *   with none can be made their own Individual account.
 * - "New account" creates a lead from the form (`new_prospect`): name, mobile,
 *   place and an optional Account type, exactly as the dialog does.
 * - "Who was there" (attendees) once an account is resolved.
 * - "This meeting already happened" (Switch) or a date before today: start and
 *   end are typed and sent as `is_manual_entry`; otherwise the meeting is
 *   saved Pending and the form lands on the meeting itself, where Start
 *   records the time and place.
 *
 * Phone-only additions the dialog does not have: a Date field (the desktop
 * takes the day from the page it sits on), an Opportunity (reached from an
 * opportunity's "Log meeting"; gated on `deals.view`, sent as `deal_id`) and
 * "What was discussed" notes (saved as a remark on the new meeting).
 *
 * ?plan=<weekly plan item id> and ?followUp=<deal follow-up id> are forwarded as
 * `weekly_plan_item_id` / `deal_follow_up_id`, as the dialog does; the route
 * validates both (own approved plan, day, own open follow-up).
 * ?account=<id> prefills the account. ?deal=<id> prefills the opportunity once
 * that account is chosen. ?date=YYYY-MM-DD prefills the date (default: today).
 * A future date is refused by the route, so the date input's `max` is today.
 */

type Load<T> = { state: 'loading' } | { state: 'ready'; rows: T[] } | { state: 'error' } | { state: 'forbidden' }

const PEOPLE_TIMEOUT_MS = 15_000
const MAX_RESULTS = 50

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
  // From a planned line / an Opportunity follow-up to-do: the meeting is logged
  // for it, exactly as the dialog's planItem / followUpId props do.
  const planItemId = searchParams.get('plan')
  const followUpId = searchParams.get('followUp')
  const { me, error: meError, retry: retryMe } = useMeStatus()
  const canCreate: boolean | null = me ? Boolean(me.permissions?.meetings?.create) : null
  const canViewDeals = Boolean(me?.permissions?.deals?.view)

  const todayStr = toDateStr(new Date())
  const [date, setDate] = useState(() => presetDate || todayStr)
  const [happened, setHappened] = useState(false)
  const [mode, setMode] = useState<'target' | 'create'>('target')

  // Who did you meet: option ids are namespaced `c:<company id>` / `p:<contact id>`.
  const [target, setTarget] = useState<PickerOption | null>(null)
  const [personCompany, setPersonCompany] = useState<PickerOption | null>(null)
  const [individualMadeFor, setIndividualMadeFor] = useState<string | null>(null)
  const [makingIndividual, setMakingIndividual] = useState(false)
  const [deal, setDeal] = useState<PickerOption | null>(null)

  const [entities, setEntities] = useState<Load<Entity>>({ state: 'loading' })
  const [entitiesReload, setEntitiesReload] = useState(0)
  const [people, setPeople] = useState<Load<LeadContact>>({ state: 'loading' })
  const [peopleReload, setPeopleReload] = useState(0)
  // The ?account= party, when it is not one of the caller's own list.
  const [presetEntity, setPresetEntity] = useState<Entity | null>(null)

  // New account (lead) panel.
  const [npName, setNpName] = useState('')
  const [npMobile, setNpMobile] = useState('')
  const [npPlace, setNpPlace] = useState<PickerOption | null>(null)
  const [npType, setNpType] = useState<PickerOption | null>(null)
  const [leadTypes, setLeadTypes] = useState<{ state: 'loading' | 'ready' | 'error'; rows: { id: string; name: string }[] }>({ state: 'loading', rows: [] })
  const [leadTypesReload, setLeadTypesReload] = useState(0)
  const [places, setPlaces] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; options: Record<string, string>; map: Map<string, PlaceChoice> }>({ state: 'idle', options: {}, map: new Map() })
  const [placesReload, setPlacesReload] = useState(0)

  const [startTime, setStartTime] = useState<TimeValue | undefined>(undefined)
  const [endTime, setEndTime] = useState<TimeValue | undefined>(undefined)
  const [timeError, setTimeError] = useState<{ start?: string; end?: string }>({})
  const [fieldError, setFieldError] = useState<{ target?: string; company?: string; name?: string }>({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [createdVisitId, setCreatedVisitId] = useState<string | null>(null)
  // Where to land after the next-meeting prompt: the day's list, or the meeting
  // itself when its notes did not save so they can be typed again.
  const [afterHref, setAfterHref] = useState<string | null>(null)

  // A date before today can only be an entry made by hand; for today the
  // Switch decides (the dialog's "This meeting already happened" toggle).
  const isPast = date < todayStr || happened

  const creating = mode === 'create'
  const selectedCompanyId = target?.id.startsWith(COMPANY_PREFIX) ? target.id.slice(COMPANY_PREFIX.length) : ''
  const selectedPersonId = target?.id.startsWith(CONTACT_PREFIX) ? target.id.slice(CONTACT_PREFIX.length) : ''
  const entityRows = useMemo(() => (entities.state === 'ready' ? entities.rows : []), [entities])
  const peopleRows = useMemo(() => (people.state === 'ready' ? people.rows : []), [people])

  const personCompanies: ContactCompany[] = useMemo(
    () => (selectedPersonId ? peopleRows.find(c => c.id === selectedPersonId)?.companies ?? [] : []),
    [peopleRows, selectedPersonId]
  )
  // A contact in several accounts: ask, never guess (the dialog's rule).
  const mustPickCompany = personCompanies.length > 1
  const chosenPersonCompany: ContactCompany | null =
    personCompanies.length === 0
      ? null
      : personCompanies.length === 1
        ? personCompanies[0]
        : personCompanies.find(c => c.id === personCompany?.id) ?? null
  const resolvedCompanyId = selectedCompanyId || chosenPersonCompany?.id || individualMadeFor || ''
  // The account the meeting is filed against (an Opportunity must be at it).
  const dealCompanyId = selectedCompanyId || chosenPersonCompany?.id || ''

  const attendees = useMeetingAttendees(creating ? '' : resolvedCompanyId, selectedPersonId)

  const changed =
    !!target || !!deal || !!notes.trim() || happened || (creating && (!!npName.trim() || !!npMobile.trim() || !!npPlace || !!npType))
  const { requestLeave, warning } = usePhoneFormGuard(changed)

  // The caller's own accounts.
  useEffect(() => {
    let live = true
    setEntities({ state: 'loading' })
    fetch('/api/business-partners?status=all&mine=1')
      .then(async r => {
        if (!live) return
        if (!r.ok) { setEntities({ state: 'error' }); return }
        const d = (await r.json()) as Entity[]
        setEntities({ state: 'ready', rows: Array.isArray(d) ? d : [] })
      })
      .catch(() => { if (live) setEntities({ state: 'error' }) })
    return () => { live = false }
  }, [entitiesReload])

  // The caller's own contacts. A 403 hides the people half of the picker; it
  // is not a fault. A failure is said, and can be retried.
  useEffect(() => {
    let live = true
    setPeople({ state: 'loading' })
    fetch('/api/contacts?mine=1', { signal: AbortSignal.timeout(PEOPLE_TIMEOUT_MS) })
      .then(async r => {
        if (!live) return
        if (r.status === 403) { setPeople({ state: 'forbidden' }); return }
        if (!r.ok) { setPeople({ state: 'error' }); return }
        const d = (await r.json()) as LeadContact[]
        if (live) setPeople({ state: 'ready', rows: Array.isArray(d) ? d : [] })
      })
      .catch(() => { if (live) setPeople({ state: 'error' }) })
    return () => { live = false }
  }, [peopleReload])

  // Prefill the account from ?account= once the list is known.
  const accountApplied = useRef(false)
  useEffect(() => {
    if (!presetAccountId || accountApplied.current || entities.state === 'loading') return
    accountApplied.current = true
    const own = entityRows.find(e => e.id === presetAccountId)
    if (own) {
      setTarget({ id: `${COMPANY_PREFIX}${own.id}`, label: partyOptionLabel(own) })
      return
    }
    ;(async () => {
      try {
        const r = await fetch(`/api/companies/${presetAccountId}`)
        if (!r.ok) return
        const c = await r.json()
        if (!c?.id) return
        setPresetEntity({ id: c.id, name: c.name, type: c.type, stage: c.stage })
        setTarget({ id: `${COMPANY_PREFIX}${c.id}`, label: c.name })
      } catch {
        /* best-effort prefill only */
      }
    })()
  }, [presetAccountId, entities.state, entityRows])

  // Prefill the opportunity from ?deal= once its account is the one chosen.
  const dealApplied = useRef(false)
  useEffect(() => {
    if (!presetDealId || dealApplied.current || deal || !dealCompanyId || !canViewDeals) return
    dealApplied.current = true
    ;(async () => {
      try {
        const r = await fetch(`/api/deals/${presetDealId}`)
        if (!r.ok) return
        const d = await r.json()
        if (d?.id && d.company_id === dealCompanyId && !d.closed_at) setDeal({ id: d.id, label: d.name })
      } catch {
        /* best-effort prefill only */
      }
    })()
  }, [presetDealId, deal, dealCompanyId, canViewDeals])

  // Lead types and places are only needed by the New account panel.
  useEffect(() => {
    if (!creating) return
    let live = true
    setLeadTypes(l => ({ ...l, state: 'loading' }))
    fetch('/api/masters/lead-types?active=true')
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((d: { id: string; name: string }[]) => { if (live) setLeadTypes({ state: 'ready', rows: Array.isArray(d) ? d : [] }) })
      .catch(() => { if (live) setLeadTypes({ state: 'error', rows: [] }) })
    return () => { live = false }
  }, [creating, leadTypesReload])

  useEffect(() => {
    if (!creating) return
    let live = true
    setPlaces(p => ({ ...p, state: 'loading' }))
    loadPlaceOptions()
      .then(({ options, map }) => { if (live) setPlaces({ state: 'ready', options, map }) })
      .catch(() => { if (live) setPlaces(p => ({ ...p, state: 'error' })) })
    return () => { live = false }
  }, [creating, placesReload])

  const fetchTargets = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      const needle = q.trim().toLowerCase()
      const parties = presetEntity && !entityRows.some(e => e.id === presetEntity.id) ? [presetEntity, ...entityRows] : entityRows
      // Each half is capped on its own, so a long list of accounts never
      // pushes the people out of view when nothing has been typed yet.
      const companies: PickerOption[] = []
      for (const e of parties) {
        if (needle && !e.name.toLowerCase().includes(needle)) continue
        companies.push({ id: `${COMPANY_PREFIX}${e.id}`, label: partyOptionLabel(e), sublabel: e.type || undefined })
      }
      const contacts: PickerOption[] = []
      for (const c of peopleRows) {
        const label = personOptionLabel(c)
        if (needle && !label.toLowerCase().includes(needle)) continue
        contacts.push({ id: `${CONTACT_PREFIX}${c.id}`, label, sublabel: 'Contact' })
      }
      return [...companies.slice(0, MAX_RESULTS), ...contacts.slice(0, MAX_RESULTS)]
    },
    [entityRows, peopleRows, presetEntity]
  )

  const fetchPlaces = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      const needle = q.trim().toLowerCase()
      return Object.entries(places.options)
        .filter(([, label]) => !needle || label.toLowerCase().includes(needle))
        .slice(0, MAX_RESULTS)
        .map(([id, label]) => ({ id, label }))
    },
    [places.options]
  )

  const fetchDeals = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      if (!dealCompanyId) return []
      const r = await fetch(`/api/deals?companyId=${dealCompanyId}&q=${encodeURIComponent(q)}`)
      if (!r.ok) throw new Error(String(r.status))
      const d = await r.json()
      const rows = (Array.isArray(d) ? d : d.rows ?? []) as { id: string; name: string; closed_at?: string | null }[]
      return rows.filter(r2 => !r2.closed_at).map(r2 => ({ id: r2.id, label: r2.name }))
    },
    [dealCompanyId]
  )

  const leadTypeOptions = useMemo<PickerOption[]>(
    () => [{ id: NO_LEAD_TYPE, label: 'Not set' }, ...Array.from(new Set(leadTypes.rows.map(t => t.name))).map(name => ({ id: name, label: name }))],
    [leadTypes.rows]
  )

  function chooseTarget(o: PickerOption) {
    setTarget(o)
    setPersonCompany(null)
    setIndividualMadeFor(null)
    setDeal(null)
    setFieldError({})
  }

  async function makeIndividual() {
    if (!selectedPersonId || makingIndividual) return
    setMakingIndividual(true)
    try {
      const r = await fetch(`/api/contacts/${selectedPersonId}/make-individual`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast(d.error || 'Could not create an Individual account', 'error'); return }
      setIndividualMadeFor(d.id)
      toast('Individual account created', 'success')
    } catch {
      toast('Could not create an Individual account', 'error')
    } finally {
      setMakingIndividual(false)
    }
  }

  async function save() {
    if (saving || canCreate !== true) return

    // The dialog's `canAdd`, said out loud: what is missing, and where.
    const errs: { target?: string; company?: string; name?: string } = {}
    if (creating) {
      if (!npName.trim()) errs.name = "Enter the account's name"
    } else {
      if (!target) errs.target = 'Choose the account or person you met'
      else if (mustPickCompany && !personCompany) errs.company = 'Choose which account the meeting was with'
    }
    setFieldError(errs)

    // Mirrors add-meeting-dialog.tsx's `isPast` branch exactly: only an
    // already-happened meeting requires (and sends) explicit start/end times.
    let manual: { is_manual_entry: true; manual_start_time: string; manual_end_time: string } | Record<string, never> = {}
    let timesOk = true
    if (isPast) {
      const s = to24h(startTime)
      const e = to24h(endTime)
      const terrs: { start?: string; end?: string } = {}
      if (!s) terrs.start = 'Enter a start time'
      if (!e) terrs.end = 'Enter an end time'
      const sIso = s ? new Date(`${date}T${s}:00`).toISOString() : null
      const eIso = e ? new Date(`${date}T${e}:00`).toISOString() : null
      if (sIso && eIso && eIso <= sIso) terrs.end = 'End time must be after start time'
      setTimeError(terrs)
      if (Object.keys(terrs).length > 0 || !sIso || !eIso) timesOk = false
      else manual = { is_manual_entry: true, manual_start_time: sIso, manual_end_time: eIso }
    }
    if (Object.keys(errs).length > 0 || !timesOk) return

    const attendeesLink = attendees.payload.length > 0 ? { attendees: attendees.payload } : {}
    const dealLink = deal && dealCompanyId && canViewDeals ? { deal_id: deal.id } : {}
    let body: Record<string, unknown>
    if (creating) {
      const place = npPlace ? places.map.get(npPlace.id) : undefined
      const type = npType && npType.id !== NO_LEAD_TYPE ? npType.id : ''
      body = {
        ...manual,
        // Blank type: the company is created untyped and the meeting is 'Other'.
        visit_type: visitTypeForCompany(type),
        new_prospect: {
          name: npName.trim(),
          type: type || null,
          mobile_1: npMobile.trim() || null,
          state_id: place?.state_id ?? null,
          district_id: place?.district_id ?? null,
          taluka_id: place?.taluka_id ?? null,
          village_id: place?.village_id ?? null,
        },
      }
    } else if (selectedPersonId) {
      const person = peopleRows.find(c => c.id === selectedPersonId)
      const company = chosenPersonCompany
      body = {
        ...manual,
        ...attendeesLink,
        ...dealLink,
        visit_type: visitTypeForPerson(company),
        entity_id: company?.id ?? null,
        entity_name: personMeetingName(person?.name, company),
        contact_id: selectedPersonId,
        is_new_entity: false,
      }
    } else {
      const selected = entityRows.find(e => e.id === selectedCompanyId) ?? (presetEntity?.id === selectedCompanyId ? presetEntity : undefined)
      body = {
        ...manual,
        ...attendeesLink,
        ...dealLink,
        visit_type: visitTypeForCompany(selected?.type),
        entity_id: selectedCompanyId,
        entity_name: selected?.name ?? target?.label ?? '',
        contact_id: null,
        is_new_entity: false,
      }
    }

    setSaving(true)
    try {
      const r = await fetch('/api/daily-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          ...(planItemId ? { weekly_plan_item_id: planItemId } : {}),
          ...(followUpId ? { deal_follow_up_id: followUpId } : {}),
          visit_date: date,
        }),
      })
      if (!r.ok) {
        toast((await r.json().catch(() => ({}))).error ?? `Failed to log the ${isPast ? 'past ' : ''}meeting`, 'error')
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
      if (!isPast) {
        // A live meeting is created Pending, as on desktop — it has not
        // started yet. Land on it, where Start records the time and place;
        // "Next meeting?" is asked when it is stopped there.
        if (notesSaved) toast('Meeting logged', 'success')
        else toast('Meeting logged, but your notes were not saved. Add them again on the meeting.', 'error')
        router.replace(`/daily-activity/meeting/${created.id}`)
        return
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

  // Access: the screen's whole job is POST /api/daily-activity (meetings:create).
  if (meError && !me) {
    return <LoadError forbidden={false} what="this form" onRetry={retryMe} />
  }
  if (!me) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  if (canCreate === false) {
    return (
      <Banner variant="danger">
        <LockIcon />
        <BannerTitle>You don&apos;t have access to log meetings</BannerTitle>
        <BannerDescription>
          Only someone who can create meetings can log one. Ask an administrator to grant access.
        </BannerDescription>
      </Banner>
    )
  }

  const listsLoading = entities.state === 'loading' || people.state === 'loading'
  const noOwn = entityRows.length === 0 && peopleRows.length === 0
  const noLeadTypes = leadTypes.state === 'ready' && leadTypes.rows.length === 0

  return (
    <>
      <PhoneForm
        onSave={save}
        saving={saving}
        saveLabel={isPast ? 'Add past meeting' : 'Add meeting'}
        changed={changed}
        onDiscard={() => requestLeave(() => router.push('/today'))}
      >
        {date >= todayStr ? (
          <ChoiceRow
            control={<Switch checked={happened} onCheckedChange={v => { setHappened(Boolean(v)); setTimeError({}) }} />}
            label="This meeting already happened"
            description={
              isPast
                ? 'Its times are typed by hand, so it is saved as Manually Entered · Tentative with no location.'
                : 'Leave this off to time the meeting live and capture its location.'
            }
          />
        ) : null}

        {!creating ? (
          <>
            <PhoneFormField label="Who did you meet" required>
              {listsLoading ? (
                <Skeleton className="h-11 w-full" />
              ) : entities.state === 'error' ? (
                <div className="flex flex-col gap-2">
                  <InlineFieldError className="mt-0">Your accounts could not be loaded.</InlineFieldError>
                  <Button variant="secondary" type="button" onClick={() => setEntitiesReload(n => n + 1)}>Try again</Button>
                </div>
              ) : (
                <PickerSheetField
                  label="Who did you meet"
                  placeholder="Search an account or person"
                  value={target}
                  onChange={chooseTarget}
                  fetchOptions={fetchTargets}
                />
              )}
              {fieldError.target ? <p className="text-meta text-danger">{fieldError.target}</p> : null}
              {people.state === 'error' ? (
                <div className="flex flex-col gap-2">
                  <InlineFieldError className="mt-0">
                    The contacts could not be loaded, so only accounts are listed here. The meeting can still be logged against one.
                  </InlineFieldError>
                  <Button variant="secondary" type="button" onClick={() => setPeopleReload(n => n + 1)}>Retry</Button>
                </div>
              ) : !listsLoading && entities.state === 'ready' ? (
                <p className="text-meta text-text-muted">
                  {noOwn
                    ? 'You have no accounts of your own yet. Use New account to add the one you met.'
                    : peopleRows.length > 0
                      ? 'Pick your account, or the person you met.'
                      : 'Pick the account you met.'}
                </p>
              ) : null}
              <Button variant="secondary" type="button" className="w-full" onClick={() => { setMode('create'); setFieldError({}) }}>
                <PlusIcon />
                New account
              </Button>
            </PhoneFormField>

            {mustPickCompany ? (
              <PhoneFormField label="Which account?" required hint="This person is linked to more than one account, so the meeting has to say which one it was with.">
                <StaticPickerSheetField
                  label="Which account?"
                  placeholder="Select the account"
                  value={personCompany}
                  onChange={o => { setPersonCompany(o); setDeal(null); setFieldError({}) }}
                  options={personCompanies.map(c => ({ id: c.id, label: c.name }))}
                />
                {fieldError.company ? <p className="text-meta text-danger">{fieldError.company}</p> : null}
              </PhoneFormField>
            ) : null}

            {selectedPersonId && personCompanies.length === 0 && !individualMadeFor ? (
              <div className="flex flex-col gap-2 rounded-lg border border-border-light bg-surface-sunken p-3">
                <p className="text-meta text-text-muted">
                  This person is not linked to any account, so the meeting is logged against them alone. You can make them their own account instead.
                </p>
                <Button variant="secondary" type="button" onClick={makeIndividual} disabled={makingIndividual}>
                  {makingIndividual ? 'Creating…' : 'Make Individual account'}
                </Button>
              </div>
            ) : null}

            {resolvedCompanyId ? <PhoneAttendees attendees={attendees} /> : null}
          </>
        ) : (
          <div className="flex flex-col gap-4 rounded-lg border border-border-light p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-label font-medium text-text-primary">New account</p>
              <Button variant="ghost" size="sm" type="button" onClick={() => { setMode('target'); setFieldError({}) }}>
                <ArrowLeftIcon />
                Pick an existing account
              </Button>
            </div>
            <PhoneFormField label="Name" required>
              <Input
                className="max-w-none"
                value={npName}
                onChange={e => { setNpName(e.target.value); setFieldError({}) }}
                placeholder="Account name"
                autoComplete="off"
                enterKeyHint="next"
                aria-invalid={!!fieldError.name}
              />
              {fieldError.name ? <p className="text-meta text-danger">{fieldError.name}</p> : null}
            </PhoneFormField>
            <PhoneFormField label="Mobile">
              <Input
                className="max-w-none"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={npMobile}
                onChange={e => setNpMobile(e.target.value)}
                placeholder="10-digit number"
                enterKeyHint="done"
              />
            </PhoneFormField>
            <PhoneFormField label="Place">
              {places.state === 'error' ? (
                <div className="flex flex-col gap-2">
                  <InlineFieldError className="mt-0">The places could not be loaded.</InlineFieldError>
                  <Button variant="secondary" type="button" onClick={() => setPlacesReload(n => n + 1)}>Try again</Button>
                </div>
              ) : places.state !== 'ready' ? (
                <Skeleton className="h-11 w-full" />
              ) : (
                <PickerSheetField
                  label="Place"
                  placeholder="District, taluka or village"
                  value={npPlace}
                  onChange={setNpPlace}
                  fetchOptions={fetchPlaces}
                />
              )}
            </PhoneFormField>
            <PhoneFormField
              label="Account type"
              hint={
                noLeadTypes
                  ? 'Optional. No account types have been set up yet; an administrator can add them in Masters → Account types. Without one, the meeting is logged as Other.'
                  : 'Optional. Without one, the meeting is logged as Other.'
              }
            >
              {leadTypes.state === 'error' ? (
                <div className="flex flex-col gap-2">
                  <InlineFieldError className="mt-0">The account types could not be loaded.</InlineFieldError>
                  <Button variant="secondary" type="button" onClick={() => setLeadTypesReload(n => n + 1)}>Try again</Button>
                </div>
              ) : leadTypes.state === 'loading' ? (
                <Skeleton className="h-11 w-full" />
              ) : (
                <StaticPickerSheetField
                  label="Account type"
                  placeholder="Not set"
                  value={npType && npType.id !== NO_LEAD_TYPE ? npType : null}
                  onChange={setNpType}
                  options={leadTypeOptions}
                />
              )}
              {noLeadTypes && me.permissions?.lead_types?.view ? (
                <Link href="/masters/lead-types" className="text-meta text-primary underline underline-offset-2">
                  Masters → Account types
                </Link>
              ) : null}
            </PhoneFormField>
          </div>
        )}

        <PhoneFormField label="Date">
          <Input
            type="date"
            className="max-w-none"
            value={date}
            max={todayStr}
            onChange={e => { setDate(e.target.value); setTimeError({}) }}
          />
        </PhoneFormField>
        {isPast && (
          <>
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
            <p className="text-meta text-text-muted">These times are tentative — typed from memory, not captured live.</p>
          </>
        )}

        {canViewDeals && !creating && dealCompanyId ? (
          <PhoneFormField label="Opportunity">
            <PickerSheetField label="Opportunity" value={deal} onChange={setDeal} fetchOptions={fetchDeals} />
          </PhoneFormField>
        ) : null}

        <PhoneFormField label="What was discussed">
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={4}
            placeholder="Notes from the meeting"
          />
        </PhoneFormField>
      </PhoneForm>
      {warning}
    </>
  )
}
