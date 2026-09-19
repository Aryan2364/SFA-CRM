"use client"

import * as React from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type ScreenReaderInstructions,
} from "@dnd-kit/core"
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
 *     call every path goes through - the menu, the keyboard and the
 *     drag. The card moves optimistically and returns to where it came
 *     from if the save fails, with an error toast. A card never sits in
 *     a column the server did not agree to.
 *   - THE MENU IS THE BASELINE PATH AND IS NEVER REMOVED (section
 *     35.6). Dragging is an enhancement over it, and both end in the
 *     same `onMove`. A board whose only route is a drag is unusable by
 *     keyboard and by most assistive technology.
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

/*
 * dnd-kit addresses everything by one flat id space, so a column and a
 * record sharing a string would silently become the same drop target.
 * The prefixes keep them apart whatever the product's ids look like.
 */
const COLUMN_ID = (id: string) => `column:${id}`
const CARD_ID = (id: string) => `card:${id}`
const isColumnId = (id: string) => id.startsWith("column:")
const bareId = (id: string) => id.slice(id.indexOf(":") + 1)

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
  /**
   * One control belonging to THIS column, rendered in its header beside
   * the total - an add button on a board whose columns are days, say.
   *
   * It lives here rather than above the board because the board is the
   * horizontal scroll container: anything rendered as a sibling stays
   * put while the columns slide under it, so a per-column control
   * outside would drift away from the column it belongs to on the first
   * sideways scroll.
   *
   * Optional, and omitting it renders exactly what this component
   * rendered before the prop existed. Keep it to ONE small control:
   * the header is 44px of a 280px column and it already carries the
   * label and the count.
   */
  action?: React.ReactNode
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
   * Section 26. When set, this card cannot be moved: the menu is
   * disabled, the card is not draggable, and the reason is given
   * through `PermissionTooltip`, because a disabled control carries
   * `pointer-events-none` and can never show a tooltip of its own.
   * States who may do it: "Only an administrator can move a closed
   * deal", never "You do not have permission".
   */
  moveDisabledReason?: string
}

/**
 * Section 35.6. Arrow Left and Right step between columns.
 *
 * dnd-kit's built-in keyboard getter nudges by a fixed pixel step,
 * which is the right default for a free canvas and the wrong one here:
 * a board has a small number of large targets, and a keyboard user
 * wants the NEXT COLUMN, not a position 25px to the right of where
 * they were. Two presses to cross a 280px column is two chances to
 * land between two of them.
 *
 * Up and Down are deliberately unhandled. A drop is addressed to a
 * column, not to a position within one - the card's place inside a
 * column comes from the list's own sort (section 27.2), and offering a
 * gesture that appears to reorder while nothing saves the order would
 * be the lie section 35.10 rules out.
 */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return undefined

  const columns = context.droppableContainers
    .getEnabled()
    .filter((container) => isColumnId(String(container.id)))
    .map((container) => ({ id: container.id, rect: container.rect.current }))
    .filter((c): c is { id: typeof c.id; rect: NonNullable<typeof c.rect> } =>
      c.rect !== null,
    )
    .sort((a, b) => a.rect.left - b.rect.left)

  if (columns.length === 0) return undefined

  // Where the drag currently sits, by nearest column centre rather than
  // by containment: mid-gesture the pointer can be between two columns,
  // and "nearest" always has an answer where "inside" does not.
  let index = 0
  let best = Number.POSITIVE_INFINITY
  columns.forEach((column, i) => {
    const centre = column.rect.left + column.rect.width / 2
    const distance = Math.abs(centre - currentCoordinates.x)
    if (distance < best) {
      best = distance
      index = i
    }
  })

  const next = event.key === "ArrowRight" ? index + 1 : index - 1
  // Deliberately does not wrap. Wrapping past the last column lands the
  // card at the far end of the board, which reads as the drag having
  // gone wrong rather than as having reached the end.
  if (next < 0 || next >= columns.length) return undefined

  const target = columns[next].rect
  return {
    x: target.left + target.width / 2,
    y: currentCoordinates.y,
  }
}

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "Press space to pick this card up. Use the left and right arrow keys to choose a column, then press space to move it there. Press escape to cancel. Press enter to open the record instead.",
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
   * THE action. Every move - menu, keyboard and drag - is this one
   * call. Reject, or throw, and the card goes back to the column it
   * came from.
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
  const [draggingCardId, setDraggingCardId] = React.useState<string | null>(null)
  const dndId = React.useId()

  const columnOf = React.useCallback(
    (card: BoardCard) => moved[card.id] ?? card.columnId,
    [moved],
  )

  const move = React.useCallback(
    async (card: BoardCard, toColumnId: string) => {
      const from = moved[card.id] ?? card.columnId
      if (from === toColumnId) return

      // Shown first. Waiting for a round trip before the card moves
      // makes the board feel broken on every slow connection.
      setMoved((m) => ({ ...m, [card.id]: toColumnId }))
      setPending((p) => ({ ...p, [card.id]: true }))

      try {
        await onMove(card.id, toColumnId)
        // Left in place: the data prop catches up on the next render
        // and `moved` agreeing with it is a no-op, so clearing it here
        // would flash the card back for one frame.
      } catch {
        setMoved((m) => {
          const next = { ...m }
          // Back to what the data says, not to a remembered value -
          // the two cannot disagree if only one of them exists.
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
    },
    [moved, onMove, moveErrorMessage],
  )

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

  const byId = React.useMemo(() => {
    const map: Record<string, BoardCard> = {}
    for (const card of cards) map[card.id] = card
    return map
  }, [cards])

  /*
   * A small distance before a drag begins, so a press on the handle
   * that turns out to be a click is still a click. Without it, the
   * keyboard sensor and the pointer sensor fight over the same press.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: boardKeyboardCoordinates,
      /*
       * Space picks a card up; Enter is left alone so it still opens
       * the record (section 11.6). dnd-kit binds both by default, which
       * would give one key two meanings on the same control - and the
       * one a person reaches for first.
       */
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
    }),
  )

  const labelOf = React.useCallback(
    (columnId: string) =>
      columns.find((c) => c.id === columnId)?.label ?? columnId,
    [columns],
  )

  /*
   * Section 19's argument, applied to a gesture: a fact available only
   * by watching the screen is no fact at all for somebody who is not
   * watching it. The drop indicator says where the card will land to
   * anyone looking; these say the same thing to anyone not.
   */
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const card = byId[bareId(String(active.id))]
      return card
        ? `Picked up ${card.title} from ${labelOf(columnOf(card))}.`
        : undefined
    },
    onDragOver: ({ over }) =>
      over && isColumnId(String(over.id))
        ? `Over ${labelOf(bareId(String(over.id)))}.`
        : undefined,
    onDragEnd: ({ active, over }) => {
      const card = byId[bareId(String(active.id))]
      if (!card) return undefined
      if (!over || !isColumnId(String(over.id))) {
        return `${card.title} was left in ${labelOf(columnOf(card))}.`
      }
      return `${card.title} moved to ${labelOf(bareId(String(over.id)))}.`
    },
    onDragCancel: ({ active }) => {
      const card = byId[bareId(String(active.id))]
      return card
        ? `Cancelled. ${card.title} stayed in ${labelOf(columnOf(card))}.`
        : undefined
    },
  }

  function handleDragStart(event: DragStartEvent) {
    setDraggingCardId(bareId(String(event.active.id)))
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingCardId(null)
    const { active, over } = event
    if (!over || !isColumnId(String(over.id))) return
    const card = byId[bareId(String(active.id))]
    if (!card) return
    // The same call the menu makes. The drag decides the destination
    // and nothing else; everything after this point is identical.
    void move(card, bareId(String(over.id)))
  }

  if (cards.length === 0 && empty) {
    return <>{empty}</>
  }

  const draggingCard = draggingCardId ? byId[draggingCardId] : null

  return (
    <DndContext
      /*
       * Without a stable id, dnd-kit numbers its own accessibility
       * nodes from a module counter that starts over on the client, so
       * the `aria-describedby` it hands each draggable is one value on
       * the server and another after hydration - a mismatch React
       * reports and does not patch up, leaving the description pointing
       * at nothing. It only shows once a page carries more than one
       * board, which the reference page does and a product might not.
       * `useId` is stable across both renders, which is the whole
       * reason it exists.
       */
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingCardId(null)}
    >
      <div
        data-slot="board"
        className={cn(
          // Horizontal here, vertical inside each column. Different
          // axes, so section 1 rule 8 is not engaged. `min-h-0` is what
          // lets the columns be shorter than their content instead of
          // pushing the board taller than its host.
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
            <BoardColumnView
              key={column.id}
              column={column}
              cards={rendered}
              hasMore={hasMore}
              emptyColumnLabel={emptyColumnLabel}
              onLoadMore={() => {
                setVisible((v) => ({
                  ...v,
                  [column.id]: shown + CARDS_PER_COLUMN,
                }))
                onLoadMore?.(column.id)
              }}
              renderCard={(card) => (
                <BoardCardView
                  key={card.id}
                  card={card}
                  columns={columns}
                  currentColumnId={columnOf(card)}
                  pending={pending[card.id] === true}
                  onMove={move}
                  onOpenCard={onOpenCard}
                />
              )}
            />
          )
        })}
      </div>

      {/*
        Outside the columns on purpose. A column clips its overflow, so
        an overlay rendered inside one would be cut off at its edge the
        moment the card left it - which is every drag that matters.
      */}
      <DragOverlay>
        {draggingCard ? (
          <BoardCardView
            card={draggingCard}
            columns={columns}
            currentColumnId={columnOf(draggingCard)}
            pending={false}
            onMove={() => {}}
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function BoardColumnView({
  column,
  cards,
  hasMore,
  emptyColumnLabel,
  onLoadMore,
  renderCard,
}: {
  column: BoardColumn
  cards: BoardCard[]
  hasMore: boolean
  emptyColumnLabel: string
  onLoadMore: () => void
  renderCard: (card: BoardCard) => React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: COLUMN_ID(column.id) })

  return (
    <section
      ref={setNodeRef}
      data-slot="board-column"
      /*
       * Section 35.6: the column a card would land in is tinted
       * `primary-subtle`. It is the same token, meaning the same
       * thing, as a selected row in section 2.2 - this is the one that
       * is chosen. The whole column is tinted rather than a thin line
       * drawn somewhere in it, because the drop is addressed to the
       * column and an indicator narrower than the target promises a
       * precision the action does not have.
       */
      data-drop-target={isOver || undefined}
      aria-label={`${column.label}, ${column.total} records`}
      className={cn(
        "flex h-full min-h-0 w-board-column shrink-0 flex-col rounded-xl border bg-surface-sunken",
        // Not `transition-colors`: that utility includes outline-color,
        // which breaks the card's `:has()` focus ring below. Named
        // properties only, here and on the card.
        "border-border-light transition-[background-color,border-color]",
        "data-[drop-target]:border-primary-border data-[drop-target]:bg-primary-subtle",
      )}
    >
      {/*
        Outside the scroller rather than sticky inside it: the
        guarantee section 35.4 asks for is that scrolling a long column
        never leaves its cards unlabelled, and a header that is not in
        the scrolling box cannot scroll away at all.
      */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border-light px-3 py-3">
        {/*
          `flex-1` so the label takes the slack and the count stays hard
          against the right edge once a third child joins it. With two
          children `justify-between` did that on its own; with three it
          would have stranded the action in the middle of the header.
          A column with no action renders exactly as before.
        */}
        <p className="min-w-0 flex-1 text-body font-medium text-text-primary">
          <Truncate>{column.label}</Truncate>
        </p>
        {/* The true total, never the rendered count (35.4). */}
        <p className="shrink-0 text-meta text-text-muted tabular-nums">
          {column.total}
        </p>
        {column.action}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {cards.length === 0 ? (
          /*
           * Section 35.9. An empty COLUMN is not an empty SCREEN:
           * section 13's heading, line and action repeated across seven
           * columns is six invitations to create a record in a stage
           * nobody asked about. One muted line - and still never a
           * blank area.
           */
          <p className="px-1 py-2 text-label text-text-muted">
            {emptyColumnLabel}
          </p>
        ) : (
          cards.map(renderCard)
        )}

        {hasMore ? (
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={onLoadMore}
          >
            Load more
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function BoardCardView({
  card,
  columns,
  currentColumnId,
  pending,
  onMove,
  onOpenCard,
  overlay = false,
}: {
  card: BoardCard
  columns: BoardColumn[]
  currentColumnId: string
  pending: boolean
  onMove: (card: BoardCard, toColumnId: string) => void
  onOpenCard?: (cardId: string) => void
  /** The copy that follows the pointer. Carries no controls of its own. */
  overlay?: boolean
}) {
  // Section 35.6: every column EXCEPT the one it is already in. A card
  // cannot move to where it is, so a disabled item would explain
  // nothing and an enabled one would do nothing.
  const destinations = columns.filter((c) => c.id !== currentColumnId)
  const allowed = card.moveDisabledReason === undefined
  const canMove = allowed && !pending

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({
      id: CARD_ID(card.id),
      disabled: !canMove || overlay,
    })

  /*
   * A pointer drag ends in a click on whatever was under it, which here
   * is the title's stretched hit area - so a card dropped in a new
   * column would also open. Swallowed once, on the way up.
   */
  const justDragged = React.useRef(false)
  React.useEffect(() => {
    if (isDragging) justDragged.current = true
  }, [isDragging])

  const controls = (
    <div className="relative z-10 flex shrink-0 items-center gap-1">
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
            DropdownMenuLabel renders Base UI's GroupLabel, which reads
            MenuGroupContext and THROWS without a Group above it - the
            render unwinds and the page goes blank, so the symptom reads
            as "the menu will not open". The group is what the label is
            the accessible name OF.
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
    </div>
  )

  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      data-slot="board-card"
      data-pending={pending || undefined}
      data-dragging={isDragging || undefined}
      /*
       * The whole card is the drag source - press and move anywhere on
       * it. There is no separate grip: a handle is a second control to
       * find, and on a card this size it competes with the two that
       * carry meaning. The 4px activation distance is what keeps a
       * press that turns out to be a click a click.
       *
       * The listeners sit here rather than on the title button because
       * a keydown inside the card bubbles to this element, so focus on
       * the title still reaches the keyboard sensor - one drag source,
       * two ways in, and no nested interactive role.
       */
      {...(overlay ? {} : listeners)}
      onClickCapture={
        overlay
          ? undefined
          : (event) => {
              if (!justDragged.current) return
              justDragged.current = false
              event.stopPropagation()
              event.preventDefault()
            }
      }
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
        // The card left behind while its copy follows the pointer. It
        // stays in place rather than being removed, so the column does
        // not reflow under the drag.
        "data-[dragging]:opacity-40",
        canMove && !overlay && "cursor-grab active:cursor-grabbing",
        overlay && "cursor-grabbing shadow-lg",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {onOpenCard && !overlay ? (
            <button
              type="button"
              // The activator node: what a keyboard drag measures from,
              // and what carries dnd-kit's own instructions to a screen
              // reader when the card is reached by Tab.
              ref={setActivatorNodeRef}
              aria-roledescription={attributes["aria-roledescription"]}
              aria-describedby={attributes["aria-describedby"]}
              onClick={() => onOpenCard(card.id)}
              // The stretched pseudo-element is what makes the whole
              // card clickable while leaving the controls above it
              // clickable in their own right. Its own outline is
              // removed because the card carries the ring.
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

        {allowed ? (
          controls
        ) : (
          <PermissionTooltip allowed={false} reason={card.moveDisabledReason!}>
            {controls}
          </PermissionTooltip>
        )}
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
