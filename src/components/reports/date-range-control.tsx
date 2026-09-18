'use client'

import * as React from 'react'

import { DatePicker } from '@/components/ui/date-picker'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'

/**
 * AGENTS.md §27.4 — the date-range preset control.
 *
 * APP-LOCAL, not a kit component. rgb-kit ships `date-picker.tsx` and the
 * two-month calendar of §20.1, but no preset control; §27.4 specifies the
 * pattern and nothing implements it. See `proposal-report-table-2026-09-18.md`
 * for why that is a build task rather than a §30 gate: §30 reads "Nothing
 * outstanding", so there is no pattern here left to agree.
 *
 * §27.4, in full, and what each line costs:
 *
 *   - "The same preset list on every screen": Today · Yesterday · Last 7 days ·
 *     Last 30 days · This month · Last month · Last 3 months · This financial
 *     year · Custom range. All nine, in that order. None added, none dropped —
 *     "the same list on every screen" is the whole rule.
 *   - "The active preset is highlighted with `primary-subtle` and a `primary`
 *     border."
 *   - "Custom range opens the two-month calendar from section 20.1" — which is
 *     what `DatePicker` opens.
 *   - "The chosen range always displays as readable text … Never only as
 *     'Custom'." So the readable line renders for EVERY preset, not only the
 *     custom one.
 *   - "Financial year means April to March."
 */

export type DateRangePresetKey =
  | 'today'
  | 'yesterday'
  | 'last_7'
  | 'last_30'
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'this_fy'
  | 'custom'

export type DateRangeValue = {
  /**
   * Kept alongside the dates rather than derived from them, because the preset
   * is the thing a saved report (P5-T3) should store. A report saved with
   * "Last 30 days" and reopened in December means the last thirty days in
   * December — not the thirty days that happened to be current when it was
   * saved. Only `custom` means the literal dates.
   */
  preset: DateRangePresetKey
  /** YYYY-MM-DD, inclusive. */
  from: string
  /** YYYY-MM-DD, inclusive. */
  to: string
}

const PRESETS: { key: Exclude<DateRangePresetKey, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last_7', label: 'Last 7 days' },
  { key: 'last_30', label: 'Last 30 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_3_months', label: 'Last 3 months' },
  { key: 'this_fy', label: 'This financial year' },
]

/**
 * ⚠️ NEVER `toISOString()`.
 *
 * `new Date(2026, 8, 18).toISOString()` is `2026-09-17T18:30:00Z` in IST, whose
 * date part is the PREVIOUS DAY. Every boundary this control produces would be
 * off by one for every user east of Greenwich, and the report would silently
 * drop or gain a day. Built from local calendar parts instead.
 */
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Parse a YYYY-MM-DD back to a LOCAL midnight Date, for the same reason. */
export function parseYmd(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/**
 * Resolve a preset to an inclusive YYYY-MM-DD pair.
 *
 * Pure, and `today` is an argument rather than `new Date()` read inside, so the
 * financial-year boundary and the month-end cases are testable without mocking
 * the clock. Exported for that reason and for P5-T3, which has to resolve a
 * stored preset at open time.
 */
export function resolvePreset(
  key: Exclude<DateRangePresetKey, 'custom'>,
  today: Date
): { from: string; to: string } {
  const y = today.getFullYear()
  const m = today.getMonth()

  switch (key) {
    case 'today':
      return { from: ymd(today), to: ymd(today) }
    case 'yesterday': {
      const d = addDays(today, -1)
      return { from: ymd(d), to: ymd(d) }
    }
    // "Last 7 days" includes today, so it is today minus six. Six, not seven:
    // an inclusive range of seven days spans six boundaries.
    case 'last_7':
      return { from: ymd(addDays(today, -6)), to: ymd(today) }
    case 'last_30':
      return { from: ymd(addDays(today, -29)), to: ymd(today) }
    case 'this_month':
      // Day 0 of the NEXT month is the last day of this one, which is how the
      // 28th, 30th and 31st are all handled without a table of month lengths.
      return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) }
    case 'last_month':
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) }
    // The three calendar months ENDING with this one, so in September it is
    // July, August and September — not a rolling ninety days.
    case 'last_3_months':
      return { from: ymd(new Date(y, m - 2, 1)), to: ymd(new Date(y, m + 1, 0)) }
    case 'this_fy': {
      // §27.4: April to March. Before April, the financial year began in the
      // PREVIOUS calendar year — in January 2027 it is still 2026-04-01.
      const start = m >= 3 ? y : y - 1
      return { from: ymd(new Date(start, 3, 1)), to: ymd(new Date(start + 1, 2, 31)) }
    }
  }
}

export function defaultRange(today: Date = new Date()): DateRangeValue {
  return { preset: 'last_30', ...resolvePreset('last_30', today) }
}

/** §27.4: "1 Aug 2026 to 29 Aug 2026". `fmtDate` is §18's `dd MMM yyyy`. */
export function describeRange(value: DateRangeValue): string {
  if (value.from === value.to) return fmtDate(value.from)
  return `${fmtDate(value.from)} to ${fmtDate(value.to)}`
}

export function DateRangeControl({
  value,
  onChange,
  className,
}: {
  value: DateRangeValue
  onChange: (next: DateRangeValue) => void
  className?: string
}) {
  const invalid = value.from > value.to

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map(p => {
          const active = value.preset === p.key
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ preset: p.key, ...resolvePreset(p.key, new Date()) })}
              className={cn(
                // 44px touch target on mobile, tighter on desktop where a
                // pointer is precise and nine chips have to fit a toolbar.
                'min-h-11 rounded-lg border px-3 text-label transition-colors sm:min-h-8',
                active
                  ? // §27.4: primary-subtle fill, primary border.
                    'border-primary bg-primary-subtle font-medium text-primary-pressed'
                  : 'border-border-light bg-surface text-text-secondary hover:bg-surface-sunken'
              )}
            >
              {p.label}
            </button>
          )
        })}
        <button
          type="button"
          aria-pressed={value.preset === 'custom'}
          onClick={() => onChange({ ...value, preset: 'custom' })}
          className={cn(
            'min-h-11 rounded-lg border px-3 text-label transition-colors sm:min-h-8',
            value.preset === 'custom'
              ? 'border-primary bg-primary-subtle font-medium text-primary-pressed'
              : 'border-border-light bg-surface text-text-secondary hover:bg-surface-sunken'
          )}
        >
          Custom range
        </button>
      </div>

      {/* §20.1's two-month calendar, which is what DatePicker opens. Shown only
          for Custom — the eight presets have already decided their dates, and a
          pair of pickers under them would invite an edit that contradicts the
          highlighted chip. */}
      {value.preset === 'custom' ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <label className="text-label text-text-secondary" htmlFor="range-from">
              From
            </label>
            <DatePicker
              id="range-from"
              invalid={invalid}
              value={parseYmd(value.from)}
              onValueChange={d => d && onChange({ ...value, preset: 'custom', from: ymd(d) })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-label text-text-secondary" htmlFor="range-to">
              To
            </label>
            <DatePicker
              id="range-to"
              value={parseYmd(value.to)}
              onValueChange={d => d && onChange({ ...value, preset: 'custom', to: ymd(d) })}
            />
          </div>
          {invalid ? (
            // Caught here rather than left to the engine's 400, so the message
            // sits beside the field that is wrong. No dead end: both pickers
            // stay open and either date fixes it.
            <p className="text-label text-danger sm:pb-2.5">
              The start date is after the end date.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* §27.4: "The chosen range always displays as readable text … Never only
          as 'Custom'." Always, not only in the custom case — a chip reading
          "This financial year" does not tell you which year. */}
      <p className="text-meta text-text-secondary">{describeRange(value)}</p>
    </div>
  )
}

/**
 * The two pickers write `from` and `to` independently and a user can cross
 * them over. Exported so the page can refuse to run rather than showing the
 * engine's 400 as a red box.
 */
export function isValidRange(value: DateRangeValue): boolean {
  return value.from <= value.to
}

export { PRESETS as DATE_RANGE_PRESETS }
