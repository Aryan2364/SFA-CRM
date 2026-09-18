import { MEASURES, type MeasureDef } from '@/lib/reports/measures'
import { dimensionsForSource } from '@/lib/reports/dimensions'

/**
 * REBUILD-PLAN.md §7.1, P5-T3 — what a saved report's `config` column may hold.
 *
 * ---------------------------------------------------------------------------
 * THE STORED CONFIG IS NOT A `ReportSpec`. IT MUST NOT BE ONE.
 *
 * A `ReportSpec` carries `dateFrom`/`dateTo` — two resolved dates. Storing
 * those would freeze a report saved as "Last 30 days" to the thirty days that
 * happened to be current on the day it was saved, so the same saved report
 * reopened in December would report on September. `date-range-control.tsx`
 * keeps the preset key alongside the dates for exactly this reason.
 *
 * So the stored range is the PRESET KEY, and the dates are re-resolved at open
 * time by `resolvePreset()`. `custom` is the one preset that means literal
 * dates, and it is the ONLY case where `from`/`to` are stored — and the only
 * case where they are read back. A non-custom config carries no dates at all,
 * rather than dates that are ignored: a stale value nobody reads is a value
 * somebody eventually reads.
 * ---------------------------------------------------------------------------
 */

export const PRESET_KEYS = [
  'today',
  'yesterday',
  'last_7',
  'last_30',
  'this_month',
  'last_month',
  'last_3_months',
  'this_fy',
  'custom',
] as const

export type PresetKey = (typeof PRESET_KEYS)[number]

export type SavedRange =
  | { preset: Exclude<PresetKey, 'custom'> }
  | { preset: 'custom'; from: string; to: string }

export type SavedReportConfig = {
  measure: string
  /** One or two dimension keys, in display order. */
  dimensions: string[]
  range: SavedRange
  /** The wire shape of a filter: `{ <dimension key>: <group key> }`. */
  filters: Record<string, string>
}

const NAME_MAX = 80
const YMD = /^\d{4}-\d{2}-\d{2}$/

export function normaliseName(value: unknown): { name: string } | { error: string } {
  if (typeof value !== 'string') return { error: 'A name is required.' }
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length === 0) return { error: 'A name is required.' }
  if (name.length > NAME_MAX) {
    return { error: `A name can be at most ${NAME_MAX} characters.` }
  }
  return { name }
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(v => typeof v === 'string')
}

/**
 * Validate a config posted by the builder, and return the canonical shape that
 * is written to the column.
 *
 * Checked against the registries, not just structurally: a measure or dimension
 * that does not exist can only come from a stale or hand-made client, and
 * storing it would guarantee a report that cannot be opened later. Permissions
 * are deliberately NOT checked here — a saved report is a stored spec, and
 * `/api/reports/run` is the one place that decides what a spec may read.
 */
export function parseConfig(value: unknown): { config: SavedReportConfig } | { error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'The report setup is missing.' }
  }
  const raw = value as Record<string, unknown>

  const measureKey = raw.measure
  if (typeof measureKey !== 'string' || !(measureKey in MEASURES)) {
    return { error: 'That measure does not exist.' }
  }
  const measure = MEASURES[measureKey as keyof typeof MEASURES] as MeasureDef

  if (!Array.isArray(raw.dimensions) || raw.dimensions.length < 1 || raw.dimensions.length > 2) {
    return { error: 'A report needs one or two dimensions.' }
  }
  const allowed = new Set(dimensionsForSource(measure.source).map(d => d.key))
  const dimensions: string[] = []
  for (const d of raw.dimensions) {
    if (typeof d !== 'string' || !allowed.has(d)) {
      return { error: 'That measure cannot be broken down by one of those fields.' }
    }
    if (dimensions.includes(d)) return { error: 'The two dimensions must be different.' }
    dimensions.push(d)
  }

  const range = raw.range
  if (typeof range !== 'object' || range === null) {
    return { error: 'A date range is required.' }
  }
  const preset = (range as Record<string, unknown>).preset
  if (typeof preset !== 'string' || !(PRESET_KEYS as readonly string[]).includes(preset)) {
    return { error: 'That date range is not one this report can store.' }
  }

  let savedRange: SavedRange
  if (preset === 'custom') {
    const from = (range as Record<string, unknown>).from
    const to = (range as Record<string, unknown>).to
    if (typeof from !== 'string' || !YMD.test(from) || typeof to !== 'string' || !YMD.test(to)) {
      return { error: 'A custom range needs a start and an end date.' }
    }
    if (from > to) return { error: 'The start date is after the end date.' }
    savedRange = { preset: 'custom', from, to }
  } else {
    // No dates. See the header: a non-custom preset is re-resolved at open time.
    savedRange = { preset: preset as Exclude<PresetKey, 'custom'> }
  }

  const filtersRaw = raw.filters ?? {}
  if (!isRecordOfStrings(filtersRaw)) {
    return { error: 'The filters are not in a shape this report can store.' }
  }
  const filters: Record<string, string> = {}
  for (const [dimension, filterValue] of Object.entries(filtersRaw)) {
    // A filter on a dimension the measure cannot slice by is dropped rather
    // than rejected: the builder already refuses to build one, and a stored
    // filter the engine would ignore is worse than no filter.
    if (!allowed.has(dimension) || filterValue === '') continue
    filters[dimension] = filterValue
  }

  return { config: { measure: measureKey, dimensions, range: savedRange, filters } }
}
