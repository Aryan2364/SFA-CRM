'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Pagination, PaginationBar, PaginationContent, PaginationCount, PaginationItem, PaginationNext, PaginationPrevious,
} from '@/components/ui/pagination'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Truncate } from '@/components/ui/truncate'
import { EMPTY, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ROW_NUMBER_KEY, type ImportResponse, type RawRow, type RowStatus } from '@/lib/bulk-import'

/**
 * The one table behind every importer's check and result screens: count chips
 * that filter it, and a paginated table in its own scroll area with a pinned
 * header. The check (`mode: 'validate'`) and the result (`'commit'`) are the
 * same response shape, so they are the same component — what the user
 * previewed is exactly what the result screen describes.
 */

export type ReviewFilter = 'all' | 'good' | 'problems' | 'existing'

/** A column of the source sheet shown beside each verdict, so a row can be
 *  recognised without opening the file. `header` is the file's own header
 *  for it; a column the file does not have shows a dash. */
export type ReviewColumn = { label: string; header: string | undefined }

const PAGE_SIZE = 25

const matches = (filter: ReviewFilter, status: RowStatus) =>
  filter === 'all' ||
  (filter === 'good' && (status === 'ready' || status === 'created')) ||
  (filter === 'problems' && status === 'skipped') ||
  (filter === 'existing' && status === 'existing')

/** The chip a response opens on: its problems when it has any. */
export function initialFilter(res: ImportResponse): ReviewFilter {
  return res.counts.skipped > 0 ? 'problems' : 'all'
}

function StatusBadge({ status }: { status: RowStatus }) {
  switch (status) {
    case 'ready':    return <Badge variant="success"><CircleCheckIcon />Ready</Badge>
    case 'created':  return <Badge variant="success"><CircleCheckIcon />Imported</Badge>
    case 'existing': return <Badge variant="neutral"><InfoIcon />Already exists</Badge>
    case 'skipped':  return <Badge variant="danger"><OctagonXIcon />Skipped</Badge>
  }
}

function Chip({ active, onClick, icon, label, count }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-label transition-colors sm:min-h-0 sm:h-control-sm',
        'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        active
          ? 'border-primary bg-primary-subtle font-medium text-primary'
          : 'border-border bg-surface text-text-secondary hover:bg-surface-control',
      )}
    >
      {icon}
      <span>{label}</span>
      <span className="tabular-nums">{fmtNumber(count)}</span>
    </button>
  )
}

export function ImportReview({ response, sourceRows, columns, filter, onFilterChange, className }: {
  response: ImportResponse
  /** The rows as parsed, keyed by the file's own headers, each with `__row`. */
  sourceRows: RawRow[]
  columns: ReviewColumn[]
  filter: ReviewFilter
  onFilterChange: (f: ReviewFilter) => void
  className?: string
}) {
  const [page, setPage] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const byRow = useMemo(
    () => new Map(sourceRows.map(r => [Number(r[ROW_NUMBER_KEY]), r])),
    [sourceRows],
  )
  const shown = useMemo(() => response.rows.filter(r => matches(filter, r.status)), [response.rows, filter])
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const slice = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  // A new filter or a new response starts at the top of page one; a page
  // change scrolls the table's own box, never the page around it.
  useEffect(() => { setPage(0) }, [filter, response])
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [current, filter, response])

  const { counts } = response
  const committed = response.mode === 'commit'

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-2" role="group" aria-label="Show rows">
        <Chip active={filter === 'all'} onClick={() => onFilterChange('all')}
          icon={null} label="All rows" count={response.total} />
        <Chip active={filter === 'good'} onClick={() => onFilterChange('good')}
          icon={<CircleCheckIcon className="text-success" />} label={committed ? 'Imported' : 'Ready'}
          count={committed ? counts.created : counts.ready} />
        <Chip active={filter === 'problems'} onClick={() => onFilterChange('problems')}
          icon={<OctagonXIcon className="text-danger" />} label="Problems" count={counts.skipped} />
        <Chip active={filter === 'existing'} onClick={() => onFilterChange('existing')}
          icon={<InfoIcon className="text-text-secondary" />} label="Already exist" count={counts.existing} />
      </div>

      <div className="flex min-h-60 flex-1 flex-col overflow-hidden rounded-xl border border-border-light bg-surface">
        {shown.length === 0 ? (
          <EmptyState
            variant="nothing-found"
            heading="No rows here"
            actionLabel="Show all rows"
            onAction={() => onFilterChange('all')}
          >
            No row in this file is in this group.
          </EmptyState>
        ) : (
          <>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead numeric className="w-col-count">Row</TableHead>
                    <TableHead className="w-col-status">Status</TableHead>
                    {columns.map((c, i) => (
                      <TableHead key={c.label} className={cn(i > 0 && 'hidden lg:table-cell')}>{c.label}</TableHead>
                    ))}
                    <TableHead className="w-2/5">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slice.map(v => {
                    const src = byRow.get(v.row)
                    return (
                      <TableRow key={v.row}>
                        <TableCell numeric className="align-top">{v.row}</TableCell>
                        <TableCell className="align-top"><StatusBadge status={v.status} /></TableCell>
                        {columns.map((c, i) => {
                          const value = src && c.header !== undefined ? String(src[c.header] ?? '').trim() : ''
                          return (
                            <TableCell key={c.label} className={cn('align-top', i > 0 && 'hidden lg:table-cell')}>
                              {value ? <Truncate>{value}</Truncate> : <span className="text-text-muted">{EMPTY}</span>}
                            </TableCell>
                          )
                        })}
                        <TableCell className="align-top">
                          {v.issues.length === 0 ? (
                            <span className="text-text-secondary">
                              {v.status === 'created' ? 'Imported' : v.status === 'existing' ? 'Already in the system; left as it is' : 'No problems'}
                            </span>
                          ) : (
                            <ul className="space-y-1">
                              {v.issues.map((iss, k) => (
                                <li key={k} className="flex gap-2 text-text-primary">
                                  {iss.severity === 'error'
                                    ? <OctagonXIcon className="mt-1 size-4 shrink-0 text-danger" aria-label="Problem" />
                                    : <TriangleAlertIcon className="mt-1 size-4 shrink-0 text-warning" aria-label="Note" />}
                                  <span className="min-w-0 break-words">{iss.message}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <PaginationBar>
              <PaginationCount>
                {fmtNumber(current * PAGE_SIZE + 1)}–{fmtNumber(Math.min((current + 1) * PAGE_SIZE, shown.length))} of {fmtNumber(shown.length)}
              </PaginationCount>
              {pages > 1 && (
                <Pagination className="mx-0 w-auto">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        aria-disabled={current === 0 || undefined}
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <span className="px-2 text-label tabular-nums text-text-secondary">
                        Page {current + 1} of {pages}
                      </span>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        aria-disabled={current >= pages - 1 || undefined}
                        onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </PaginationBar>
          </>
        )}
      </div>
    </div>
  )
}
