'use client'

import * as React from 'react'

import { CategoryBarChart, MAX_SERIES } from '@/components/ui/bar-chart'

import { formatValue } from './report-table'
import type { ReportFormat, ReportRow } from './types'

/**
 * The chart half of the §7.1 builder's table/chart toggle.
 *
 * ---------------------------------------------------------------------------
 * WHY A HORIZONTAL BAR CHART, AND ONLY THAT
 *
 * The chart type is my judgement to make (§10), and the judgement is: the one
 * the design system already owns. `components/ui/bar-chart.tsx` is §21 made
 * into a component — the categorical sequence, the zero baseline, the six-series
 * ceiling, direct value labels instead of a legend. A line chart for the time
 * dimensions would be a NEW pattern, and §30 is explicit that a new pattern is
 * agreed and written into AGENTS.md before it is built, not after. So: bars.
 *
 * Horizontal suits the data anyway. Every dimension here except the three time
 * ones is a name — a company, a person, a product category — and names collide
 * immediately under vertical bars.
 *
 * ---------------------------------------------------------------------------
 * TWO DIMENSIONS
 *
 * The engine returns one flat row per (dim1, dim2) pair. A chart of those pairs
 * as one category each is a bar chart of a hundred meaningless labels, so the
 * second dimension becomes the SERIES: one coloured bar per dim-2 value, beside
 * each dim-1 category. §21 caps that at six, and the kit THROWS on a seventh
 * rather than drawing a colour nobody chose — so the smallest are grouped into
 * "Other" here, which is what §21 asks for.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ NO TOTAL IS DRAWN. The table's total comes from the engine's own
 * accumulator and for a ratio measure it is not the sum of the rows; a chart
 * that stacked or summed bars would assert something the engine never said.
 * Bars are the row values and nothing else.
 */

/**
 * Categories drawn. The chart's height grows with the row count, so an
 * unbounded report becomes a mile of bars nobody scrolls. The table is the
 * complete answer (§34.2 — never paginate); the chart is the shape of the top
 * of it, and it says so on screen when it has trimmed.
 */
const MAX_CATEGORIES = 20

/** Series the caller may draw before the rest are grouped into "Other". */
const MAX_REAL_SERIES = MAX_SERIES - 1

type ChartRow = { category: string; values: number[] }

export function ReportChart({
  dimensions,
  measure,
  rows,
}: {
  dimensions: { key: string; label: string }[]
  measure: { key: string; label: string; format: ReportFormat }
  rows: ReportRow[]
}) {
  const { data, seriesLabels, trimmed } = React.useMemo(
    () => buildChart(rows, dimensions.length),
    [rows, dimensions.length]
  )

  if (data.length === 0) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The chart itself scrolls vertically inside its own box — the page
          body never grows to fit a hundred bars. */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <CategoryBarChart
          data={data}
          category={row => row.category}
          series={seriesLabels.map((label, position) => ({
            label,
            // The bar's LENGTH is a pixel measurement, so a number is right.
            value: (row: ChartRow) => row.values[position] ?? 0,
            // The digits a person reads are formatted from the same value the
            // table formats, through the same function — one formatter, so the
            // chart and the table can never disagree about a number.
            format: (row: ChartRow) =>
              formatValue(row.values[position] ?? 0, measure.format),
          }))}
        />
      </div>

      {trimmed > 0 && (
        <p className="shrink-0 border-t border-border-light px-4 py-2 text-meta text-text-muted">
          Showing the top {MAX_CATEGORIES} of {MAX_CATEGORIES + trimmed} rows.
          The table shows every row.
        </p>
      )}
    </div>
  )
}

/**
 * Flat report rows → chart rows.
 *
 * Exported for the same reason `resolvePreset` is: it is the part with the
 * arithmetic in it, and it is pure.
 */
export function buildChart(
  rows: ReportRow[],
  dimensionCount: number
): { data: ChartRow[]; seriesLabels: string[]; trimmed: number } {
  if (rows.length === 0) return { data: [], seriesLabels: [], trimmed: 0 }

  if (dimensionCount === 1) {
    const all = rows.map(r => ({ category: r.label[0] ?? '', values: [r.value] }))
    return {
      data: all.slice(0, MAX_CATEGORIES),
      seriesLabels: ['Value'],
      trimmed: Math.max(0, all.length - MAX_CATEGORIES),
    }
  }

  // ── Two dimensions ──────────────────────────────────────────────────────
  // Series are ranked by the total they carry across every category, so the
  // five that survive are the five that matter rather than the five that
  // happened to appear first.
  const seriesTotal = new Map<string, number>()
  for (const r of rows) {
    const s = r.label[1] ?? ''
    seriesTotal.set(s, (seriesTotal.get(s) ?? 0) + Math.abs(r.value))
  }
  const ranked = [...seriesTotal.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label)

  const kept = ranked.slice(0, MAX_REAL_SERIES)
  const hasOther = ranked.length > kept.length
  const seriesLabels = hasOther ? [...kept, 'Other'] : kept
  const indexOf = new Map(kept.map((label, i) => [label, i]))

  // Categories keep the engine's own order, which is already the sort the
  // dimension declares — value-descending for a name, chronological for time.
  const byCategory = new Map<string, ChartRow>()
  for (const r of rows) {
    const category = r.label[0] ?? ''
    let row = byCategory.get(category)
    if (!row) {
      row = { category, values: new Array(seriesLabels.length).fill(0) }
      byCategory.set(category, row)
    }
    const position = indexOf.get(r.label[1] ?? '') ?? (hasOther ? kept.length : -1)
    if (position >= 0) row.values[position] += r.value
  }

  const all = [...byCategory.values()]
  return {
    data: all.slice(0, MAX_CATEGORIES),
    seriesLabels,
    trimmed: Math.max(0, all.length - MAX_CATEGORIES),
  }
}
