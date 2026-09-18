'use client'

import * as React from 'react'

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { fmtAmount, fmtNumber } from '@/lib/format'

import type { ReportFormat, ReportRow } from './types'

/**
 * AGENTS.md §34 — the report table. APP-LOCAL; see
 * `proposal-report-table-2026-09-18.md` for why this is a build task rather
 * than a §30 gate, and for the API as proposed.
 *
 * ⚠️ IMPORTS NOTHING FROM `@/lib/reports/**`. Those modules import `@/lib/db`,
 * which imports Prisma and `pg`; this is a `'use client'` component, and one
 * value import from there pulls the data layer into the browser bundle with a
 * clean `tsc --noEmit`. The wire shapes come from `./types`, which imports
 * nothing at all.
 *
 * What §34 asks for, and where each rule lands:
 *
 *   34.1  Total row pinned the same way the header is → `TableFooter sticky`,
 *         which applies `sticky bottom-0` to the `tfoot` AND to its cells,
 *         because several engines ignore it on `tfoot`.
 *   34.2  Never paginate. Show every row and scroll. There is no page size
 *         here and none in the API — the only ceiling is the engine's
 *         MAX_ROWS, and when it bites `truncated` says so rather than the
 *         table quietly showing a partial answer as if it were whole.
 *   34.3  First column freezes on horizontal scroll, 1px right border. Applied
 *         to the header, body and footer cells so the corner stays covered
 *         while both axes move.
 *   34.4  One component, every scope. `scopeLabel` is the caption saying what
 *         the figures cover.
 */

/** `format` decides the formatter AND the alignment (§11.1). */
export function formatValue(value: number, format: ReportFormat): string {
  switch (format) {
    case 'amount':
      return fmtAmount(value)
    case 'percent':
      // One decimal: a discount percentage of 12.5 is a different negotiation
      // from 13, and rounding to whole numbers hides the difference.
      return `${fmtNumber(Number(value.toFixed(1)))}%`
    case 'hours':
      return `${fmtNumber(Number(value.toFixed(1)))} h`
    case 'number':
    default:
      return fmtNumber(value)
  }
}

/**
 * The frozen first column. `sticky left-0` needs an opaque background of its
 * own — a transparent cell scrolls the next column's text under itself — so
 * each of the three rows states the background it sits on rather than
 * inheriting one.
 */
const FROZEN = 'sticky left-0 z-10 border-r border-border-light'

export function ReportTable({
  dimensions,
  measure,
  rows,
  total,
  truncated,
  scopeLabel,
  className,
}: {
  /** Column headers for the dimension columns, in spec order. One or two. */
  dimensions: { key: string; label: string }[]
  /** The measure — names and formats the single value column. */
  measure: { key: string; label: string; format: ReportFormat }
  rows: ReportRow[]
  /**
   * The engine's own grand total.
   *
   * ⚠️ NOT a sum of `rows[].value`, and never computed as one here. For a
   * ratio measure (Discount Percentage) the engine's total is
   * `sum(numerator) / sum(denominator)`, which is neither the sum nor the mean
   * of the row percentages. Summing the column would print a plausible wrong
   * number.
   */
  total: number
  /** True when MAX_ROWS bit; the figures are partial. */
  truncated?: boolean
  /** §34.4 — what the figures cover, rendered as caption text. */
  scopeLabel?: string
  className?: string
}) {
  const numeric = true

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {/*
        THE SCROLL CONTAINER, and the only thing on this page that scrolls
        sideways. `overflow-auto` on this box is what makes the header's
        `sticky top-0`, the footer's `sticky bottom-0` and the first column's
        `sticky left-0` resolve against the table rather than the window — and
        it is what keeps a fourteen-character company name from widening the
        page body.
      */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {dimensions.map((d, index) => (
                <TableHead
                  key={d.key}
                  className={cn(index === 0 && `${FROZEN} bg-surface-sunken`)}
                >
                  {d.label}
                </TableHead>
              ))}
              <TableHead numeric={numeric}>{measure.label}</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map(row => (
              // The composite group key is React's row identity, so changing
              // the measure under the same dimensions UPDATES each row in
              // place rather than destroying and recreating it. That is the
              // difference between a number changing and the table flickering.
              <TableRow key={JSON.stringify(row.key)} className="group">
                {row.label.map((label, index) => (
                  <TableCell
                    key={dimensions[index]?.key ?? index}
                    className={cn(
                      index === 0 &&
                        // `bg-surface` rather than transparent: see FROZEN.
                        // The hover tint is repeated here because the row's
                        // own hover background sits behind this cell.
                        `${FROZEN} bg-surface group-hover:bg-surface-sunken`
                    )}
                  >
                    {label}
                  </TableCell>
                ))}
                <TableCell numeric={numeric}>
                  {formatValue(row.value, measure.format)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>

          {/* §34.1. Pinned, and present even when there are no rows — a total
              of zero is an answer, and a missing total row reads as a bug. */}
          <TableFooter sticky>
            <TableRow>
              <TableCell
                className={`${FROZEN} bg-surface-sunken font-medium`}
                colSpan={1}
              >
                Total
              </TableCell>
              {dimensions.length > 1 && <TableCell />}
              <TableCell numeric={numeric} className="font-medium">
                {formatValue(total, measure.format)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {(scopeLabel || truncated) && (
        <div className="shrink-0 border-t border-border-light px-4 py-2">
          {truncated && (
            // §34.2 forbids pagination, so the ceiling has to be VISIBLE
            // rather than silently applied. Stated with the way out: narrow
            // the date range.
            <p className="text-label text-warning">
              Only the first rows were read, so these figures are partial.
              Narrow the date range or add a filter to see a complete answer.
            </p>
          )}
          {scopeLabel && (
            <p className="text-meta text-text-muted">{scopeLabel}</p>
          )}
        </div>
      )}
    </div>
  )
}
