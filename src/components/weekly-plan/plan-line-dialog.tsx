'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Add or edit ONE planned line, for the seven-column board (F9-F13).
 *
 * ---------------------------------------------------------------------------
 * WHY A DIALOG AT ALL
 *
 * The old screen edited a line as a row of inputs laid out across the day
 * card. A board column is 280px wide, so the row does not fit and never will —
 * the fields moved into a dialog rather than being shrunk until they lie about
 * how much room they have.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE
 *
 * `dist`, `dealer` and `others` are gone from the FORM and from the CARD
 * (F12), and their columns are still in the database. So they are carried on
 * the draft untouched and written back exactly as they arrived. Dropping them
 * from this dialog instead of from the row type is the whole point: an
 * existing line keeps whatever counts its author typed, and a new line writes
 * the zeroes the old form would have written. Nothing in the write path can
 * tell the difference.
 *
 * The same is true of `fromPlace`, `toPlace`, `modeOfTravel` and `note`.
 *
 * ⚠️ `note` is NOT an input here, and that is not an oversight. On live, 78
 * rows have a legacy count stringified into `notes`, and the read path still
 * parses it back out (`readOthers` on the plan screen). An agenda field
 * writing free text into that column would corrupt those rows. The card READS
 * `note` as the agenda line, which is safe; writing it needs the column the
 * data model task will add.
 */

export type PlanLineDraft = {
  id: string
  partyId: string
  partyType: 'company' | 'contact' | ''
  expectedOrderValue: string
  /** Carried through untouched — see the note above. */
  dist: number
  dealer: number
  others: number
  fromPlace: string
  toPlace: string
  modeOfTravel: string
  note: string
}

export function PlanLineDialog({
  open,
  mode,
  dateLabel,
  date,
  dayOptions,
  onDateChange,
  draft,
  companyType,
  canRemove,
  /** Rendered by the caller so the party list stays in one place. */
  partyField,
  onExpectedValueChange,
  onSave,
  onRemove,
  onClose,
}: {
  open: boolean
  mode: 'add' | 'edit'
  dateLabel: string
  date: string
  /**
   * The seven days, as `[value, label]`. The day is a FIELD rather than a
   * fixed subtitle because a line can be added from the page header, where
   * nothing has said which day it is for yet. Opened from a day, the field is
   * simply pre-filled with that day.
   */
  dayOptions: [string, string][]
  onDateChange: (date: string) => void
  draft: PlanLineDraft | null
  /** From the Company master. Read-only wherever it is shown (§5.1). */
  companyType: string | null
  canRemove: boolean
  partyField: React.ReactNode
  onExpectedValueChange: (raw: string) => void
  onSave: () => void
  onRemove: () => void
  onClose: () => void
}) {
  /*
   * Save is blocked rather than hidden while no party is chosen, and the
   * reason is stated under the field. A hidden primary action reads as a
   * broken dialog; a disabled one that says why reads as a form.
   */
  const hasParty = Boolean(draft?.partyId)

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'add' ? 'Add a line' : 'Edit line'}
          </DialogTitle>
          {/*
            Not the date. The Day field below states it and can change it, and
            saying it twice would leave a stale subtitle above a field the user
            has just altered.
          */}
          <DialogDescription>
            {dateLabel
              ? 'Pick the day, the party, and what you expect from the visit.'
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Day</Label>
            {/*
              The kit's Select, never a bare `<select>` — F8 and F16 were both
              a raw OS dropdown reaching a user, and the rule from them is
              standing.
            */}
            <Select
              value={date}
              // Base UI hands back `string | null`; there is no clear control
              // on this field, so null only arrives if one is ever added.
              onValueChange={v => { if (v) onDateChange(v) }}
            >
              <SelectTrigger className="w-full">
                {/*
                  Base UI renders the raw VALUE unless it is told otherwise,
                  and the value here is `2026-09-19`. The trigger read as an
                  ISO date while every option under it read "Saturday, 19 Sep".
                */}
                <SelectValue placeholder="Pick a day">
                  {(value: string | null) =>
                    dayOptions.find(([v]) => v === value)?.[1] ?? 'Pick a day'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {dayOptions.map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-line-party">Party</Label>
            {partyField}
            {!hasParty && (
              <p className="text-meta text-text-muted">
                Choose the company or contact this visit is for.
              </p>
            )}
          </div>

          {/*
            §5.1: the Company Type comes from the master and is shown locked.
            Text, never a disabled input — a disabled input still reads as a
            field somebody could switch on.
          */}
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <div className="rounded-lg border border-border-light bg-surface-sunken px-3 py-2 text-body">
              {hasParty ? (
                <span className="text-text-secondary">{companyType || '—'}</span>
              ) : (
                <span className="text-text-muted">Select a party first</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-line-value">Expected order value</Label>
            <input
              id="plan-line-value"
              type="text"
              inputMode="decimal"
              value={draft?.expectedOrderValue ?? ''}
              onChange={e => onExpectedValueChange(e.target.value)}
              placeholder="Optional"
              // 16px below sm or iOS zooms the page on focus.
              className="w-full rounded-lg border border-border-light px-3 py-2 text-[16px] text-text-primary placeholder:text-text-muted focus:ring-2 focus:ring-primary-ring focus:outline-none sm:text-sm"
            />
          </div>

          {/*
            Read-only, and only when there is something to show. A legacy line
            carries a note that the card uses as its agenda; saying so here
            stops it looking like the dialog lost it.
          */}
          {draft?.note ? (
            <div className="flex flex-col gap-1.5">
              <Label>Agenda</Label>
              <p className="rounded-lg border border-border-light bg-surface-sunken px-3 py-2 text-body text-text-secondary">
                {draft.note}
              </p>
              <p className="text-meta text-text-muted">
                Carried from the existing plan. Editing an agenda comes with the
                next change to this screen.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {canRemove && mode === 'edit' && (
            <Button variant="danger" onClick={onRemove} className="mr-auto">
              Remove line
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!hasParty}>
            {mode === 'add' ? 'Add line' : 'Save line'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Below 768px the board is not offered (section 35.3), so the week is shown
 * one day at a time. This is the day picker: seven pills that scroll
 * horizontally, each stating its own line count, so the counts F9 asks for
 * survive at phone width instead of being a desktop-only fact.
 */
export function DayPicker({
  days,
  counts,
  selected,
  today,
  onSelect,
}: {
  days: string[]
  counts: Record<string, number>
  selected: string
  today: string | null
  onSelect: (day: string) => void
}) {
  const [node, setNode] = useState<HTMLDivElement | null>(null)

  /*
   * Reveal the chosen pill by driving THIS strip's scrollLeft, never
   * `scrollIntoView` — that walks up to the nearest scrollable ancestor and
   * jumps the whole page, which on a phone throws the board out of view.
   */
  useEffect(() => {
    if (!node) return
    const pill = node.querySelector<HTMLElement>(`[data-day="${selected}"]`)
    if (!pill) return
    const target = pill.offsetLeft - (node.clientWidth - pill.clientWidth) / 2
    node.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }, [node, selected])

  return (
    <div
      ref={setNode}
      className="flex gap-2 overflow-x-auto pb-1"
      role="tablist"
      aria-label="Day of the week"
    >
      {days.map(day => {
        const d = new Date(day + 'T00:00:00')
        const active = day === selected
        return (
          <button
            key={day}
            data-day={day}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(day)}
            // 44px minimum touch target.
            className={[
              'flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-label transition-[background-color,border-color] duration-200',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border-light bg-surface text-text-secondary hover:bg-surface-control',
            ].join(' ')}
          >
            <span className="font-medium">
              {d.toLocaleDateString('en-IN', { weekday: 'short' })} {d.getDate()}
            </span>
            <span
              className={[
                'rounded px-1.5 text-meta tabular-nums',
                active ? 'bg-white/20' : 'bg-surface-sunken text-text-muted',
              ].join(' ')}
            >
              {counts[day] ?? 0}
            </span>
            {day === today && (
              <span className={active ? 'text-meta' : 'text-meta text-primary'}>
                Today
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
