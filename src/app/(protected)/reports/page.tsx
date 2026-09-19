'use client'

import * as React from 'react'
import {
  BarChart3Icon,
  ChevronDownIcon,
  PlusIcon,
  TableIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DateRangeControl,
  defaultRange,
  describeRange,
  isValidRange,
  resolvePreset,
  type DateRangeValue,
} from '@/components/reports/date-range-control'
import { ReportChart } from '@/components/reports/report-chart'
import { ReportHeadline } from '@/components/reports/report-headline'
import {
  matchPreset,
  ReportPresets,
  type PresetPick,
} from '@/components/reports/report-presets'
import { formatValue, ReportTable } from '@/components/reports/report-table'
import {
  SavedReports,
  type SavedReport,
  type SavedReportConfig,
} from '@/components/reports/saved-reports'
import { useToast } from '@/contexts/ToastContext'
import type {
  MetaMeasure,
  ReportMeta,
  ReportResult,
  ReportSpec,
} from '@/components/reports/types'
import { fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * REBUILD-PLAN.md §7.1 — THE report builder. P5-T2.
 *
 * Measure × one or two Dimensions × Date Range × Filters → a table, with a
 * toggle to a chart. One screen, not 41.
 *
 * ---------------------------------------------------------------------------
 * EVERYTHING COMES FROM `/api/reports/meta`. NOTHING IS HARDCODED.
 *
 * Not one measure, dimension, preset or band name is written in this file. The
 * registries in `src/lib/reports/` are the source of truth for what can be
 * built, and `meta` is that list already filtered by the caller's permissions
 * — so a Sales Executive with no Expenses grant is never offered an Expense
 * measure. A literal list here would look identical on the day it was written
 * and diverge silently from the registry on the day someone adds a measure.
 *
 * ⚠️ `meta` is a CONVENIENCE, not the enforcement. `/api/reports/run` checks
 * the same permissions and the same §6.6 scope itself. Nothing on this screen
 * is a security boundary.
 *
 * ⚠️ NO IMPORT FROM `@/lib/reports/**` OR `@/lib/db`. This is a `'use client'`
 * page; those modules reach Prisma and `pg`, and one import of them puts the
 * data layer in the browser bundle and breaks every route in the app with a
 * clean `tsc --noEmit`. The wire types live in `@/components/reports/types`,
 * which imports nothing.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE OF THE STATE IS THE SHAPE OF A SAVED REPORT
 *
 * `BuilderSpec` below is JSON-serialisable with no derived values in it: a
 * measure key, one or two dimension keys, a `{ preset, from, to }` range and a
 * flat filter map. The range keeps its PRESET rather than only its dates, so a
 * report saved as "Last 30 days" reopens in December meaning December's last
 * thirty days — the thing the person actually chose.
 *
 * P5-T3 stores exactly that, minus the dates a preset can re-derive:
 * `toSavedConfig()` / `fromSavedConfig()` below are the whole translation, and
 * a non-custom preset is re-resolved against TODAY every time it is opened.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO "RUN" BUTTON
 *
 * Every control on this page is a complete choice the moment it is made, so
 * the report runs on change (debounced). A Run button would be a second step
 * that adds nothing and, on a page whose controls are pinned above a scrolling
 * result, is exactly the button people forget to press and then read a stale
 * number from. The pinned controls are what the "never scroll up to re-run"
 * rule asks for; not needing to re-run at all is better.
 */

type FilterRow = { id: string; dimension: string; value: string }

type BuilderSpec = {
  measure: string
  dimensions: string[]
  range: DateRangeValue
  filters: FilterRow[]
}

type View = 'table' | 'chart'

/** Debounce before a run. Long enough to absorb a click-through of presets. */
const RUN_DEBOUNCE_MS = 250

/**
 * The floor for a result that has no rows — a message, a skeleton or an error.
 * Only those states need one: a table sizes itself. Without it an EmptyState
 * centred in an auto-height box is a strip, which is the very complaint F34
 * opens with.
 */
const EMPTY_MIN = 'min-h-[18rem]'

let filterSeq = 0
function nextFilterId(): string {
  filterSeq += 1
  return `f${filterSeq}`
}

/** `filters` on the wire is a flat map; the rows are only the editing shape. */
function filterMap(rows: FilterRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (row.dimension && row.value) out[row.dimension] = row.value
  }
  return out
}

function toSpec(spec: BuilderSpec): ReportSpec {
  return {
    measure: spec.measure,
    dimensions: spec.dimensions as [string] | [string, string],
    dateFrom: spec.range.from,
    dateTo: spec.range.to,
    filters: filterMap(spec.filters),
  }
}

/** `Record<value, label>`, which is what both pickers take. */
function optionsOf(items: { key: string; label: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of items) out[item.key] = item.label
  return out
}

// ── Saved reports (P5-T3) ─────────────────────────────────────────────────

/**
 * Builder state → the stored `config`.
 *
 * ⚠️ A NON-CUSTOM RANGE LOSES ITS DATES ON PURPOSE. Storing them beside the
 * preset would leave two sources of truth for the same range, and the stale
 * one is the one somebody eventually reads. `custom` is the only preset whose
 * dates ARE the choice.
 */
function toSavedConfig(spec: BuilderSpec): SavedReportConfig {
  return {
    measure: spec.measure,
    dimensions: [...spec.dimensions],
    range:
      spec.range.preset === 'custom'
        ? { preset: 'custom', from: spec.range.from, to: spec.range.to }
        : { preset: spec.range.preset },
    filters: filterMap(spec.filters),
  }
}

/** The stored `config` → builder state, with the preset re-resolved to TODAY. */
function fromSavedConfig(config: SavedReportConfig): BuilderSpec {
  const range: DateRangeValue =
    config.range.preset === 'custom'
      ? { preset: 'custom', from: config.range.from, to: config.range.to }
      : { preset: config.range.preset, ...resolvePreset(config.range.preset, new Date()) }

  return {
    measure: config.measure,
    dimensions: [...config.dimensions],
    range,
    filters: Object.entries(config.filters ?? {}).map(([dimension, value]) => ({
      id: nextFilterId(),
      dimension,
      value,
    })),
  }
}

export default function ReportsPage() {
  const { toast } = useToast()
  const [meta, setMeta] = React.useState<ReportMeta | null>(null)
  const [metaError, setMetaError] = React.useState<string | null>(null)
  const [spec, setSpec] = React.useState<BuilderSpec | null>(null)
  const [view, setView] = React.useState<View>('table')
  const [controlsOpen, setControlsOpen] = React.useState(true)

  const [result, setResult] = React.useState<ReportResult | null>(null)
  const [running, setRunning] = React.useState(false)
  const [runError, setRunError] = React.useState<string | null>(null)
  /** Bumped to re-run the same spec after a failure. */
  const [attempt, setAttempt] = React.useState(0)

  /** The saved report currently open, if the combination came from one. */
  const [activeSaved, setActiveSaved] = React.useState<SavedReport | null>(null)

  // ── Meta ────────────────────────────────────────────────────────────────
  const loadMeta = React.useCallback(() => {
    setMetaError(null)
    fetch('/api/reports/meta')
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error ?? 'Could not load the report options.')
        }
        return (await res.json()) as ReportMeta
      })
      .then(data => {
        setMeta(data)
        const first = data.measures[0]
        if (first && first.dimensions[0]) {
          setSpec({
            measure: first.key,
            dimensions: [first.dimensions[0].key],
            range: defaultRange(),
            filters: [],
          })
        }
      })
      .catch((err: Error) => setMetaError(err.message))
  }, [])

  React.useEffect(loadMeta, [loadMeta])

  const measure: MetaMeasure | null = React.useMemo(() => {
    if (!meta || !spec) return null
    return meta.measures.find(m => m.key === spec.measure) ?? null
  }, [meta, spec])

  // ── Run ─────────────────────────────────────────────────────────────────
  // The spec is serialised into the dependency so the effect re-runs on a
  // CHANGE OF CONTENT rather than on every re-render that produced a new
  // object with the same values.
  const wireSpec = spec ? JSON.stringify(toSpec(spec)) : null
  const rangeValid = spec ? isValidRange(spec.range) : false

  React.useEffect(() => {
    if (!wireSpec || !rangeValid) return
    let live = true
    setRunning(true)
    const timer = setTimeout(() => {
      fetch('/api/reports/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: wireSpec,
      })
        .then(async res => {
          const body = await res.json().catch(() => null)
          if (!res.ok) throw new Error(body?.error ?? 'The report could not be run.')
          return body as ReportResult
        })
        .then(data => {
          if (!live) return
          setResult(data)
          setRunError(null)
        })
        .catch((err: Error) => {
          if (!live) return
          // The previous result is dropped rather than left on screen under a
          // new error — a stale table beside a message about a failed run is
          // the one state where a person reads a wrong number confidently.
          setResult(null)
          setRunError(err.message)
        })
        .finally(() => {
          if (live) setRunning(false)
        })
    }, RUN_DEBOUNCE_MS)

    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [wireSpec, rangeValid, attempt])

  // ── Editing the spec ────────────────────────────────────────────────────

  /**
   * Changing the measure can change the SOURCE, and a dimension belongs to a
   * source. Keeping "Product Category" selected while switching from Orders to
   * Expenses would post a spec the engine rejects with a 400, so anything the
   * new measure cannot slice by is dropped here, and the first dimension it
   * can is put in place of an empty selection.
   */
  function changeMeasure(key: string) {
    if (!meta || !spec) return
    const next = meta.measures.find(m => m.key === key)
    if (!next) return
    const allowed = new Set(next.dimensions.map(d => d.key))
    const kept = spec.dimensions.filter(d => allowed.has(d))
    const dimensions = kept.length > 0 ? kept : [next.dimensions[0]?.key].filter(Boolean) as string[]
    setSpec({
      ...spec,
      measure: key,
      dimensions,
      filters: spec.filters.filter(f => allowed.has(f.dimension)),
    })
  }

  function changeDimension(index: number, key: string) {
    if (!spec) return
    const dimensions = [...spec.dimensions]
    if (key === '') {
      // Only the second may be cleared; one dimension is the minimum the
      // engine accepts.
      if (index === 0) return
      dimensions.splice(index, 1)
    } else {
      // The two must differ. Picking the one already in the other slot swaps
      // them rather than refusing the click.
      const other = dimensions[index === 0 ? 1 : 0]
      if (other === key) dimensions[index === 0 ? 1 : 0] = dimensions[index]
      dimensions[index] = key
    }
    setSpec({ ...spec, dimensions })
  }

  const dimensionOptions = measure ? optionsOf(measure.dimensions) : {}

  // ── The ten ready-made reports (P5-T4) ──────────────────────────────────

  /**
   * Which preset the builder is showing, DERIVED from the spec rather than
   * remembered. Change a dimension after opening "Pipeline Summary" and the
   * name drops off by itself; there is no flag left claiming the report on
   * screen is still that one.
   */
  const activePreset = React.useMemo(
    () =>
      meta && spec
        ? matchPreset(meta.presets, {
            measure: spec.measure,
            dimensions: spec.dimensions,
            filters: filterMap(spec.filters),
          })
        : null,
    [meta, spec]
  )

  /**
   * A preset fills the builder; it does not replace it. Only the three things
   * a preset actually declares are written — measure, dimensions, filters —
   * so the date range the person has chosen SURVIVES the click. A preset has
   * no opinion about the period, and overwriting a carefully set range with a
   * default is the fastest way to make a ready-made report feel like a trap.
   */
  function openPreset(pick: PresetPick) {
    if (!spec) return
    setSpec({
      ...spec,
      measure: pick.spec.measure,
      dimensions: [...pick.spec.dimensions],
      filters: Object.entries(pick.spec.filters ?? {}).map(([dimension, value]) => ({
        id: nextFilterId(),
        dimension,
        value,
      })),
    })
    // The combination on screen is now the preset's, not the saved report's.
    setActiveSaved(null)
  }

  // ── Saved reports (P5-T3) ───────────────────────────────────────────────

  const currentConfig = spec ? toSavedConfig(spec) : null

  /**
   * A saved config can name a measure or a dimension that has since left the
   * registry — or that this person's permissions no longer reach, since `meta`
   * is already filtered by `checkPermission`. Answering here rather than in the
   * saved-reports component is what keeps that component free of any knowledge
   * of the registries.
   */
  const unavailableReason = React.useCallback(
    (config: SavedReportConfig): string | null => {
      if (!meta) return null
      const m = meta.measures.find(x => x.key === config.measure)
      if (!m) return 'This measure is no longer available to you.'
      const allowed = new Set(m.dimensions.map(d => d.key))
      if (!config.dimensions[0] || !allowed.has(config.dimensions[0])) {
        return 'The field it breaks down by is no longer available to you.'
      }
      return null
    },
    [meta]
  )

  const describeConfig = React.useCallback(
    (config: SavedReportConfig): string => {
      const m = meta?.measures.find(x => x.key === config.measure)
      const labels = config.dimensions.map(
        d => m?.dimensions.find(x => x.key === d)?.label ?? d
      )
      const range: DateRangeValue =
        config.range.preset === 'custom'
          ? { preset: 'custom', from: config.range.from, to: config.range.to }
          : { preset: config.range.preset, ...resolvePreset(config.range.preset, new Date()) }
      return `${m?.label ?? config.measure} by ${labels.join(' and ')} · ${describeRange(range)}`
    },
    [meta]
  )

  /**
   * Open a saved report.
   *
   * Anything the measure can no longer be sliced by is dropped rather than
   * posted to the engine for a 400: a second dimension that has gone, and any
   * filter on a dimension that has gone. The person is told what was dropped —
   * a report that quietly returns different numbers than it did when it was
   * saved is the failure worth spending a toast on.
   */
  function openSaved(report: SavedReport) {
    if (!meta) return
    const m = meta.measures.find(x => x.key === report.config.measure)
    if (!m) return
    const allowed = new Set(m.dimensions.map(d => d.key))

    const next = fromSavedConfig(report.config)
    const dimensions = next.dimensions.filter(d => allowed.has(d))
    const filters = next.filters.filter(f => allowed.has(f.dimension))
    const dropped =
      dimensions.length !== next.dimensions.length || filters.length !== next.filters.length

    setSpec({ ...next, dimensions, filters })
    setActiveSaved(report)
    if (dropped) {
      toast(
        `Part of “${report.name}” is no longer available and was left out.`,
        'warning'
      )
    }
  }

  /** True once the person has changed anything since the saved report opened. */
  const savedEdited =
    activeSaved !== null &&
    currentConfig !== null &&
    JSON.stringify(currentConfig) !== JSON.stringify(activeSaved.config)

  /**
   * §34.1's total, formatted the same way the table's own column is — through
   * `formatValue`, so the header and the table can never disagree. `null`
   * whenever there is no answer to state: an invalid range, a failed run, or
   * a first load that has not returned. A zero total IS an answer and shows.
   */
  const totalLabel =
    rangeValid && !runError && result !== null
      ? formatValue(result.total, result.measure.format)
      : null

  const savedControls = (
    <SavedReports
      currentConfig={currentConfig}
      activeId={activeSaved?.id ?? null}
      activeName={
        activeSaved ? (savedEdited ? `${activeSaved.name} (edited)` : activeSaved.name) : null
      }
      edited={savedEdited}
      onOpen={openSaved}
      onActiveChange={setActiveSaved}
      unavailableReason={unavailableReason}
      describeConfig={describeConfig}
    />
  )

  // ── Render ──────────────────────────────────────────────────────────────

  if (metaError) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader />
        <div className="mt-4 flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border-light bg-surface">
          <EmptyState
            variant="failed"
            heading="Reports could not be loaded"
            onAction={loadMeta}
          >
            {metaError}
          </EmptyState>
        </div>
      </div>
    )
  }

  if (!meta || !spec) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  if (meta.measures.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader />
        <div className="mt-4 flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border-light bg-surface">
          <EmptyState
            variant="nothing-yet"
            heading="No report data available to you"
            actionLabel="Back to dashboard"
            onAction={() => {
              window.location.href = '/'
            }}
          >
            Reports are built from the sections you can view, and you do not
            currently have view access to any of them. An administrator can
            grant it in Settings, Access Control.
          </EmptyState>
        </div>
      </div>
    )
  }

  return (
    // F34 — ONE REGION, ONE SCROLL, AND THE REGION IS THE PAGE.
    //
    // This page used to be a fixed frame (`h-full min-h-0`) holding two
    // independently-sized boxes: a controls panel capped at 45vh with its own
    // scrollbar, and a result box that was the only thing allowed to scroll.
    // Every row of chrome added since — the four headline tiles, Ready-made,
    // Saved — came out of the same fixed vertical budget, so each addition
    // squeezed the result towards its `basis-40` floor. It broke twice in two
    // days for that one reason. The frame is gone: everything below is in
    // normal flow and the shell's own content scroller is the only scroller.
    //
    // §34.1 (the total must stay visible while the result is read) survives
    // WITHOUT the frame, because it never actually required a nested
    // scroller — only a sticky box. The total now rides the section's sticky
    // header instead of the table's `tfoot`; a sticky footer needs a box that
    // clips it, a sticky header does not. See the header below.
    <div className="flex flex-col">
      <PageHeader
        action={
          // Save/open sit on the header bar beside the view toggle — the one
          // row that is pinned and never scrolls away — because they act on
          // the whole report, not on any one control inside the panel. They
          // are also reachable with the panel collapsed, which is the state a
          // phone spends most of its time in.
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* The ready-made ten sit beside Saved, on the same pinned row and
                in the same shape as their peer: a labelled button that opens a
                list. They are both "open a report someone already set up". */}
            <ReportPresets
              presets={meta.presets}
              active={activePreset}
              onPick={openPreset}
            />
            {savedControls}
            <div className="flex items-center gap-1 rounded-lg border border-border-light bg-surface p-1">
              <ViewToggle view={view} setView={setView} target="table" icon={TableIcon} label="Table" />
              <ViewToggle view={view} setView={setView} target="chart" icon={BarChart3Icon} label="Chart" />
            </div>
          </div>
        }
      />

      {/* ── §7.5 — THE FOUR NUMBERS ──────────────────────────────────────
          Above everything, full width, for the range selected below. They
          are four runs of the same engine, so they carry the same §6.6 scope
          as everything else on the page. `shrink-0`: they are the last thing
          on this page that should give up height. */}
      <ReportHeadline
        tiles={meta.headline}
        dateFrom={spec.range.from}
        dateTo={spec.range.to}
        rangeLabel={describeRange(spec.range)}
      />

      {/* ── ONE SECTION: SETUP AND RESULT ────────────────────────────────
          Aryan, F34: "why do we have two section like setup rather than
          having one big section having both in it". One card. Its sticky
          header names the report and carries the total; the setup folds out
          of that header; the result sits under it in normal flow. */}
      <section className="mt-4 flex flex-col rounded-xl border border-border-light bg-surface">
        {/*
          THE STICKY HEADER, AND WHERE §34.1's TOTAL NOW LIVES.

          The total used to be a sticky `tfoot`, and a sticky footer only
          sticks inside a box that clips it — which is the whole reason this
          page carried a fixed frame, a 45vh cap and a nested scroller. A
          sticky HEADER needs none of that: `top-0` here resolves against the
          shell's content scroller (`h-full overflow-y-auto` in app-shell),
          so this row stays on screen for the entire length of the table, at
          every window height, with the page scrolling normally underneath.

          The title and the total are on one row because they are one
          sentence: what was asked, and what it came to.
        */}
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-t-xl border-b border-border-light bg-surface px-4 py-2">
          <button
            type="button"
            aria-expanded={controlsOpen}
            onClick={() => setControlsOpen(o => !o)}
            // The chevron sits against the title rather than at the far end
            // of the row: it opens the setup for THIS report, and stranding
            // it beside the total made it read as the total's control.
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left sm:min-h-8"
          >
            <span className="min-w-0 truncate text-label text-text-secondary">
              {measure?.label ?? '—'}
              {' by '}
              {spec.dimensions
                .map(d => dimensionOptions[d] ?? d)
                .join(' and ')}
              {' · '}
              {describeRange(spec.range)}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0 text-text-secondary transition-transform duration-200',
                controlsOpen && 'rotate-180'
              )}
            />
          </button>

          {/* Said once. The table's own `tfoot` total is no longer sticky —
              two totals on screen at once would be the same number twice. */}
          {totalLabel !== null && (
            <p className="flex shrink-0 items-baseline gap-2 text-label text-text-secondary">
              Total
              <span className="text-body font-medium tabular-nums text-text-primary">
                {totalLabel}
              </span>
            </p>
          )}
        </div>

        {/* Collapsible setup. Animated rather than snapped: 200ms on the grid
            rows, which is the one property that can animate a height that is
            not known. No height cap and no scroller of its own — with the
            page scrolling normally there is nothing to protect it from. */}
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-200 ease-out',
            controlsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-border-light p-4">
              {/* Measure and the one or two dimensions, side by side on a
                  desktop and stacked on a phone. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Measure" htmlFor="report-measure">
                  <SearchableSelect
                    id="report-measure"
                    options={optionsOf(meta.measures)}
                    value={spec.measure}
                    onValueChange={changeMeasure}
                    placeholder="Choose a measure"
                  />
                </Field>

                <Field label="Dimension" htmlFor="report-dim-1">
                  <SearchableSelect
                    id="report-dim-1"
                    options={dimensionOptions}
                    value={spec.dimensions[0]}
                    onValueChange={key => changeDimension(0, key)}
                    placeholder="Choose a dimension"
                  />
                </Field>

                <Field
                  label="Second dimension"
                  htmlFor="report-dim-2"
                  hint="Optional"
                >
                  {spec.dimensions[1] ? (
                    <div className="flex items-center gap-2">
                      <SearchableSelect
                        id="report-dim-2"
                        className="min-w-0 flex-1"
                        options={dimensionOptions}
                        value={spec.dimensions[1]}
                        onValueChange={key => changeDimension(1, key)}
                      />
                      <Button
                        variant="secondary"
                        size="icon"
                        className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
                        aria-label="Remove the second dimension"
                        onClick={() => changeDimension(1, '')}
                      >
                        <XIcon aria-hidden="true" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      className="min-h-11 w-full justify-start sm:min-h-0 sm:w-auto"
                      onClick={() => {
                        const free = measure?.dimensions.find(
                          d => d.key !== spec.dimensions[0]
                        )
                        if (free) setSpec({ ...spec, dimensions: [spec.dimensions[0], free.key] })
                      }}
                    >
                      <PlusIcon aria-hidden="true" />
                      Add a second dimension
                    </Button>
                  )}
                </Field>
              </div>

              {/* §27.4. Its own row: nine chips and a readable range do not
                  fit a third of a grid. */}
              <Field label="Date range">
                <DateRangeControl
                  value={spec.range}
                  onChange={range => setSpec({ ...spec, range })}
                />
              </Field>

              <Filters
                spec={spec}
                setSpec={setSpec}
                measure={measure}
                dimensionOptions={dimensionOptions}
              />

              {/* The ready-made reports USED to be a row of chips here. They
                  are now the "Ready-made" button on the pinned header row —
                  said once, in the place where the other "open something
                  already set up" action lives, and reachable with this panel
                  collapsed, which is the state a phone spends its life in. */}
            </div>
          </div>
        </div>

      {/* ── RESULT ───────────────────────────────────────────────────────
          In normal flow, inside the same card. It is as tall as its rows and
          the page scrolls — it can no longer be squeezed, because nothing is
          competing with it for a fixed budget. `EMPTY_MIN` is a floor for the
          states that have no rows to give them one, so a message is never a
          strip. The table keeps its own HORIZONTAL scroller: §34.3's frozen
          first column is a legitimately nested scroller and stays. */}
      <div className="flex flex-col rounded-b-xl">
        {!rangeValid ? (
          <div className={`flex ${EMPTY_MIN} items-center justify-center`}>
            <EmptyState
              variant="failed"
              heading="That date range runs backwards"
              actionLabel="Use the last 30 days"
              onAction={() => setSpec({ ...spec, range: defaultRange() })}
            >
              The start date is after the end date, so there is nothing to
              report on. Change either date, or go back to the last 30 days.
            </EmptyState>
          </div>
        ) : runError ? (
          <div className={`flex ${EMPTY_MIN} items-center justify-center`}>
            <EmptyState
              variant="failed"
              heading="The report could not be run"
              onAction={() => setAttempt(a => a + 1)}
            >
              {runError}
            </EmptyState>
          </div>
        ) : running && !result ? (
          <div className={`${EMPTY_MIN} space-y-3 p-4`}>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-5/6" />
            <Skeleton className="h-8 w-4/6" />
          </div>
        ) : result && result.rows.length === 0 ? (
          <div className={`flex ${EMPTY_MIN} items-center justify-center`}>
            <EmptyState
              variant="nothing-found"
              heading="No records in this range"
              actionLabel="Widen to the last 30 days"
              onAction={() => setSpec({ ...spec, range: defaultRange(), filters: [] })}
            >
              {measure?.label} has nothing between {describeRange(spec.range)}
              {spec.filters.length > 0 ? ' with these filters' : ''}. Widen the
              date range or remove a filter.
            </EmptyState>
          </div>
        ) : result ? (
          <div
            className={cn(
              'flex flex-col transition-opacity duration-200',
              // A re-run dims the previous answer rather than replacing it
              // with a spinner. The numbers stay readable and the rows are
              // never destroyed and recreated.
              running && 'opacity-60'
            )}
          >
            {view === 'table' ? (
              <ReportTable
                dimensions={result.dimensions}
                measure={result.measure}
                rows={result.rows}
                total={result.total}
                truncated={result.truncated}
                scopeLabel={scopeLabel(result)}
              />
            ) : (
              <>
                <ReportChart
                  dimensions={result.dimensions}
                  measure={result.measure}
                  rows={result.rows}
                />
                <p className="shrink-0 border-t border-border-light px-4 py-2 text-meta text-text-muted">
                  {scopeLabel(result)}
                </p>
              </>
            )}
          </div>
        ) : null}
        </div>
      </section>
    </div>
  )
}

/**
 * §34.4's scope caption: what the figures cover. Stated as facts the engine
 * returned — the range it actually used and how many records it read — rather
 * than as a claim about the viewer's role, which this page does not know and
 * must not guess.
 */
function scopeLabel(result: ReportResult): string {
  return `${fmtNumber(result.rows.length)} rows from ${fmtNumber(result.scanned)} records you can see, ${result.dateFrom} to ${result.dateTo}.`
}

function PageHeader({ action }: { action?: React.ReactNode }) {
  return (
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-page-title font-medium text-text-primary">Reports</h1>
        {/* F33. The one line on this page that is explanation rather than
            data or control, so it is the first thing to go when the frame is
            short. At 390 it wrapped to three lines and cost the header 60px
            of the 744 the page has — height the controls panel needed more
            than the sentence did. Nothing actionable is hidden with it. */}
        <p className="mt-1 hidden text-meta text-text-muted sm:block">
          Pick what to measure, what to break it down by, and over what period.
        </p>
      </div>
      {/* `max-w-full`, NOT `shrink-0`. A `shrink-0` box takes its max-content
          width, so the `flex-wrap` row of buttons inside it never reaches a
          width it has to wrap at — on a phone the last actions simply ran off
          the right edge, unreachable. Capping the box at the header's width is
          what lets that wrap actually happen. */}
      {action && <div className="min-w-0 max-w-full">{action}</div>}
    </header>
  )
}

function ViewToggle({
  view,
  setView,
  target,
  icon: Icon,
  label,
}: {
  view: View
  setView: (v: View) => void
  target: View
  icon: LucideIcon
  label: string
}) {
  const active = view === target
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setView(target)}
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-md px-3 text-label transition-colors sm:min-h-8',
        active
          ? 'bg-primary-subtle font-medium text-primary-pressed'
          : 'text-text-secondary hover:bg-surface-sunken'
      )}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </button>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="text-label text-text-secondary" htmlFor={htmlFor}>
        {label}
        {hint && <span className="ml-1 text-text-muted">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

/**
 * FILTERS.
 *
 * A filter is a dimension plus one of its values, which is exactly what the
 * engine takes: `filters: { <dimension key>: <group key> }`, matched against
 * the same `extract()` that builds the group keys.
 *
 * ⚠️ THE VALUE LIST IS NOT FETCHED FROM A MASTER ENDPOINT. The members of a
 * dimension are whatever `extract()` produces — a band key, a "No category"
 * bucket, a user id — and no master table holds that list. Reading
 * `/api/masters/*` for it would be a second, divergent source of truth for
 * what a dimension's members are, which is the thing the registry exists to
 * prevent. So the values are discovered by RUNNING THE SAME REPORT grouped by
 * that dimension: the engine's own group keys and labels, in the same date
 * range, already scoped to what this user can see.
 *
 * The cost is one extra run per filter dimension opened, and the benefit is
 * that a filter can never offer a value the report cannot produce.
 */
function Filters({
  spec,
  setSpec,
  measure,
  dimensionOptions,
}: {
  spec: BuilderSpec
  setSpec: (next: BuilderSpec) => void
  measure: MetaMeasure | null
  dimensionOptions: Record<string, string>
}) {
  const [values, setValues] = React.useState<Record<string, Record<string, string>>>({})
  const [loading, setLoading] = React.useState<Record<string, boolean>>({})

  // Values belong to a (measure, dimension, range) triple. When any of them
  // changes the cached lists are stale, so they are dropped rather than shown
  // as options a re-run would not produce.
  const cacheKey = `${spec.measure}|${spec.range.from}|${spec.range.to}`
  const lastKey = React.useRef(cacheKey)
  if (lastKey.current !== cacheKey) {
    lastKey.current = cacheKey
    if (Object.keys(values).length > 0) setValues({})
  }

  const loadValues = React.useCallback(
    (dimension: string) => {
      if (!dimension || values[dimension] || loading[dimension]) return
      setLoading(l => ({ ...l, [dimension]: true }))
      fetch('/api/reports/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          measure: spec.measure,
          dimensions: [dimension],
          dateFrom: spec.range.from,
          dateTo: spec.range.to,
        }),
      })
        .then(async res => {
          if (!res.ok) throw new Error('failed')
          return (await res.json()) as ReportResult
        })
        .then(data => {
          const out: Record<string, string> = {}
          for (const row of data.rows) out[row.key[0]] = row.label[0]
          setValues(v => ({ ...v, [dimension]: out }))
        })
        .catch(() => {
          // An empty list is a dead end, so the picker says so and the row can
          // still be removed. No toast: the filter row is where the problem is.
          setValues(v => ({ ...v, [dimension]: {} }))
        })
        .finally(() => setLoading(l => ({ ...l, [dimension]: false })))
    },
    [spec.measure, spec.range.from, spec.range.to, values, loading]
  )

  // A preset arrives with its filters already chosen, and their value lists
  // have never been fetched — so the picker would show a chosen filter with no
  // label. Fetched here rather than only on a change of the field.
  const filterDims = spec.filters.map(f => f.dimension).filter(Boolean).join(',')
  React.useEffect(() => {
    for (const dimension of filterDims.split(',').filter(Boolean)) loadValues(dimension)
  }, [filterDims, loadValues])

  const used = new Set(spec.filters.map(f => f.dimension))

  return (
    <Field label="Filters" hint="Optional">
      <div className="flex flex-col gap-2">
        {spec.filters.map(row => {
          const options = values[row.dimension]
          return (
            <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchableSelect
                className="min-w-0 sm:w-64"
                options={Object.fromEntries(
                  Object.entries(dimensionOptions).filter(
                    ([key]) => key === row.dimension || !used.has(key)
                  )
                )}
                value={row.dimension}
                placeholder="Choose a field"
                onValueChange={dimension => {
                  setSpec({
                    ...spec,
                    filters: spec.filters.map(f =>
                      f.id === row.id ? { ...f, dimension, value: '' } : f
                    ),
                  })
                  loadValues(dimension)
                }}
              />
              <SearchableSelect
                className="min-w-0 flex-1"
                options={options ?? {}}
                value={row.value}
                disabled={!row.dimension}
                placeholder={
                  !row.dimension
                    ? 'Choose a field first'
                    : loading[row.dimension]
                      ? 'Loading values'
                      : 'Any value'
                }
                emptyMessage={
                  options && Object.keys(options).length === 0
                    ? 'No values in this date range. Widen the range, or remove this filter.'
                    : 'Nothing matches that search.'
                }
                onValueChange={value =>
                  setSpec({
                    ...spec,
                    filters: spec.filters.map(f =>
                      f.id === row.id ? { ...f, value } : f
                    ),
                  })
                }
              />
              <Button
                variant="secondary"
                size="icon"
                className="min-h-11 min-w-11 shrink-0 sm:min-h-0 sm:min-w-0"
                aria-label={`Remove the ${dimensionOptions[row.dimension] ?? ''} filter`}
                onClick={() =>
                  setSpec({ ...spec, filters: spec.filters.filter(f => f.id !== row.id) })
                }
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          )
        })}

        {measure && spec.filters.length < measure.dimensions.length && (
          <Button
            variant="secondary"
            className="min-h-11 w-full justify-start sm:min-h-0 sm:w-auto"
            onClick={() =>
              setSpec({
                ...spec,
                filters: [...spec.filters, { id: nextFilterId(), dimension: '', value: '' }],
              })
            }
          >
            <PlusIcon aria-hidden="true" />
            Add a filter
          </Button>
        )}
      </div>
    </Field>
  )
}
