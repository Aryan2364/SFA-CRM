'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'

import { fmtAmount, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableRowHeader,
  TableCell,
} from '@/components/ui/table'

/**
 * The per-person rows of the Team Summary (§6.4).
 *
 * The person's NAME is the link into their own screen, which is the whole
 * reason the page exists: a manager reads the table to find who to look at,
 * then opens that one person. The per-person screens are unchanged — the
 * name links to `/review/<userId>`, it does not re-render their content.
 * There is exactly one way in — no separate "Open" column/button, and the
 * row itself is not clickable (it may carry its own controls later).
 *
 * Sorting is local because the row set is capped server-side at 120 people; a
 * sort that round-tripped would flash the whole table to reorder ten rows.
 */

export type TeamMemberRow = {
  userId: string
  name: string
  managerName: string | null
  toMeet: number
  met: number
  notMet: number
  plannedGoal: number
  meetings: number
  ticked: number
  open: number
  extraMeetings: number
  newParties: number
  expenseTotal: number
  orderCount: number
  orderValue: number
  /** To-dos due this week that were never started or moved (src/lib/missed-todos.ts). */
  missedCount: number
  /** Every to-do's end state for the week — see countOutcomesByUser(). */
  outcomeCounts: { met: number; metLate: number; couldntMeet: number; missed: number }
  /** Parties this person has "couldn't meet" 3+ times in the last 30 days. */
  repeatedCouldntMeet: { party_id: string; party_name: string | null }[]
}

type SortKey = 'name' | 'plannedGoal' | 'meetings' | 'ticked' | 'notMet' | 'met' | 'metLate' | 'couldntMeet' | 'missedCount' | 'newParties' | 'expenseTotal' | 'orderValue'

const COLUMNS: { key: SortKey; header: string; numeric: boolean; render: (r: TeamMemberRow) => string }[] = [
  { key: 'name', header: 'Person', numeric: false, render: r => r.name },
  { key: 'plannedGoal', header: 'Planned', numeric: true, render: r => fmtNumber(r.plannedGoal) },
  { key: 'meetings', header: 'Meetings', numeric: true, render: r => fmtNumber(r.meetings) },
  { key: 'ticked', header: 'Ticked / open', numeric: true, render: r => `${fmtNumber(r.ticked)} / ${fmtNumber(r.open)}` },
  { key: 'notMet', header: 'Not met', numeric: true, render: r => fmtNumber(r.notMet) },
  { key: 'met', header: 'Met', numeric: true, render: r => fmtNumber(r.outcomeCounts.met) },
  { key: 'metLate', header: 'Met late', numeric: true, render: r => fmtNumber(r.outcomeCounts.metLate) },
  { key: 'couldntMeet', header: "Couldn't meet", numeric: true, render: r => fmtNumber(r.outcomeCounts.couldntMeet) },
  { key: 'missedCount', header: 'Missed', numeric: true, render: r => fmtNumber(r.missedCount) },
  { key: 'newParties', header: 'New parties', numeric: true, render: r => fmtNumber(r.newParties) },
  { key: 'expenseTotal', header: 'Expenses', numeric: true, render: r => fmtAmount(r.expenseTotal) },
  { key: 'orderValue', header: 'Order value', numeric: true, render: r => fmtAmount(r.orderValue) },
]

export function TeamMemberTable({
  rows,
  showManager,
}: {
  rows: TeamMemberRow[]
  showManager: boolean
}) {
  const [sortKey, setSortKey] = useState<SortKey>('meetings')
  const [asc, setAsc] = useState(false)

  const sorted = useMemo(() => {
    const copy = [...rows]
    const value = (r: TeamMemberRow): number | string => {
      if (sortKey === 'met') return r.outcomeCounts.met
      if (sortKey === 'metLate') return r.outcomeCounts.metLate
      if (sortKey === 'couldntMeet') return r.outcomeCounts.couldntMeet
      return r[sortKey] as number | string
    }
    copy.sort((a, b) => {
      if (sortKey === 'name') return asc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      const diff = (value(a) as number) - (value(b) as number)
      return asc ? diff : -diff
    })
    return copy
  }, [rows, sortKey, asc])

  function toggle(key: SortKey) {
    if (key === sortKey) setAsc(v => !v)
    else {
      setSortKey(key)
      setAsc(key === 'name')
    }
  }

  return (
    <Table containerClassName="overflow-x-auto">
      <TableHeader>
        <TableRow>
          {COLUMNS.map(c => (
            <TableHead key={c.key} numeric={c.numeric} className={c.key === 'name' ? 'w-grid-head' : undefined}>
              <button
                type="button"
                onClick={() => toggle(c.key)}
                className={cn(
                  'inline-flex min-h-[44px] items-center gap-1 hover:text-text-primary sm:min-h-0',
                  c.numeric && 'flex-row-reverse'
                )}
              >
                {c.header}
                {sortKey === c.key && (asc ? <ArrowUpIcon className="h-3 w-3" /> : <ArrowDownIcon className="h-3 w-3" />)}
              </button>
            </TableHead>
          ))}
          {showManager && <TableHead>Reports to</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map(r => (
          <TableRow key={r.userId}>
            {COLUMNS.map(c =>
              c.key === 'name' ? (
                <TableRowHeader key={c.key} frozen>
                  <Link
                    href={`/review/${r.userId}?tab=summary`}
                    className="inline-flex min-h-[44px] items-center font-medium text-text-primary hover:text-primary hover:underline"
                  >
                    {r.name}
                  </Link>
                </TableRowHeader>
              ) : c.key === 'couldntMeet' ? (
                <TableCell key={c.key} numeric>
                  <span className="inline-flex items-center justify-end gap-1.5">
                    {c.render(r)}
                    {r.repeatedCouldntMeet.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger
                          type="button"
                          className="inline-flex size-4 items-center justify-center rounded-full bg-warning-bg text-[10px] font-semibold text-warning outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
                          aria-label={`Couldn't meet 3+ times with: ${r.repeatedCouldntMeet.map(p => p.party_name ?? 'Unknown').join(', ')}`}
                        >
                          !
                        </TooltipTrigger>
                        <TooltipContent>
                          {`Couldn't meet 3+ times with: ${r.repeatedCouldntMeet.map(p => p.party_name ?? 'Unknown').join(', ')}`}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                </TableCell>
              ) : (
                <TableCell key={c.key} numeric={c.numeric}>
                  {c.render(r)}
                </TableCell>
              )
            )}
            {showManager && <TableCell className="text-text-secondary">{r.managerName ?? '—'}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
