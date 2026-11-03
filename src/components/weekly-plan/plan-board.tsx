'use client'

import { useMemo } from 'react'
import { XIcon } from 'lucide-react'

import { Board, type BoardCard, type BoardColumn } from '@/components/ui/board'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
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
 *   - one column per value it is given. Here the seven are Monday to
 *     Sunday, always exactly seven.
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
  /** The person the visit is with, when the line is for an account. Empty otherwise. */
  person?: string
  /** Pre-formatted, or empty. */
  expected: string
  /** True when the row has no party and is showing its journey instead. */
  isFallback: boolean
}

/** The card's two supporting facts: the person, then the agenda. Never a Type badge. */
function cardFacts(line: PlanBoardLine): BoardCard['facts'] {
  const who = line.person ? (
    <span key="person" className="block text-label text-text-secondary">with {line.person}</span>
  ) : null
  const what = line.agenda ? (
    <span key="agenda" className="block text-label text-text-secondary">{line.agenda}</span>
  ) : line.isFallback ? (
    <span key="noparty" className="inline-block rounded bg-surface-sunken px-1.5 py-0.5 text-meta font-medium text-text-muted">No party yet</span>
  ) : null
  if (who && what) return [who, what]
  const one = who ?? what
  return one ? [one] : undefined
}

export function PlanBoard({
  days,
  lines,
  dayLabel,
  canEdit,
  onOpenLine,
  onMoveLine,
  onAddToDay,
  addDisabledReason,
}: {
  /** Exactly seven `YYYY-MM-DD` strings, Monday first. */
  days: string[]
  lines: PlanBoardLine[]
  dayLabel: (day: string) => string
  canEdit: boolean
  onOpenLine: (lineId: string) => void
  /** Rejects by throwing; the board reverts the card and toasts. */
  onMoveLine: (lineId: string, toDay: string) => Promise<void>
  /**
   * The "+" in every day's heading. Leave it out while permissions are still
   * loading (not known yet is not not allowed): no "+" is drawn at all.
   */
  onAddToDay?: (day: string) => void
  /** Why the "+" is disabled (no permission, or the plan is locked). */
  addDisabledReason?: string
}) {
  const columns: BoardColumn[] = useMemo(
    () =>
      days.map(day => ({
        id: day,
        label: dayLabel(day),
        // The true total. Every line for the day is in `lines`, so the count
        // and the cards cannot disagree.
        total: lines.filter(l => l.date === day).length,
        ...(onAddToDay
          ? {
              onAdd: () => onAddToDay(day),
              // "Tue 28 Oct" -> "Add a visit on Tue 28".
              addLabel: `Add a visit on ${dayLabel(day).split(' ').slice(0, 2).join(' ')}`,
              addDisabledReason,
            }
          : {}),
      })),
    [days, lines, dayLabel, onAddToDay, addDisabledReason],
  )

  const cards: BoardCard[] = useMemo(
    () =>
      lines.map(line => ({
        id: line.id,
        columnId: line.date,
        title: line.title,
        // The person sits under the account ("with Amit"); there is no Type
        // badge. The second fact is the agenda, or an honest "No party yet".
        facts: cardFacts(line),
        meta: line.expected || undefined,
        moveDisabledReason: canEdit
          ? undefined
          : 'Only the plan owner can move a line, and only while the plan is a draft.',
      })),
    [lines, canEdit],
  )

  return (
    <>
      <Board
        columns={columns}
        cards={cards}
        onMove={(cardId, toColumnId) => onMoveLine(cardId, toColumnId)}
        onOpenCard={onOpenLine}
        emptyColumnLabel="Nothing planned"
        moveErrorMessage="That line could not be moved and has gone back to the day it came from."
      />
    </>
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
  onRemoveLine,
  dayLabel,
  permissionReason,
}: {
  day: string
  lines: PlanBoardLine[]
  canEdit: boolean
  onOpenLine: (lineId: string) => void
  /** Optional: when given, a full-width "Add a line" button ends the list. The
   *  phone editor omits it and uses the screen's floating add button instead. */
  onAdd?: () => void
  /** Optional: when given (and canEdit), each card carries a remove button. */
  onRemoveLine?: (lineId: string) => void
  /** Names the day in the remove button's label, e.g. "Tue 28". */
  dayLabel?: string
  /**
   * Set when the plan is editable by status but this person lacks the
   * permission: the remove button then shows disabled with this reason on tap
   * (section 26). A plan locked by status shows no remove button; its banner
   * already says why.
   */
  permissionReason?: string
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
          <div key={line.id} className="relative">
            <button
              type="button"
              onClick={() => onOpenLine(line.id)}
              className={[
                'flex min-h-11 w-full flex-col gap-1 rounded-xl border border-border-light bg-surface p-3 text-left transition-[background-color] duration-200 hover:bg-surface-control active:bg-surface-control-pressed',
                (canEdit || permissionReason) && onRemoveLine ? 'pr-14' : '',
              ].join(' ')}
            >
              <span className="block text-body font-medium text-text-primary">
                <Truncate>{line.title}</Truncate>
              </span>
              {line.person && (
                <span className="block text-label text-text-secondary">
                  <Truncate>{`with ${line.person}`}</Truncate>
                </span>
              )}
              {line.agenda && (
                <span className="text-label text-text-secondary">{line.agenda}</span>
              )}
              {line.expected && (
                <span className="text-meta text-text-muted">{line.expected}</span>
              )}
            </button>
            {!canEdit && permissionReason && onRemoveLine && (
              <div className="absolute right-1 top-1/2 -translate-y-1/2">
                <PermissionTooltip allowed={false} reason={permissionReason}>
                  <button
                    type="button"
                    disabled
                    aria-label={`Remove ${line.title} from ${dayLabel ?? 'this day'}`}
                    className="flex size-11 items-center justify-center rounded-lg text-text-secondary opacity-50"
                  >
                    <XIcon className="size-5" aria-hidden />
                  </button>
                </PermissionTooltip>
              </div>
            )}
            {canEdit && onRemoveLine && (
              <button
                type="button"
                onClick={() => onRemoveLine(line.id)}
                aria-label={`Remove ${line.title} from ${dayLabel ?? 'this day'}`}
                className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-text-secondary active:bg-surface-control-pressed"
              >
                <XIcon className="size-5" aria-hidden />
              </button>
            )}
          </div>
        ))
      )}

      {canEdit && onAdd && (
        <Button variant="secondary" onClick={onAdd} className="min-h-11 w-full">
          Add a line
        </Button>
      )}
    </div>
  )
}
