'use client'

/**
 * "See all results for 'x'" — where the top bar's global search dropdown
 * sends a caller past its 5-per-type cap (src/components/shell/top-bar.tsx).
 *
 * Not built on `templates/list-page.tsx`: that template's own "KNOWN
 * BOUNDARY" note says it does client-side pagination over an array a route
 * returns whole, and explicitly defers server-side `{ rows, total }` paging
 * until a screen needs it. This is that screen — five independent lists, each
 * server-paged through `GET /api/search?type=&limit=&offset=` — so it is
 * plain content inside the shell's own scrolling wrapper (section 12.3)
 * rather than forcing a template built for one table into five.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CalendarDaysIcon,
  ContactIcon,
  HandshakeIcon,
  ShoppingCartIcon,
  UserRoundSearchIcon,
} from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import {
  PaginationBar,
  PaginationCount,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { recordRecentItem } from '@/lib/recent-items'
import { useMe } from '@/hooks/useMe'

type ResultType = 'account' | 'contact' | 'opportunity' | 'order' | 'meeting'
type SearchResult = { type: ResultType; id: string; title: string; subtitle: string | null; href: string }

const TYPES: { type: ResultType; heading: string; icon: ReactNode }[] = [
  { type: 'account', heading: 'Accounts', icon: <UserRoundSearchIcon className="size-icon" /> },
  { type: 'contact', heading: 'Contacts', icon: <ContactIcon className="size-icon" /> },
  { type: 'opportunity', heading: 'Opportunities', icon: <HandshakeIcon className="size-icon" /> },
  { type: 'order', heading: 'Orders', icon: <ShoppingCartIcon className="size-icon" /> },
  { type: 'meeting', heading: 'Meetings', icon: <CalendarDaysIcon className="size-icon" /> },
]

const PAGE_SIZE = 10
const REQUEST_TIMEOUT_MS = 15000

function SearchPageInner() {
  const router = useRouter()
  const q = (useSearchParams().get('q') ?? '').trim()
  // Each TypeSection reports its own total once it has loaded, so the page
  // can tell "still loading" apart from "every type came back empty" and show
  // one aggregate empty state instead of five identical blank sections.
  const [totals, setTotals] = useState<Partial<Record<ResultType, number>>>({})
  const reportTotal = useCallback((type: ResultType, total: number) => {
    setTotals(prev => (prev[type] === total ? prev : { ...prev, [type]: total }))
  }, [])
  useEffect(() => setTotals({}), [q])

  const allLoaded = TYPES.every(t => t.type in totals)
  const grandTotal = useMemo(() => Object.values(totals).reduce((a, b) => a + (b ?? 0), 0), [totals])

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-h2 text-text-primary">
          {q ? <>Search results for &ldquo;{q}&rdquo;</> : 'Search'}
        </h1>
        <p className="text-body text-text-secondary">Accounts, contacts, opportunities, orders and meetings.</p>
      </div>

      {q.length < 2 ? (
        <EmptyState variant="nothing-found" heading="Type at least 2 characters" actionLabel="Back to dashboard" onAction={() => router.push('/')}>
          Search by name, mobile number, email or GST number.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {allLoaded && grandTotal === 0 && (
            <EmptyState
              variant="nothing-found"
              heading={`No results for "${q}"`}
              actionLabel="Back to dashboard"
              onAction={() => router.push('/')}
            >
              Nothing in accounts, contacts, opportunities, orders or meetings matched that search.
            </EmptyState>
          )}
          {TYPES.map(t => (
            <TypeSection key={t.type} q={q} type={t.type} heading={t.heading} icon={t.icon} onTotal={reportTotal} />
          ))}
        </div>
      )}
    </div>
  )
}

function TypeSection({
  q,
  type,
  heading,
  icon,
  onTotal,
}: {
  q: string
  type: ResultType
  heading: string
  icon: ReactNode
  onTotal: (type: ResultType, total: number) => void
}) {
  const me = useMe()
  const [rows, setRows] = useState<SearchResult[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [failed, setFailed] = useState(false)
  // Which `load()` call is the current one. Two calls can resolve out of
  // order — dev-mode double-invoke racing Next's lazy route compile is one
  // way it happened here, but any abandoned-then-superseded request has the
  // same shape — so a stale response arriving after a newer one must never
  // overwrite it. Every async handler checks it owns the latest id before
  // touching state; `AbortController.abort()` alone does not cover this,
  // because a response that already finished arriving when the next call
  // starts still resolves its old .then/.catch after abort() is called.
  const requestId = useRef(0)

  const load = useCallback(() => {
    const myRequest = ++requestId.current
    setRows(null)
    setFailed(false)
    const abort = new AbortController()
    const deadline = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
    fetch(`/api/search?q=${encodeURIComponent(q)}&type=${type}&limit=${PAGE_SIZE}&offset=${offset}`, {
      signal: abort.signal,
    })
      .then(r => {
        if (!r.ok) throw new Error('search failed')
        return r.json()
      })
      .then(body => {
        if (requestId.current !== myRequest) return
        setRows(body.results ?? [])
        setTotal(body.total ?? 0)
        onTotal(type, body.total ?? 0)
      })
      .catch(() => {
        if (requestId.current !== myRequest) return
        setFailed(true)
      })
      .finally(() => clearTimeout(deadline))
    return () => {
      clearTimeout(deadline)
      abort.abort()
    }
  }, [q, type, offset, onTotal])

  useEffect(() => {
    setOffset(0)
  }, [q, type])

  useEffect(() => load(), [load])

  // A type with zero matches, once the first page has actually loaded, is
  // left off the page entirely — five empty sections saying "nothing here"
  // would bury the types that DID match. Still loading or failed stay
  // visible so the caller sees why.
  if (rows !== null && !failed && total === 0) return null

  return (
    <section className="overflow-hidden rounded-xl border border-border-light bg-surface">
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-3">
        <span className="text-text-muted [&_svg]:size-icon">{icon}</span>
        <h2 className="text-body font-medium text-text-primary">{heading}</h2>
        {rows !== null && !failed && (
          <span className="text-meta text-text-muted">{total}</span>
        )}
      </div>

      {failed ? (
        <div className="p-4">
          <EmptyState variant="failed" heading="Couldn't load these" onAction={load}>
            Something went wrong fetching {heading.toLowerCase()}.
          </EmptyState>
        </div>
      ) : rows === null ? (
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-control w-full" />
          ))}
        </div>
      ) : (
        <>
          <ul>
            {rows.map(row => (
              <li key={row.id} className="border-b border-border-light last:border-b-0">
                <Link
                  href={row.href}
                  onClick={() => me?.userId && recordRecentItem(me.userId, row)}
                  className="flex flex-col px-4 py-3 text-body hover:bg-surface-control"
                >
                  <span className="truncate text-text-primary">{row.title}</span>
                  {row.subtitle && (
                    <span className="truncate text-meta text-text-muted">{row.subtitle}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {total > PAGE_SIZE && (
            <PaginationBar>
              <PaginationCount>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </PaginationCount>
              <div className="flex items-center gap-1">
                <PaginationPrevious
                  aria-disabled={offset === 0}
                  onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
                />
                <PaginationNext
                  aria-disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(o => o + PAGE_SIZE)}
                />
              </div>
            </PaginationBar>
          )}
        </>
      )}
    </section>
  )
}

/*
 * `useSearchParams()` opts the whole route into client-side rendering unless
 * it is inside a Suspense boundary — same pattern as `orders/page.tsx`.
 */
export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  )
}
