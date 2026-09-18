/**
 * THE WIRE SHAPES OF THE REPORT ENGINE — and nothing else.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ THIS FILE IMPORTS NOTHING, ON PURPOSE. DO NOT ADD AN IMPORT.
 *
 * The obvious way to write it is `import type { ReportResult } from
 * '@/lib/reports/run'`. Do not. That module imports `@/lib/db`, which imports
 * Prisma and `pg`, and the report builder is a `'use client'` page. One import
 * that is not erased at compile time pulls the whole data layer into the
 * browser bundle, `pg` reaches for `fs`, and EVERY ROUTE IN THE APPLICATION
 * breaks — with a completely clean `tsc --noEmit`, because the types were
 * always correct. It has happened in this repo before.
 *
 * `import type` is erased and would be safe in theory. The rule here is the
 * stricter one because the safety depends on a single keyword surviving every
 * future edit, and the failure is silent, total, and invisible to type
 * checking. A hand-written copy cannot fail that way.
 *
 * These types are the JSON on the wire, which is the contract between the two
 * halves anyway. `src/lib/reports/run.ts` and `src/app/api/reports/meta/route.ts`
 * are the source of truth; if they change shape, change this file to match.
 * ---------------------------------------------------------------------------
 */

/** `MeasureDef['format']`. Decides alignment and the number formatter. */
export type ReportFormat = 'amount' | 'number' | 'percent' | 'hours'

/** One entry of `meta.measures[].dimensions`. */
export type MetaDimension = {
  key: string
  label: string
  /** 'key' = read in its own order (time, bands). 'value' = biggest first. */
  sort: string
}

/** One entry of `meta.measures`. */
export type MetaMeasure = {
  key: string
  label: string
  format: ReportFormat
  source: string
  sourceLabel: string
  section: string
  /** ONLY the dimensions that can slice this measure. Already permission-filtered. */
  dimensions: MetaDimension[]
}

export type MetaPresetSpec = {
  measure: string
  dimensions: string[]
  filters?: Record<string, string>
}

export type MetaPreset = {
  key: string
  name: string
  description: string
  spec: MetaPresetSpec
  companions?: { name: string; spec: MetaPresetSpec }[]
}

export type MetaBand = { key: string; label: string }

/** `GET /api/reports/meta`. */
export type ReportMeta = {
  measures: MetaMeasure[]
  presets: MetaPreset[]
  headline: { key: string; label: string; spec: MetaPresetSpec }[]
  bands: { probability: MetaBand[]; ageing: MetaBand[] }
}

/** The body of `POST /api/reports/run`. */
export type ReportSpec = {
  measure: string
  dimensions: [string] | [string, string]
  /** YYYY-MM-DD, inclusive at both ends. */
  dateFrom: string
  dateTo: string
  filters?: Record<string, string>
}

export type ReportRow = {
  /** One group key per dimension, in spec order. Identity — never displayed. */
  key: string[]
  /** The human label for each key, in spec order. This is what is rendered. */
  label: string[]
  value: number
}

/** The response of `POST /api/reports/run`. */
export type ReportResult = {
  measure: { key: string; label: string; format: ReportFormat }
  dimensions: { key: string; label: string }[]
  dateFrom: string
  dateTo: string
  rows: ReportRow[]
  /**
   * The measure applied to every matching row, ignoring the dimensions.
   *
   * ⚠️ NOT the sum of `rows[].value`, and never compute it as one. For a
   * `ratio` measure — Discount Percentage — the engine's total is
   * `sum(numerator) / sum(denominator)`, which is neither the sum nor the mean
   * of the row percentages. A component that added the column up would print a
   * plausible wrong number.
   */
  total: number
  /** Rows READ from the database, not rows returned. */
  scanned: number
  /** True when the engine's MAX_ROWS ceiling bit; the figures are partial. */
  truncated: boolean
}
