"use client"

import * as React from "react"
import { EllipsisIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PermissionTooltip } from "@/components/ui/permission-tooltip"
import { Truncate } from "@/components/ui/truncate"
import { toast } from "@/components/ui/sonner"

/**
 * Section 35. The third view of a list page, beside list and card.
 *
 * One column per value of a single status field, one card per record.
 * It occupies zone 3 of section 11.1 and nothing else about the page
 * changes: the same header, the same toolbar, the same filters, the
 * same pagination bar underneath.
 *
 * WHAT THIS COMPONENT OWNS, so a call site cannot get it wrong:
 *
 *   - SEVEN COLUMNS MAXIMUM, and it throws past that. Section 12.1
 *     caps the sidebar at seven for the reason that applies here:
 *     beyond seven people stop scanning and start hunting. A limit
 *     that renders the eighth column anyway is not a limit.
 *   - TWENTY-FIVE CARDS A COLUMN, then Load more (section 35.7). The
 *     column header states the TRUE total throughout, never the
 *     rendered count, so a column reading 48 with 25 cards under it is
 *     saying exactly what it is showing.
 *   - THE MOVE IS AN ACTION, NOT A GESTURE. `onMove` is the single
 *     call every path goes through. The card moves optimistically and
 *     returns to where it came from if the save fails, with an error
 *     toast. A card never sits in a column the server did not agree
 *     to.
 *   - THE MENU IS THE BASELINE PATH AND IS NEVER REMOVED (section
 *     35.6). Dragging is agreed and lands on top of this same
 *     `onMove`; when it does, nothing at a call site changes. A board
 *     whose only route is a drag is unusable by keyboard.
 *   - A CARD NEVER SHOWS THE STATUS THE COLUMNS ARE MADE OF (section
 *     35.5). The column is that fact. `badge` is for a card's OTHER
 *     status fields.
 *
 * WHAT THE CALLER OWNS:
 *
 *   - The container. A board needs a host with a fixed height and
 *     `min-h-0`; it fills what it is given. Section 31.4 records the
 *     same trap costing a day - the data entry grid was fine in a list
 *     page's data area and clipped inside a `card`, because `card` is
 *     `overflow-hidden`. A board in a container that will not give it
 *     a height renders one screen tall with its columns cut off.
 *   - The empty state's variant. Only the caller knows whether filters
 *     are active, and section 13 turns on exactly that: never offer
 *     "add your first record" to somebody whose filter matched
 *     nothing.
 *   - Not offering the board below 768px at all (section 35.3). Use
 *     `useBoardAvailable` for that, so the view switcher has one
 *     implementation of the rule rather than each screen's own.
 *
 * SCROLL SHAPE (section 35.8), and it is a scoped exception to section
 * 10 rule 2: the board scrolls HORIZONTALLY and each column scrolls
 * VERTICALLY inside it. Those are different axes, so section 1 rule 8
 * is not engaged - the two never compete for one gesture. What WOULD
 * engage it is the page scrolling vertically behind a column that also
 * scrolls vertically, which is why the fixed height above is a
 * requirement and not a layout preference.
 */

/** Section 35.4. Past this the component throws rather than rendering. */
const MAX_COLUMNS = 7

/** Section 35.7. Matches section 11.1's default page size of 25. */
const CARDS_PER_COLUMN = 25

type BoardColumn = {
  /** Matches `BoardCard.columnId`. The status field's stored value. */
  id: string
  /** The column heading. The status field's display value. */
  label: string
  /**
   * The TRUE number of records in this column under the current
   * filters - not the number of cards passed in, and not the number
   * rendered. Section 35.4: a column showing 25 of 48 says so.
   */
  total: number
}

type BoardCard = {
  id: string
  /** Which column the record is in. Matches `BoardColumn.id`. */
  columnId: string
  /**
   * The record's name. Leads the card, truncates to one line with the
   * full text as a tooltip (sections 8 and 11.6).
   */
  title: string
  /**
   * At most two supporting facts. The tuple type is the section 11.6
   * five-piece cap made unbreakable: title, two facts, one meta line,
   * one badge.
   */
  facts?: [React.ReactNode] | [React.ReactNode, React.ReactNode]
  /** One meta line, in meta style. */
  meta?: React.ReactNode
  /**
   * A status the columns are NOT made of - a payment state on a deal
   * card in a stage board. Pass a `Badge`. Section 35.5 forbids
   * repeating the column's own status here.
   */
  badge?: React.ReactNode
  /**
   * Section 26. When set, this card cannot be moved and the menu says
   * why, through `PermissionTooltip` - a disabled control carries
   * `pointer-events-none` and can never show a tooltip of its own.
   * States who may do it: "Only an administrator can move a closed
   * deal", never "You do not have permission".
   */
  moveDisabledReason?: string
}

function Board({
  columns,
  cards,
  onMove,
  onOpenCard,
  onLoadMore,
  empty,
  emptyColumnLabel = "Nothing in this column",
  moveErrorMessage = "That could not be saved and the card has gone back where it was. Check the connection and try the move again.",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "onDrop"> & {
  /** In the order the work moves in. Seven maximum. */
  columns: BoardColumn[]
  cards: BoardCard[]
  /**
   * THE action. Every move - menu, keyboard, and the drag that lands
   * on top of this later - is this one call. Reject, or throw, and the
   * card goes back to the column it came from.
   *
   * Section 14 rule 4: give it a deadline at the point the request is
   * made. A promise that cannot reject cannot be reverted, and the
   * optimistic card stays in the wrong column for ever.
   */
  onMove: (cardId: string, toColumnId: string) => void | Promise<unknown>
  /** Section 11.6: the whole card is clickable, not only the title. */
  onOpenCard?: (cardId: string) => void
  /**
   * Called when a column's Load more is pressed, for a caller that
   * pages from the server. A caller holding every card already can
   * omit it - the column reveals the next 25 either way.
   */
  onLoadMore?: (columnId: string) => void
  /**
   * Section 13, rendered in place of the board when there are no cards
   * at all. The caller picks the variant because only it knows whether
   * filters are active.
   */
  empty?: React.ReactNode
  /** Section 35.9. One line. Never a blank column, never "No data". */
  emptyColumnLabel?: string
  /**
   * Section 7.2: cause, then the next action. Error toasts never
   * auto-dismiss (section 25).
   */
  moveErrorMessage?: string
}) {
  if (columns.length > MAX_COLUMNS) {
    throw new Error(
      `[design-system] A board was given ${columns.length} columns. ` +
        `AGENTS.md section 35.4: maximum seven. Beyond seven people ` +
        `stop scanning and start hunting, and a pipeline with more ` +
        `stages than that has a process problem the interface cannot ` +
        `solve.`,
    )
  }

  /*
   * The optimistic layer. `moved` holds cardId -> columnId for moves
   * that have been shown but not yet confirmed, and `pending` holds
   * the ids still in flight. A failure deletes the entry, so the card
   * falls back to the column the data says it is in - which is the
   * revert, without a second copy of the truth to keep in step.
   */
  const [moved, setMoved] = React.useState<Record<string, string>>({})
  const [pending, setPending] = React.useState<Record<string, true>>({})
  const [visible, setVisible] = React.useState<Record<string, number>>({})

  const columnOf = React.useCallback(
    (card: BoardCard) => moved[card.id] ?? card.columnId,
    [moved],
  )

  async function move(card: BoardCard, toColumnId: string) {
    const from = columnOf(card)
    if (from === toColumnId) return

    // Shown first. Waiting for a round trip before the card moves makes
    // the board feel broken on every slow connection.
    setMoved((m) => ({ ...m, [card.id]: toColumnId }))
    setPending((p) => ({ ...p, [card.id]: true }))

    try {
      await onMove(card.id, toColumnId)
      // Left in place: the data prop catches up on the next render and
      // `moved` agreeing with it is a no-op, so clearing it here would
      // flash the card back for one frame.
    } catch {
      setMoved((m) => {
        const next = { ...m }
        // Back to what the data says, not to a remembered value - the
        // two cannot disagree if only one of them exists.
        delete next[card.id]
        return next
      })
      toast.error(moveErrorMessage)
    } finally {
      setPending((p) => {
        const next = { ...p }
        delete next[card.id]
        return next
      })
    }
  }

  const grouped = React.useMemo(() => {
    const byColumn: Record<string, BoardCard[]> = {}
    for (const column of columns) byColumn[column.id] = []

    for (const card of cards) {
      const id = moved[card.id] ?? card.columnId
      const bucket = byColumn[id]
      if (!bucket) continue // a value with no column of its own is not rendered
      // A card that has just been moved goes to the top of where it
      // landed, so the user sees where it went rather than hunting for
      // it at whatever position the source order gives it.
      if (moved[card.id]) bucket.unshift(card)
      else bucket.push(card)
    }
    return byColumn
  }, [cards, columns, moved])

  if (cards.length === 0 && empty) {
    return <>{empty}</>
  }

  return (
    <div
      data-slot="board"
      className={cn(
        // Horizontal here, vertical inside each column. Different axes,
        // so section 1 rule 8 is not engaged. `min-h-0` is what lets
        // the columns be shorter than their content instead of pushing
        // the board taller than its host.
        "flex h-full min-h-0 items-stretch gap-4 overflow-x-auto overflow-y-hidden",
        className,
      )}
      {...props}
    >
      {columns.map((column) => {
        const columnCards = grouped[column.id] ?? []
        const shown = visible[column.id] ?? CARDS_PER_COLUMN
        const rendered = columnCards.slice(0, shown)
        const hasMore = columnCards.length > rendered.length

        return (
          <section
            key={column.id}
            data-slot="board-column"
            aria-label={`${column.label}, ${column.total} records`}
            className="flex h-full min-h-0 w-board-column shrink-0 flex-col rounded-xl border border-border-light bg-surface-sunken"
          >
            {/*
              Outside the scroller rather than sticky inside it: the
              guarantee section 35.4 asks for is that scrolling a long
              column never leaves its cards unlabelled, and a header
              that is not in the scrolling box cannot scroll away at
              all.
            */}
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border-light px-3 py-3">
              <p className="min-w-0 text-body font-medium text-text-primary">
                <Truncate>{column.label}</Truncate>
              </p>
              {/* The true total, never the rendered count (35.4). */}
              <p className="shrink-0 text-meta text-text-muted tabular-nums">
                {column.total}
              </p>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              {rendered.length === 0 ? (
                /*
                 * Section 35.9. An empty COLUMN is not an empty SCREEN:
                 * section 13's heading, line and action repeated across
                 * seven columns is six invitations to create a record
                 * in a stage nobody asked about. One muted line - and
                 * still never a blank area.
                 */
                <p className="px-1 py-2 text-label text-text-muted">
                  {emptyColumnLabel}
                </p>
              ) : (
                rendered.map((card) => (
                  <BoardCardView
                    key={card.id}
                    card={card}
                    columns={columns}
                    currentColumnId={columnOf(card)}
                    pending={pending[card.id] === true}
                    onMove={move}
                    onOpenCard={onOpenCard}
                  />
                ))
              )}

              {hasMore ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setVisible((v) => ({
                      ...v,
                      [column.id]: shown + CARDS_PER_COLUMN,
                    }))
                    onLoadMore?.(column.id)
                  }}
                >
                  Load more
                </Button>
              ) : null}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function BoardCardView({
  card,
  columns,
  currentColumnId,
  pending,
  onMove,
  onOpenCard,
}: {
  card: BoardCard
  columns: BoardColumn[]
  currentColumnId: string
  pending: boolean
  onMove: (card: BoardCard, toColumnId: string) => void
  onOpenCard?: (cardId: string) => void
}) {
  // Section 35.6: every column EXCEPT the one it is already in. A card
  // cannot move to where it is, so a disabled item would explain
  // nothing and an enabled one would do nothing.
  const destinations = columns.filter((c) => c.id !== currentColumnId)
  const canMove = card.moveDisabledReason === undefined && !pending

  return (
    <article
      data-slot="board-card"
      data-pending={pending || undefined}
      className={cn(
        "relative flex flex-col gap-2 rounded-xl border border-border-light bg-surface p-3",
        /*
         * NOT `transition-colors`, and this is load-bearing rather than
         * fussy. That utility transitions `outline-color` along with
         * the rest, and combined with the `has-[:focus-visible]` ring
         * below the colour never lands: the ring renders in
         * `currentColor` - black - instead of `primary-ring`, and it
         * stays there. Measured in Chrome on this kit: with
         * `transition-colors` the focused card's outline reads
         * rgb(23,23,23) after 700ms; with the transition narrowed to
         * the background it reads rgb(42,111,108) immediately.
         *
         * It is the quiet kind of wrong. A ring still appears, so the
         * screen looks correct and nothing errors - the ring is simply
         * not the colour section 6.4 requires, on every card on the
         * board. A button is unaffected because it takes the ring
         * through `focus-visible:` on itself rather than through
         * `:has()` on a parent.
         */
        "transition-[background-color]",
        // Section 11.6: the whole card is clickable, so the whole card
        // carries the states (section 6.4).
        onOpenCard && "hover:bg-surface-control active:bg-surface-control-pressed",
        // The ring belongs to the card, not to the title button inside
        // it: a keyboard user needs to see which CARD is focused, and a
        // ring around three words of text does not say that.
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-ring",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {onOpenCard ? (
            <button
              type="button"
              onClick={() => onOpenCard(card.id)}
              // The stretched pseudo-element is what makes the whole
              // card clickable while leaving the menu button above it
              // clickable in its own right. Its own outline is removed
              // because the card carries the ring.
              className="block w-full cursor-pointer text-left outline-none after:absolute after:inset-0 after:content-['']"
            >
              <span className="block text-body font-medium text-text-primary">
                <Truncate>{card.title}</Truncate>
              </span>
            </button>
          ) : (
            <span className="block text-body font-medium text-text-primary">
              <Truncate>{card.title}</Truncate>
            </span>
          )}
        </div>

        {/* z-10 so it sits above the stretched hit area of the title. */}
        <div className="relative z-10 shrink-0">
          <PermissionTooltip
            allowed={card.moveDisabledReason === undefined}
            reason={card.moveDisabledReason ?? ""}
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!canMove}
                    aria-label={`Actions for ${card.title}`}
                  />
                }
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/*
                  DropdownMenuLabel renders Base UI's GroupLabel, which
                  reads MenuGroupContext and THROWS without a Group
                  above it - the render unwinds and the page goes
                  blank, so the symptom reads as "the menu will not
                  open". The group is what the label is the accessible
                  name OF.
                */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Move to</DropdownMenuLabel>
                  {destinations.map((destination) => (
                    <DropdownMenuItem
                      key={destination.id}
                      onClick={() => onMove(card, destination.id)}
                    >
                      {destination.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </PermissionTooltip>
        </div>
      </div>

      {card.facts?.length ? (
        <div className="flex flex-col gap-1">
          {card.facts.map((fact, i) => (
            <span key={i} className="block text-label text-text-secondary">
              {fact}
            </span>
          ))}
        </div>
      ) : null}

      {card.badge || card.meta ? (
        <div className="flex items-center justify-between gap-2">
          {/*
            Section 35.5: this is a status the columns are NOT made of.
            The column is the card's own status and repeating it here
            would state one fact twice - and disagree with the column
            for as long as a move is in flight.
          */}
          {card.badge ?? <span />}
          {card.meta ? (
            <span className="min-w-0 text-meta text-text-muted">
              <Truncate>{String(card.meta)}</Truncate>
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

/**
 * Section 35.3: the board is offered at 768px and above, and below that
 * the view switcher shows list and card only.
 *
 * It lives here rather than in each screen so the rule has one
 * implementation. The only thing a board does is show the stages side
 * by side; one column at a time, stacked, is a list with extra steps -
 * it costs the comparison that is the whole point and gives nothing
 * back. A user whose remembered view was the board sees the list, and
 * that is not an error state: nothing failed, a view is simply not
 * offered at this width.
 *
 * It reports `false` on the server and until the first effect runs, so
 * the markup matches on both sides of hydration. A switcher rendering
 * the board button one frame late is invisible; a hydration mismatch is
 * not.
 */
function useBoardAvailable() {
  const [available, setAvailable] = React.useState(false)

  React.useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)")
    const read = () => setAvailable(query.matches)
    read()
    query.addEventListener("change", read)
    return () => query.removeEventListener("change", read)
  }, [])

  return available
}

export {
  Board,
  useBoardAvailable,
  type BoardColumn,
  type BoardCard,
  MAX_COLUMNS as BOARD_MAX_COLUMNS,
  CARDS_PER_COLUMN as BOARD_CARDS_PER_COLUMN,
}
