'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { HistoryIcon, SquareArrowOutUpRightIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Truncate } from '@/components/ui/truncate'
import { formatDuration } from '@/components/daily-activity/types'
import { fmtDate, fmtTime } from '@/lib/format'

/**
 * "Links to all Meetings held on a Deal appear on that Deal" — §5.6.
 *
 * ---------------------------------------------------------------------------
 * THIS SECTION RENDERS NOTHING WHEN THERE ARE NO MEETINGS. NOT AN EMPTY STATE.
 *
 * `05-PHASE-3-PLAN.md` says it outright: do not render an empty "Meetings"
 * section. It is the one place in this app where an empty state is the wrong
 * answer, and the reason is §5.6's last line — a Meeting is **not compulsory**
 * for a Deal. Everywhere else, nothing-there means something is missing and the
 * empty state says how to fix it. Here, nothing-there is an ordinary, complete
 * Deal: a card reading "No meetings yet" would invent an obligation the
 * specification explicitly removes, and would do it on the majority of Deals.
 *
 * So the component returns `null` for all three of "still loading", "the read
 * failed" and "none" — a heading that appears a beat later is worse than one
 * that was never promised, and a Deal is perfectly readable without this.
 *
 * ---------------------------------------------------------------------------
 * EVERY MEETING LINKED TO THIS DEAL, AND `can_open` SAYS WHO MAY OPEN IT
 *
 * Aryan, 2026-10-13: "if an opportunity is shared then meetings against that
 * opportunity should also be shared." `/api/deals/[id]/meetings` now lists
 * EVERY meeting linked to this Deal once the viewer may read the Deal at all
 * — whoever held it, not only the ones inside the viewer's own `meetings`
 * scope — and names its holder. `can_open` is server-decided
 * (`src/lib/sharing.ts`, `canReadVisitViaSharing`) and always true for a row
 * that reaches this response, but the row is only wrapped in a `Link` when it
 * is true: a link the viewer cannot follow must not look clickable.
 */

type DealMeeting = {
  id: string
  visit_date: string
  visit_type: string
  entity_name: string
  status: 'Pending' | 'Active' | 'Completed'
  start_time: string | null
  duration_secs: number | null
  is_manual_entry: boolean
  users: { id: string; name: string } | null
  can_open: boolean
}

export function DealMeetingsSection({ dealId }: { dealId: string }) {
  const [meetings, setMeetings] = useState<DealMeeting[]>([])

  useEffect(() => {
    if (!dealId) return
    let live = true
    fetch(`/api/deals/${dealId}/meetings`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : []))
      .then((rows: DealMeeting[]) => {
        if (live) setMeetings(Array.isArray(rows) ? rows : [])
      })
      /* A failure here costs the cross-links and nothing else. The Deal is
         not allowed to fail because its optional section did. */
      .catch(() => {})
    return () => {
      live = false
    }
  }, [dealId])

  if (meetings.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Meetings
          <span className="ml-2 text-label font-normal text-text-secondary">
            {meetings.length === 1 ? 'one meeting' : `${meetings.length} meetings`} on this opportunity
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {meetings.map(m => {
            const rowClass =
              'flex min-h-11 flex-col gap-2 rounded-lg border border-border-light p-3 transition-colors sm:flex-row sm:items-center sm:justify-between'
            const body = (
              <>
                <div className="min-w-0">
                  {/* The party leads, the date and the rest sit under it. */}
                  {/*
                    Kit §8. `truncate` sat on the FLEX row, which is not the
                    box the text overflows — the name pushed the icon along
                    instead of ending in three dots, and nothing showed the
                    full text. `Truncate` puts the ellipsis and the tooltip
                    on the text itself and leaves the icon as a `shrink-0`
                    sibling. The meeting form now names the person met, so
                    this row carries "Ramesh Kumar · ACME Traders" and
                    reaches that edge routinely.
                  */}
                  <p className="flex items-center gap-1.5 text-body font-medium text-text-primary">
                    <Truncate>{m.entity_name}</Truncate>
                    {m.can_open ? (
                      <SquareArrowOutUpRightIcon
                        className="size-3.5 shrink-0 text-text-muted"
                        aria-hidden="true"
                      />
                    ) : null}
                  </p>
                  <p className="text-label text-text-secondary">
                    {fmtDate(m.visit_date)}
                    {m.start_time ? ` · ${fmtTime(m.start_time)}` : ''}
                    {m.duration_secs ? ` · ${formatDuration(m.duration_secs)}` : ''}
                    {` · ${m.visit_type}`}
                    {m.users ? ` · ${m.users.name}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {m.is_manual_entry ? (
                    <Badge variant="warning" className="gap-1">
                      <HistoryIcon className="size-3" />
                      Manually Entered · Tentative
                    </Badge>
                  ) : null}
                  <Badge
                    variant={
                      m.status === 'Active'
                        ? 'warning'
                        : m.status === 'Completed'
                          ? 'success'
                          : 'neutral'
                    }
                  >
                    {m.status}
                  </Badge>
                </div>
              </>
            )
            return (
              <li key={m.id}>
                {/* The whole row is the link, so the touch target is the row
                    rather than a word inside it — 44px at every width. A row
                    the viewer may not open (can_open false) is plain text:
                    see the header. */}
                {m.can_open ? (
                  <Link
                    href={`/daily-activity/meeting/${m.id}`}
                    className={`${rowClass} hover:bg-surface-control`}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className={rowClass}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
