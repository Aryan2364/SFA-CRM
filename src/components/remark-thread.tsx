'use client'

import { useCallback, useEffect, useState } from 'react'
import { MessageSquareIcon, SendIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Button } from '@/components/ui/button'
import { fmtDateTime } from '@/lib/format'

/**
 * ONE NOTES/COMMENTS PANEL, for every context `contextual_remarks` carries.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE COMPONENT
 *
 * Deal notes (§4.4), Minutes of the Meeting (§5.5) and Manager comments (§6.5)
 * are the same primitive with different limits, so they are the same panel
 * with different limits. Three components would be three places to fix the
 * next time a timestamp format or an empty state changes.
 *
 * ---------------------------------------------------------------------------
 * TWO ADDRESSING SHAPES, MIRRORING THE API
 *
 *   <RemarkThread contextType="deal" contextId={deal.id} />
 *   <RemarkThread contextType="daily_summary" userId={u.id} date="2026-09-18" />
 *
 * A summary has no row and therefore no id; the API derives one from the
 * person and the period and refuses a raw id for those types, so this
 * component must not invent one either. The union below makes passing the
 * wrong pair a compile error rather than a 400 at runtime.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 *
 * There is no approve, no resolve, no unread chase and no status chip — §9
 * item 5 forbids all four on a summary comment. The only thing the panel
 * knows about state is whether the API would accept another post, and it asks
 * that question by looking at the thread, not by storing a flag.
 *
 * The composer is hidden when the viewer may not post, and that decision is
 * made from the same rules the route enforces (`_access.ts`). The route is the
 * boundary; this is only courtesy, so that a control which would always fail
 * is never shown.
 */

export type Remark = {
  id: string
  context_id: string
  parent_remark_id: string | null
  author_user_id: string
  body: string
  created_at: string
  is_read: boolean
  users: { id: string; name: string } | null
}

type RowAddressed = {
  contextType: 'deal' | 'meeting' | 'expense' | 'weekly_plan' | 'weekly_plan_day'
  contextId: string
  userId?: never
  date?: never
}

type SummaryAddressed = {
  contextType: 'daily_summary' | 'weekly_summary'
  /** Whose summary it is. */
  userId: string
  /** `YYYY-MM-DD` — the day, or the week-start date. */
  date: string
  contextId?: never
}

export type RemarkThreadProps = (RowAddressed | SummaryAddressed) & {
  /** Panel heading. Defaults to "Notes", or "Comment" for a summary. */
  title?: string
  /** Shown above the composer when the thread is empty. */
  emptyHint?: string
  className?: string
}

const SUMMARY_TYPES = ['daily_summary', 'weekly_summary']

export function RemarkThread(props: RemarkThreadProps) {
  const { contextType, contextId, userId, date, title, emptyHint, className } = props
  const { toast } = useToast()

  const [remarks, setRemarks] = useState<Remark[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [meId, setMeId] = useState<string | null>(null)

  const isSummary = SUMMARY_TYPES.includes(contextType)

  useEffect(() => {
    /* `useMe()` does not carry the caller's user id, and it is a shared hook
       that other screens depend on — so this reads the same endpoint rather
       than widening it. One request, cached by the browser for the panel's
       lifetime. */
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setMeId(d?.userId ?? null))
      .catch(() => setMeId(null))
  }, [])

  const query = isSummary
    ? `contextType=${contextType}&userId=${userId}&date=${date}`
    : `contextType=${contextType}&contextId=${contextId}`

  const load = useCallback(async () => {
    setFailed(null)
    try {
      const r = await fetch(`/api/remarks?${query}`)
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        /* Section 14: a failed panel says what went wrong and offers a way
           forward, rather than rendering as an empty thread — "no notes" and
           "not allowed to see the notes" must not look identical. */
        setFailed((e as { error?: string }).error ?? `Could not load (${r.status})`)
        setRemarks(null)
        return
      }
      setRemarks(await r.json())
    } catch {
      setFailed('Could not reach the server')
      setRemarks(null)
    }
  }, [query])

  useEffect(() => { load() }, [load])

  const roots = (remarks ?? []).filter(r => !r.parent_remark_id)
  const repliesOf = (id: string) => (remarks ?? []).filter(r => r.parent_remark_id === id)

  /*
   * §6.5's limits, read off the thread rather than stored.
   *
   *   a summary takes ONE root comment, and its author is the reviewer;
   *   that comment takes ONE reply, and its author is the summary's owner.
   *
   * For every other context there is no limit — a deal accumulates notes.
   */
  const isOwner = isSummary && meId !== null && meId === userId
  const rootComment = roots[0] ?? null
  const hasReply = rootComment ? repliesOf(rootComment.id).length > 0 : false

  let canPost: boolean
  let replyingTo: string | null = null
  if (!isSummary) {
    canPost = true
  } else if (!rootComment) {
    canPost = !isOwner && meId !== null
  } else if (!hasReply && isOwner) {
    canPost = true
    replyingTo = rootComment.id
  } else {
    canPost = false
  }

  async function post() {
    const text = draft.trim()
    if (!text || posting) return
    setPosting(true)
    try {
      const r = await fetch('/api/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_type: contextType,
          ...(isSummary ? { user_id: userId, date } : { context_id: contextId }),
          ...(replyingTo ? { parent_remark_id: replyingTo } : {}),
          body: text,
        }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        toast((e as { error?: string }).error ?? 'Could not post', 'error')
      } else {
        setDraft('')
        await load()
      }
    } catch {
      toast('Could not reach the server', 'error')
    }
    setPosting(false)
  }

  const heading = title ?? (isSummary ? 'Comment' : 'Notes')
  const placeholder = replyingTo
    ? 'Write your reply…'
    : isSummary
      ? 'Leave one comment on this summary…'
      : 'Add a note…'

  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
          <MessageSquareIcon className="w-4 h-4 text-text-muted" />
          {heading}
        </h3>
        {remarks && remarks.length > 0 && (
          <span className="text-xs text-text-muted">{remarks.length}</span>
        )}
      </div>

      {failed && (
        <div className="rounded-xl border border-border-light bg-surface-sunken px-4 py-3">
          <p className="text-sm text-text-secondary">{failed}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      {!failed && remarks === null && (
        <div className="space-y-2" aria-busy="true">
          <div className="h-12 rounded-xl bg-surface-sunken animate-pulse" />
          <div className="h-12 rounded-xl bg-surface-sunken animate-pulse" />
        </div>
      )}

      {!failed && remarks !== null && (
        <>
          {roots.length === 0 ? (
            <p className="text-sm text-text-secondary rounded-xl bg-surface-sunken px-4 py-3">
              {emptyHint ?? (isSummary ? 'No comment yet.' : 'No notes yet.')}
            </p>
          ) : (
            <ul className="space-y-2">
              {roots.map(r => (
                <li key={r.id}>
                  <RemarkCard remark={r} mine={r.author_user_id === meId} />
                  {repliesOf(r.id).length > 0 && (
                    <ul className="mt-2 ml-4 sm:ml-6 space-y-2 border-l-2 border-border-light pl-3">
                      {repliesOf(r.id).map(reply => (
                        <li key={reply.id}>
                          <RemarkCard remark={reply} mine={reply.author_user_id === meId} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canPost && (
            <div className="mt-3">
              {replyingTo && (
                <p className="text-xs text-text-secondary mb-1">
                  You can reply once.
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post()
                  }}
                  rows={2}
                  aria-label={replyingTo ? 'Your reply' : heading}
                  placeholder={placeholder}
                  className="flex-1 min-w-0 border border-border-light rounded-xl px-3 py-2 text-base sm:text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-ring bg-surface"
                />
                <Button
                  onClick={post}
                  disabled={posting || draft.trim() === ''}
                  className="sm:self-end w-full sm:w-auto"
                >
                  <SendIcon />
                  {posting ? 'Posting…' : replyingTo ? 'Reply' : 'Post'}
                </Button>
              </div>
            </div>
          )}

          {/* Why the composer is gone, so its absence does not read as a bug.
              Silence here is the state §9 wants — not a "resolved" chip. */}
          {isSummary && !canPost && meId !== null && (
            <p className="mt-3 text-xs text-text-muted">
              {hasReply
                ? 'This comment has been replied to.'
                : isOwner
                  ? 'No comment on this summary yet.'
                  : 'This summary already has its one comment.'}
            </p>
          )}
        </>
      )}
    </section>
  )
}

function RemarkCard({ remark, mine }: { remark: Remark; mine: boolean }) {
  return (
    <article className="rounded-xl border border-border-light bg-surface px-3 py-2.5 transition-colors">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-sm font-medium text-text-primary">
          {remark.users?.name ?? 'Unknown'}
          {mine && <span className="ml-1.5 text-xs font-normal text-text-muted">(you)</span>}
        </span>
        {/* §4.4 and §6.5 both require the stamp, and section 18 fixes its
            shape — `DD Mon YYYY, h:mm A`, never a hand-rolled toLocaleString. */}
        <time dateTime={remark.created_at} className="text-xs text-text-muted whitespace-nowrap">
          {fmtDateTime(remark.created_at)}
        </time>
      </div>
      <p className="mt-1 text-sm text-text-secondary whitespace-pre-wrap break-words">
        {remark.body}
      </p>
    </article>
  )
}
