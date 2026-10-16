'use client'

import * as React from 'react'
import { PlusIcon, SearchIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { cn } from '@/lib/utils'
import { useLayout } from '@/lib/layout'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.5: what a list table
 * becomes on phone. Renders nothing in the desktop layout, so a caller
 * builds one tree and lets this file and the desktop list page each show
 * only in their own layout (§41.3 rule 4).
 *
 * THIS IS A DELIBERATELY REDUCED PORT of the kit's 1700-line phone-list.tsx.
 * It keeps the shape callers need most — search, loading/failed/ready
 * branches, rows, an add button — and drops filter/sort sheets, status
 * chips, select mode, the scroll-away header, pull-to-refresh and the
 * saved-scroll-position contract, because those depend on kit
 * infrastructure (sheet.tsx's ActionBarFrame, ShellLink/progress-bar,
 * content-area's BLEED/BLOCK tokens) that does not
 * exist in this codebase yet. See the phone-foundation build report.
 */
const PHONE_LIST_PAGE = 25
const SEARCH_DELAY_MS = 300

export type PhoneListState = 'loading' | 'failed' | 'ready'

export type PhoneListSearch = {
  value: string
  onChange: (value: string) => void
}

/** One filter chip with a count, e.g. "Approvals 6" (§41.5 rules 20-21). */
export type PhoneListFilterChip = {
  value: string
  label: string
  count: number
}

export type PhoneListFilters = {
  /** Screen-reader label for the row, e.g. "Stage". */
  label: string
  value: string | null
  onChange: (value: string | null) => void
  /** "All" is prepended automatically when `allLabel` is given. */
  allLabel?: string
  allCount?: number
  chips: PhoneListFilterChip[]
}

/**
 * A filter applied from outside the list, e.g. arriving from an account with
 * `?account=` — shown as a removable chip so nobody forgets why the list is
 * short (§41.5 rule 5, section 27.3).
 */
export type PhoneListActiveFilter = {
  key: string
  label: string
  /** Screen-reader label for the ×, e.g. "Show all opportunities". */
  clearLabel: string
  onClear: () => void
}

export type PhoneListProps<Row> = {
  state: PhoneListState
  onRetry?: () => void
  noun: { one: string; many: string }
  rows: Row[]
  total: number
  rowKey: (row: Row) => string
  renderRow: (row: Row) => React.ReactNode
  onLoadMore?: () => Promise<void>
  search: PhoneListSearch
  empty: React.ReactNode
  /**
   * The floating add button. `allowed` undefined means the permission is not
   * known yet: the button shows disabled with no reason ("not known yet" is
   * not "not allowed"). `false` shows it disabled, with `reason` — who may
   * do it, e.g. "Only someone who can create expenses can add one" — behind
   * a tap (§41.8 rule 17, section 26).
   */
  add?: { label: string; href: string; allowed: boolean | undefined; reason?: string }
  className?: string
  /** Filter chips above the list, one row, scrolling sideways if needed. */
  filters?: PhoneListFilters
  /** Removable chips for filters applied from outside, below the count line. */
  activeFilters?: PhoneListActiveFilter[]
  /** Pulling down at the top reloads the list (§41.5 rule 16). */
  onRefresh?: () => Promise<void>
  /**
   * Scroll position, search and filters survive opening a row and coming
   * back (§41.5 rule 17 / §27.3). Defaults to the current pathname, so two
   * lists on the same route need a distinct key.
   */
  listKey?: string
}

export function PhoneList<Row>(props: PhoneListProps<Row>) {
  const { layout } = useLayout()
  if (layout !== 'phone') return null
  return <PhoneListOnPhone {...props} />
}

function PhoneListOnPhone<Row>({
  state,
  onRetry,
  noun,
  rows,
  total,
  rowKey,
  renderRow,
  onLoadMore,
  search,
  empty,
  add,
  className,
  filters,
  activeFilters,
  onRefresh,
  listKey,
}: PhoneListProps<Row>) {
  const [loadingMore, setLoadingMore] = React.useState(false)
  const endRef = React.useRef<HTMLDivElement | null>(null)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const canLoadMore = state === 'ready' && onLoadMore !== undefined && rows.length < total
  const pathname = usePathname()
  const scrollKey = `phone-list-scroll:${listKey ?? pathname}`

  const [refreshing, setRefreshing] = React.useState(false)
  usePullToRefresh(rootRef, onRefresh, refreshing, setRefreshing, state === 'ready')

  // §41.5 rule 17 / §27.3: restore scroll on return, save it on the way out.
  React.useEffect(() => {
    if (state !== 'ready') return
    try {
      const raw = window.sessionStorage.getItem(scrollKey)
      if (raw) {
        const y = Number(raw)
        if (Number.isFinite(y)) window.scrollTo(0, y)
      }
    } catch {}
    // Restore once per ready paint, not on every row change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state === 'ready'])

  React.useEffect(() => {
    function save() {
      try {
        window.sessionStorage.setItem(scrollKey, String(window.scrollY))
      } catch {}
    }
    window.addEventListener('scroll', save, { passive: true })
    window.addEventListener('pagehide', save)
    return () => {
      save()
      window.removeEventListener('scroll', save)
      window.removeEventListener('pagehide', save)
    }
  }, [scrollKey])

  React.useEffect(() => {
    const end = endRef.current
    if (!end || !canLoadMore || loadingMore) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setLoadingMore(true)
          onLoadMore?.().finally(() => setLoadingMore(false))
        }
      },
      { rootMargin: '0px 0px 320px 0px' }
    )
    observer.observe(end)
    return () => observer.disconnect()
  }, [canLoadMore, loadingMore, onLoadMore, rows.length])

  const searching = search.value.trim() !== ''

  let body: React.ReactNode
  if (state === 'loading') {
    body = <PhoneSkeletonRows count={8} />
  } else if (state === 'failed') {
    body = (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-body font-medium text-text-primary">
          The {noun.many} could not be loaded
        </p>
        <p className="text-body text-text-muted">Check your connection and try again.</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="h-11 rounded-lg border border-border-light bg-surface px-4 text-body font-medium text-text-primary"
          >
            Try again
          </button>
        ) : null}
      </div>
    )
  } else if (rows.length === 0 && searching) {
    body = (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <p className="text-body font-medium text-text-primary">
          No {noun.many} match &apos;{search.value}&apos;
        </p>
        <button type="button" onClick={() => search.onChange('')} className="text-body text-primary">
          Clear search
        </button>
      </div>
    )
  } else if (rows.length === 0) {
    body = empty
  } else {
    body = (
      <>
        <ul className="flex flex-col divide-y divide-border-light rounded-xl border border-border-light bg-surface">
          {rows.map(row => (
            <li key={rowKey(row)}>{renderRow(row)}</li>
          ))}
        </ul>
        {loadingMore ? <PhoneSkeletonRows count={3} className="mt-2" /> : null}
        <div ref={endRef} aria-hidden />
      </>
    )
  }

  return (
    <div
      ref={rootRef}
      className={cn('flex min-w-0 flex-col gap-3', add ? 'pb-24' : '', className)}
    >
      {onRefresh ? (
        <div
          aria-hidden
          className={cn(
            'flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out',
            refreshing ? 'h-8' : 'h-0'
          )}
        >
          <div className="size-5 animate-spin rounded-full border-2 border-border-light border-t-primary" />
        </div>
      ) : null}
      <ListSearchField noun={noun} search={search} />
      {filters ? <FilterChips filters={filters} /> : null}
      <div role="status" className="text-label text-text-secondary">
        {state === 'loading' ? 'Loading' : `${total} ${total === 1 ? noun.one : noun.many}`}
      </div>
      {activeFilters && activeFilters.length > 0 ? <ActiveFilterChips filters={activeFilters} /> : null}
      {body}
      {add ? <AddButton add={add} /> : null}
    </div>
  )
}

const ADD_BUTTON =
  'flex size-14 items-center justify-center rounded-full shadow-lg'

function AddButton({ add }: { add: NonNullable<PhoneListProps<unknown>['add']> }) {
  return (
    <div
      className={cn(
        'fixed bottom-[calc(var(--h-tab-bar)+var(--safe-bottom)+16px)] right-[calc(var(--safe-right)+16px)]',
        'z-[--z-shell]'
      )}
    >
      {add.allowed === true ? (
        <Link
          href={add.href}
          aria-label={add.label}
          className={cn(ADD_BUTTON, 'bg-primary text-primary-foreground')}
        >
          <PlusIcon aria-hidden />
        </Link>
      ) : (
        // Only a refusal that has actually landed carries its reason; while
        // the permission is still loading the button is disabled and silent.
        <PermissionTooltip allowed={add.allowed === undefined || !add.reason} reason={add.reason ?? ''}>
          <button
            type="button"
            disabled
            aria-label={add.label}
            className={cn(
              ADD_BUTTON,
              'pointer-events-none border border-border-light bg-surface-sunken text-text-muted'
            )}
          >
            <PlusIcon aria-hidden />
          </button>
        </PermissionTooltip>
      )}
    </div>
  )
}

function ListSearchField({
  noun,
  search,
}: {
  noun: { one: string; many: string }
  search: PhoneListSearch
}) {
  const [text, setText] = React.useState(search.value)
  React.useEffect(() => {
    if (text === search.value) return
    const timer = window.setTimeout(() => search.onChange(text), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <div className="flex h-11 items-center gap-2 rounded-lg border border-border-light bg-surface px-3">
      <SearchIcon aria-hidden className="size-4 shrink-0 text-text-secondary" />
      <input
        type="search"
        inputMode="search"
        value={text}
        onChange={event => setText(event.target.value)}
        placeholder={`Search ${noun.many}`}
        aria-label={`Search ${noun.many}`}
        className="min-w-0 flex-1 bg-transparent text-body text-text-primary outline-none"
      />
      {text ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setText('')
            search.onChange('')
          }}
        >
          <XIcon aria-hidden className="size-4 text-text-secondary" />
        </button>
      ) : null}
    </div>
  )
}

export type PhoneListRowProps = {
  href: string
  name: string
  status?: React.ReactNode
  facts?: string[]
  amount?: string
  meta?: string
}

/**
 * §41.5 rules 8-13: one record, the whole row a link to it.
 *   Line 1  name (up to two lines)                       [status]
 *   Line 2  fact · fact                                  [amount]
 *   Line 3  meta
 */
export function PhoneListRow({ href, name, status, facts, amount, meta }: PhoneListRowProps) {
  return (
    <Link href={href} className="flex min-h-16 flex-col gap-1 px-4 py-3 active:bg-surface-control">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 text-body font-medium text-text-primary">{name}</span>
        {status ? <span className="shrink-0">{status}</span> : null}
      </div>
      {facts && facts.length > 0 || amount ? (
        <div className="flex items-start justify-between gap-2">
          {facts && facts.length > 0 ? (
            <span className="min-w-0 flex-1 text-label text-text-secondary">{facts.join(' · ')}</span>
          ) : null}
          {amount ? <span className="shrink-0 text-body font-medium text-text-primary">{amount}</span> : null}
        </div>
      ) : null}
      {meta ? <span className="text-meta text-text-muted">{meta}</span> : null}
    </Link>
  )
}

const CHIP =
  'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-label font-medium'
const CHIP_RESTING = 'border-border-light bg-surface text-text-primary active:bg-surface-control'
const CHIP_CHOSEN = 'border-primary-border bg-primary-subtle text-primary'

/** §41.5 rules 20-21: filter chips with counts, one row, scrolls sideways. */
function FilterChips({ filters }: { filters: PhoneListFilters }) {
  const chips = filters.allLabel
    ? [{ value: null as string | null, label: filters.allLabel, count: filters.allCount ?? 0 }, ...filters.chips]
    : filters.chips.map(c => ({ ...c, value: c.value as string | null }))

  return (
    <div
      role="group"
      aria-label={filters.label}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
    >
      {chips.map(chip => {
        const chosen = chip.value === filters.value
        return (
          <button
            key={chip.value ?? 'all'}
            type="button"
            aria-pressed={chosen}
            onClick={() => filters.onChange(chip.value)}
            className={cn(CHIP, chosen ? CHIP_CHOSEN : CHIP_RESTING)}
          >
            {chip.label}
            <span className={cn('text-meta', chosen ? 'text-primary' : 'text-text-muted')}>{chip.count}</span>
          </button>
        )
      })}
    </div>
  )
}

/** §41.5 rule 5: active filter chips, one row, scrolls sideways. */
function ActiveFilterChips({ filters }: { filters: PhoneListActiveFilter[] }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {filters.map(filter => (
        <span
          key={filter.key}
          className="inline-flex h-11 max-w-full shrink-0 items-center rounded-full border border-primary-border bg-primary-subtle pl-3 text-label font-medium text-primary"
        >
          <span className="min-w-0 truncate">{filter.label}</span>
          <button
            type="button"
            aria-label={filter.clearLabel}
            onClick={filter.onClear}
            className="flex size-11 shrink-0 items-center justify-center rounded-full active:bg-primary-subtle"
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        </span>
      ))}
    </div>
  )
}

const PULL_TO_REFRESH_PX = 72

/**
 * §41.5 rule 16: pulling down at the top reloads the list, no browser
 * pull-to-refresh. Ignores a pull starting within 24px of a side edge
 * (reserved for the phone's own back gesture) and any pull that does not
 * start with the list scrolled to the very top.
 */
function usePullToRefresh(
  rootRef: React.RefObject<HTMLDivElement | null>,
  onRefresh: (() => Promise<void>) | undefined,
  refreshing: boolean,
  setRefreshing: (value: boolean) => void,
  enabled: boolean
) {
  React.useEffect(() => {
    const root = rootRef.current
    const refresh = onRefresh
    if (!root || !refresh || !enabled) return

    let startY = 0
    let active = false

    function atTop() {
      return window.scrollY <= 0
    }

    function onTouchStart(e: TouchEvent) {
      const touch = e.touches[0]
      if (!touch || touch.clientX < 24 || touch.clientX > window.innerWidth - 24) return
      if (!atTop() || refreshing) return
      startY = touch.clientY
      active = true
    }

    function onTouchMove(e: TouchEvent) {
      if (!active) return
      const touch = e.touches[0]
      if (!touch) return
      const dy = touch.clientY - startY
      if (dy < 0) active = false
    }

    function onTouchEnd(e: TouchEvent) {
      if (!active) return
      active = false
      const touch = e.changedTouches[0]
      if (!touch) return
      const dy = touch.clientY - startY
      if (dy >= PULL_TO_REFRESH_PX) {
        setRefreshing(true)
        refresh!().finally(() => setRefreshing(false))
      }
    }

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: true })
    root.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', onTouchEnd)
    }
  }, [rootRef, onRefresh, refreshing, setRefreshing, enabled])
}

function PhoneSkeletonRows({ count, className }: { count: number; className?: string }) {
  return (
    <ul className={cn('flex flex-col divide-y divide-border-light rounded-xl border border-border-light bg-surface', className)}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} aria-hidden className="flex flex-col gap-2 px-4 py-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface-sunken" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-sunken" />
        </li>
      ))}
    </ul>
  )
}

export { PHONE_LIST_PAGE }
