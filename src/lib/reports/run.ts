import { Prisma } from '@prisma/client'
import { prisma, serialize } from '@/lib/db'
import type { SessionUser } from '@/lib/auth'
import { checkPermission, type PermSection } from '@/lib/permissions'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'
import {
  getDimension,
  UNSET_KEY,
  type DimBinding,
  type DimensionDef,
  type ReportLookups,
} from './dimensions'
import { getMeasure, type MeasureDef } from './measures'
import {
  deepMerge,
  delegateFor,
  nestedSelect,
  nestedWhere,
  readPath,
  SOURCE_DEFS,
  type SourceDef,
} from './sources'

/**
 * THE REPORT RUNNER — REBUILD-PLAN.md §7.1.
 *
 * `Measure × 1-2 Dimensions × Date Range × Filters` resolved against three
 * registries. There is no report-specific code in this file and there must
 * never be: a named report is a `ReportSpec` literal in `presets.ts`, not a
 * branch here.
 *
 * ---------------------------------------------------------------------------
 * NO RAW SQL — DELIBERATELY
 *
 * Grouping by two dimensions across a join is awkward in Prisma, and this is
 * exactly where `$queryRaw` gets reached for. It is not used, and this repo
 * still contains zero raw SQL. The reason is not taste:
 *
 *   `npm run audit:tenant` STATICALLY SCANS for a `tenant_id` predicate, and a
 *   predicate inside a raw SQL string is not something it can see. A raw query
 *   that forgot `tenant_id` would leak every tenant's rows into one report,
 *   return 200, and pass the audit.
 *
 * Instead: one `findMany` per report, with `tenant_id`, the date range, the
 * scope filter and the measure's own predicate all expressed as Prisma `where`
 * fragments — then group in memory. `MAX_ROWS` bounds the cost, and the
 * response says when it bit. At CRM volumes (a tenant's orders for a quarter)
 * this is a few thousand rows.
 *
 * ---------------------------------------------------------------------------
 * THE THREE THINGS THAT FAIL SILENTLY
 *
 * 1. **Scope.** §6.6 applies to "every list, summary and report". A report that
 *    skips `scopedUserIds()` shows an executive the whole company's numbers and
 *    looks perfectly healthy doing it. Applied below, unconditionally, from the
 *    SOURCE's declared section and scope column — never from a hardcoded role.
 * 2. **`?userId=`.** It INTERSECTS. `/api/orders` let it replace the allowed
 *    set, which turned a filter into a bypass (gap G3). An id outside the
 *    allowed set collapses to no rows here, never to a wider set.
 * 3. **`Decimal`.** Every accumulator is a `Prisma.Decimal` and the whole
 *    payload goes through `serialize()` on the way out. A `Decimal` that meets
 *    `JSON.stringify` becomes a string, and `"1200" + "800"` is `"1200800"`.
 */

export type ReportSpec = {
  measure: string
  dimensions: [string] | [string, string]
  /** YYYY-MM-DD, inclusive at both ends. */
  dateFrom: string
  dateTo: string
  filters?: Record<string, string>
}

export type ReportRow = {
  /** One group key per dimension, in spec order. */
  key: string[]
  /** The human label for each key, in spec order. */
  label: string[]
  value: number
}

export type ReportResult = {
  measure: { key: string; label: string; format: string }
  dimensions: { key: string; label: string }[]
  dateFrom: string
  dateTo: string
  rows: ReportRow[]
  /** The measure applied to every matching row, ignoring the dimensions. */
  total: number
  /** Rows READ from the database, not rows returned. */
  scanned: number
  /** True when `MAX_ROWS` was hit and the numbers are therefore partial. */
  truncated: boolean
}

export type RunFailure = { error: string; status: 400 | 403 }

/**
 * Hard ceiling on rows read for one report. Chosen so a pathological spec costs
 * one bounded query rather than an unbounded one; `truncated` tells the caller
 * the answer is partial rather than quietly returning a wrong total.
 */
export const MAX_ROWS = 20_000

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Throwaway key name used only to borrow `scopeWhere`'s leaf predicate. */
const SCOPE_LEAF = 'value'


export async function runReport(
  user: SessionUser,
  tenantId: string,
  spec: ReportSpec
): Promise<ReportResult | RunFailure> {
  // ── 1. Resolve the spec against the registries ──────────────────────────
  const measure = getMeasure(spec.measure)
  if (!measure) return { error: `Unknown measure: ${spec.measure}`, status: 400 }

  if (!Array.isArray(spec.dimensions) || spec.dimensions.length < 1 || spec.dimensions.length > 2) {
    return { error: 'Pick one or two dimensions', status: 400 }
  }
  if (spec.dimensions.length === 2 && spec.dimensions[0] === spec.dimensions[1]) {
    return { error: 'The two dimensions must differ', status: 400 }
  }

  const source = SOURCE_DEFS[measure.source]

  const dims: DimensionDef[] = []
  for (const key of spec.dimensions) {
    const dim = getDimension(key)
    if (!dim) return { error: `Unknown dimension: ${key}`, status: 400 }
    if (!dim.on[source.key]) {
      return {
        error: `"${dim.label}" cannot slice "${measure.label}" — it does not exist on ${source.label}`,
        status: 400,
      }
    }
    dims.push(dim)
  }

  if (!DATE_RE.test(spec.dateFrom) || !DATE_RE.test(spec.dateTo)) {
    return { error: 'dateFrom and dateTo must be YYYY-MM-DD', status: 400 }
  }
  if (spec.dateFrom > spec.dateTo) {
    // Plain string comparison is correct for YYYY-MM-DD and is why the format
    // is validated first.
    return { error: 'dateFrom is after dateTo', status: 400 }
  }

  const filters = spec.filters ?? {}

  // Filters may name a dimension that is not being grouped by — the dimension
  // still has to be selected so its key can be extracted and matched.
  const filterDims: { dim: DimensionDef; value: string }[] = []
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'userId' || key === 'sales_person') continue // handled in the scope step
    if (value === undefined || value === null || value === '') continue
    const dim = getDimension(key)
    if (!dim) return { error: `Unknown filter: ${key}`, status: 400 }
    if (!dim.on[source.key]) {
      return { error: `Cannot filter "${measure.label}" by "${dim.label}"`, status: 400 }
    }
    filterDims.push({ dim, value })
  }

  // ── 2. Permissions ──────────────────────────────────────────────────────
  if (!(await checkPermission(user, source.section, 'view'))) {
    return { error: 'Forbidden', status: 403 }
  }
  // A dimension that reaches into another section needs that section too.
  const extraSections = new Set<PermSection>()
  for (const d of [...dims, ...filterDims.map(f => f.dim)]) {
    if (d.requiresSection && d.requiresSection !== source.section) extraSections.add(d.requiresSection)
  }
  for (const section of extraSections) {
    if (!(await checkPermission(user, section, 'view'))) {
      return { error: 'Forbidden', status: 403 }
    }
  }

  // ── 3. Scope (§6.6) ─────────────────────────────────────────────────────
  // ⚠️ The column is the SOURCE's, not a constant: Party tables scope on
  // `owner_user_id`, activity tables on `user_id`, and two sources reach it
  // through a relation. `scopePath` is the single declaration of that.
  const allowed = await scopedUserIds(user, source.section)
  const requestedUser = filters.userId ?? filters.sales_person ?? null
  const effective = intersectScope(allowed, requestedUser)
  // `scopeWhere` returns `{}` for Company scope with no requested user — no
  // predicate at all — which is the one case where a missing filter is correct.
  // `scopeWhere` builds the leaf predicate (`{ in: [...] }`, or nothing at all
  // for Company scope); `nestedWhere` puts it at the source's declared path,
  // which for two sources is one level down a relation.
  const leaf = scopeWhere(effective, SCOPE_LEAF)[SCOPE_LEAF]
  const scopeFragment = effective === null ? {} : nestedWhere(source.scopePath, leaf)

  // ── 4. Build the query ──────────────────────────────────────────────────
  const from = new Date(`${spec.dateFrom}T00:00:00.000Z`)
  const to = new Date(`${spec.dateTo}T23:59:59.999Z`)

  let where: Record<string, unknown> = { tenant_id: tenantId }
  where = deepMerge(where, nestedWhere(source.datePath, { gte: from, lte: to }))
  where = deepMerge(where, scopeFragment)
  if (source.baseWhere) where = deepMerge(where, source.baseWhere)
  if (measure.where) where = deepMerge(where, measure.where)

  const bindings: DimBinding[] = [
    ...dims.map(d => d.on[source.key]!),
    ...filterDims.map(f => f.dim.on[source.key]!),
  ]

  // The id is always selected: it is the only column guaranteed to exist and it
  // keeps `select` non-empty when the measure is a bare count with no dimension
  // columns of its own.
  let select: Record<string, unknown> = { id: true }
  select = deepMerge(select, nestedSelect(source.datePath))
  if (measure.select) select = deepMerge(select, measure.select)
  for (const b of bindings) select = deepMerge(select, b.select)

  const rows = await delegateFor(source.key).findMany({
    where,
    select,
    take: MAX_ROWS + 1,
  })

  const truncated = rows.length > MAX_ROWS
  if (truncated) rows.length = MAX_ROWS

  // ── 5. The two lookups Prisma cannot join ───────────────────────────────
  const lookups = await buildLookups(tenantId, source, bindings, rows)

  // ── 6. Filter, group, accumulate ────────────────────────────────────────
  const groups = new Map<string, Accumulator>()
  const grand = newAccumulator([], [])

  rowLoop: for (const row of rows) {
    for (const f of filterDims) {
      const got = f.dim.on[source.key]!.extract(row, lookups)
      if (got.key !== f.value) continue rowLoop
    }

    const parts = dims.map(d => d.on[source.key]!.extract(row, lookups))
    // JSON, not a joined string. Group keys are user data — a company name, an
    // expense category — so any printable separator is one badly-named master
    // row away from merging two groups into one, silently, and only for the
    // tenant that named it that way.
    const composite = JSON.stringify(parts.map(p => p.key))

    let acc = groups.get(composite)
    if (!acc) {
      acc = newAccumulator(parts.map(p => p.key), parts.map(p => p.label))
      groups.set(composite, acc)
    }
    apply(acc, measure, row)
    apply(grand, measure, row)
  }

  // ── 7. Order and serialise ──────────────────────────────────────────────
  const primary = dims[0]
  const out = [...groups.values()].map(acc => ({
    key: acc.key,
    label: acc.label,
    value: finalise(acc, measure),
  }))

  if (primary.sort === 'key') {
    // Time and band dimensions read in their own order, not by size. The unset
    // bucket sorts last either way — a "No date" row at the front of a monthly
    // trend is noise.
    out.sort((a, b) => rank(a.key[0]) - rank(b.key[0]) || cmp(a.key, b.key))
  } else {
    out.sort((a, b) => {
      const d = b.value.comparedTo(a.value)
      if (d !== 0) return d
      return cmp(a.label, b.label)
    })
  }

  const result = {
    measure: { key: measure.key, label: measure.label, format: measure.format },
    dimensions: dims.map(d => ({ key: d.key, label: d.label })),
    dateFrom: spec.dateFrom,
    dateTo: spec.dateTo,
    rows: out,
    total: finalise(grand, measure),
    scanned: rows.length,
    truncated,
  }

  // ⚠️ Every `value` and `total` above is still a `Prisma.Decimal`. This is the
  // line that turns them into JS numbers; without it they would be strings on
  // the wire and every sum the client does would concatenate.
  return serialize(result) as ReportResult
}

// ---------------------------------------------------------------------------
// Accumulation
// ---------------------------------------------------------------------------

type Accumulator = {
  key: string[]
  label: string[]
  count: number
  sum: Prisma.Decimal
  num: Prisma.Decimal
  den: Prisma.Decimal
}

function newAccumulator(key: string[], label: string[]): Accumulator {
  return {
    key,
    label,
    count: 0,
    sum: new Prisma.Decimal(0),
    num: new Prisma.Decimal(0),
    den: new Prisma.Decimal(0),
  }
}

function apply(acc: Accumulator, measure: MeasureDef, row: Record<string, unknown>): void {
  acc.count += 1
  if (measure.kind === 'sum') {
    acc.sum = acc.sum.add(measure.value(row))
  } else if (measure.kind === 'ratio') {
    acc.num = acc.num.add(measure.numerator(row))
    acc.den = acc.den.add(measure.denominator(row))
  }
}

function finalise(acc: Accumulator, measure: MeasureDef): Prisma.Decimal {
  if (measure.kind === 'count') return new Prisma.Decimal(acc.count)
  if (measure.kind === 'ratio') {
    if (acc.den.isZero()) return new Prisma.Decimal(0)
    return acc.num.div(acc.den).mul(100).toDecimalPlaces(2)
  }
  return acc.sum.toDecimalPlaces(2)
}

/** The unset bucket always sorts last. */
function rank(key: string): number {
  return key === UNSET_KEY ? 1 : 0
}

function cmp(a: string[], b: string[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = a[i].localeCompare(b[i])
    if (d !== 0) return d
  }
  return 0
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * `orders.entity_id` and `daily_visits.entity_id` point at `companies.id` but
 * are NOT declared foreign keys, so Prisma cannot include through them. Rather
 * than reach for raw SQL, the ids are collected and resolved with ONE query.
 *
 * ⚠️ Both queries carry `tenant_id`. They are ordinary reads and the static
 * tenant audit sees them, but the consequence of dropping it here would be a
 * report labelled with another tenant's company names.
 */
async function buildLookups(
  tenantId: string,
  source: SourceDef,
  bindings: DimBinding[],
  rows: Record<string, unknown>[]
): Promise<ReportLookups> {
  const needs = new Set(bindings.map(b => b.needs).filter(Boolean))
  const lookups: ReportLookups = { companies: new Map(), users: new Map() }

  if (needs.has('company') && source.companyIdPath) {
    const ids = uniqueIds(rows, source.companyIdPath)
    if (ids.length) {
      const companies = await prisma.companies.findMany({
        where: { tenant_id: tenantId, id: { in: ids } },
        select: {
          id: true, name: true, type: true, pincode: true, is_complete: true,
          industries: { select: { name: true } },
          states: { select: { name: true } },
        },
      })
      for (const c of companies) {
        lookups.companies.set(c.id, {
          id: c.id,
          name: c.name,
          type: c.type ?? null,
          pincode: c.pincode ?? null,
          is_complete: c.is_complete,
          industry: c.industries?.name ?? null,
          state: c.states?.name ?? null,
        })
      }
    }
  }

  if (needs.has('user')) {
    const ids = uniqueIds(rows, source.scopePath)
    if (ids.length) {
      const users = await prisma.users.findMany({
        where: { tenant_id: tenantId, id: { in: ids } },
        select: { id: true, name: true },
      })
      for (const u of users) lookups.users.set(u.id, u.name)
    }
  }

  return lookups
}

function uniqueIds(rows: Record<string, unknown>[], path: readonly string[]): string[] {
  const set = new Set<string>()
  for (const row of rows) {
    const v = readPath(row, path)
    if (typeof v === 'string' && v) set.add(v)
  }
  return [...set]
}
