'use client'

import { useMemo, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { fmtAmount, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The per-person rows of the Team Summary (§6.4).
 *
 * Every row is a LINK INTO THE PERSON'S OWN SCREEN, which is the whole reason
 * the page exists: a manager reads the table to find who to look at, then opens
 * that one person. The per-person screens are unchanged — this table navigates
 * to `/review/<userId>`, it does not re-render their content.
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
  onOpen,
}: {
  rows: TeamMemberRow[]
  showManager: boolean
  onOpen: (userId: string) => void
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
            <th className="py-2 pr-3 text-right">Detail</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr
              key={r.userId}
              onClick={() => onOpen(r.userId)}
              className="cursor-pointer border-b border-border-light last:border-0 hover:bg-surface-control"
            >
              {COLUMNS.map(c => (
                <td
                  key={c.key}
                  className={cn('py-3 pr-3', c.numeric && 'text-right tabular-nums', c.key === 'name' && 'font-medium text-text-primary')}
                >
                  {c.render(r)}
                </td>
              ))}
              {showManager && <td className="py-3 pr-3 text-text-secondary">{r.managerName ?? '—'}</td>}
              <td className="py-3 pr-3 text-right">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={e => {
                    e.stopPropagation()
                    onOpen(r.userId)
                  }}
                  aria-label={`Open ${r.name}'s review`}
                >
                  Open <ChevronRightIcon className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
