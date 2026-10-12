'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { HistoryIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadError } from '@/components/ui/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDuration } from '@/components/daily-activity/types'
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * "Previous meetings" — what was discussed the last times anyone met this
 * company, read before (or during) this meeting.
 *
 * The list is whatever `/api/daily-activity/[id]/history` sends, and that
 * route decides who may read it. The rule (Aryan, 2026-10-12): whoever has
 * access to a customer sees that customer's history, and this meeting is
 * the access — so its viewer reads every earlier meeting with the same
 * company, whoever held it. See the route for the bounds. A past meeting
 * the viewer may not open on its own is listed without a link, because
 * its own page would 404.
 *
 * The newest one is "Last time" and opens in full; older ones show their
 * first lines and expand in place. Expanding is instant — kit §5.6 rule 1
 * never animates the height of text being read.
 */

type Minute = { id: string; body: string; created_at: string; author: string | null }

type PastMeeting = {
  id: string
  visit_date: string
  start_time: string | null
  duration_secs: number | null
  status: 'Pending' | 'Active' | 'Completed'
  is_manual_entry: boolean
  held_by: string | null
  earlier_note: string | null
  minutes: Minute[]
  can_open: boolean
}

type History = {
  company_linked: boolean
  total: number
  items: PastMeeting[]
  next_offset: number | null
}

/** Kit §14 rule 4: every request carries a deadline. */
const TIMEOUT_MS = 15_000

const toggleClass = cn(
  'inline-flex min-h-11 cursor-pointer items-center rounded-lg text-label text-primary hover:text-primary-hover sm:min-h-0',
  'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring'
)

export function PreviousMeetingsSection({ visitId }: { visitId: string }) {
  const { toast } = useToast()
  const [history, setHistory] = useState<History | null>(null)
  const [failed, setFailed] = useState<false | 'error' | 'forbidden'>(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // The ids opened in full. The newest starts open: it is "Last time".
  const [open, setOpen] = useState<Set<string>>(new Set())

  const fetchPage = useCallback(
    async (offset: number): Promise<History> => {
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
    setHistory(null)
    setFailed(false)
    try {
      const page = await fetchPage(0)
      setHistory(page)
      setOpen(new Set(page.items[0] ? [page.items[0].id] : []))
    } catch (err) {
      setFailed(err instanceof Error && err.message === 'forbidden' ? 'forbidden' : 'error')
    }
  }, [fetchPage])

  useEffect(() => { void load() }, [load])

  async function loadOlder() {
    if (!history || history.next_offset === null) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(history.next_offset)
      // Appended, not replaced: the meetings already on screen keep their
      // identity and their open/closed state.
      setHistory(prev =>
        prev ? { ...page, items: [...prev.items, ...page.items.filter(p => !prev.items.some(i => i.id === p.id))] } : page
      )
    } catch {
      toast('Could not load older meetings. Try again.', 'error')
    }
    setLoadingMore(false)
  }

  function toggle(id: string) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-x-2">
          Previous meetings
          {history && history.total > 0 ? (
            <span className="text-label font-normal text-text-secondary">
              {history.total === 1 ? '1 earlier meeting' : `${history.total} earlier meetings`} with this company
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {failed ? (
          <LoadError forbidden={failed === 'forbidden'} what="previous meetings" onRetry={load} />
        ) : history === null ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : !history.company_linked ? (
          <p className="text-body text-text-secondary">
            Earlier meetings can only be found when a company is picked. This meeting was logged without one.
          </p>
        ) : history.items.length === 0 ? (
          <p className="text-body text-text-secondary">
            This is the first meeting with this company. Its minutes will show here at the next one.
          </p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border-light">
              {history.items.map((m, i) => (
                <PastMeetingRow
                  key={m.id}
                  meeting={m}
                  isLatest={i === 0}
                  expanded={open.has(m.id)}
                  onToggle={() => toggle(m.id)}
                />
              ))}
            </ul>
            {history.next_offset !== null ? (
              <Button
                variant="secondary"
                className="min-h-11 w-full sm:min-h-0"
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
      </CardContent>
    </Card>
  )
}

function PastMeetingRow({
  meeting: m,
  isLatest,
  expanded,
  onToggle,
}: {
  meeting: PastMeeting
  isLatest: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const nothingWritten = m.minutes.length === 0 && !m.earlier_note
  // Collapsed, a meeting shows its first entry, clamped to two lines (kit §8).
  const preview = m.earlier_note ?? m.minutes[0]?.body ?? null
  const entries = m.minutes.length + (m.earlier_note ? 1 : 0)
  // Measured, as `Clamp` measures: is the one entry actually cut off?
  const previewRef = useRef<HTMLParagraphElement>(null)
  const [previewCut, setPreviewCut] = useState(false)
  useEffect(() => {
    const el = previewRef.current
    if (!el || expanded) return
    const measure = () => setPreviewCut(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [preview, expanded])
  const hasMore = entries > 1 || previewCut

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          {isLatest ? <p className="text-label font-medium text-text-secondary">Last time</p> : null}
          <p className="text-body font-medium text-text-primary">
            {fmtDate(m.visit_date)}
            {m.start_time ? ` · ${fmtTime(m.start_time)}` : ''}
          </p>
          <p className="text-label text-text-secondary">
            {m.held_by ?? 'Unknown'}
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
      ) : expanded ? (
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
      ) : (
        <p
          ref={previewRef}
          className="overflow-hidden whitespace-pre-wrap text-body text-text-primary"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
        >
          {preview}
        </p>
      )}

      {!nothingWritten && hasMore ? (
        <button type="button" className={cn(toggleClass, 'self-start')} onClick={onToggle} aria-expanded={expanded}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </li>
  )
}
