'use client'

import { useMemo } from 'react'
import { PlusIcon } from 'lucide-react'

import { Board, type BoardCard, type BoardColumn } from '@/components/ui/board'
import { Button } from '@/components/ui/button'
import { Truncate } from '@/components/ui/truncate'

/**
 * F9 — the week as a seven-column board, Monday to Sunday.
 *
 * ---------------------------------------------------------------------------
 * WHY THE KIT'S BOARD AND NOT A GRID
 *
 * `components/ui/board.tsx` already owns four of the five things F9 asks for,
 * and owns them against real data on the Deals screen:
 *
 *   - seven columns maximum, and it THROWS past seven. Everywhere else that
 *     cap is a worry, because `deal_stages` is user-editable. Here the seven
 *     are Monday to Sunday, so the constraint is the requirement.
 *   - each column scrolls vertically on its own, 25 cards then Load more.
 *   - the heading states the TRUE total, never the rendered count.
 *   - the row scrolls horizontally when seven columns do not fit.
 *
 * ---------------------------------------------------------------------------
 * WHAT A MOVE MEANS HERE
 *
 * The board requires `onMove`, and on this screen the answer is the good one:
 * a card's column IS its `plan_date`, so dragging Tuesday's visit to Wednesday
 * re-dates it. That is a change to the in-memory draft only. Nothing is
 * written until Save Draft or Submit, exactly as typing in the old grid was,
 * and `dayDataToPlanItems` keys items by date already — so the existing write
 * path carries the new date with no change at all.
 *
 * A move onto a day that already plans the same party is rejected by throwing,
 * which is the contract the board's optimistic layer is built on: the card
 * returns to the day it came from and the caller's toast says why.
 *
 * ---------------------------------------------------------------------------
 * THE CARD (F13)
 *
 * Firm name leads. Type sits under it with the agenda beside it. Neither the
 * day nor the Dist/Dealer/Others counts appear: the day is what the column
 * means (section 35.5 forbids repeating it), and the counts were retired from
 * the face of the plan by F12 while their columns stay in the database.
 *
 * `party_id` is NULL on almost every row that exists today, so a card with no
 * party falls back to the journey the row does carry, `from_place → to_place`.
 * It is honest about what the row is rather than inventing a firm name, and it
 * is never blank.
 */

export type PlanBoardLine = {
  id: string
  /** `YYYY-MM-DD`. The column this card sits in. */
  date: string
  /** Firm name when a party is set; the journey when it is not. */
  title: string
  /** Company Type from the master. Empty when no party is set. */
  type: string
  /** Free text already on the row. Read-only here — see plan-line-dialog. */
  agenda: string
  /** Pre-formatted, or empty. */
  expected: string
  /** True when the row has no party and is showing its journey instead. */
  isFallback: boolean
}

export function PlanBoard({
  days,
  lines,
  dayLabel,
  canEdit,
  onOpenLine,
  onMoveLine,
  onAddToDay,
}: {
  /** Exactly seven `YYYY-MM-DD` strings, Monday first. */
  days: string[]
  lines: PlanBoardLine[]
  dayLabel: (day: string) => string
  canEdit: boolean
  onOpenLine: (lineId: string) => void
  /** Rejects by throwing; the board reverts the card and toasts. */
  onMoveLine: (lineId: string, toDay: string) => Promise<void>
  onAddToDay: (day: string) => void
}) {
  const columns: BoardColumn[] = useMemo(
    () =>
      days.map(day => ({
        id: day,
        label: dayLabel(day),
        // The true total. Every line for the day is in `lines`, so the count
        // and the cards cannot disagree.
        total: lines.filter(l => l.date === day).length,
        /*
         * F9's plus, on the heading of the day it adds to. Hidden rather
         * than disabled when the plan is locked: a control that can never
         * do anything in this state is not information, it is clutter, and
         * the banner above already says why the plan cannot be edited.
         */
        action: canEdit ? (
          <Button
            variant="in-field"
            size="icon-sm"
            onClick={() => onAddToDay(day)}
            aria-label={`Add a line on ${dayLabel(day)}`}
          >
            <PlusIcon />
          </Button>
        ) : undefined,
      })),
    [days, lines, dayLabel, canEdit, onAddToDay],
  )

  const cards: BoardCard[] = useMemo(
    () =>
      lines.map(line => ({
        id: line.id,
        columnId: line.date,
        title: line.title,
        facts: [
          <span key="type" className="flex items-start gap-2">
            <span
              className={
                line.type
                  ? 'shrink-0 rounded bg-primary-subtle px-1.5 py-0.5 text-meta font-medium text-primary'
                  : 'shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-meta font-medium text-text-muted'
              }
            >
              {line.type || (line.isFallback ? 'No party yet' : '—')}
            </span>
            {line.agenda && (
              <span className="min-w-0 flex-1 text-label text-text-secondary">
                {line.agenda}
              </span>
            )}
          </span>,
        ],
        meta: line.expected || undefined,
        moveDisabledReason: canEdit
          ? undefined
          : 'Only the plan owner can move a line, and only while the plan is a draft.',
      })),
    [lines, canEdit],
  )

  return (
    <Board
      columns={columns}
      cards={cards}
      onMove={(cardId, toColumnId) => onMoveLine(cardId, toColumnId)}
      onOpenCard={onOpenLine}
      emptyColumnLabel="Nothing planned"
      moveErrorMessage="That line could not be moved and has gone back to the day it came from."
    />
  )
}

/**
 * The same seven days one at a time, for phone width.
 *
 * Section 35.3 says the board is not offered below 768px, and the reason
 * applies here more than anywhere: seven 280px columns need 2,000px and the
 * phone has 390. Squeezing them would cost the week-at-a-glance comparison
 * that is the entire point of the board and give nothing back. One day, full
 * width, with the day picker above carrying every day's count — so the week is
 * still legible, it is just read rather than scanned.
 */
export function PlanDayList({
  day,
  lines,
  canEdit,
  onOpenLine,
  onAdd,
}: {
  day: string
  lines: PlanBoardLine[]
  canEdit: boolean
  onOpenLine: (lineId: string) => void
  onAdd: () => void
}) {
  const forDay = lines.filter(l => l.date === day)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pb-2">
      {forDay.length === 0 ? (
        <p className="rounded-xl border border-border-light bg-surface px-4 py-6 text-center text-label text-text-muted">
          Nothing planned for this day.
        </p>
      ) : (
        forDay.map(line => (
          <button
            key={line.id}
            type="button"
            onClick={() => onOpenLine(line.id)}
            className="flex min-h-11 w-full flex-col gap-2 rounded-xl border border-border-light bg-surface p-3 text-left transition-[background-color] duration-200 hover:bg-surface-control active:bg-surface-control-pressed"
          >
            <span className="block text-body font-medium text-text-primary">
              <Truncate>{line.title}</Truncate>
            </span>
            <span className="flex items-start gap-2">
              <span
                className={
                  line.type
                    ? 'shrink-0 rounded bg-primary-subtle px-1.5 py-0.5 text-meta font-medium text-primary'
                    : 'shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-meta font-medium text-text-muted'
                }
              >
                {line.type || (line.isFallback ? 'No party yet' : '—')}
              </span>
              {line.agenda && (
                <span className="min-w-0 flex-1 text-label text-text-secondary">
                  {line.agenda}
                </span>
              )}
            </span>
            {line.expected && (
              <span className="text-meta text-text-muted">{line.expected}</span>
            )}
          </button>
        ))
      )}

      {canEdit && (
        <Button variant="secondary" onClick={onAdd} className="min-h-11 w-full">
          Add a line
        </Button>
      )}
    </div>
  )
}
