'use client'

import { MinusIcon, PencilIcon, PlusIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { fmtAmount, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  DIFF_FIELD_LABELS,
  diffTotal,
  isEmptyDiff,
  type DiffField,
  type DiffLine,
  type ItemsDiff,
} from '@/lib/weekly-plan-diff'

/**
 * §5.2: "The User must be able to see what changes his Manager made."
 *
 * This renders the payload the manager's edit froze into
 * `weekly_plan_audit_logs.edited_fields`. It reads ONE object and needs no
 * request of its own — the owner's plan screen and the manager's approval
 * screen both already hold the audit log, and both render this.
 *
 * Deliberately not a table. A diff read by the person whose work changed is a
 * short list of sentences — "Tuesday, Sundar Traders: Dealer 2 → 4" — and a
 * six-column grid of mostly-unchanged numbers buries the one cell that moved.
 * The changed VALUES are what get the colour, not the rows.
 */

function partyName(line: DiffLine): string {
  return line.party_label ?? 'No party'
}

function formatValue(field: DiffField, line: DiffLine): string {
  const value = line[field]
  if (field === 'expected_order_value') {
    return value === null ? '—' : fmtAmount(value as number)
  }
  if (field === 'notes') {
    const text = (value as string) ?? ''
    return text.trim() === '' ? '—' : text
  }
  if (field === 'party_label') return (value as string | null) ?? 'No party'
  return String(value ?? 0)
}

/** Weekday plus date — "Tue 15 Sep" reads as a plan day; a bare date does not. */
function dayLabel(planDate: string): string {
  // `planDate` is "YYYY-MM-DD". Split rather than `new Date(...)`: the string
  // form is UTC-parsed, so in a negative-offset zone the browser renders the
  // previous day, which on a weekly plan is the wrong day of the week.
  const [y, m, d] = planDate.split('-').map(Number)
  if (!y || !m || !d) return planDate
  const local = new Date(y, m - 1, d)
  const weekday = local.toLocaleDateString(undefined, { weekday: 'short' })
  return `${weekday} ${fmtDate(planDate)}`
}

function LineHeading({ line }: { line: DiffLine }) {
  return (
    <span className="text-body font-medium text-text-primary">
      {dayLabel(line.plan_date)}
      <span className="text-text-secondary font-normal"> · {partyName(line)}</span>
    </span>
  )
}

/** The counts a line carries, as the compact summary an added/removed row needs. */
function LineSummary({ line }: { line: DiffLine }) {
  const parts = [
    `Dealer ${line.new_dealers_goal}`,
    `Dist. ${line.existing_dealers_goal}`,
    `Others ${line.others_goal}`,
  ]
  if (line.expected_order_value !== null) {
    parts.push(`Expected ${fmtAmount(line.expected_order_value)}`)
  }
  return (
    <span className="text-label text-text-secondary">
      {parts.join(' · ')}
      {line.notes.trim() ? ` · ${line.notes}` : ''}
    </span>
  )
}

function Row({
  tone,
  icon,
  children,
}: {
  tone: 'added' | 'removed' | 'changed'
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border [&_svg]:size-3',
          tone === 'added' && 'border-success-border bg-success-bg text-success',
          tone === 'removed' && 'border-danger-border bg-danger-bg text-danger',
          tone === 'changed' && 'border-border bg-surface-control text-text-secondary',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  )
}

export function ManagerChanges({
  changes,
  className,
}: {
  changes: ItemsDiff
  className?: string
}) {
  if (isEmptyDiff(changes)) return null

  return (
    <ul className={cn('divide-y divide-border-light', className)}>
      {changes.added.map((line, i) => (
        <Row key={`a${i}`} tone="added" icon={<PlusIcon />}>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <Badge variant="success">Added</Badge>
            <LineHeading line={line} />
          </span>
          <span className="mt-0.5 block">
            <LineSummary line={line} />
          </span>
        </Row>
      ))}

      {changes.removed.map((line, i) => (
        <Row key={`r${i}`} tone="removed" icon={<MinusIcon />}>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <Badge variant="danger">Removed</Badge>
            <span className="text-body font-medium text-text-primary line-through decoration-danger/50">
              {dayLabel(line.plan_date)}
            </span>
            <span className="text-body text-text-secondary">{partyName(line)}</span>
          </span>
          <span className="mt-0.5 block">
            <LineSummary line={line} />
          </span>
        </Row>
      ))}

      {changes.changed.map((change, i) => (
        <Row key={`c${i}`} tone="changed" icon={<PencilIcon />}>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <Badge>Changed</Badge>
            <LineHeading line={change.after} />
          </span>
          <ul className="mt-1 space-y-0.5">
            {change.fields.map(field => (
              <li key={field} className="text-label text-text-secondary">
                {DIFF_FIELD_LABELS[field]}{' '}
                {/* The old value is struck through rather than merely greyed:
                    grey-on-grey is the one thing a person reading a diff on a
                    phone cannot resolve. */}
                <span className="text-text-muted line-through">
                  {formatValue(field, change.before)}
                </span>{' '}
                <span aria-hidden>&rarr;</span>{' '}
                <span className="font-medium text-text-primary">
                  {formatValue(field, change.after)}
                </span>
              </li>
            ))}
          </ul>
        </Row>
      ))}
    </ul>
  )
}

/** "3 changes" — the one-line count a banner or a tab badge needs. */
export function changeCountLabel(changes: ItemsDiff): string {
  const n = diffTotal(changes)
  return n === 1 ? '1 change' : `${n} changes`
}
