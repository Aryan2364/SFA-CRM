"use client"

import * as React from "react"
import { ChevronRightIcon, EllipsisIcon, PlusIcon, TrashIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  whenLayersSettled,
} from "@/components/ui/sheet"
import { toast } from "@/components/ui/sonner"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/**
 * FRONTEND_RULES_PHONE.md 41.7 rule 16, built as a standalone part usable
 * inside any form (section 4 rule 1: Add and Edit are the one form, so
 * this is not waiting on the form page template).
 *
 * "Repeating rows in a form, such as an invoice's line items, show as a
 * list of rows, each summarising one line (item, quantity, amount), with
 * the total below. Tapping a row opens it as its own screen to edit, with
 * Save in its action bar and Remove in its three-dot menu. "Add item" adds
 * a line. Read-only tables inside a record show the same way, without
 * editing."
 *
 * HOW EACH PART OF THE RULE IS MET:
 *
 *   - "a list of rows, each summarising one line": on phone, `summary`
 *     renders each row as a title / detail / amount line, in the shape of
 *     a phone list row (41.5 rules 9 to 11): body strong title, up to two
 *     lines; one supporting line, truncated; the amount right-aligned.
 *   - "with the total below": `total`, when given, is a label-value pair
 *     in body strong under the rows (3 rule 5), with a 1px rule above it
 *     (not the 2px report-total rule of 34.1 - these rows are not a
 *     report table).
 *   - "Tapping a row opens it as its own screen to edit": on phone each
 *     row is a 44px+ button that opens the row in a `SheetContent
 *     presentation="screen"` layer (sheet.tsx, 41.8 rule 10) - the same
 *     full-screen layer a medium or large dialog becomes, so it gets the
 *     app bar, the back arrow, Android back and the keyboard handling for
 *     free, with no part of the mechanism rebuilt here.
 *   - "with Save in its action bar": the layer's SheetFooter, which
 *     becomes the action bar (sheet.tsx's ActionBarFrame) on a screen
 *     presentation. Values are controlled and already live in the
 *     caller's state as the person types (`set`, below), so Save's one
 *     job is to return to the list; nothing more to commit.
 *   - "and Remove in its three-dot menu": the sheet's header carries a
 *     three-dot DropdownMenu; `SheetContent`'s screen presentation lifts
 *     everything in the header besides the title into the app bar's
 *     actions automatically (sheet.tsx), so this never duplicates that
 *     wiring.
 *   - ""Add item" adds a line": the add button's words come from `text`
 *     (37.6), defaulting to "Add item".
 *   - "Read-only tables inside a record show the same way, without
 *     editing": `readOnly` drops the remove control and the add button,
 *     and on phone a row still opens its screen (SheetFooter is left out,
 *     since there is nothing to save), to read the full fields rather
 *     than the row's three-field summary.
 *
 * DECISIONS WHERE 41.7 RULE 16 IS SILENT:
 *
 *   - No row limit by default. `max`, when given, disables "Add" once
 *     reached and a muted line under it says so ("8 is the most you can
 *     add."), the same wording shape as the kit's other stated limits
 *     (41.6 rule 16).
 *   - Removing a row is a reversible action (section 38.1: "remove from a
 *     list" is named there), so it happens at once with an Undo toast,
 *     never a confirmation dialog (15 would be for a permanent delete,
 *     which this is not - the value is only taken out of the array the
 *     caller holds).
 *   - Focus after add and remove (39.3), which the rule does not state:
 *     on desktop, adding focuses the new row's first field, and removing
 *     moves focus to the next row's remove button, or the previous one,
 *     or "Add" when none are left. On phone 41.7 rule 17 forbids
 *     autofocus on opening any screen but the search page, so adding a
 *     row opens nothing and puts no field in focus; focus after Remove
 *     (closing the row's screen) is the screen's own return to its
 *     opener (39.3, sheet.tsx).
 *   - Desktop shape: the rule only describes the phone list-of-rows. On
 *     desktop each row renders inline (`renderRow`'s fields side by side,
 *     as a form row), with a quiet trash icon button at its end (6.3) -
 *     closer to how a desktop form already shows repeating fields than
 *     the data entry grid (section 31, a different, spreadsheet-shaped
 *     control for line items with many columns).
 *   - `getId` and a React `key`: rows need a stable identity to animate
 *     and to keep the sheet's own state attached to the right row across
 *     a reorder; the caller's data shape already needs its own id for
 *     persistence, so this asks for it rather than inventing one.
 *
 * CONTROLLED: the caller owns `value` and `onChange`, and supplies
 * `renderRow` for the fields of one row, so this works with any form's
 * state (section 4 rule 1 - the same shape, an Add and Edit, inside any
 * screen).
 */

type RepeatingRowsText = {
  /** "Add item" (37.2: starts with the verb). */
  addLabel: string
  /** The row's screen title and its three-dot menu's remove word. */
  removeLabel: string
  /** A row with no better title of its own: "Item 1", "Item 2". */
  rowLabel: (index: number) => string
  /** Past tense (37.4): "Item removed", or built from the row's own title. */
  removed: (title: string) => string
  /** "8 is the most you can add." */
  maxReached: (max: number) => string
}

const DEFAULT_TEXT: RepeatingRowsText = {
  addLabel: "Add item",
  removeLabel: "Remove",
  rowLabel: (index) => `Item ${index + 1}`,
  removed: (title) => `${title} removed`,
  maxReached: (max) => `${max} is the most you can add.`,
}

type RowSummary = {
  /** Body strong (41.5 rule 9); up to two lines on phone. */
  title: string
  /** One supporting line, truncated (41.5 rule 10). */
  detail?: string
  /** Right-aligned, tabular (41.5 rule 10, 18). */
  amount?: string
}

function RepeatingRows<T>({
  value,
  onChange,
  getId,
  newRow,
  renderRow,
  summary,
  total,
  max,
  readOnly = false,
  text,
  className,
}: {
  /** The rows, owned by the caller. */
  value: T[]
  onChange: (rows: T[]) => void
  /** A stable id for a row, for React keys and the phone screen's own state. */
  getId: (row: T) => string
  /** A freshly added row's starting values. */
  newRow: () => T
  /** The fields of one row. `set` merges a patch into that row only. */
  renderRow: (row: T, set: (patch: Partial<T>) => void, index: number) => React.ReactNode
  /** The row's summary line for the phone list and, read-only, the desktop list too. */
  summary: (row: T) => RowSummary
  /** The total shown below the rows, already formatted (section 18). */
  total?: { label: string; value: string }
  /** The most rows allowed. Unlimited when left out. */
  max?: number
  /** Read-only tables inside a record (41.7 rule 16's last sentence): no add, no remove. */
  readOnly?: boolean
  text?: Partial<RepeatingRowsText>
  className?: string
}) {
  const words = React.useMemo(() => ({ ...DEFAULT_TEXT, ...text }), [text])
  const { layout } = useLayout()
  const phone = layout === "phone"

  const atMax = typeof max === "number" && value.length >= max

  const setRow = (id: string, patch: Partial<T>) => {
    onChange(value.map((row) => (getId(row) === id ? { ...row, ...patch } : row)))
  }

  const removeRow = React.useCallback(
    (id: string, focusAfter?: (next: T[]) => void) => {
      const index = value.findIndex((row) => getId(row) === id)
      if (index < 0) return
      const removed = value[index]
      const next = value.filter((row) => getId(row) !== id)
      onChange(next)
      focusAfter?.(next)
      // 38.1: reversible, so an Undo toast rather than a confirmation.
      // The exact position is kept, so Undo restores it there, not at
      // the end.
      toast.undo(words.removed(summary(removed).title), () => {
        onChange([...next.slice(0, index), removed, ...next.slice(index)])
      })
    },
    [value, onChange, getId, summary, words]
  )

  // 39.3: after a remove, focus lands on the next row, or the previous
  // one, or "Add" once none are left; each layout gives its row targets.
  const addRef = React.useRef<HTMLButtonElement | null>(null)

  const addRow = () => {
    if (atMax) return
    onChange([...value, newRow()])
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {phone ? (
        <PhoneRows
          addRef={addRef}
          rows={value}
          getId={getId}
          renderRow={renderRow}
          setRow={setRow}
          summary={summary}
          removeRow={removeRow}
          readOnly={readOnly}
          words={words}
        />
      ) : (
        <DesktopRows
          addRef={addRef}
          rows={value}
          getId={getId}
          renderRow={renderRow}
          setRow={setRow}
          removeRow={removeRow}
          readOnly={readOnly}
          words={words}
        />
      )}

      {total ? (
        <div className="flex justify-between border-t border-border-light pt-3 text-body font-medium text-text-primary">
          <span>{total.label}</span>
          <span className="tabular-nums">{total.value}</span>
        </div>
      ) : null}

      {!readOnly ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            ref={addRef}
            variant="secondary"
            disabled={atMax}
            onClick={addRow}
            className="self-start"
          >
            <PlusIcon />
            {words.addLabel}
          </Button>
          {atMax ? (
            <p className="text-label text-text-muted">{words.maxReached(max as number)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------
   Desktop: each row inline, a quiet trash icon button at its end.
   ------------------------------------------------------------------ */

function DesktopRows<T>({
  addRef,
  rows,
  getId,
  renderRow,
  setRow,
  removeRow,
  readOnly,
  words,
}: {
  addRef: React.RefObject<HTMLButtonElement | null>
  rows: T[]
  getId: (row: T) => string
  renderRow: (row: T, set: (patch: Partial<T>) => void, index: number) => React.ReactNode
  setRow: (id: string, patch: Partial<T>) => void
  removeRow: (id: string, focusAfter?: (next: T[]) => void) => void
  readOnly: boolean
  words: RepeatingRowsText
}) {
  const removeRefs = React.useRef(new Map<string, HTMLButtonElement | null>())

  // 39.3: focus moves to the next row's remove button, or the previous
  // one, or to "Add" once none are left.
  const focusAfterRemove = (id: string) => (next: T[]) => {
    window.setTimeout(() => {
      if (next.length === 0) {
        addRef.current?.focus()
        return
      }
      const index = rows.findIndex((row) => getId(row) === id)
      const target = next[Math.min(index, next.length - 1)]
      removeRefs.current.get(getId(target))?.focus()
    }, 0)
  }

  if (rows.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => {
        const id = getId(row)
        return (
          <div
            key={id}
            className="flex items-end gap-3 rounded-lg border border-border-light p-3"
          >
            <div className="grid min-w-0 flex-1 grid-cols-12 gap-x-4 gap-y-6">
              {renderRow(row, (patch) => setRow(id, patch), index)}
            </div>
            {!readOnly ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                ref={(el) => {
                  removeRefs.current.set(id, el)
                }}
                onClick={() => removeRow(id, focusAfterRemove(id))}
                aria-label={words.removeLabel}
                title={words.removeLabel}
              >
                <TrashIcon />
              </Button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------
   Phone: a list of summary rows, each opening its own screen.
   ------------------------------------------------------------------ */

function PhoneRows<T>({
  addRef,
  rows,
  getId,
  renderRow,
  setRow,
  summary,
  removeRow,
  readOnly,
  words,
}: {
  addRef: React.RefObject<HTMLButtonElement | null>
  rows: T[]
  getId: (row: T) => string
  renderRow: (row: T, set: (patch: Partial<T>) => void, index: number) => React.ReactNode
  setRow: (id: string, patch: Partial<T>) => void
  summary: (row: T) => RowSummary
  removeRow: (id: string, focusAfter?: (next: T[]) => void) => void
  readOnly: boolean
  words: RepeatingRowsText
}) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  const rowRefs = React.useRef(new Map<string, HTMLButtonElement | null>())

  // The removed row's own button is gone, so the screen cannot hand focus
  // back to its opener: once the layer has closed and its history entry
  // is settled, focus the next row, or the previous one, or "Add".
  const focusAfterRemove = (index: number) => (next: T[]) => {
    void whenLayersSettled().then(() => {
      window.requestAnimationFrame(() => {
        if (next.length === 0) {
          addRef.current?.focus()
          return
        }
        const target = next[Math.min(index, next.length - 1)]
        rowRefs.current.get(getId(target))?.focus()
      })
    })
  }
  const openRow = rows.find((row) => getId(row) === openId) ?? null
  const openIndex = openRow ? rows.indexOf(openRow) : -1

  if (rows.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const id = getId(row)
        const line = summary(row)
        return (
          <button
            key={id}
            ref={(element) => {
              rowRefs.current.set(id, element)
            }}
            type="button"
            onClick={() => setOpenId(id)}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-lg border border-border-light px-4 py-3 text-left",
              "hover:bg-surface-control active:bg-surface-control-pressed",
              "outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-body font-medium text-text-primary">
                {line.title}
              </span>
              {line.detail ? (
                <span className="truncate text-label text-text-secondary">{line.detail}</span>
              ) : null}
            </div>
            {line.amount ? (
              <span className="shrink-0 text-right tabular-nums text-body text-text-primary">
                {line.amount}
              </span>
            ) : null}
            <ChevronRightIcon className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
          </button>
        )
      })}

      <Sheet open={openRow !== null} onOpenChange={(open) => !open && setOpenId(null)}>
        {openRow ? (
          <SheetContent
            presentation="screen"
            screenTitle={words.rowLabel(openIndex)}
          >
            <SheetHeader>
              <SheetTitle>{words.rowLabel(openIndex)}</SheetTitle>
              {!readOnly ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="on-brand" size="icon" />}
                  >
                    <EllipsisIcon />
                    <span className="sr-only">More actions</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant="danger"
                        onClick={() => {
                          const id = getId(openRow)
                          setOpenId(null)
                          removeRow(id, focusAfterRemove(openIndex))
                        }}
                      >
                        <TrashIcon />
                        {words.removeLabel}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </SheetHeader>
            <SheetBody>
              <div className="grid grid-cols-1 gap-6">
                {renderRow(openRow, (patch) => setRow(getId(openRow), patch), openIndex)}
              </div>
            </SheetBody>
            {!readOnly ? (
              <SheetFooter>
                <Button type="button" onClick={() => setOpenId(null)}>
                  Save
                </Button>
              </SheetFooter>
            ) : null}
          </SheetContent>
        ) : null}
      </Sheet>
    </div>
  )
}

export { RepeatingRows, type RepeatingRowsText, type RowSummary }
