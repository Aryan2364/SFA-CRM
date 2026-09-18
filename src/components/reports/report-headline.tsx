'use client'

import * as React from 'react'
import { RotateCwIcon } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { fmtAmount, fmtNumber } from '@/lib/format'
import type { MetaPresetSpec, ReportResult } from '@/components/reports/types'
import { cn } from '@/lib/utils'

/**
 * REBUILD-PLAN.md §7.5, P5-T5 — THE FOUR NUMBERS.
 *
 * Order Value · Number of Meetings · Deals Won · Expense, for the period the
 * person has selected, above everything else on the page.
 *
 * "If a client logs in, sees those four numbers and closes the app, he has
 * still got value that day."
 *
 * ---------------------------------------------------------------------------
 * THEY GO THROUGH THE ENGINE. ALL FOUR.
 *
 * Each is `POST /api/reports/run` with a spec that `GET /api/reports/meta`
 * handed over, and the number rendered is the run's `total`. There is no
 * headline endpoint and there must not be one, for two reasons:
 *
 *   1. §6.6 SCOPE. The engine applies `scopedUserIds()` from the source's own
 *      declared section. A second code path that summed the same tables would
 *      have to re-derive that, and a headline covering records the person
 *      cannot open is a leak in the one place on the page nobody would think
 *      to check.
 *   2. PERMISSIONS. `meta` already drops a spec whose section this person
 *      cannot view, so a Sales Executive with no Expenses grant simply gets
 *      three tiles — not a tile that 403s, and not a zero that reads as "no
 *      expenses this month".
 *
 * ⚠️ WHICH IS WHY THE LIST OF FOUR IS NOT WRITTEN HERE. It comes from
 * `meta.headline`, i.e. from `HEADLINE_SPECS` in the registry. A literal list
 * in this file would look identical on the day it was written and would keep
 * rendering a measure the registry had dropped.
 *
 * ⚠️ `total`, NEVER a sum of `rows[].value`. For a ratio measure those are not
 * the same number, and the engine's own total is the one that is right for
 * every measure kind.
 */

type Tile = {
  key: string
  label: string
  spec: MetaPresetSpec
}

type Loaded = {
  value: number
  format: ReportResult['measure']['format']
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; tiles: Record<string, Loaded | 'failed'> }

/** Matches the builder's own debounce, so dragging a date does not run eight reports. */
const DEBOUNCE_MS = 250

function render(loaded: Loaded): string {
  switch (loaded.format) {
    case 'amount':
      return fmtAmount(loaded.value)
    case 'percent':
      return `${fmtNumber(loaded.value)}%`
    case 'hours':
      return `${fmtNumber(loaded.value)} h`
    default:
      return fmtNumber(loaded.value)
  }
}

export function ReportHeadline({
  tiles,
  dateFrom,
  dateTo,
  rangeLabel,
}: {
  tiles: Tile[]
  dateFrom: string
  dateTo: string
  /** The range in the person's own words, e.g. "Last 30 days". */
  rangeLabel: string
}) {
  const [state, setState] = React.useState<State>({ status: 'loading' })
  /** Bumped to re-run after a failure. */
  const [attempt, setAttempt] = React.useState(0)

  // Serialised so the effect re-runs on a change of CONTENT, not on every
  // render that produced a new array with the same specs in it.
  const wire = JSON.stringify({ tiles, dateFrom, dateTo })

  React.useEffect(() => {
    if (tiles.length === 0) return
    let live = true
    setState(s => (s.status === 'ready' ? s : { status: 'loading' }))

    const timer = setTimeout(() => {
      const parsed = JSON.parse(wire) as { tiles: Tile[]; dateFrom: string; dateTo: string }

      // All four at once. They are four independent reads of four different
      // tables; running them in series would make the headline the slowest
      // thing on a page whose whole point is that it is the first thing read.
      Promise.all(
        parsed.tiles.map(async tile => {
          try {
            const res = await fetch('/api/reports/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...tile.spec,
                dateFrom: parsed.dateFrom,
                dateTo: parsed.dateTo,
              }),
            })
            if (!res.ok) return [tile.key, 'failed' as const] as const
            const body = (await res.json()) as ReportResult
            return [
              tile.key,
              { value: body.total, format: body.measure.format } satisfies Loaded,
            ] as const
          } catch {
            return [tile.key, 'failed' as const] as const
          }
        })
      ).then(entries => {
        if (!live) return
        setState({ status: 'ready', tiles: Object.fromEntries(entries) })
      })
    }, DEBOUNCE_MS)

    return () => {
      live = false
      clearTimeout(timer)
    }
    // `tiles` is inside `wire`; listing it too would re-run on identity alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wire, attempt])

  if (tiles.length === 0) return null

  const anyFailed =
    state.status === 'ready' && Object.values(state.tiles).some(t => t === 'failed')

  return (
    <section
      aria-label={`Totals for ${rangeLabel}`}
      className={cn(
        // Full width, four across from `sm` up and two across on a phone —
        // never a skinny centred column, and never four unreadable slivers.
        'mt-4 grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-xl border',
        'border-border-light bg-border-light sm:grid-cols-4'
      )}
    >
      {tiles.map(tile => {
        const loaded = state.status === 'ready' ? state.tiles[tile.key] : undefined
        return (
          <div key={tile.key} className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3">
            <span className="truncate text-meta text-text-secondary">{tile.label}</span>
            {loaded === undefined ? (
              <Skeleton className="h-7 w-24" />
            ) : loaded === 'failed' ? (
              // No dead end: the tile that failed says so and carries the way
              // out, rather than showing a dash that reads as a real zero.
              <button
                type="button"
                onClick={() => setAttempt(a => a + 1)}
                className="flex min-h-7 items-center gap-1.5 text-left text-label text-text-secondary underline-offset-2 hover:underline"
              >
                <RotateCwIcon aria-hidden="true" className="size-3.5 shrink-0" />
                Could not load — retry
              </button>
            ) : (
              <span
                // `tabular-nums` so the four values do not jitter sideways as
                // the range changes under them.
                className="truncate text-section font-medium tabular-nums text-text-primary"
                title={render(loaded)}
              >
                {render(loaded)}
              </span>
            )}
          </div>
        )
      })}
      {anyFailed && (
        <p className="col-span-full bg-surface px-4 pb-2 text-meta text-text-muted">
          Some totals could not be loaded. The reports below are unaffected.
        </p>
      )}
    </section>
  )
}
