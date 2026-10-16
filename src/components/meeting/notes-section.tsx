'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { HistoryIcon, LinkIcon, SendIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadError } from '@/components/ui/load-error'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
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
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { formatDuration } from '@/components/daily-activity/types'
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { NOTE_CONTEXT, type NoteTarget, type Remark } from './types'

/**
 * §5.5 — **Minutes of the Meeting**, and the note that can be linked to a
 * specific Deal or Order.
 *
 * Those read as two features and are one control. A note is always written the
 * same way; the "File under" picker decides which thread it joins, and the
 * thread below it swaps to match. Making them two boxes would mean the user
 * deciding, before typing, which of two identical text areas they wanted.
 *
 * ---------------------------------------------------------------------------
 * NO NEW TABLE, AND NO `daily_visits.notes`
 *
 * Minutes go in `contextual_remarks` under `context_type = 'meeting'`. That is
 * already a tenant-scoped, timestamped, authored, threaded note with read
 * tracking; `daily_visits.notes` is a single unattributed text column that the
 * next person to save overwrites, which is not what "notes on what was
 * discussed" during and after a meeting means.
 *
 * The Daily Activity card used to write that column from a Notes box of its
 * own, so one meeting had two records of what was discussed and neither screen
 * showed the other's. That box is gone — the card's Minutes button opens this
 * same thread — and nothing writes the column any more. A meeting that still
 * carries text there shows it read-only at the top of its minutes
 * (`earlierNote`), so no note written before the change is hidden.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ THE TWO HALVES OF `/api/remarks` TAKE DIFFERENT SPELLINGS
 *
 *   GET   query string, camelCase:  ?contextType=meeting&contextId=…
 *   POST  JSON body,   snake_case:  {"context_type":"meeting", …}
 *
 * This is deliberate and documented in `src/app/api/remarks/_access.ts` — each
 * half kept the convention its own side already had, because aligning them
 * would break a live caller. Sending the wrong casing returns a message about
 * `contextType`, which READS LIKE A BAD VALUE and sends you looking at the
 * wrong thing. Both spellings below are correct; do not "tidy" either.
 */
export function NotesSection({
  visitId,
  targets,
  canWrite,
  earlierNote,
  canViewHistory,
}: {
  visitId: string
  /** "This meeting" first, then each open Deal, then each recent Order. */
  targets: NoteTarget[]
  canWrite: boolean
  /** `daily_visits.notes`, read-only. See the header. */
  earlierNote?: string | null
  /** Three-state: `null` while `useMe()` hasn't resolved — see the page. */
  canViewHistory: boolean | null
}) {
  const { toast } = useToast()
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '')
  const [remarks, setRemarks] = useState<Remark[] | null>(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  /*
   * A target that disappears — an order deleted, a deal closed in another tab —
   * would otherwise leave the picker showing a blank value and every request
   * 404ing. Falling back to the meeting is the one target that always exists.
   */
  const target = targets.find(t => t.id === targetId) ?? targets[0]

  const options = Object.fromEntries(
    targets.map(t => [
      t.id,
      t.kind === 'meeting' ? t.label : `${t.kind === 'deal' ? 'Opportunity' : 'Order'} · ${t.label}`,
    ])
  )

  const load = useCallback(async () => {
    if (!target) return
    setRemarks(null)
    const contextType = NOTE_CONTEXT[target.kind]
    const r = await fetch(
      `/api/remarks?contextType=${contextType}&contextId=${target.id}`
    )
    if (!r.ok) {
      setRemarks([])
      toast('Could not load the notes on this', 'error')
      return
    }
    const data = await r.json()
    setRemarks(Array.isArray(data) ? data : [])
  }, [target, toast])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * A new note scrolls THE THREAD BOX, never the page. Driving `scrollTop` on
   * the container that actually overflows keeps the composer under the user's
   * thumb where they left it; `scrollIntoView` would jump the whole screen and
   * throw away their position in the Deals and Orders below.
   */
  useEffect(() => {
    const box = threadRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [remarks])

  async function send() {
    const text = body.trim()
    if (!text || !target) return
    setSending(true)
    const r = await fetch('/api/remarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // snake_case. See the warning above.
      body: JSON.stringify({
        context_type: NOTE_CONTEXT[target.kind],
        context_id: target.id,
        body: text,
      }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      toast(err.error ?? 'Could not save that note', 'error')
      setSending(false)
      return
    }
    const created: Remark = await r.json()
    // Appended in place rather than re-fetching the thread: the existing rows
    // keep their identity, so nothing the user is reading is torn down and
    // rebuilt underneath them.
    setRemarks(prev => [...(prev ?? []), created])
    setBody('')
    setSending(false)
    toast(target.kind === 'meeting' ? 'Minutes saved' : `Note linked to ${target.label}`)
  }

  const linked = target && target.kind !== 'meeting'
  const earlier = target?.kind === 'meeting' ? earlierNote?.trim() || null : null

  async function saveEdit(id: string, newBody: string) {
    const r = await fetch(`/api/remarks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: newBody }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      toast(err.error ?? 'Could not save that note', 'error')
      return false
    }
    const updated: Remark = await r.json()
    setRemarks(prev => (prev ?? []).map(r2 => (r2.id === id ? { ...r2, ...updated } : r2)))
    return true
  }

  async function deleteRemark(id: string) {
    const r = await fetch(`/api/remarks/${id}`, { method: 'DELETE' })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      toast(err.error ?? 'Could not delete that note', 'error')
      return
    }
    setRemarks(prev => (prev ?? []).filter(r2 => r2.id !== id))
    toast('Entry deleted')
  }

  return (
    <Card>
      {/* Stacked at every width, never side by side: on desktop this card
          lives in a one-third column, where a 256px picker beside the title
          squeezed "Minutes of the meeting" onto three lines. The picker
          takes the row under the title instead. */}
      <CardHeader className="flex-col items-stretch gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 whitespace-nowrap">
            Minutes of the meeting
            {linked ? (
              <Badge variant="primary" className="gap-1">
                <LinkIcon className="size-3" />
                {target.kind === 'deal' ? 'Opportunity' : 'Order'}
              </Badge>
            ) : null}
          </CardTitle>
          <PastNotesButton visitId={visitId} canView={canViewHistory} />
        </div>
        {targets.length > 1 ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-label text-text-secondary">File under</span>
            {/* SearchableSelect: the list is the meeting plus every open Deal
                plus every recent Order, which passes six on any busy party
                (§16.3). It has no groups, so the KIND is carried in each
                label — "Deal · …" — rather than in a heading above it. */}
            <SearchableSelect
              className="min-w-0 flex-1"
              options={options}
              value={target?.id ?? ''}
              onValueChange={setTargetId}
              searchPlaceholder="Search opportunities and orders"
            />
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div
          ref={threadRef}
          className="max-h-72 min-h-24 overflow-y-auto rounded-lg border border-border-light bg-surface-sunken p-3"
        >
          {remarks === null ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : remarks.length === 0 && !earlier ? (
            /* Section 13: a real empty state, and one that says what to do
               next rather than the words "No data". */
            <p className="py-4 text-center text-body text-text-secondary">
              {target?.kind === 'meeting'
                ? 'No minutes yet. Write what was discussed — during the meeting or after it.'
                : `No notes on ${target?.label} yet.`}
            </p>
          ) : (
            <ul className="space-y-3">
              {earlier ? (
                <li className="text-body text-text-primary">
                  <p className="text-label text-text-secondary">Earlier note</p>
                  <p className="whitespace-pre-wrap">{earlier}</p>
                </li>
              ) : null}
              {remarks.map(remark => (
                <NoteItem
                  key={remark.id}
                  remark={remark}
                  isMeeting={target?.kind === 'meeting'}
                  onSave={saveEdit}
                  onDelete={deleteRemark}
                />
              ))}
            </ul>
          )}
        </div>

        {canWrite ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              className="min-h-20 flex-1 text-base sm:text-body"
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={
                target?.kind === 'meeting'
                  ? 'What was discussed?'
                  : `A note about ${target?.label}`
              }
              aria-label="Note"
            />
            <Button
              className="w-full sm:w-auto"
              onClick={send}
              disabled={sending || !body.trim()}
            >
              <SendIcon />
              {sending ? 'Saving…' : 'Save note'}
            </Button>
          </div>
        ) : (
          /* Only a permitted action is shown. A composer that always 403s is
             worse than no composer, because it looks like a bug in the app. */
          <p className="text-label text-text-secondary">
            You can read these notes but not add to them.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * One entry in the thread. Edit/delete only render for the meeting's own
 * minutes (`isMeeting`), for the author's own entries (`remark.can_edit`) —
 * Deal and Order notes are untouched.
 */
function NoteItem({
  remark,
  isMeeting,
  onSave,
  onDelete,
}: {
  remark: Remark
  isMeeting: boolean
  onSave: (id: string, body: string) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(remark.body)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const showControls = isMeeting && remark.can_edit

  async function save() {
    if (!draft.trim()) return
    setSaving(true)
    const ok = await onSave(remark.id, draft.trim())
    setSaving(false)
    if (ok) setEditing(false)
  }

  return (
    <li className="text-body text-text-primary">
      <p className="text-label text-text-secondary">
        {remark.users?.name ?? 'Unknown'} · {fmtDateTime(remark.created_at)}
        {remark.edited ? ' · edited' : ''}
      </p>
      {editing ? (
        <div className="mt-1 flex flex-col gap-2">
          <Textarea
            autoFocus
            className="min-h-16 text-base sm:text-body"
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving || !draft.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setEditing(false); setDraft(remark.body) }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap">{remark.body}</p>
          {showControls ? (
            <div className="mt-1 flex items-center gap-3">
              <button
                onClick={() => setEditing(true)}
                className="text-label text-text-muted transition hover:text-primary"
              >
                Edit
              </button>
              <PermissionTooltip
                allowed={!!remark.can_delete}
                reason="Entries can only be deleted on the day they were written."
              >
                <button
                  onClick={() => remark.can_delete && setConfirmOpen(true)}
                  disabled={!remark.can_delete}
                  className="text-label text-text-muted transition hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                >
                  Delete
                </button>
              </PermissionTooltip>
            </div>
          ) : null}
        </>
      )}

      {showControls ? (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
              <AlertDialogDescription>
                This remark will be permanently removed. This can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  setConfirmOpen(false)
                  await onDelete(remark.id)
                }}
              >
                Delete entry
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </li>
  )
}

/** Earlier meetings per page — matches the route's own `PAGE_SIZE`. */
const PAST_NOTES_PAGE_SIZE = 5
/** Kit §14 rule 4: every request carries a deadline. */
const TIMEOUT_MS = 15_000

type PastMinute = { id: string; body: string; created_at: string; author: string | null }

type PastMeeting = {
  id: string
  visit_date: string
  start_time: string | null
  duration_secs: number | null
  status: 'Pending' | 'Active' | 'Completed'
  is_manual_entry: boolean
  held_by: string | null
  main_attendee: string | null
  earlier_note: string | null
  minutes: PastMinute[]
  can_open: boolean
}

type PastHistory = { total: number; items: PastMeeting[]; next_offset: number | null }

/**
 * "Past notes (N)" — replaces the old standalone "Previous meetings" section
 * (Aryan, 2026-10-16). Living in the Minutes header keeps it next to what it
 * is a history OF, instead of a separate card the eye has to find; opening it
 * is a side panel rather than an always-expanded block, since most visits to
 * this page are not about reading the back-catalogue.
 *
 * The count loads eagerly so the button's label is right before anyone
 * clicks it; the panel reuses that first page and only re-fetches to go
 * older. See `GET /api/daily-activity/[id]/history` for who matches and why.
 */
function PastNotesButton({ visitId, canView }: { visitId: string; canView: boolean | null }) {
  const { toast } = useToast()
  const [history, setHistory] = useState<PastHistory | null>(null)
  const [failed, setFailed] = useState<false | 'error' | 'forbidden'>(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [open, setOpen] = useState(false)

  const fetchPage = useCallback(
    async (offset: number): Promise<PastHistory> => {
      const r = await fetch(`/api/daily-activity/${visitId}/history?offset=${offset}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (r.status === 403) throw new Error('forbidden')
      if (!r.ok) throw new Error('failed')
      return r.json()
    },
    [visitId]
  )

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const page = await fetchPage(0)
      setHistory(page)
    } catch (err) {
      setFailed(err instanceof Error && err.message === 'forbidden' ? 'forbidden' : 'error')
    }
  }, [fetchPage])

  // Loaded once the gate resolves to allowed, so a `canView === false` or
  // `null` viewer never fires the request at all.
  useEffect(() => {
    if (canView) void load()
  }, [canView, load])

  async function loadOlder() {
    if (!history || history.next_offset === null) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(history.next_offset)
      setHistory(prev =>
        prev
          ? { ...page, items: [...prev.items, ...page.items.filter(p => !prev.items.some(i => i.id === p.id))] }
          : page
      )
    } catch {
      toast('Could not load older meetings. Try again.', 'error')
    }
    setLoadingMore(false)
  }

  const count = history?.total ?? 0

  return (
    <>
      <PermissionTooltip
        allowed={canView !== false}
        reason="Only someone who can view meetings may see past notes."
      >
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOpen(true)}
          disabled={!canView || failed === 'forbidden'}
        >
          <HistoryIcon />
          Past notes {history ? `(${count})` : ''}
        </Button>
      </PermissionTooltip>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border-light">
            <SheetTitle>Past notes {history ? `(${count})` : ''}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4">
            {failed ? (
              <LoadError forbidden={failed === 'forbidden'} what="past notes" onRetry={load} />
            ) : history === null ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : history.items.length === 0 ? (
              <p className="py-4 text-center text-body text-text-secondary">No meetings exist yet.</p>
            ) : (
              <>
                <ul className="flex flex-col divide-y divide-border-light">
                  {history.items.map(m => (
                    <PastMeetingRow key={m.id} meeting={m} />
                  ))}
                </ul>
                {history.next_offset !== null ? (
                  <Button
                    variant="secondary"
                    className="mt-3 min-h-11 w-full sm:min-h-0"
                    onClick={loadOlder}
                    disabled={loadingMore}
                  >
                    {loadingMore
                      ? 'Loading…'
                      : `Show older (${history.total - history.items.length} more)`}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function PastMeetingRow({ meeting: m }: { meeting: PastMeeting }) {
  const nothingWritten = m.minutes.length === 0 && !m.earlier_note

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-body font-medium text-text-primary">
            {fmtDate(m.visit_date)}
            {m.start_time ? ` · ${fmtTime(m.start_time)}` : ''}
          </p>
          <p className="text-label text-text-secondary">
            {m.held_by ?? 'Unknown'}
            {m.main_attendee ? ` · with ${m.main_attendee}` : ''}
            {m.duration_secs ? ` · ${formatDuration(m.duration_secs)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {m.is_manual_entry ? (
            <Badge variant="warning" className="gap-1">
              <HistoryIcon className="size-3" />
              Entered by hand
            </Badge>
          ) : null}
          {m.status !== 'Completed' ? <Badge variant="neutral">{m.status}</Badge> : null}
          {/* Only a meeting the viewer may open is linked; the others would
              404 on their own page. */}
          {m.can_open ? (
            <Link
              href={`/daily-activity/meeting/${m.id}`}
              className={cn(
                'inline-flex min-h-11 items-center rounded-lg text-label text-primary-text hover:underline sm:min-h-0',
                'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring'
              )}
            >
              Open meeting
            </Link>
          ) : null}
        </div>
      </div>

      {nothingWritten ? (
        <p className="text-body text-text-muted">No minutes were written at this meeting.</p>
      ) : (
        <ul className="space-y-3 rounded-lg bg-surface-sunken p-3">
          {m.earlier_note ? (
            <li className="text-body text-text-primary">
              <p className="text-label text-text-secondary">Earlier note</p>
              <p className="whitespace-pre-wrap">{m.earlier_note}</p>
            </li>
          ) : null}
          {m.minutes.map(minute => (
            <li key={minute.id} className="text-body text-text-primary">
              <p className="text-label text-text-secondary">
                {minute.author ?? 'Unknown'} · {fmtDateTime(minute.created_at)}
              </p>
              <p className="whitespace-pre-wrap">{minute.body}</p>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
