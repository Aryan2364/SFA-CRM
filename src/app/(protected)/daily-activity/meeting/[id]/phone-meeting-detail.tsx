'use client'

/**
 * Inside a Meeting — phone (FRONTEND_RULES_PHONE.md §41.6, docs/phone-components.md).
 *
 * A trimmed read of the same `MeetingContext` the desktop page already loads:
 * the record's identity, up to four key facts, the contact (tappable for
 * Call/WhatsApp/Copy), the minutes in full, and the next meeting if one is
 * set. Writing a note goes through the same `/api/remarks` POST the desktop
 * `NotesSection` uses (snake_case body, `context_type: 'meeting'`), so a note
 * written here is identical to one written there.
 *
 * What a rep does during and right after the visit is here too, as sections in
 * the content (the bottom bar stays Add note / Start-Stop, section 41.6 rule 8):
 * who was there and the main person, the account's opportunities (stage,
 * discussed, new), the order taken at this visit, and past notes. Delete
 * lives in the three-dot menu. See components/daily-activity/phone-meeting-sections.tsx.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EllipsisVerticalIcon, MapPinIcon, PlayIcon, SendIcon, SquareIcon } from 'lucide-react'

import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { ActionBar } from '@/components/ui/action-bar'
import { RecordSummary } from '@/components/ui/record-summary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Textarea } from '@/components/ui/textarea'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { PhoneContactActionsSheet } from '@/components/ui/contact-actions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  PhoneMeetingAttendees,
  PhoneMeetingDeals,
  PhoneMeetingOrder,
  PhonePastNotes,
} from '@/components/daily-activity/phone-meeting-sections'
import { NextMeetingDialog } from '@/components/daily-activity/next-meeting-dialog'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import { formatDuration } from '@/components/daily-activity/types'
import { LocationCheckSheet, type LocationReading } from '@/components/daily-activity/location-check-sheet'
import { sendStartStop } from '@/components/daily-activity/start-stop'
import { whenLayersSettled } from '@/components/ui/sheet'
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/format'
import type { MeetingContext, MeetingDeal, Remark } from '@/components/meeting/types'

const REQUEST_TIMEOUT_MS = 15000

async function fetchWithDeadline(url: string, init?: RequestInit): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: abort.signal })
  } finally {
    clearTimeout(timer)
  }
}

type LoadState = 'loading' | 'ok' | 'not-found' | 'forbidden' | 'failed'

export function PhoneMeetingDetailPage({ visitId }: { visitId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const me = useMe()

  const [ctx, setCtx] = useState<MeetingContext | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [nextMeeting, setNextMeeting] = useState<{ due_date: string; deal_name: string | null } | null>(null)
  const [addNoteOpen, setAddNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [nextMeetingOpen, setNextMeetingOpen] = useState(false)
  // 'prompt' right after a Stop, as on desktop; 'manage' from the menu.
  const [nextMeetingMode, setNextMeetingMode] = useState<'prompt' | 'manage'>('manage')
  // Start and Stop each open the location check first (§41.16 rule 10):
  // the person sees where they are before it is saved.
  // The action outlives the open flag, so the sheet's title does not flip
  // while it slides away.
  const [locationOpen, setLocationOpen] = useState(false)
  const [locationFor, setLocationFor] = useState<'start' | 'stop'>('start')
  // The sheet's close is a step back in history. A dialog opened before that
  // step lands is the layer the step closes, leaving the sheet up — so the
  // prompt waits for the sheet to be shut and its close to settle.
  const [promptNext, setPromptNext] = useState(false)
  useEffect(() => {
    if (!promptNext || locationOpen) return
    let cancelled = false
    void whenLayersSettled().then(() => {
      if (cancelled) return
      setPromptNext(false)
      setNextMeetingMode('prompt')
      setNextMeetingOpen(true)
    })
    return () => { cancelled = true }
  }, [promptNext, locationOpen])
  // Delete: the menu item only asks; the confirmation opens once the menu has
  // closed, for the same reason as the prompt above.
  const [deleteAsked, setDeleteAsked] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    if (!deleteAsked) return
    let cancelled = false
    const timer = setTimeout(() => {
      void whenLayersSettled().then(() => {
        if (cancelled) return
        setDeleteAsked(false)
        setDeleteOpen(true)
      })
    }, 50)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [deleteAsked])
  // A failed load is its own state: empty would read as "no minutes yet" and
  // invite a duplicate note.
  const [minutesFailed, setMinutesFailed] = useState(false)
  const [minutesTry, setMinutesTry] = useState(0)
  const [nextFailed, setNextFailed] = useState(false)

  const load = useCallback(async () => {
    if (!visitId) return
    setState(prev => (prev === 'ok' ? prev : 'loading'))
    try {
      const r = await fetchWithDeadline(`/api/daily-activity/${visitId}`)
      if (r.status === 404) return setState('not-found')
      if (r.status === 403) return setState('forbidden')
      if (!r.ok) return setState('failed')
      setCtx((await r.json()) as MeetingContext)
      setState('ok')
    } catch {
      setState('failed')
    }
  }, [visitId])

  useEffect(() => {
    void load()
  }, [load])

  const loadNextMeeting = useCallback(async () => {
    if (!visitId) return
    try {
      const r = await fetchWithDeadline(`/api/daily-activity/${visitId}/next-meeting`)
      if (!r.ok) {
        setNextFailed(true)
        return
      }
      const d = await r.json()
      setNextMeeting(d.next_meeting ?? null)
      setNextFailed(false)
    } catch {
      /* Not fatal — the page still shows the meeting, with a retry row. */
      setNextFailed(true)
    }
  }, [visitId])

  useEffect(() => {
    void loadNextMeeting()
  }, [loadNextMeeting])

  /* Same two gates the desktop page checks (`ctx.can_write` for a shared,
     read-only meeting, plus `meetings.edit` for the role). Both the Add
     note sheet and Set next meeting re-check through the API regardless. */
  const canWriteMeeting = ctx?.can_write ?? false
  const canWriteNotes = canWriteMeeting && !!me?.permissions?.meetings?.edit
  /* Start/Stop, as desktop's visit card: someone else's meeting offers no
     toggle at all (a manager reads the team's day, and the route only starts
     the caller's own), and the role's meetings.edit — the action PATCH
     checks — disables it with a reason. null = /me not answered yet. */
  const mine = ctx && me ? ctx.visit.user_id === me.userId : null
  const canStartStop = me ? canWriteMeeting && !!me.permissions?.meetings?.edit : null
  /* Each control below is gated on the exact permission its route checks
     (null = /me not answered yet, so disabled with no reason):
       attendees PATCH  meetings.edit (+ own scope)    -> canWriteNotes
       stage PATCH      deals.edit      mark discussed  deals.view + meetings.edit
       POST /api/deals  deals.create    POST /api/orders orders.create
       history GET      meetings.view   delete action   meetings.delete */
  const perm = (allowed: boolean | undefined) => (me ? !!allowed : null)
  const canEditAttendees: boolean | null = me ? canWriteNotes : null
  const canMarkDiscussed = canWriteNotes && !!me?.permissions?.deals?.view
  const canDeleteMeeting: boolean | null = perm(me?.permissions?.meetings?.delete)
  const canViewHistory: boolean | null = perm(me?.permissions?.meetings?.view)
  const elapsed = useElapsed(ctx?.visit.status === 'Active' ? ctx.visit.start_time : null)

  /* Desktop's handleStart/handleStop, after the person has confirmed the
     place: a refusal never gets this far (the sheet holds it), and a phone
     that cannot find itself proceeds with no place, as desktop does. */
  async function startOrStop(action: 'start' | 'stop', reading: LocationReading | null): Promise<boolean> {
    if (!ctx) return false
    const error = await sendStartStop(ctx.visit.id, action, reading)
    if (error) {
      toast(error, 'error')
      // "Another meeting is already active" — the page may be stale.
      void load()
      return false
    }
    await load()
    if (action === 'start') {
      toast('Meeting started', 'success')
    } else {
      // The "Next meeting?" prompt, right after a successful stop — asked
      // once the location sheet has closed (the effect below).
      setPromptNext(true)
    }
    return true
  }

  function replaceDeal(updated: MeetingDeal) {
    setCtx(prev => (prev ? { ...prev, deals: prev.deals.map(d => (d.id === updated.id ? updated : d)) } : prev))
  }

  function setDiscussed(dealId: string, discussed: boolean) {
    setCtx(prev => {
      if (!prev) return prev
      const ids = prev.discussed_deal_ids.filter(id => id !== dealId)
      return { ...prev, discussed_deal_ids: discussed ? [...ids, dealId] : ids }
    })
  }

  /* Desktop's rule for the delete button: your own meeting, not yet started. */
  const canOfferDelete = !!ctx && mine === true && ctx.visit.status === 'Pending'

  async function confirmDelete() {
    if (!ctx || deleting) return
    setDeleting(true)
    try {
      const r = await fetchWithDeadline(`/api/daily-activity/${ctx.visit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete' }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        toast(err.error ?? 'Failed to delete the meeting', 'error')
        setDeleting(false)
        return
      }
      toast('Meeting deleted')
      router.replace('/today')
    } catch {
      toast('The connection dropped. The meeting was not deleted.', 'error')
      setDeleting(false)
    }
  }

  usePhoneAppBar({
    title: ctx?.company?.name ?? ctx?.visit.entity_name ?? 'Meeting',
    back: '/today',
    menu: ctx ? (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="More actions"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg active:bg-white/10"
            />
          }
        >
          <EllipsisVerticalIcon aria-hidden className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {ctx.company && ctx.company.can_open !== false ? (
            <DropdownMenuItem
              className="h-11"
              onClick={() => router.push(`/parties/companies/${ctx.company!.id}`)}
            >
              Open account
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="h-11"
            disabled={!canWriteMeeting}
            onClick={() => {
              setNextMeetingMode('manage')
              setNextMeetingOpen(true)
            }}
          >
            {nextMeeting ? 'Change next meeting' : 'Set next meeting'}
          </DropdownMenuItem>
          {canOfferDelete ? (
            <PermissionTooltip
              allowed={canDeleteMeeting === null ? undefined : canDeleteMeeting}
              reason="Only someone who can delete meetings can delete one."
            >
              <DropdownMenuItem
                className="h-11 text-danger"
                disabled={canDeleteMeeting !== true}
                onClick={() => setDeleteAsked(true)}
              >
                Delete meeting
              </DropdownMenuItem>
            </PermissionTooltip>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : undefined,
  })

  async function sendNote() {
    const text = note.trim()
    if (!text || !ctx) return
    setSaving(true)
    try {
      const r = await fetchWithDeadline('/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_type: 'meeting',
          context_id: ctx.visit.id,
          body: text,
        }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        toast(err.error ?? 'Could not save that note', 'error')
        return
      }
      const created = (await r.json()) as Remark
      setMinutesInPlace(created)
      setNote('')
      setAddNoteOpen(false)
      toast('Minutes saved')
    } catch {
      toast('The connection dropped. The note was not saved.', 'error')
    } finally {
      setSaving(false)
    }
  }

  function setMinutesInPlace(remark: Remark) {
    setMinutes(prev => [...prev, remark])
  }

  const [minutes, setMinutes] = useState<Remark[]>([])

  // The thread for "this meeting" only — same endpoint as desktop's
  // NotesSection, loaded once the meeting itself has resolved.
  useEffect(() => {
    if (!ctx) return
    let cancelled = false
    setMinutesFailed(false)
    fetchWithDeadline(`/api/remarks?contextType=meeting&contextId=${ctx.visit.id}`)
      .then(async r => {
        if (cancelled) return
        const data = r.ok ? await r.json() : null
        if (cancelled) return
        if (Array.isArray(data)) setMinutes(data)
        else setMinutesFailed(true)
      })
      .catch(() => {
        if (!cancelled) setMinutesFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [ctx, minutesTry])

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-7 w-2/3 animate-pulse rounded bg-surface-sunken" />
        <div className="h-20 animate-pulse rounded bg-surface-sunken" />
        <div className="h-40 animate-pulse rounded bg-surface-sunken" />
      </div>
    )
  }

  if (state !== 'ok' || !ctx) {
    const heading =
      state === 'not-found'
        ? 'Meeting not found'
        : state === 'forbidden'
          ? 'You cannot open this meeting'
          : 'This meeting could not be loaded'
    const body =
      state === 'not-found'
        ? 'It may have been deleted, or it belongs to someone outside your access.'
        : state === 'forbidden'
          ? 'Your role does not include viewing meetings.'
          : 'Something went wrong reading it. Try again, or go back to Today.'
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-body font-medium text-text-primary">{heading}</p>
        <p className="text-body text-text-secondary">{body}</p>
        {state === 'failed' ? (
          <button type="button" onClick={() => void load()} className="text-body text-primary">
            Try again
          </button>
        ) : (
          <button type="button" onClick={() => router.push('/today')} className="text-body text-primary">
            Back to Today
          </button>
        )}
      </div>
    )
  }

  const { visit, company } = ctx
  const day = visit.visit_date.slice(0, 10)
  const openDeal = ctx.deals[0] ?? null
  const contactPhone = company?.mobile_1 ?? null

  return (
    <div className="flex flex-col gap-6">
      <RecordSummary
        name={company?.name ?? visit.entity_name}
        badges={
          <>
            <Badge
              variant={
                visit.status === 'Active'
                  ? 'warning'
                  : visit.status === 'Completed'
                    ? 'success'
                    : 'neutral'
              }
            >
              {visit.status}
            </Badge>
            {visit.location_flagged ? (
              <Badge variant="warning" className="gap-1">
                <MapPinIcon className="size-3" />
                Location differs
              </Badge>
            ) : null}
            {!canWriteMeeting ? <Badge variant="neutral">Shared with you: view only</Badge> : null}
          </>
        }
        meta={visit.users?.name ?? undefined}
        facts={[
          {
            label: 'Date & time',
            value: `${fmtDate(day)}${visit.start_time ? ` · ${fmtTime(visit.start_time)}` : ''}${
              visit.status === 'Active'
                ? ` · ${formatDuration(elapsed)} so far`
                : visit.duration_secs
                  ? ` · ${formatDuration(visit.duration_secs)}`
                  : ''
            }`,
          },
          { label: 'Visit type', value: visit.visit_type },
          { label: 'Status', value: visit.status },
          {
            label: 'Opportunity',
            value: openDeal ? (
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => router.push(`/deals/${openDeal.id}`)}
              >
                {openDeal.name}
              </button>
            ) : null,
          },
        ]}
      />

      {/* Where the meeting was started and stopped — recorded by the taps on
          Start and Stop below, never tracked in between. */}
      {visit.address || visit.end_address ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border-light bg-surface px-3 py-2">
          {visit.address ? (
            <div>
              <p className="text-label text-text-secondary">Started at</p>
              <p className="text-body text-text-primary">{visit.address}</p>
            </div>
          ) : null}
          {visit.end_address ? (
            <div>
              <p className="text-label text-text-secondary">Ended at</p>
              <p className="text-body text-text-primary">{visit.end_address}</p>
              {visit.location_flagged ? (
                <p className="text-meta text-text-secondary">
                  Further from the start than your company allows. Noted for review only.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : mine && visit.status === 'Pending' ? (
        <p className="text-body text-text-secondary">
          To record where this meeting happens, allow location when you tap Start meeting.
        </p>
      ) : null}

      {contactPhone ? (
        <button
          type="button"
          onClick={() => setContactOpen(true)}
          className="flex min-h-11 items-center justify-between rounded-lg border border-border-light bg-surface px-3 py-2 text-left active:bg-surface-control"
        >
          <div className="min-w-0">
            <p className="text-label text-text-secondary">Contact</p>
            <p className="text-body text-text-primary">{contactPhone}</p>
          </div>
        </button>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="text-label text-text-secondary">Minutes of the meeting</p>
        {visit.notes?.trim() ? (
          <p className="whitespace-pre-wrap rounded-lg bg-surface-sunken p-3 text-body text-text-primary">
            {visit.notes.trim()}
          </p>
        ) : null}
        {minutesFailed ? (
          <div className="flex flex-col items-start gap-2 rounded-lg bg-surface-sunken p-3">
            <p className="text-body text-text-primary">Couldn&apos;t load the notes for this meeting.</p>
            <Button variant="secondary" size="sm" onClick={() => setMinutesTry(n => n + 1)}>
              Retry
            </Button>
          </div>
        ) : minutes.length === 0 && !visit.notes?.trim() ? (
          <p className="rounded-lg bg-surface-sunken p-3 text-center text-body text-text-secondary">
            No minutes yet. Write what was discussed — during the meeting or after it.
          </p>
        ) : (
          <ul className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-3">
            {minutes.map(m => (
              <li key={m.id} className="text-body text-text-primary">
                <p className="text-label text-text-secondary">
                  {m.users?.name ?? 'Unknown'} · {fmtDateTime(m.created_at)}
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PhonePastNotes visitId={visit.id} canView={canViewHistory} />

      <PhoneMeetingAttendees visitId={visit.id} companyId={company?.id ?? null} canEdit={canEditAttendees} />

      <PhoneMeetingDeals
        visitId={visit.id}
        company={company}
        companyName={company?.name ?? visit.entity_name}
        deals={ctx.deals}
        openDealCount={ctx.open_deal_count}
        discussedIds={ctx.discussed_deal_ids}
        visible={ctx.deals_visible}
        canEditDeals={perm(me?.permissions?.deals?.edit)}
        canCreateDeal={perm(me?.permissions?.deals?.create)}
        canMarkDiscussed={canMarkDiscussed}
        canWriteMeeting={canWriteMeeting}
        onDealChanged={replaceDeal}
        onDiscussedChanged={setDiscussed}
        onReload={() => void load()}
      />

      <PhoneMeetingOrder
        visitId={visit.id}
        company={company}
        companyName={company?.name ?? visit.entity_name}
        visible={ctx.orders_visible}
        visitOrder={ctx.visit_order}
        orderCount={ctx.order_count}
        canCreateOrder={perm(me?.permissions?.orders?.create)}
        canWriteMeeting={canWriteMeeting}
      />

      {nextFailed && !nextMeeting ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-surface px-3 py-2">
          <p className="text-body text-text-primary">Couldn&apos;t load the next meeting.</p>
          <Button variant="secondary" size="sm" onClick={() => void loadNextMeeting()}>
            Retry
          </Button>
        </div>
      ) : null}

      {nextMeeting ? (
        <div className="rounded-lg border border-border-light bg-surface px-3 py-2">
          <p className="text-label text-text-secondary">Next meeting</p>
          <p className="text-body text-text-primary">
            {fmtDate(nextMeeting.due_date)}
            {nextMeeting.deal_name ? ` · ${nextMeeting.deal_name}` : ''}
          </p>
        </div>
      ) : null}

      <ActionBar>
        <PermissionTooltip
          allowed={canWriteNotes}
          reason={!canWriteMeeting ? 'This meeting is shared with you to view only.' : 'Only people allowed to edit meetings can do this.'}
        >
          <Button
            className="w-full"
            variant={mine && visit.status !== 'Completed' ? 'secondary' : 'primary'}
            disabled={!canWriteNotes || minutesFailed}
            onClick={() => setAddNoteOpen(true)}
          >
            Add note
          </Button>
        </PermissionTooltip>
        {/* ONE button that reads Start and turns into Stop (§5.4): same
            node, so the colour change animates instead of snapping. A
            finished meeting has no toggle left to offer. */}
        {mine && visit.status !== 'Completed' ? (
          <PermissionTooltip
            allowed={canStartStop ?? undefined}
            reason={
              !canWriteMeeting
                ? 'This meeting is shared with you to view only.'
                : 'Only people allowed to edit meetings can do this.'
            }
          >
            <Button
              className="w-full duration-200"
              variant={visit.status === 'Active' ? 'danger' : 'primary'}
              disabled={canStartStop !== true}
              onClick={() => {
                setLocationFor(visit.status === 'Active' ? 'stop' : 'start')
                setLocationOpen(true)
              }}
            >
              {visit.status === 'Active' ? <SquareIcon /> : <PlayIcon />}
              {visit.status === 'Active' ? 'Stop meeting' : 'Start meeting'}
            </Button>
          </PermissionTooltip>
        ) : null}
      </ActionBar>

      <LocationCheckSheet
        open={locationOpen}
        onOpenChange={setLocationOpen}
        title={locationFor === 'stop' ? 'Stop meeting here?' : 'Start meeting here?'}
        confirmLabel={locationFor === 'stop' ? 'Stop meeting' : 'Start meeting'}
        busyLabel={locationFor === 'stop' ? 'Stopping…' : 'Starting…'}
        requireLocation={false}
        onConfirm={reading => startOrStop(locationFor, reading)}
      />

      <BottomSheet
        open={addNoteOpen}
        onOpenChange={o => {
          setAddNoteOpen(o)
          if (!o) setNote('')
        }}
        title="Add note"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddNoteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void sendNote()} disabled={saving || !note.trim()}>
              <SendIcon />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <Textarea
          autoFocus
          className="min-h-28 text-base"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="What was discussed?"
          aria-label="Note"
        />
      </BottomSheet>

      {contactPhone ? (
        <PhoneContactActionsSheet open={contactOpen} onOpenChange={setContactOpen} phone={contactPhone} />
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={o => { if (!o && !deleting) setDeleteOpen(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              {visit.entity_name} will be removed from your day. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={e => { e.preventDefault(); void confirmDelete() }}
            >
              {deleting ? 'Deleting…' : 'Delete meeting'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {nextMeetingOpen ? (
        <NextMeetingDialog
          visitId={visit.id}
          mode={nextMeetingMode}
          onClose={() => setNextMeetingOpen(false)}
          onSaved={loadNextMeeting}
        />
      ) : null}
    </div>
  )
}

/** Seconds since `startTime`, ticking once a second; 0 when there is none. */
function useElapsed(startTime: string | null | undefined): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!startTime) {
      setElapsed(0)
      return
    }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [startTime])
  return elapsed
}
