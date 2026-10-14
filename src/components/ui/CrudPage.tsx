'use client'

import { ReactNode, useState, useEffect } from 'react'
import { CheckIcon, MinusIcon } from 'lucide-react'
import Toggle from './Toggle'
import { Badge } from './badge'
import { EmptyState } from './empty-state'
import { PermissionTooltip } from './permission-tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog'
import {
  Pagination,
  PaginationBar,
  PaginationContent,
  PaginationCount,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './pagination'
import { useToast } from '@/contexts/ToastContext'
import type { Me } from '@/hooks/useMe'
import type { DeleteFailure } from '@/hooks/useCrud'

export interface Column {
  key: string
  label: string
  render?: (row: Record<string, unknown>) => ReactNode
}

/**
 * Section 26: an action the user may not perform is shown disabled with a
 * reason, never hidden. Per action: absent → allowed; `null` → not known yet
 * (permissions still loading: disabled, no reason); a string → denied, and the
 * string is the tooltip. The Active toggle and drag-reorder follow `edit`.
 */
export type CrudLocks = { add?: string | null; edit?: string | null; delete?: string | null }

/**
 * Locks for a master screen, read from the real permission map — never a role
 * name. /api/auth/me returns every section true for an Administrator, so they
 * keep every action without the role being named here.
 *
 * `addAction` is whichever action the master's POST route checks: some ask
 * `create`, older ones ask `edit`.
 */
export function masterLocks(
  me: Me | null, section: string, noun: string, addAction: 'create' | 'edit' = 'edit',
): CrudLocks {
  const p = me?.permissions?.[section]
  const lock = (ok: boolean | undefined, reason: string) => (me == null ? null : ok ? undefined : reason)
  return {
    add: addAction === 'create'
      ? lock(p?.create ?? p?.edit, `Only someone who can create ${noun} can add one.`)
      : lock(p?.edit, `Only someone who can edit ${noun} can add one.`),
    edit: lock(p?.edit, `Only someone who can edit ${noun} can change them.`),
    delete: lock(p?.delete, `Only someone who can delete ${noun} can remove them.`),
  }
}

interface CrudPageProps {
  title: string
  headerExtra?: ReactNode
  backHref?: string
  columns: Column[]
  rows: Record<string, unknown>[]
  allRowsCount: number
  isLoading: boolean
  search: string
  onSearchChange: (v: string) => void
  page: number
  totalPages: number
  onPage: (p: number) => void
  onAdd?: () => void
  onEdit?: (row: Record<string, unknown>) => void
  onDelete?: (row: Record<string, unknown>) => Promise<string | DeleteFailure | null | void> | void
  /**
   * What this master's DELETE route actually does, so the confirmation says
   * it. `soft` only switches the row off — it stays listed and the Active
   * toggle brings it back. `hard` removes the row, and fails with a 409 while
   * other records still use it.
   */
  deleteMode: 'soft' | 'hard'
  /**
   * Returns why this row cannot be deleted, or null when it can. A reason
   * renders that row's Delete disabled with the reason as its tooltip,
   * rather than leaving it clickable and doing nothing.
   */
  deleteDisabledReason?: (row: Record<string, unknown>) => string | null
  /**
   * Returns why this row's Edit action (and its Active toggle, which follows
   * `edit`) cannot be used, or null when it can — same shape as
   * `deleteDisabledReason`, for a row that is individually locked (e.g. a
   * system row) even though the page-level permission allows editing. A
   * page-level lock still wins; this only adds a per-row reason on top.
   */
  editDisabledReason?: (row: Record<string, unknown>) => string | null
  /** Page-level permission state per action. See `CrudLocks`. */
  locks?: CrudLocks
  rowActions?: (row: Record<string, unknown>) => ReactNode
  onToggleActive?: (row: Record<string, unknown>, val: boolean) => unknown
  onReorder?: (newRows: Record<string, unknown>[]) => void
  showActive?: boolean
  addLabel?: string
  filterBar?: ReactNode
  /**
   * Set when the list fetch failed. Without it a 500 renders as "No records
   * found.", which tells the user their data is gone. `useCrud` returns it.
   */
  loadError?: string | null
  onRetry?: () => void
}

export default function CrudPage({
  title, headerExtra, backHref, columns, rows, allRowsCount, isLoading, search, onSearchChange,
  page, totalPages, onPage, onAdd, onEdit, onDelete, deleteMode, deleteDisabledReason, editDisabledReason, rowActions, onToggleActive,
  onReorder: onReorderProp, showActive = true, addLabel = '+ Add', filterBar, loadError, onRetry, locks,
}: CrudPageProps) {
  // Dragging has no control to disable and explain, so it is simply off until
  // `edit` is known to be allowed.
  const onReorder = locks?.edit === undefined ? onReorderProp : undefined
  const { toast } = useToast()

  // Section 15: an irreversible action opens a confirmation dialog, never a
  // native confirm(). The row is held here so the dialog can name it.
  const [pendingDelete, setPendingDelete] = useState<Record<string, unknown> | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  // Section 15.1: when the server refuses a delete because other records still
  // use the row, the dialog stays open and becomes the answer — the reason,
  // stated neutrally, and the alternative where the screen has one.
  const [inUseReason, setInUseReason] = useState<string | null>(null)
  const [isSwitchingOff, setIsSwitchingOff] = useState(false)

  const deleteLabel = pendingDelete
    ? String(pendingDelete.name ?? (columns[0] ? pendingDelete[columns[0].key] : '') ?? '').trim()
    : ''

  function closeDelete() {
    setPendingDelete(null)
    setInUseReason(null)
  }

  async function confirmDelete() {
    if (!pendingDelete || isDeleting) return
    setIsDeleting(true)
    let keepOpen = false
    try {
      const result = await onDelete?.(pendingDelete)
      if (typeof result === 'string' && result) toast(result, 'error')
      else if (result && typeof result === 'object') {
        if (result.inUse) {
          setInUseReason(result.message)
          keepOpen = true
        } else toast(result.message, 'error')
      }
    } finally {
      setIsDeleting(false)
      if (!keepOpen) closeDelete()
    }
  }

  // Offered only where the row can be switched off here and now: the screen
  // has a toggle, the user may use it, and the row is still on.
  const canSwitchOff = !!onToggleActive && locks?.edit === undefined && Boolean(pendingDelete?.is_active)

  async function switchOffInstead() {
    if (!pendingDelete || !onToggleActive || isSwitchingOff) return
    setIsSwitchingOff(true)
    try {
      await onToggleActive(pendingDelete, false)
    } finally {
      setIsSwitchingOff(false)
      closeDelete()
    }
  }

  // The page window the previous Pagination component computed internally.
  // Kept identical so the 16 CrudPage screens paginate exactly as before;
  // only the markup underneath it changed to the kit's component.
  const pageWindow = Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
    if (totalPages <= 7) return i + 1
    if (page <= 4) return i + 1
    if (page >= totalPages - 3) return totalPages - 6 + i
    return page - 3 + i
  })

  // Local ordered rows for drag-and-drop (only used when onReorder is set)
  const [orderedRows, setOrderedRows] = useState<Record<string, unknown>[]>(rows)
  useEffect(() => { setOrderedRows(rows) }, [rows])

  const dragIdx    = { current: null as number | null }
  const dragOverIdx = { current: null as number | null }

  function handleDragStart(idx: number) { dragIdx.current = idx }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    dragOverIdx.current = idx
  }

  function handleDrop() {
    const from = dragIdx.current
    const to   = dragOverIdx.current
    if (from === null || to === null || from === to) return
    const next = [...orderedRows]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setOrderedRows(next)
    onReorder?.(next)
    dragIdx.current = null
    dragOverIdx.current = null
  }

  const displayRows = onReorder ? orderedRows : rows
  const colSpan = columns.length + (showActive ? 2 : 1) + (onReorder ? 1 : 0)

  return (
    <div>
      {backHref && (
        <a href={backHref} className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary mb-4 group">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          Back to Masters
        </a>
      )}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-medium text-text-primary">{title}</h2>
          {headerExtra}
        </div>
        {onAdd && (
          <PermissionTooltip allowed={typeof locks?.add !== 'string'} reason={locks?.add ?? ''}>
            <button
              onClick={onAdd}
              disabled={locks?.add !== undefined}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg transition disabled:bg-surface-sunken disabled:text-text-muted disabled:pointer-events-none"
            >
              {addLabel}
            </button>
          </PermissionTooltip>
        )}
      </div>

      <div className="mb-3">
        <input
          type="text" placeholder="Search…" value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-primary-ring"
        />
      </div>
      {filterBar && <div className="mb-3">{filterBar}</div>}

      <div className="bg-surface rounded-xl border border-border-light overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken border-b border-border-light">
            <tr>
              {onReorder && <th className="w-8 px-3 py-3" />}
              {columns.map(c => (
                <th key={c.key} className="text-left px-4 py-3 font-medium text-text-secondary whitespace-nowrap">{c.label}</th>
              ))}
              {showActive && <th className="text-left px-4 py-3 font-medium text-text-secondary">Active</th>}
              <th className="px-4 py-3 text-right font-medium text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={colSpan} className="text-center py-12 text-text-muted">Loading…</td></tr>
            ) : loadError && displayRows.length === 0 ? (
              /* A14: a failed load is not an empty list, and saying "No records
                 found." here tells the user their data is gone. */
              <tr>
                <td colSpan={colSpan} className="p-0">
                  <EmptyState
                    variant="failed"
                    heading="This list could not be loaded"
                    onAction={onRetry ?? (() => window.location.reload())}
                  >
                    {loadError} Try again, and if it keeps happening the records are still safe — only this view failed.
                  </EmptyState>
                </td>
              </tr>
            ) : displayRows.length === 0 ? (
              <tr><td colSpan={colSpan} className="text-center py-12 text-text-muted">No records found.</td></tr>
            ) : displayRows.map((row, i) => (
              <tr
                key={String(row.id ?? i)}
                className="border-t border-border-light hover:bg-surface-sunken"
                draggable={!!onReorder}
                onDragStart={onReorder ? () => handleDragStart(i) : undefined}
                onDragOver={onReorder ? e => handleDragOver(e, i) : undefined}
                onDrop={onReorder ? handleDrop : undefined}
              >
                {onReorder && (
                  <td className="px-3 py-3 cursor-grab text-text-muted hover:text-text-secondary select-none">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5m-16.5 6h16.5m-16.5 6h16.5" />
                    </svg>
                  </td>
                )}
                {columns.map(c => (
                  <td key={c.key} className="px-4 py-3 text-text-secondary">
                    {c.render ? c.render(row) : String(row[c.key] ?? '')}
                  </td>
                ))}
                {/* The header renders this column whenever `showActive`, so the
                    body must too, or every row is one cell short and Actions
                    slides under the "Active" heading. Where the screen passes
                    no toggle the state is still shown — read-only, as a badge. */}
                {/*
                  The page-level lock wins; a row's own reason (e.g. a system
                  row) applies only when the user may edit at all.
                  `undefined` → interactive, `null` → not known yet (disabled,
                  no reason), a string → denied with that reason. Computed
                  once per row and shared by the Active toggle and Edit, since
                  both follow `edit`.
                */}
                {(() => {
                  const rowEditBlocked: string | null | undefined =
                    locks?.edit !== undefined ? locks.edit : (editDisabledReason?.(row) ?? undefined)
                  return (
                    <>
                      {showActive && (
                        <td className="px-4 py-3">
                          {onToggleActive && rowEditBlocked === undefined ? (
                            <Toggle checked={Boolean(row.is_active)} onChange={v => onToggleActive(row, v)} />
                          ) : onToggleActive ? (
                            <PermissionTooltip allowed={typeof rowEditBlocked !== 'string'} reason={rowEditBlocked ?? ''}>
                              {/* Toggle takes no className; this span stops a disabled
                                  one swallowing the hover the tooltip needs. */}
                              <span className="inline-flex pointer-events-none">
                                <Toggle checked={Boolean(row.is_active)} onChange={() => {}} disabled />
                              </span>
                            </PermissionTooltip>
                          ) : Boolean(row.is_active) ? (
                            <Badge variant="success"><CheckIcon />Active</Badge>
                          ) : (
                            <Badge variant="neutral"><MinusIcon />Inactive</Badge>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {onEdit && (
                            <PermissionTooltip allowed={typeof rowEditBlocked !== 'string'} reason={rowEditBlocked ?? ''}>
                              <button
                                onClick={() => onEdit(row)}
                                disabled={rowEditBlocked !== undefined}
                                className="text-primary hover:text-primary-hover text-xs font-medium disabled:text-text-muted disabled:pointer-events-none"
                              >
                                Edit
                              </button>
                            </PermissionTooltip>
                          )}
                          {rowActions?.(row)}
                          {onDelete && (() => {
                            // The page-level lock wins; a row's own reason applies only
                            // when the user may delete at all.
                            const lock = locks?.delete
                            // On a soft-delete master, Delete only switches the row off —
                            // so on a row that is already off it would do nothing.
                            const blocked = lock !== undefined ? lock
                              : (deleteDisabledReason?.(row)
                                ?? (deleteMode === 'soft' && !row.is_active
                                  ? (onToggleActive ? 'Already switched off. Use the Active switch to bring it back.' : 'Already switched off.')
                                  : null))
                            return (
                              <PermissionTooltip allowed={!blocked} reason={blocked ?? ''}>
                                <button
                                  onClick={() => setPendingDelete(row)}
                                  disabled={lock !== undefined || !!blocked}
                                  className="text-danger hover:text-danger-hover text-xs font-medium disabled:text-text-muted disabled:pointer-events-none"
                                >
                                  Delete
                                </button>
                              </PermissionTooltip>
                            )
                          })()}
                        </div>
                      </td>
                    </>
                  )
                })()}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <PaginationBar>
          <PaginationCount>
            {allRowsCount != null ? `${allRowsCount} records` : ''}
          </PaginationCount>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  aria-disabled={page === 1}
                  onClick={e => {
                    e.preventDefault()
                    if (page > 1) onPage(page - 1)
                  }}
                />
              </PaginationItem>
              {pageWindow.map(p => (
                <PaginationItem key={p}>
                  <PaginationLink
                    href="#"
                    isActive={p === page}
                    onClick={e => {
                      e.preventDefault()
                      onPage(p)
                    }}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  aria-disabled={page === totalPages}
                  onClick={e => {
                    e.preventDefault()
                    if (page < totalPages) onPage(page + 1)
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </PaginationBar>
      )}

      {/* Section 15. Portalled by AlertDialogContent, so no ancestor
          transform or overflow can clip it. Neither button is live while the
          delete is in flight, which is what stops a double submit. */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={o => { if (!o && !isDeleting && !isSwitchingOff) closeDelete() }}
      >
        <AlertDialogContent>
          {inUseReason ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {deleteLabel ? `${deleteLabel} can't be deleted` : "This record can't be deleted"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {inUseReason}{' '}
                  {canSwitchOff
                    ? 'Switch it off instead: the records that use it keep reading correctly, and it stops appearing in new entry.'
                    : 'Remove or change the records that use it first, and then delete it.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isSwitchingOff}>{canSwitchOff ? 'Cancel' : 'Close'}</AlertDialogCancel>
                {canSwitchOff && (
                  <AlertDialogAction variant="primary" onClick={switchOffInstead} disabled={isSwitchingOff}>
                    {isSwitchingOff ? 'Switching off…' : 'Switch off instead'}
                  </AlertDialogAction>
                )}
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {deleteLabel ? `Delete ${deleteLabel}?` : 'Delete this record?'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {deleteMode === 'soft'
                    ? 'This hides it everywhere; you can switch it back on later. Records that already use it keep it.'
                    : 'This removes it permanently and cannot be undone.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDelete} disabled={isDeleting}>
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
