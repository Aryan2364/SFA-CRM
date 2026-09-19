'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'

import { fmtAmount, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

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
}

type SortKey = 'name' | 'plannedGoal' | 'meetings' | 'ticked' | 'notMet' | 'newParties' | 'expenseTotal' | 'orderValue'

const COLUMNS: { key: SortKey; header: string; numeric: boolean; render: (r: TeamMemberRow) => string }[] = [
  { key: 'name', header: 'Person', numeric: false, render: r => r.name },
  { key: 'plannedGoal', header: 'Planned', numeric: true, render: r => fmtNumber(r.plannedGoal) },
  { key: 'meetings', header: 'Meetings', numeric: true, render: r => fmtNumber(r.meetings) },
  { key: 'ticked', header: 'Ticked / open', numeric: true, render: r => `${fmtNumber(r.ticked)} / ${fmtNumber(r.open)}` },
  { key: 'notMet', header: 'Not met', numeric: true, render: r => fmtNumber(r.notMet) },
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
    copy.sort((a, b) => {
      if (sortKey === 'name') return asc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      const diff = (a[sortKey] as number) - (b[sortKey] as number)
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-body">
        <thead>
          <tr className="border-b border-border-light text-left text-caption text-text-secondary">
            {COLUMNS.map(c => (
              <th key={c.key} className={cn('py-2 pr-3', c.numeric && 'text-right')}>
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
              </th>
            ))}
            {showManager && <th className="py-2 pr-3">Reports to</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.userId} className="border-b border-border-light last:border-0">
              {COLUMNS.map(c =>
                c.key === 'name' ? (
                  <td key={c.key} className="py-1 pr-3">
                    <Link
                      href={`/review/${r.userId}?tab=summary`}
                      className="inline-flex min-h-[44px] items-center py-3 font-medium text-text-primary hover:text-primary hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                ) : (
                  <td
                    key={c.key}
                    className={cn('py-3 pr-3', c.numeric && 'text-right tabular-nums')}
                  >
                    {c.render(r)}
                  </td>
                )
              )}
              {showManager && <td className="py-3 pr-3 text-text-secondary">{r.managerName ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
