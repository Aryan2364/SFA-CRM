'use client'

/**
 * Inside a Meeting — phone (FRONTEND_RULES_PHONE.md §41.6, docs/phone-components.md).
 *
 * A trimmed read of the same `MeetingContext` the desktop page already loads:
 * the record's identity, up to four key facts, the contact (tappable for
 * Call/WhatsApp/Copy), the minutes in full, and the next meeting if one is
 * set. Writing a note goes through the same `/api/remarks` POST the desktop
 * `NotesSection` uses (snake_case body, `context_type: 'meeting'`), so a note
 * written here is identical to one written there. Deals/Orders drill-down is
 * deliberately not built here — this screen is the record and its minutes;
 * the opportunity link is the one way across, via its own phone detail page.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EllipsisVerticalIcon, SendIcon } from 'lucide-react'

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
import { NextMeetingDialog } from '@/components/daily-activity/next-meeting-dialog'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import { formatDuration } from '@/components/daily-activity/types'
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/format'
import type { MeetingContext, Remark } from '@/components/meeting/types'

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
            onClick={() => setNextMeetingOpen(true)}
          >
            {nextMeeting ? 'Change next meeting' : 'Set next meeting'}
          </DropdownMenuItem>
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
            {!canWriteMeeting ? <Badge variant="neutral">Shared with you: view only</Badge> : null}
          </>
        }
        meta={visit.users?.name ?? undefined}
        facts={[
          {
            label: 'Date & time',
            value: `${fmtDate(day)}${visit.start_time ? ` · ${fmtTime(visit.start_time)}` : ''}${
              visit.duration_secs ? ` · ${formatDuration(visit.duration_secs)}` : ''
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
          reason={!canWriteMeeting ? 'This meeting is shared with you to view only.' : 'Only someone who can edit meetings can add minutes.'}
        >
          <Button className="w-full" disabled={!canWriteNotes || minutesFailed} onClick={() => setAddNoteOpen(true)}>
            Add note
          </Button>
        </PermissionTooltip>
      </ActionBar>

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

      {nextMeetingOpen ? (
        <NextMeetingDialog
          visitId={visit.id}
          mode="manage"
          onClose={() => setNextMeetingOpen(false)}
          onSaved={loadNextMeeting}
        />
      ) : null}
    </div>
  )
}
