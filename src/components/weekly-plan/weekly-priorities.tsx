'use client'

import { ChevronDownIcon, PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * F14 — "Upcoming week I want to Achieve", after the board took the screen.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A STRIP AT THE BOTTOM AND NOT A COLUMN OR A DIALOG
 *
 * Aryan's own suggestion was "at the end, small vertical space with full width
 * and internal scrolling", held loosely. Two alternatives were considered and
 * rejected:
 *
 *   - An eighth column. The board throws past seven, and rightly: these are
 *     not a day, so a column for them would claim they are.
 *   - Behind a button. Weekly Review reads this same data for its
 *     ticked-versus-open list, and the ticking happens DURING the week, on
 *     this screen, while the plan is Approved and everything else is locked.
 *     A checklist you have to go and find is a checklist nobody ticks.
 *
 * So: the strip, full width, its own scroll, and collapsible — because the
 * board is the thing that wants the height on a laptop, and a person who has
 * finished writing their points should be able to give it back. The collapse
 * is animated rather than snapped, and the done-of-total count stays visible
 * while collapsed, so collapsing never hides whether there is anything to do.
 *
 * ⚠️ The ROW is what Weekly Review reads. Nothing here changes the shape the
 * plan screen sends: text, is_done and sort_order, exactly as before.
 */

export type PriorityRow = {
  key: string
  id: string | null
  text: string
  is_done: boolean
}

export function WeeklyPriorities({
  rows,
  canEdit,
  open,
  onToggleOpen,
  onChangeText,
  onToggleDone,
  onAdd,
  onRemove,
}: {
  rows: PriorityRow[]
  canEdit: boolean
  open: boolean
  onToggleOpen: () => void
  onChangeText: (key: string, text: string) => void
  onToggleDone: (key: string) => void
  onAdd: () => void
  onRemove: (key: string) => void
}) {
  const written = rows.filter(r => r.text.trim())
  const done = written.filter(r => r.is_done).length

  return (
    <section className="shrink-0 rounded-xl border border-border-light bg-surface">
      <div className="flex min-h-11 items-center gap-3 px-4">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          className="flex min-h-11 flex-1 items-center gap-2 text-left"
        >
          <ChevronDownIcon
            className={[
              'size-4 shrink-0 text-text-muted transition-transform duration-200 ease-out',
              open ? '' : '-rotate-90',
            ].join(' ')}
          />
          <span className="text-body font-medium text-text-primary">
            Upcoming week I want to Achieve
          </span>
          {/*
            Said once. The count is here and nowhere else — the old screen had
            it next to the heading AND implied it again by the ticked rows.
          */}
          {written.length > 0 && (
            <span className="text-meta text-text-muted tabular-nums">
              {done}/{written.length} done
            </span>
          )}
        </button>

        {canEdit && open && (
          <Button variant="ghost" size="sm" onClick={onAdd} className="shrink-0">
            <PlusIcon />
            Add
          </Button>
        )}
      </div>

      {/*
        Animated with a grid row rather than max-height: a guessed max-height
        either clips a long list or eases against a number the content never
        reaches, which is the stutter at the end of every such transition.
      */}
      <div
        className={[
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        ].join(' ')}
      >
        <div className="overflow-hidden">
          {/* Its own scroll, so a long list never pushes the board off. */}
          <div className="max-h-40 space-y-2 overflow-y-auto px-4 pt-1 pb-4">
            {rows.map((row, i) => (
              <div key={row.key} className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={row.is_done}
                  /*
                   * Ticking is allowed in EVERY status, unlike everything else
                   * on this screen. The points are ticked during the week, and
                   * during the week the plan is Approved — gating this on
                   * canEdit would lock the checklist exactly when it is for.
                   */
                  disabled={!row.text.trim()}
                  onChange={() => onToggleDone(row.key)}
                  aria-label={
                    row.text.trim()
                      ? `Mark "${row.text.trim()}" done`
                      : 'Point not written yet'
                  }
                  className="size-[18px] shrink-0 cursor-pointer rounded border-border accent-primary disabled:cursor-default disabled:opacity-40"
                />
                <input
                  type="text"
                  disabled={!canEdit}
                  value={row.text}
                  onChange={e => onChangeText(row.key, e.target.value)}
                  placeholder={
                    i === 0
                      ? 'e.g. Close the Nashik distributor appointment'
                      : 'Add a point…'
                  }
                  className={[
                    'min-h-11 min-w-0 flex-1 rounded-lg border border-border-light px-3 py-2 text-[16px] placeholder:text-text-muted focus:ring-2 focus:ring-primary-ring focus:outline-none disabled:bg-surface-sunken disabled:text-text-muted sm:min-h-0 sm:text-sm',
                    row.is_done ? 'text-text-muted line-through' : 'text-text-primary',
                  ].join(' ')}
                />
                {canEdit && (
                  <Button
                    variant="in-field"
                    size="icon"
                    onClick={() => onRemove(row.key)}
                    aria-label="Remove point"
                    className="shrink-0"
                  >
                    <XIcon />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
