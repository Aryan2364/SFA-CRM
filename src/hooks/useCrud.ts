'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useToast } from '@/contexts/ToastContext'

const PAGE_SIZE = 15

/** Section 14 rule 4: `fetch` has no deadline of its own. Matches `src/lib/load-list.ts`. */
const TIMEOUT_MS = 20000

const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'
const TIMEOUT_MESSAGE = 'The server took too long to answer. Try again in a moment.'
const UNREADABLE_MESSAGE = 'The server sent back an answer this screen could not read. Try again in a moment.'
const FORBIDDEN_MESSAGE = 'You do not have permission to do this.'

/** A delete the server refused. `inUse` is a 409: other records still point at this one. */
export type DeleteFailure = { message: string; inUse: boolean }

type Reply =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; message: string }

/** Ends a message with a full stop so the text CrudPage appends reads as a new sentence. */
function sentence(message: string): string {
  const m = message.trim()
  return /[.!?]$/.test(m) ? m : `${m}.`
}

/**
 * Every request in this hook goes through here, so none of them can stall for
 * ever and none can put a raw browser string ("Failed to fetch", "Unexpected
 * token '<'") in front of the user.
 *
 * A failed route does not always answer with JSON — a 502 from a proxy, or a
 * connection dropped mid-body, gives HTML or nothing at all. Before this,
 * `res.json()` then threw, and that throw escaped `create`/`update`/`remove`
 * and skipped the caller's `setSaving(false)`, leaving the modal on "Saving…".
 * This never throws.
 */
async function send(url: string, init: RequestInit | undefined, fallback: string): Promise<Reply> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  let text: string
  try {
    res = await fetch(url, { ...init, signal: controller.signal })
    text = await res.text()
  } catch {
    return { ok: false, status: 0, message: controller.signal.aborted ? TIMEOUT_MESSAGE : NETWORK_MESSAGE }
  } finally {
    clearTimeout(timer)
  }

  let body: unknown = null
  let readable = true
  if (text) {
    try { body = JSON.parse(text) } catch { readable = false }
  }

  if (res.ok) {
    return readable ? { ok: true, status: res.status, body } : { ok: false, status: res.status, message: UNREADABLE_MESSAGE }
  }
  const error = body && typeof body === 'object' ? (body as Record<string, unknown>).error : undefined
  if (res.status === 403 && (typeof error !== 'string' || error === 'Forbidden')) {
    return { ok: false, status: 403, message: FORBIDDEN_MESSAGE }
  }
  return {
    ok: false,
    status: res.status,
    message: typeof error === 'string' && error.trim() ? sentence(error) : fallback,
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function useCrud<T extends Record<string, unknown>>(apiPath: string, queryParams?: Record<string, string>) {
  const [allRows, setAllRows] = useState<T[]>([])
  const [isFetching, setIsFetching] = useState(false)
  // "Loading…" belongs to the very first load only. Every later fetch — after a
  // save, a toggle, a reorder, a new search — keeps the rows and the page on
  // screen and swaps them when the answer lands, so nothing blanks or jumps.
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { toast } = useToast()
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Only the newest list request may write rows. Without this, two refetches
  // in flight (a toggle clicked twice) can land out of order and the older
  // answer overwrites the newer one.
  const fetchSeq = useRef(0)
  const lastQuery = useRef<string | null>(null)
  // A mutation's refetch runs after an await, by which time the closure's
  // `search` may be stale. The ref always holds what the box says now.
  const searchRef = useRef(search)
  searchRef.current = search

  const fetchRows = useCallback(async (q: string) => {
    const seq = ++fetchSeq.current
    setIsFetching(true)
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...queryParams })
    const reply = await send(`${apiPath}?${params}`, undefined, 'The server could not return the records.')
    if (seq !== fetchSeq.current) return
    setIsFetching(false)
    if (reply.ok && Array.isArray(reply.body)) {
      setAllRows(reply.body as T[])
      setHasLoaded(true)
      setLoadError(null)
      // A new search starts at page 1; a refetch of the same search stays put.
      if (lastQuery.current !== q) setPage(1)
      lastQuery.current = q
      return
    }
    // A14: the rows are left as they were rather than cleared — a refetch
    // that fails must not wipe a list the user is reading. What changes is
    // that the failure is now stated, so an empty table reads as "this did
    // not load", not as "you have no records".
    const message = reply.ok ? UNREADABLE_MESSAGE : reply.message
    setLoadError(message)
    toast(message, 'error')
  }, [apiPath, JSON.stringify(queryParams)])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => fetchRows(search), 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [search, fetchRows])

  const refetch = useCallback(() => fetchRows(searchRef.current), [fetchRows])

  /** Replaces one row in place — same position, same key — so it never flickers. */
  function patchRow(id: string, patch: Record<string, unknown>) {
    setAllRows(prev => prev.map(r => (String(r.id) === id ? { ...r, ...patch } as T : r)))
  }

  /*
   * All of these report failure as a VALUE — null / false / a message — and
   * never throw. Every page does `setSaving(true) … await … setSaving(false)`,
   * so a throw from here skipped the reset and pinned the modal on "Saving…".
   */
  async function create(body: Record<string, unknown>): Promise<T | null> {
    const reply = await send(apiPath, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }, 'The record could not be created.')
    if (!reply.ok) { toast(reply.message, 'error'); return null }
    toast('Created successfully')
    // Where a new row lands depends on the server's ordering, so it is fetched
    // rather than guessed — in the background, with the current rows kept.
    await refetch()
    return (reply.body ?? {}) as T
  }

  async function update(id: string, body: Record<string, unknown>): Promise<boolean> {
    const reply = await send(`${apiPath}/${id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) }, 'The change could not be saved.')
    if (!reply.ok) { toast(reply.message, 'error'); return false }
    toast('Updated successfully')
    // The row changes where it stands: what was sent, then whatever the server
    // answered with. The quiet refetch after it brings in the fields only the
    // list query computes (a district's state name, say).
    const returned = reply.body && typeof reply.body === 'object' && String((reply.body as Record<string, unknown>).id) === id
      ? reply.body as Record<string, unknown>
      : {}
    patchRow(id, { ...body, ...returned })
    void refetch()
    return true
  }

  /**
   * Persists a new order for the rows CrudPage just dragged into place. One
   * PUT per row whose position actually changed, one toast, one refetch — and
   * if any PUT fails the list goes back to how it was before the drag.
   *
   * `newRows` is the visible page (or the search results on it). The positions
   * it is given are the `sort_order` values those same rows already held, so
   * rows on other pages or outside the search keep their places. Only when
   * those values are not distinct (older data, every row 0) is the position
   * taken from where the row sits in the list instead.
   */
  async function reorder(newRows: Record<string, unknown>[], bodyFor: (row: Record<string, unknown>) => Record<string, unknown>): Promise<boolean> {
    const before = allRows
    const slots = newRows.map(r => Number(r.sort_order)).sort((a, b) => a - b)
    const distinct = slots.every((v, i) => Number.isFinite(v) && (i === 0 || v !== slots[i - 1]))
    const offset = (safePage - 1) * PAGE_SIZE
    const orders = newRows.map((_, i) => (distinct ? slots[i] : offset + i))

    const ids = new Set(newRows.map(r => String(r.id)))
    const byId = new Map(newRows.map((r, i) => [String(r.id), { ...r, sort_order: orders[i] } as unknown as T]))
    const reordered = newRows.map(r => byId.get(String(r.id)) as T)
    setAllRows(prev => {
      // Splice the dragged rows back into the positions they occupied.
      let k = 0
      return prev.map(r => (ids.has(String(r.id)) ? reordered[k++] : r))
    })

    const changed = newRows.filter((r, i) => Number(r.sort_order) !== orders[i])
    if (changed.length === 0) return true
    const replies = await Promise.all(
      changed.map(r => send(
        `${apiPath}/${r.id}`,
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ ...bodyFor(r), sort_order: byId.get(String(r.id))?.sort_order }) },
        'The new order could not be saved.',
      )),
    )
    const failed = replies.find(r => !r.ok)
    if (failed && !failed.ok) {
      setAllRows(before)
      // Some PUTs may have landed. Undo those on the server too, so what the
      // refetch brings back is the old order and not half of the new one.
      const saved = changed.filter((_, i) => replies[i].ok)
      const undo = await Promise.all(
        saved.map(r => send(
          `${apiPath}/${r.id}`,
          { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ ...bodyFor(r), sort_order: r.sort_order }) },
          'The previous order could not be restored.',
        )),
      )
      toast(
        undo.every(r => r.ok)
          ? `${failed.message} The previous order has been put back.`
          : `${failed.message} The order may be partly saved. Refresh to see the current order.`,
        'error',
      )
      void refetch()
      return false
    }
    toast('Order saved')
    void refetch()
    return true
  }

  /** Returns the failure, or null on success. The row is deliberately NOT
   *  removed optimistically — the server decides whether it went. */
  async function remove(id: string): Promise<DeleteFailure | null> {
    const reply = await send(`${apiPath}/${id}`, { method: 'DELETE' }, 'The record could not be deleted.')
    if (!reply.ok) return { message: reply.message, inUse: reply.status === 409 }
    toast('Deleted successfully')
    await refetch()
    return null
  }

  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE))
  // A delete that empties the last page must not leave the user on a page
  // that no longer exists.
  const safePage = Math.min(page, totalPages)
  // …and the stored page follows, so a later growth of the list does not
  // carry the view back to the page it had before the shrink.
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])
  // Memoised: CrudPage mirrors `rows` into its drag state with an effect, and a
  // fresh slice every render would re-fire that effect on every render.
  const rows = useMemo(
    () => allRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [allRows, safePage],
  )

  return {
    // Before the first answer the list is loading, not empty — so "No records
    // found." never flashes on open. After a failed first load it is the
    // error, until a retry is in flight.
    rows, allRows, isLoading: !hasLoaded && (isFetching || !loadError), loadError, search, setSearch,
    page: safePage, setPage, totalPages, create, update, reorder, remove, refetch,
  }
}
