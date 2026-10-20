'use client'

/**
 * Shared drag-to-reorder table body for masters that persist a `sort_order`
 * column, built once per the "never build the same thing twice" rule
 * (section 4 rules 2-4) instead of re-deriving it in every master that needs
 * it. Originally written inline in `master-name-page.tsx` (Wave 3A); pulled
 * out here so the bespoke `lead-types`/`lead-stages` pages (which don't fit
 * `MasterNamePage`'s shape) can reuse the identical drag + keyboard-fallback
 * UI and persistence logic rather than losing the feature on migration.
 *
 * The kit has no list-row reorder pattern (`board.tsx`'s drag/keyboard
 * reorder is card-board-specific) — see `docs/kit-audit/kit-gaps.md`.
 */
import { useRef, useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon, GripVerticalIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { cn } from '@/lib/utils'
import type { ListColumn } from '@/components/templates/list-page'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type SortableRow = { id: string; name?: unknown; sort_order?: number; [key: string]: unknown }

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export interface UseReorderableRowsOptions<T extends SortableRow> {
  /** Off entirely (hidden handles, no drag/keyboard wiring) when false — e.g. not yet known to be allowed. */
  enabled: boolean
  /** The master's REST base path, e.g. `/api/masters/lead-types`. One `PUT {apiPath}/{id}` per moved row. */
  apiPath: string
  /**
   * Builds the PUT body for one row at its new `sort_order` (passed as the
   * second argument). Must carry every field the route needs unchanged —
   * the route treats an absent key as "leave alone" for some fields and
   * "reset to default" for others (e.g. `is_active` defaults to `true` if
   * omitted), so callers must match what their master's route expects.
   */
  buildBody: (row: T, newSortOrder: number) => Record<string, unknown>
  /** Called after a successful persist, to refetch the list. */
  onPersisted: () => void
}

export function useReorderableRows<T extends SortableRow>(opts: UseReorderableRowsOptions<T>) {
  const { toast } = useToast()
  const [orderRows, setOrderRows] = useState<T[]>([])
  const lastLoadedRef = useRef<T[] | null>(null)
  const dragFromRef = useRef<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const canReorder = opts.enabled

  // Synced during render (not an effect) so a fresh `load` response is
  // reflected on the same paint — the same pattern `getDerivedStateFromProps`
  // replaces.
  function syncOrderRows(rows: T[]) {
    if (lastLoadedRef.current !== rows) {
      lastLoadedRef.current = rows
      setOrderRows(rows)
    }
  }

  async function persistOrder(next: T[], previous: T[]) {
    const changed = next.filter((r, i) => r.sort_order !== i)
    if (changed.length === 0) return
    const replies = await Promise.all(
      changed.map(r => {
        const newSortOrder = next.indexOf(r)
        return fetch(`${opts.apiPath}/${r.id}`, {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({ ...opts.buildBody(r, newSortOrder), sort_order: newSortOrder }),
        })
      }),
    )
    if (replies.some(r => !r.ok)) {
      setOrderRows(previous)
      toast('The new order could not be saved.', 'error')
      return
    }
    toast('Order saved')
    opts.onPersisted()
  }

  function moveRow(from: number, to: number) {
    if (to < 0 || to >= orderRows.length || from === to) return
    const previous = orderRows
    const next = [...orderRows]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    const renumbered = next.map((r, i) => ({ ...r, sort_order: i }))
    setOrderRows(renumbered)
    void persistOrder(renumbered, previous)
  }

  function handleDrop() {
    const from = dragFromRef.current
    const to = dragOverIdx
    dragFromRef.current = null
    setDragOverIdx(null)
    if (from === null || to === null) return
    moveRow(from, to)
  }

  /**
   * Renders the full reorderable `<Table>` for `ListPage`'s `renderData`
   * escape hatch. `columns` is the same `ListColumn[]` the caller's default
   * (non-reorder) rendering would use.
   */
  function renderReorderableTable(rows: T[], columns: ListColumn<T>[]) {
    syncOrderRows(rows)
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            {columns.map(col => (
              <TableHead key={col.id} numeric={col.numeric}>{col.header || <span className="sr-only">Actions</span>}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {orderRows.map((row, i) => (
            <TableRow
              key={row.id}
              draggable={canReorder}
              onDragStart={canReorder ? () => { dragFromRef.current = i } : undefined}
              onDragOver={canReorder ? e => { e.preventDefault(); setDragOverIdx(i) } : undefined}
              onDrop={canReorder ? handleDrop : undefined}
              onDragEnd={canReorder ? () => { dragFromRef.current = null; setDragOverIdx(null) } : undefined}
              className={cn('transition-colors duration-200 ease-out', i === dragOverIdx && 'bg-surface-sunken')}
            >
              <TableCell className="w-10">
                {canReorder && (
                  <div className="flex items-center gap-0.5">
                    <GripVerticalIcon
                      className="h-4 w-4 cursor-grab text-text-muted active:cursor-grabbing"
                      aria-hidden
                    />
                    {/* Keyboard-accessible fallback for native HTML5 drag,
                        which has no keyboard path (kit section 39 asks for
                        one; the kit itself has no list-reorder pattern — see
                        kit-gaps.md). */}
                    <div className="flex flex-col">
                      <button
                        type="button"
                        className="text-text-muted hover:text-text-secondary disabled:opacity-30"
                        onClick={() => moveRow(i, i - 1)}
                        disabled={i === 0}
                        aria-label={`Move ${String(row.name ?? '')} up`}
                      >
                        <ChevronUpIcon className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="text-text-muted hover:text-text-secondary disabled:opacity-30"
                        onClick={() => moveRow(i, i + 1)}
                        disabled={i === orderRows.length - 1}
                        aria-label={`Move ${String(row.name ?? '')} down`}
                      >
                        <ChevronDownIcon className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
              </TableCell>
              {columns.map(col => (
                <TableCell key={col.id} numeric={col.numeric}>{col.cell(row)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  return { renderReorderableTable, orderRows }
}
