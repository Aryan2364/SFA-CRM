'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FilterIcon, SearchIcon, XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DatePicker, formatDate } from '@/components/ui/date-picker'
import { EmptyState } from '@/components/ui/empty-state'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import {
  Pagination,
  PaginationBar,
  PaginationContent,
  PaginationCount,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Truncate } from '@/components/ui/truncate'

/**
 * Section 11.1. The list page: four fixed zones, section 35.8's bounded
 * page scroll, and everything that is the same on every list screen.
 *
 *   1  Header      title left, one primary action right, record count
 *                  as meta text under the title. Does not scroll.
 *   1a Section tabs optional (section 33). The ONLY thing permitted
 *                  between the header and the toolbar.
 *   2  Toolbar     search left at a fixed 260-320px, the section 27.3
 *                  filter panel beside it, active filters as chips
 *                  underneath. Does not scroll.
 *   3  Data area   The rows or the board. Column headers stay visible
 *                  as rows scroll - see "which box scrolls" below.
 *   4  Pagination  count left, page controls right. Does not scroll.
 *
 * ---------------------------------------------------------------------
 * WHICH BOX SCROLLS, AND HOW FAR
 *
 * Zone 1 sits outside the scroller and is therefore pinned with no
 * `sticky` anywhere: the page title and its one primary action never
 * leave. Everything under it — zones 1a, 2, 3 and 4 — lives in ONE box
 * whose height is the page minus zone 1, and that box is the scroller.
 *
 * Scroll it and zones 1a and 2 leave the screen; the data area's own
 * header then rests against the top of that box, which is directly
 * under the title.
 *
 * SECTION 35.8 SETS THIS OUT FOR THE BOARD - a bounded page scroll,
 * with the four conditions that keep it safe above vertically
 * scrolling columns. THE TABLE FOLLOWS THE SAME SHAPE, which the kit
 * does not yet say: section 10 still gives a list page's scroll to the
 * data area. That departure was asked for directly and is recorded
 * here, in the one file it affects. It costs nothing that section 10
 * was protecting - the table's case has a single vertical scroller,
 * which is stricter than what 35.8 permits, not looser.
 *
 *   table   the panel grows with its rows, so the scroll carries zones
 *           1a and 2 away and then goes on through the rows. Zone 3 is
 *           not a scroller at all, so there is exactly one vertical
 *           scroller on the screen.
 *   board   the panel is exactly the scroller's height, so the scroll
 *           range IS zones 1a and 2 and stops. That bound is the
 *           condition section 35.8 attaches to a board's columns
 *           scrolling vertically underneath a scrolling page.
 *
 * The heights are derived, not measured and not guessed at. `app-shell`
 * roots the application at `h-dvh`, and its content wrapper carries a
 * DEFINITE height — 100% of a box that is itself flex-1 of that root.
 * This template is `h-full` inside that wrapper, so the scroller's
 * height IS the window minus the top bar, minus the page padding, minus
 * zone 1 — arithmetic the browser redoes on every resize, with no
 * constant to go stale and no resize listener to miss a frame.
 *
 * `min-h-0` at every step is load-bearing. A flex item defaults to
 * `min-height: auto`, which is its content height, so without it a long
 * table refuses to shrink and pushes the page taller than the window.
 *
 * ALL OF THAT IS PREFIXED `md:` — 768px, which is section 9's floor.
 * Below the supported range the whole template grows to its rows and the
 * shell's content wrapper scrolls the page, because a fixed height at
 * phone width leaves the data area a porthole scrolling on both axes.
 *
 * A SCREEN THAT WRAPS THIS TEMPLATE has to prefix its own height
 * classes the same way, or it re-imposes the contract from outside. The
 * pattern is `md:h-full` on the wrapper and `md:min-h-0 md:flex-1` on
 * the template — never the unprefixed forms, which below 768 leave a
 * `flex-1` child of an auto-height column with a zero hypothetical main
 * size and collapse it to nothing.
 *
 * ---------------------------------------------------------------------
 * WHAT A SCREEN CANNOT GET WRONG
 *
 * Everything a list screen would otherwise rewrite lives here: the
 * fetch lifecycle and its four states, the request deadline, the search
 * debounce, the pagination, the skeleton, the column tiers and the
 * filter panel. None of it is reachable from a prop, so no screen can
 * omit one and still compile.
 *
 * The deadline is the one worth spelling out. The screen's `load` is
 * handed an `AbortSignal`, but this file does not TRUST it to use one —
 * it races `load` against its own timer. A screen that ignores the
 * signal leaks one request; it cannot lose the failed branch, because
 * the rejection comes from here rather than from the screen's promise.
 * That is section 14 rule 4 taken rather than asked for: a promise that
 * cannot reject cannot be rendered as an error, however good the error
 * state is.
 *
 * And section 14 rule 3: `rows === null` is true both before the first
 * response and after a failed one, so `failed` is a separate flag and
 * the branches read it first.
 *
 * ---------------------------------------------------------------------
 * KNOWN BOUNDARY
 *
 * Pagination is client-side over the array `load` returns, which is
 * what every list route in this product currently answers with. A
 * screen that needs server-side paging wants `load` to return
 * `{ rows, total }`; that shape is deliberately not guessed at before
 * one does.
 */

/** Section 11.1: the default page size is 25 records. */
export const LIST_PAGE_SIZE = 25
/** Section 27.1: search runs ~300ms after the user stops typing. */
const SEARCH_DEBOUNCE_MS = 300
/** Section 14 rule 4: a request that cannot fail cannot render a failure. */
const REQUEST_TIMEOUT_MS = 15000
/** Enough rows to fill zone 3 at 1280 without overshooting at 768. */
const SKELETON_ROWS = 8

/**
 * Section 10 rule 4 asks every table to declare which columns are
 * essential, which are secondary and which are tertiary.
 *
 * These are named by the width they drop at instead, because the
 * spec's own ordering reads inverted: it defines secondary as "hidden
 * below 1024px" and tertiary as "hidden below 768px", so a tertiary
 * column survives a width that a secondary one does not — the opposite
 * of what the words normally mean. Naming the breakpoint removes the
 * question. The rule is honoured; only the label differs.
 */
export type ColumnTier = 'essential' | 'hide-below-1024' | 'hide-below-768'

const TIER_CLASS: Record<ColumnTier, string> = {
  essential: '',
  'hide-below-1024': 'hidden lg:table-cell',
  'hide-below-768': 'hidden md:table-cell',
}

type ColumnBase = {
  /** Stable key. Also the React key for the head and every cell. */
  id: string
  /** Header text. Empty renders a hidden "Actions" label instead. */
  header: string
  /** Section 10 rule 4. Defaults to `essential`. */
  tier?: ColumnTier
  /** Section 11.1: right-aligned and tabular, on the head and the cell. */
  numeric?: boolean
  /**
   * Section 8. The one column that absorbs the table's slack, so the
   * others size to their content and this one truncates. At most one
   * per table; without it an auto-layout table sizes every column to
   * its text and nothing ever truncates.
   */
  grow?: boolean
  /** Escape hatch on the head AND every cell: whitespace, caps. */
  className?: string
  /**
   * Cell-only styling — weight, colour. Separate from `className`
   * because that one also lands on the header, and a header that
   * inherits a row's font-medium stops reading as a header.
   */
  cellClassName?: string
  /** Width of this column's skeleton block, e.g. `w-24`. */
  skeletonWidth?: string
}

/**
 * Section 8: a table cell truncates to one line, with the full text as
 * a tooltip ONLY where it is genuinely cut. `truncate` requires the
 * cell to return a string, because a string is what can be measured
 * and put in a tooltip — the type enforces that rather than letting it
 * fail at runtime.
 */
export type ListColumn<Row> =
  | (ColumnBase & { truncate: true; cell: (row: Row) => string })
  | (ColumnBase & { truncate?: false; cell: (row: Row) => ReactNode })

/**
 * Section 27.3. A filter is DECLARED, never rendered by the screen —
 * that is what keeps filters out of the toolbar and inside the panel.
 * Values are strings and `''` means inactive, which is all this file
 * needs in order to count them, chip them and clear them.
 */
export type ListFilter =
  | {
      id: string
      label: string
      kind: 'select'
      /** value to label. The empty-string key is the "any" option. */
      options: Record<string, string>
      /** Section 16.3: past about six options the menu needs a search. */
      searchable?: boolean
    }
  | { id: string; label: string; kind: 'date' }

export type ListFilterValues = Record<string, string>

export type ListPageProps<Row> = {
  /** Zone 1. The one page title on the screen (section 3 rule 3). */
  title: string
  /**
   * What a record is called. Drives the meta line, the pagination count
   * and two of the three empty states, so none of them is written per
   * screen.
   */
  noun: { one: string; many: string }
  /** Zone 1, right. EXACTLY ONE primary action (section 6.1 rule 1). */
  action?: ReactNode
  /**
   * Zone 1a. Section 33's tab bar, the only thing permitted between the
   * header and the toolbar. Not built in this product yet; the slot
   * exists so the first screen that needs one puts it where section
   * 33.2 allows rather than inventing a position.
   */
  sectionTabs?: ReactNode
  /**
   * Zone 2, far right. Section 11.6's list/card switcher when there is
   * one. Nothing has been built against this yet.
   */
  toolbarExtra?: ReactNode

  columns: ListColumn<Row>[]
  rowKey: (row: Row) => string
  filters?: ListFilter[]

  /**
   * Zone 3, in place of the table — section 35.1's board view.
   *
   * This is NOT an escape hatch for a screen that does not fit. Section
   * 35 REQUIRES the board to occupy zone 3 of this same list page,
   * sharing this header, this toolbar, these filters and this
   * pagination bar: "it is deliberately not a sixth page template".
   * This template predates section 35 and was missing the capability
   * the specification asks for. A screen that wants a different toolbar
   * still does not get one.
   *
   * It replaces the TABLE BRANCH ONLY. The four other zone-3 states —
   * skeleton, failed, nothing-found and nothing-yet — are read first
   * and are unchanged, which is what gives the board section 13's
   * states without restating them, and is what makes section 35.9's
   * "a board where every column is empty is an empty screen" true here
   * rather than in each screen.
   *
   * Optional: a screen that passes nothing renders exactly what it
   * always did.
   */
  renderData?: (rows: Row[]) => ReactNode

  /**
   * The only thing a screen does about loading. No timer, no catch, no
   * debounce — this is called with the debounced search and the active
   * filters, and its rejection already IS the failed state.
   *
   * The signal carries this file's deadline; using it cancels the
   * underlying request, and ignoring it only leaks one.
   */
  load: (args: {
    search: string
    filters: ListFilterValues
    signal: AbortSignal
  }) => Promise<Row[]>
  /** Change this to force a refetch — after a create, say. */
  refreshKey?: unknown

  /** Defaults to `Search {noun.many}` (section 27.1: name the record). */
  searchPlaceholder?: string
  /** Section 27.1: the field carries the list of fields it searches. */
  searchHint?: string
  /**
   * Section 13's "nothing yet" — the one empty state a template cannot
   * write for itself, because what would normally be here, and how to
   * put it there, are facts about the records.
   */
  emptyYet: {
    heading: string
    body: string
    actionLabel?: string
    onAction?: () => void
  }
  /** Section 11.1: 25 unless a screen has a reason. */
  pageSize?: number
  className?: string
}

/** 1 … 4 5 6 … 12, so the control stays one row however long the list. */
function pageWindow(current: number, count: number): (number | 'gap')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const out: (number | 'gap')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(count - 1, current + 1)
  if (start > 2) out.push('gap')
  for (let p = start; p <= end; p += 1) out.push(p)
  if (end < count - 1) out.push('gap')
  out.push(count)
  return out
}

/*
 * Built from the parts rather than `new Date(text)`, which reads a bare
 * YYYY-MM-DD as UTC midnight and lands on the previous day for every
 * reader west of Greenwich.
 */
function fromISODate(text: string): Date | undefined {
  if (!text) return undefined
  const [y, m, d] = text.split('-').map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d)
}

function toISODate(d: Date) {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function ListPage<Row>({
  title,
  noun,
  action,
  sectionTabs,
  toolbarExtra,
  columns,
  rowKey,
  filters,
  renderData,
  load,
  refreshKey,
  searchPlaceholder,
  searchHint,
  emptyYet,
  pageSize = LIST_PAGE_SIZE,
  className,
}: ListPageProps<Row>) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [values, setValues] = useState<ListFilterValues>({})
  const [panelOpen, setPanelOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)

  /*
   * `load` is held in a ref and never becomes an effect dependency. A
   * screen that declares it inline would otherwise hand this file a new
   * function on every render and refetch for ever. What drives a
   * refetch is what actually changes the query, plus `refreshKey`.
   */
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  /*
   * Only DECLARED filters contribute. A value left behind by a filter
   * that is no longer on screen — the team picker disappearing when
   * somebody loses their reports — is neither sent nor counted.
   */
  const declared = useMemo(() => filters ?? [], [filters])
  const active = useMemo(() => {
    const out: ListFilterValues = {}
    for (const filter of declared) {
      const value = values[filter.id]
      if (value) out[filter.id] = value
    }
    return out
  }, [declared, values])

  const activeKey = JSON.stringify(active)
  const activeCount = Object.keys(active).length
  const anyNarrowing = activeCount > 0 || search !== ''

  // Section 27.1: search runs ~300ms after the user stops typing.
  useEffect(() => {
    const timer = setTimeout(
      () => setSearch(searchInput.trim()),
      SEARCH_DEBOUNCE_MS
    )
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()

    /*
     * Cleared BEFORE the request, not after it. Without this, Retry
     * left the failed state up for the whole of the second attempt and
     * the button read as dead. Rows are NOT cleared: a filter change
     * keeps its table until the new one lands, so the page does not
     * flash a skeleton on every keystroke.
     */
    setFailed(false)

    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort()
        reject(new Error('The request passed its deadline.'))
      }, REQUEST_TIMEOUT_MS)
    })

    Promise.race([
      loadRef.current({ search, filters: active, signal: abort.signal }),
      deadline,
    ])
      .then(result => {
        if (cancelled) return
        setRows(result)
        setFailed(false)
      })
      .catch(() => {
        if (cancelled) return
        setRows(null)
        setFailed(true)
      })
      .finally(() => clearTimeout(timer))

    return () => {
      cancelled = true
      clearTimeout(timer)
      abort.abort()
    }
    // `active` is covered by activeKey; `load` deliberately is not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeKey, refreshKey, retryNonce])

  // A narrowing change re-pages from the top: page 4 of the old result
  // set means nothing in the new one.
  useEffect(() => {
    setPage(1)
  }, [search, activeKey])

  function setFilter(id: string, value: string) {
    setValues(prev => ({ ...prev, [id]: value }))
  }

  function clearAll() {
    setValues({})
    setSearchInput('')
    setSearch('')
  }

  const total = rows?.length ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount)
  const firstOnPage = (current - 1) * pageSize
  const pageRows = rows ? rows.slice(firstOnPage, firstOnPage + pageSize) : []

  /*
   * Zone 1's meta line. Section 11.1 puts the record count under the
   * title; section 27.1 puts the result count beside the search field.
   * One number, said once, with the wording saying which it is.
   */
  const meta =
    rows === null
      ? null
      : search
        ? `${total} ${total === 1 ? 'result' : 'results'} for “${search}”`
        : `${total} ${total === 1 ? noun.one : noun.many}`

  function columnClass(column: ListColumn<Row>) {
    return cn(
      TIER_CLASS[column.tier ?? 'essential'],
      column.grow && 'w-full max-w-0',
      /*
       * A capped column can fall below its text and truncate without
       * collapsing the way `max-w-0` would once another column is
       * taking the slack. 160px is `--spacing-field-min`, borrowed
       * because the kit has no token for the width of a text column in
       * a table — see the report.
       */
      column.truncate && !column.grow && 'max-w-field-min',
      column.className
    )
  }

  const head = (
    <TableHeader>
      <TableRow>
        {columns.map(column => (
          <TableHead
            key={column.id}
            numeric={column.numeric}
            className={columnClass(column)}
          >
            {column.header || <span className="sr-only">Actions</span>}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  )

  /*
   * Section 13's three states are not interchangeable, and the two this
   * file generates differ in all three parts — heading, body and
   * action — rather than being one state wearing three labels:
   *
   *   failed        nothing is known about the records; the cause is
   *                 the connection; the action retries.
   *   nothing-found the records may well exist; the cause is what the
   *                 user typed or ticked; the action widens it again.
   *   nothing-yet   there genuinely are none; the cause is that none
   *                 has been made; the action makes one. Only this
   *                 one's words come from the screen, because only this
   *                 one is about the records rather than the query.
   */
  let zone3: ReactNode
  if (failed) {
    zone3 = (
      <EmptyState
        className="h-full"
        variant="failed"
        heading={`${sentenceCase(noun.many)} could not be loaded`}
        onAction={() => setRetryNonce(n => n + 1)}
      >
        The server did not answer. Check your connection, then try again.
      </EmptyState>
    )
  } else if (rows === null) {
    zone3 = (
      /* Section 14 rule 1: the shape of what is coming, never a spinner,
         and the same header, so nothing jumps when the rows land. */
      <Table>
        {head}
        <TableBody>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <TableRow key={i}>
              {columns.map(column => (
                <TableCell
                  key={column.id}
                  numeric={column.numeric}
                  className={cn(columnClass(column), column.cellClassName)}
                >
                  <Skeleton
                    className={cn(
                      'h-4',
                      column.skeletonWidth ?? 'w-24',
                      column.numeric && 'ml-auto'
                    )}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  } else if (total === 0 && anyNarrowing) {
    /* Read BEFORE "nothing yet", so a filter matching nothing never
       invites somebody to create their first record (section 13). */
    zone3 = (
      <EmptyState
        className="h-full"
        variant="nothing-found"
        heading={
          search
            ? `No ${noun.many} match “${search}”`
            : `No ${noun.many} match these filters`
        }
        onAction={clearAll}
      >
        {search && activeCount > 0
          ? `Nothing matches that search with these filters. Clearing both brings every ${noun.one} back.`
          : search
            ? `Nothing matches that search. Clearing it brings every ${noun.one} back.`
            : `Nothing matches these filters. Clearing them brings every ${noun.one} back.`}
      </EmptyState>
    )
  } else if (total === 0) {
    zone3 = (
      <EmptyState
        className="h-full"
        variant="nothing-yet"
        heading={emptyYet.heading}
        actionLabel={emptyYet.actionLabel}
        onAction={emptyYet.onAction}
      >
        {emptyYet.body}
      </EmptyState>
    )
  } else if (renderData) {
    // Section 35.1: the board occupies zone 3, and everything above and
    // below it is this template's. Handed EVERY row rather than the
    // page's slice — zone 4 reports the count for the current filters
    // and does not page the board (section 35.7).
    zone3 = renderData(rows)
  } else {
    zone3 = (
      <Table>
        {head}
        <TableBody>
          {pageRows.map(row => (
            <TableRow key={rowKey(row)}>
              {columns.map(column => (
                <TableCell
                  key={column.id}
                  numeric={column.numeric}
                  className={cn(columnClass(column), column.cellClassName)}
                >
                  {column.truncate ? (
                    <Truncate>{column.cell(row)}</Truncate>
                  ) : (
                    column.cell(row)
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  /*
   * BOTH VIEWS HAND THE VERTICAL SCROLL TO THE PAGE at 768 and above,
   * so that zones 1a and 2 can leave the screen and the data area's own
   * header — the table's column row, the board's column titles — comes
   * to rest under the page title. Section 11.1's zone 3 keeps the scroll
   * within itself; this is section 35.8's bounded page scroll instead,
   * and this file is the only place it lives.
   *
   * WHAT DIFFERS IS HOW FAR THE PAGE SCROLLS, and the difference is the
   * whole of section 35.8's condition.
   *
   *   table   the panel GROWS with its rows, so the page scroll carries
   *           zones 1a and 2 away and then keeps going through the
   *           rows. Nothing inside it scrolls vertically at all — zone 3
   *           gives up `overflow-auto` at this width — so there is one
   *           vertical scroller on the screen and no gesture to share.
   *
   *   board   the panel is EXACTLY the scroller's height, so the page's
   *           whole scroll range is zones 1a and 2 and not one pixel
   *           more. That bound is what makes the board's columns safe to
   *           scroll vertically underneath it: the outer scroller is at
   *           its end within one gesture and stays there, and from then
   *           on every wheel event over a column belongs to the column.
   *           Section 35.8 states the condition; `md:h-full md:shrink-0`
   *           on the panel below is what enforces it.
   */
  const boardView = Boolean(renderData)

  /*
   * THE ONE PLACE A BOARD NEEDS JAVASCRIPT, and it is here because the
   * browser's own rule is the wrong way round for this layout.
   *
   * A wheel event is offered to the innermost scroller under the pointer
   * first, and only chains outward once that one is at its end.
   * Measured on the board before this ran: wheeling over a column that
   * had cards to spare moved the COLUMN and left the page where it was,
   * so the strip and the toolbar only went away if the pointer happened
   * to be over a gap, an empty column or a column header. The page did
   * chain correctly once a column bottomed out — the behaviour was
   * consistent, just not the one section 35.8 now promises.
   *
   * So a downward gesture is given to the page until the page's 126px
   * of range is spent, and only then to the column. An UPWARD gesture is
   * left alone unless the scroller under the pointer is already at its
   * own top, because somebody reading down a column and flicking back up
   * means that column, not the page.
   *
   * Only in board view. A table has nothing nested inside the scroller,
   * so there is no gesture to arbitrate and no listener to attach.
   */
  const scrollerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || !boardView) return
    if (!window.matchMedia('(min-width: 768px)').matches) return

    /** The nearest scroller under the pointer that could take this delta. */
    function innerTaker(target: EventTarget | null, up: boolean) {
      let node = target instanceof Element ? target : null
      while (node && node !== el) {
        const overflow = getComputedStyle(node).overflowY
        if (overflow === 'auto' || overflow === 'scroll') {
          const room = up
            ? node.scrollTop > 0
            : node.scrollTop < node.scrollHeight - node.clientHeight
          if (room) return node
        }
        node = node.parentElement
      }
      return null
    }

    function onWheel(event: WheelEvent) {
      const box = el
      if (!box || event.ctrlKey || event.deltaY === 0) return
      const max = box.scrollHeight - box.clientHeight
      if (max <= 0) return
      const up = event.deltaY < 0
      if (up ? box.scrollTop <= 0 : box.scrollTop >= max) return
      if (up && innerTaker(event.target, true)) return
      box.scrollTop = Math.max(0, Math.min(max, box.scrollTop + event.deltaY))
      event.preventDefault()
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [boardView])

  return (
    /*
     * `md:h-full` rather than `h-full`, and every height class below it
     * carries the same prefix. AGENTS.md section 9 supports desktop and
     * tablet, and 768 is that floor — so at and above it this template
     * is byte-identical to what it was: a definite height divided
     * between the four zones, with zone 3 the only scrolling one.
     *
     * BELOW 768 the same contract makes zone 3 a porthole. Measured at
     * 420x800 before this change: zone 3 was 230px tall around a table
     * 492px tall and 623px wide, so the data area scrolled on both axes
     * inside a page that could not scroll at all — 3 rows of 8 visible
     * with the window half-full of chrome. Section 9 rule 5 governs
     * below the supported range and asks only that the layout stay
     * usable; the honest reading is that the page scrolls there and the
     * data area grows to its rows, which is also what section 35.3 does
     * for the board — a view whose shape stops working at that width is
     * not offered at that width.
     */
    <div className={cn('flex min-h-0 flex-col md:h-full', className)}>
      {/* ── ZONE 1 ── header. Does not scroll. */}
      <header className="flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-page-title font-medium text-text-primary">
            {title}
          </h1>
          {meta !== null && (
            <p className="mt-1 text-meta text-text-muted">{meta}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>

      {/*
        THE SCROLLER, and the whole of the scroll-away behaviour.
        Everything below zone 1 lives inside it; zone 1 is outside it and
        is therefore pinned without a single `sticky` anywhere.

        Its height is the page minus zone 1, so the page scrolls by
        exactly the height of zones 1a and 2 plus whatever the rows add.
        Scroll it and the strip and the toolbar leave; the table's own
        `sticky top-0` header then rests against the top of this box,
        which is directly under the page title. That is the arrangement
        asked for, stated as a fact about one box rather than as a rule
        about three.

        IN TABLE VIEW IT IS THE ONLY VERTICAL SCROLLER ON THE PAGE.
        Zone 3 gives up its own `overflow-auto` at this width, and it
        has to: an ancestor with a non-visible overflow becomes the
        scrollport a sticky header sticks to, and a scrollport that never
        scrolls holds the header still while the page moves under it.
        That is why the column header scrolled away with the rows in
        every attempt that left zone 3 scrolling.

        IN BOARD VIEW the columns scroll vertically inside it, which
        section 35.8 permits on one condition: that this scroller's own
        range is bounded and ends. The panel below is exactly this box's
        height in that view, so the range is zones 1a and 2 and stops —
        see the note there.
      */}
      <div ref={scrollerRef} className="flex flex-col md:min-h-0 md:flex-1 md:overflow-auto">
      {/* ── ZONE 1a ── section tabs (section 33). Optional. */}
      {sectionTabs && <div className="mt-4 shrink-0">{sectionTabs}</div>}

      {/* ── ZONE 2 ── toolbar. Does not scroll.
          The chips are section 27.3's and sit BELOW the toolbar, inside
          this zone rather than as a zone of their own: section 11.1 has
          four, and only section 33's tab bar may ever be a fifth. */}
      <div className="mt-4 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          {/* Fixed 280px, inside section 11.1's 260-320 band and never
              full width; `max-w-full` so it still shrinks at 768. */}
          <div className="w-search max-w-full shrink-0">
            <Tooltip>
              <TooltipTrigger render={<div />}>
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="search"
                    aria-label={searchPlaceholder ?? `Search ${noun.many}`}
                    placeholder={searchPlaceholder ?? `Search ${noun.many}`}
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                  />
                  {/* Section 27.1: a clear button appears inside the
                      field once there is text. Section 23.1 maps Close
                      to `x`. */}
                  {searchInput !== '' && (
                    <InputGroupAddon align="inline-end">
                      <Button
                        variant="in-field"
                        size="icon-sm"
                        onClick={() => setSearchInput('')}
                      >
                        <XIcon />
                        <span className="sr-only">Clear search</span>
                      </Button>
                    </InputGroupAddon>
                  )}
                </InputGroup>
              </TooltipTrigger>
              {searchHint && <TooltipContent>{searchHint}</TooltipContent>}
            </Tooltip>
          </div>

          {declared.length > 0 && (
            <Popover open={panelOpen} onOpenChange={setPanelOpen}>
              <PopoverTrigger render={<Button variant="secondary" />}>
                <FilterIcon />
                Filter
                {/* Section 27.3: a count badge when filters are active. */}
                {activeCount > 0 && (
                  <Badge variant="primary">{activeCount}</Badge>
                )}
              </PopoverTrigger>
              <PopoverContent>
                <PopoverTitle className="text-card-heading font-medium text-text-primary">
                  Filter
                </PopoverTitle>
                {declared.map(filter => (
                  <div key={filter.id}>
                    <Label htmlFor={`filter-${filter.id}`}>{filter.label}</Label>
                    <div className="mt-1">
                      {filter.kind === 'date' ? (
                        <DatePicker
                          id={`filter-${filter.id}`}
                          value={fromISODate(values[filter.id] ?? '')}
                          onValueChange={d =>
                            setFilter(filter.id, d ? toISODate(d) : '')
                          }
                        />
                      ) : filter.searchable ? (
                        <SearchableSelect
                          id={`filter-${filter.id}`}
                          options={filter.options}
                          value={values[filter.id] ?? ''}
                          onValueChange={value => setFilter(filter.id, value)}
                          searchPlaceholder={`Search ${filter.label.toLowerCase()}`}
                          /* The trigger falls back to its placeholder on an
                             empty value, and an empty value here is the
                             "any" OPTION rather than no choice — so the
                             placeholder is that option's own label. */
                          placeholder={filter.options[''] ?? 'Any'}
                        />
                      ) : (
                        <Select
                          items={filter.options}
                          value={values[filter.id] ?? ''}
                          onValueChange={value =>
                            setFilter(filter.id, String(value))
                          }
                        >
                          <SelectTrigger id={`filter-${filter.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(filter.options).map(
                              ([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                ))}
                {/* Section 27.3: "Clear all" is always available. */}
                <Button
                  variant="secondary"
                  onClick={clearAll}
                  disabled={!anyNarrowing}
                >
                  Clear all
                </Button>
              </PopoverContent>
            </Popover>
          )}

          {toolbarExtra && (
            <div className="ml-auto shrink-0">{toolbarExtra}</div>
          )}
        </div>

        {/* Section 27.3: active filters appear as removable chips below
            the toolbar, so nobody forgets why the list is short and
            reports the missing records as a bug. */}
        {activeCount > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {declared
              .filter(filter => active[filter.id])
              .map(filter => {
                const value = active[filter.id]
                const shown =
                  filter.kind === 'date'
                    ? formatDate(fromISODate(value))
                    : (filter.options[value] ?? value)
                return (
                  <span
                    key={filter.id}
                    className="inline-flex h-control items-center gap-1 rounded-lg border border-primary-border bg-primary-subtle pr-1 pl-3 text-label text-text-primary"
                  >
                    {filter.label}: {shown}
                    {/* Section 6.3.1: a control inside something that
                        already has a border does not bring its own. */}
                    <Button
                      variant="in-field"
                      size="icon-sm"
                      onClick={() => setFilter(filter.id, '')}
                    >
                      <XIcon />
                      <span className="sr-only">
                        Remove the {filter.label.toLowerCase()} filter
                      </span>
                    </Button>
                  </span>
                )
              })}
          </div>
        )}
      </div>

      {/* ── ZONES 3 and 4 ── one panel.
          `overflow-hidden` is what clips the scrolling child to the
          panel's radius. At md it becomes `overflow-clip` in the
          scrolling case, and the difference is load-bearing rather than
          cosmetic: `clip` is not a scroll container, so the table header
          and the pagination bar inside still stick to the page scroller
          above. `hidden` would make this element their scrollport and
          both would go static.

          TABLE: `md:grow md:shrink-0` rather than `md:flex-1`. flex-1
          would pin the panel to the leftover height and there would be
          nothing to scroll. Grow-but-never-shrink means a short list
          still fills the page — so the pagination bar sits at the
          bottom, as it always did — and a long one keeps its own
          height and lets the scroller above do its work.
          `md:w-fit md:min-w-full` is for the eight-column case: the
          table no longer has its own scrollbox, so where its min-content
          runs past the window the panel grows with it and the border
          stays around the table instead of cutting across it.

          BOARD: `md:h-full md:shrink-0` — EXACTLY the scroller's height,
          never more and never less. This is the whole of section 35.8's
          condition, expressed as one class rather than as a promise.
          Because the panel cannot grow, the scroller's content is zones
          1a and 2 plus one screen, so its scroll range is the height of
          those two zones and ends there. A bounded outer scroller that
          is at its end after one gesture is what makes the columns
          underneath safe to scroll vertically: there is no point after
          that at which a wheel event could belong to either of them.
          Measured at 1280x700: 138px of range, then nothing. */}
      <div
        className={cn(
          'mt-4 flex flex-col overflow-hidden rounded-xl border border-border-light bg-surface md:overflow-clip',
          boardView
            ? 'md:h-full md:shrink-0'
            : 'md:w-fit md:min-w-full md:grow md:shrink-0'
        )}
      >
        {/* ZONE 3.

            Below 768 this is the scrolling zone: `overflow-auto` on ONE
            element, both axes, which is not the nesting section 1 rule 8
            forbids.

            At md the table's case stops being a scroller at all — see
            the note on the box above; the rows are scrolled by the page
            and the table keeps its sticky header because nothing between
            it and that scroller clips. The board's case keeps a definite
            height here, because `board.tsx` fills what it is given and
            renders one screen tall in a box that will not give it one. */}
        <div
          className={cn(
            'overflow-auto',
            boardView
              ? 'md:min-h-0 md:flex-1'
              : 'md:grow md:shrink-0 md:overflow-visible'
          )}
        >
          {zone3}
        </div>

        {/* ── ZONE 4 ── pagination. Does not scroll — and where the
            page is what scrolls, `sticky bottom-0` is how it goes on not
            scrolling. Its two halves stick sideways as well, because the
            panel around them is as wide as the widest table and
            `justify-between` would otherwise send the page controls out
            past the right edge of the window. */}
        <PaginationBar
          className='md:sticky md:bottom-0 md:z-10'
        >
          {/* Section 11.1.1: `1–8 of 8`, not "Showing 1 to 8 of 8". The
              total is the part that carries information; the words in
              front of it were width spent saying what the numbers
              already say. */}
          <PaginationCount
            className='md:sticky md:left-0'
          >
            {total === 0
              ? `No ${noun.many}`
              : `${firstOnPage + 1}–${Math.min(
                  firstOnPage + pageSize,
                  total
                )} of ${total}`}
          </PaginationCount>
          <Pagination className='md:sticky md:right-0'>
            <PaginationContent>
              <PaginationItem>
                {/* Section 6.4: a control with nowhere to go reads as
                    disabled — reduced contrast, no pointer — rather than
                    looking live and doing nothing. `aria-disabled` is
                    the whole of it now: section 11.1.1 put that state
                    into `pagination.tsx`, so the classes that used to be
                    written out here are gone. */}
                <PaginationPrevious
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  aria-disabled={current === 1}
                  tabIndex={current === 1 ? -1 : undefined}
                />
              </PaginationItem>
              {pageWindow(current, pageCount).map((entry, i) =>
                entry === 'gap' ? (
                  <PaginationItem key={`gap-${i}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={entry}>
                    <PaginationLink
                      isActive={entry === current}
                      onClick={() => setPage(entry)}
                    >
                      {entry}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationNext
                  onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                  aria-disabled={current === pageCount}
                  tabIndex={current === pageCount ? -1 : undefined}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </PaginationBar>
      </div>
      </div>
    </div>
  )
}
