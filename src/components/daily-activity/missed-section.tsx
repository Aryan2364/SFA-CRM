'use client'

import { useMemo, useState } from 'react'
import { ChevronDownIcon, ClockIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { MissedTodo } from './types'

/**
 * Items due on an earlier day that nobody started or moved (§ Missed).
 * Collapsed by default, at the bottom of the Meetings list, and only shown
 * on TODAY — a missed item from a past day's own list would be a report
 * screen, not a to-do list. Same-account items are merged into one card,
 * the same rule the same-day to-dos already follow in the page above.
 */

type MergedMissed = {
  key: string
  party_id: string | null
  heading: string
  reasons: string[]
  originalDate: string
  /** The single item Start acts on when the group has exactly one follow-up
   *  or next-meeting source (a plan-line-only group has nothing Start can
   *  auto-fill, so it still opens the manual dialog). */
  items: MissedTodo[]
}

function mergeMissed(items: MissedTodo[]): MergedMissed[] {
  const groups = new Map<string, MergedMissed>()
  let ungrouped = 0
  for (const item of items) {
    const key = item.party_id ?? `_${ungrouped++}`
    const cur = groups.get(key) ?? {
      key, party_id: item.party_id, heading: item.party_name,
      reasons: [], originalDate: item.original_date, items: [],
    }
    cur.reasons.push(item.label)
    cur.items.push(item)
    // The earliest date in the group is the one shown — it is the one that
    // has been outstanding longest.
    if (item.original_date < cur.originalDate) cur.originalDate = item.original_date
    groups.set(key, cur)
  }
  return Array.from(groups.values())
}

export function MissedSection({
  items,
  canStart,
  startingKey,
  onStart,
  onCouldntMeet,
}: {
  items: MissedTodo[]
  canStart: boolean | null
  startingKey: string | null
  onStart: (group: MergedMissed) => void
  /** After the item's own day, the only choices are Start or Couldn't
   *  meet — the plain Move action is gone here (moving BEFORE the day
   *  stays possible from the follow-up/next-meeting screens themselves). */
  onCouldntMeet: (group: MergedMissed) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const groups = useMemo(() => mergeMissed(items), [items])
  if (groups.length === 0) return null

  return (
    <div className="rounded-xl border border-dashed border-border-light bg-surface-sunken/40">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-body font-medium text-text-primary">
          <ClockIcon className="size-4 text-text-muted" />
          Missed ({groups.length})
        </span>
        <ChevronDownIcon
          className={`size-4 text-text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Animated expand, per the kit: height/opacity, ~200-300ms. */}
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight: expanded ? '2000px' : '0px', opacity: expanded ? 1 : 0 }}
      >
        <div className="grid gap-3 border-t border-border-light p-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(g => {
            return (
              <div key={g.key} className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="neutral">Missed · {g.originalDate}</Badge>
                </div>
                <h4 className="text-card-heading font-medium text-text-primary">{g.heading}</h4>
                <ul className="flex flex-col gap-0.5 text-body text-text-secondary">
                  {g.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
                <div className="mt-1 flex items-center gap-2 border-t border-border-light pt-2.5">
                  <PermissionTooltip
                    allowed={canStart !== false}
                    reason="Only someone who can create and edit meetings can start one"
                  >
                    <Button
                      size="sm"
                      disabled={canStart !== true}
                      onClick={() => onStart(g)}
                    >
                      {startingKey === g.key ? 'Starting…' : 'Start'}
                    </Button>
                  </PermissionTooltip>

                  <Button
                    variant="ghost" size="sm"
                    disabled={canStart !== true}
                    onClick={() => onCouldntMeet(g)}
                  >
                    Couldn&apos;t meet
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export type { MergedMissed }
