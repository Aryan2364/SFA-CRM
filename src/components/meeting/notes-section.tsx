'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LinkIcon, SendIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { fmtDateTime } from '@/lib/format'
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
  targets,
  canWrite,
}: {
  /** "This meeting" first, then each open Deal, then each recent Order. */
  targets: NoteTarget[]
  canWrite: boolean
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
      t.kind === 'meeting' ? t.label : `${t.kind === 'deal' ? 'Deal' : 'Order'} · ${t.label}`,
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

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <CardTitle className="flex items-center gap-2">
          Minutes of the meeting
          {linked ? (
            <Badge variant="primary" className="gap-1">
              <LinkIcon className="size-3" />
              {target.kind === 'deal' ? 'Deal' : 'Order'}
            </Badge>
          ) : null}
        </CardTitle>
        {targets.length > 1 ? (
          <div className="flex items-center gap-2 sm:justify-end">
            <span className="shrink-0 text-label text-text-secondary">File under</span>
            {/* SearchableSelect: the list is the meeting plus every open Deal
                plus every recent Order, which passes six on any busy party
                (§16.3). It has no groups, so the KIND is carried in each
                label — "Deal · …" — rather than in a heading above it. */}
            <SearchableSelect
              className="w-full sm:w-64"
              options={options}
              value={target?.id ?? ''}
              onValueChange={setTargetId}
              searchPlaceholder="Search deals and orders"
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
          ) : remarks.length === 0 ? (
            /* Section 13: a real empty state, and one that says what to do
               next rather than the words "No data". */
            <p className="py-4 text-center text-body text-text-secondary">
              {target?.kind === 'meeting'
                ? 'No minutes yet. Write what was discussed — during the meeting or after it.'
                : `No notes on ${target?.label} yet.`}
            </p>
          ) : (
            <ul className="space-y-3">
              {remarks.map(remark => (
                <li key={remark.id} className="text-body text-text-primary">
                  <p className="text-label text-text-secondary">
                    {remark.users?.name ?? 'Unknown'} · {fmtDateTime(remark.created_at)}
                  </p>
                  <p className="whitespace-pre-wrap">{remark.body}</p>
                </li>
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
