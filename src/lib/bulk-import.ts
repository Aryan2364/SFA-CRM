/**
 * The shared contract of the three bulk importers — locations, products and
 * companies. Pure: no server imports, safe in a client bundle, so the pages
 * pre-check a file with exactly the rules the routes apply.
 *
 * The flow every importer follows:
 *
 *  1. The page (or `companies/bulk-parse`) reads the sheet into rows keyed by
 *     the file's own header text, each carrying its sheet row in `__row`.
 *  2. `mode: 'validate'` runs every check, including the lookups against the
 *     tenant's existing data, and writes nothing.
 *  3. `mode: 'commit'` re-runs the same validation on the server — it never
 *     trusts an earlier verdict — and writes only the rows that pass.
 *
 * Both answer with an `ImportResponse`, so the preview and the result screen
 * render the same table. A file with bad rows is a 200 with those rows
 * `skipped`; a 400 is reserved for a problem with the file itself (missing or
 * ambiguous columns, too many rows, no usable rows).
 */

// ── Columns ───────────────────────────────────────────────────────────────

export type ImportColumn = {
  /** The key the importer reads, and the header the template writes. */
  label: string
  /** Other spellings accepted in addition to `label`. Compared normalised. */
  aliases: string[]
  required: boolean
}

/** Row-number key attached to each row, so reported row numbers are the
 *  sheet's own even when the sheet has blank rows in it. Not a column. */
export const ROW_NUMBER_KEY = '__row'

/** The columns a rejected-rows file adds after the template's own. None is an
 *  import column, and `matchColumns` skips them outright (neither mapped nor
 *  reported as unrecognised), so the user fixes the cells and re-uploads that
 *  same file unchanged. */
export const REJECTED_ROW_HEADER = 'Sheet row'
export const REJECTED_PROBLEM_HEADER = 'Problem'
export const REJECTED_REASON_HEADER = 'Reason'

export const IMPORT_MAX_ROWS = 2000

/**
 * A header matches a column when the two agree after normalising case,
 * surrounding and repeated spaces, `_` / `-` versus a space, a required-field
 * `*`, and a parenthesised hint — so "State", " STATE ", "state_name",
 * "Name *" and "Next Follow-up Date (YYYY-MM-DD)" all resolve, while a header
 * that means something else ("Region") is reported, never guessed at.
 */
export function normaliseHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const IGNORED_HEADERS = new Set(
  [REJECTED_ROW_HEADER, REJECTED_PROBLEM_HEADER, REJECTED_REASON_HEADER].map(normaliseHeader),
)

function ignoredHeader(h: string): boolean {
  return h === ROW_NUMBER_KEY || IGNORED_HEADERS.has(normaliseHeader(h))
}

export type ColumnMatch = {
  /** column label → the header in the file that supplies it */
  mapping: Record<string, string>
  /** Required columns with no matching header. */
  missing: string[]
  /** Headers in the file that match no column; their values are ignored. */
  unrecognised: string[]
  /** Columns with several candidate headers and no way to pick one; none mapped. */
  ambiguous: { label: string; headers: string[] }[]
}

/**
 * A header's exact spelling: `normaliseHeader` without dropping a bracketed
 * hint. "Name *" and "name" are the Name column spelled exactly; "Name (Hindi)"
 * only normalises to it.
 */
function exactHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\*/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Two cases are refused as ambiguous rather than resolved by position, because
 * the headers usually hold different values and picking one would import the
 * wrong one with nothing reported until after the write:
 *
 *  - a file with no `label` header but two or more of its aliases (a "Rate"
 *    and an "MRP" column, no "Price");
 *  - two headers that normalise to the same spelling ("GST Number (old)" and
 *    "GST Number *"), unless exactly one of them is spelled exactly as the
 *    label or an alias (`exactHeader`) — then that one is the column, so
 *    "Name" beats "Name (Hindi)" and "GST Number" beats "GST Number (old)",
 *    and the other is reported as unrecognised.
 */
export function matchColumns(headers: string[], columns: ImportColumn[]): ColumnMatch {
  const byNorm = new Map<string, string[]>()
  for (const h of headers) {
    if (ignoredHeader(h)) continue
    const n = normaliseHeader(h)
    if (!n) continue
    const group = byNorm.get(n) ?? []
    if (!group.includes(h)) byNorm.set(n, [...group, h])
  }

  const mapping: Record<string, string> = {}
  const ambiguous: ColumnMatch['ambiguous'] = []
  const used = new Set<string>()
  /** The headers a spelling of `col` picks up: one, several (a collision no
   *  exact spelling settles), or none. */
  const lookup = (col: ImportColumn, spelling: string): string[] => {
    const group = (byNorm.get(normaliseHeader(spelling)) ?? []).filter(h => !used.has(h))
    if (group.length <= 1) return group
    const exact = new Set([col.label, ...col.aliases].map(exactHeader))
    const winners = group.filter(h => exact.has(exactHeader(h)))
    return winners.length === 1 ? winners : group
  }
  for (const col of columns) {
    const own = lookup(col, col.label)
    const found = own.length > 0
      ? own
      : [...new Set(col.aliases.flatMap(a => lookup(col, a)))]
    if (found.length === 1) { mapping[col.label] = found[0]; used.add(found[0]) }
    else if (found.length > 1) {
      ambiguous.push({ label: col.label, headers: found })
      // Named in the ambiguity message; not also listed as unrecognised.
      found.forEach(h => used.add(h))
    }
  }

  return {
    mapping,
    missing: columns.filter(c => c.required && !(c.label in mapping) && !ambiguous.some(a => a.label === c.label)).map(c => c.label),
    unrecognised: headers.filter(h => !ignoredHeader(h) && normaliseHeader(h) !== '' && !used.has(h)),
    ambiguous,
  }
}

/** Header texts that appear more than once in a header row. Rows are keyed by
 *  header text, so the second column would overwrite the first's value. */
export function duplicateHeaders(headers: string[]): string[] {
  const seen = new Set<string>()
  const dups = new Set<string>()
  for (const h of headers) {
    // A rejected-rows column read twice is ignored either way.
    if (!h || ignoredHeader(h)) continue
    if (seen.has(h)) dups.add(h)
    seen.add(h)
  }
  return [...dups]
}

/** The file-level message for `duplicateHeaders`. */
export function duplicateHeadersMessage(dups: string[]): string {
  return `This file has more than one column headed ${listNames(dups.map(h => `"${h}"`))}, so nothing was imported: ` +
    'the importer cannot tell which of them to read. Rename or remove the extra column, then upload again.'
}

/** "State, District and Taluka". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The 400 body for a file whose headers do not carry the required columns. */
export function missingColumnsMessage(match: ColumnMatch, columns: ImportColumn[], found: string[]): string {
  const shown = found.filter(h => !ignoredHeader(h) && h.trim() !== '')
  return `This file has no ${listNames(match.missing.map(m => `"${m}"`))} column, so nothing was imported. ` +
    `Expected columns: ${columns.map(c => c.label).join(', ')}. ` +
    `Found: ${shown.length ? shown.join(', ') : 'no column headers'}. ` +
    'Rename the header row to match the template, then upload again.'
}

/** The 400 body for a file with several candidate headers for one column. */
export function ambiguousColumnsMessage(match: ColumnMatch): string {
  const parts = match.ambiguous.map(a =>
    `${listNames(a.headers.map(h => `"${h}"`))} could each be the "${a.label}" column`)
  return `In this file ${parts.join('; ')}, so nothing was imported. ` +
    `Rename the one you mean to "${match.ambiguous[0].label}" (or remove the others), then upload again.`
}

// ── Rows ──────────────────────────────────────────────────────────────────

export type RawRow = Record<string, string | number | null | undefined>

/** A mapped cell, trimmed; blank when the column is absent. */
export function cell(row: RawRow, header: string | undefined): string {
  if (header === undefined) return ''
  const v = row[header]
  return v === undefined || v === null ? '' : String(v).trim()
}

/** The sheet's own row number, as the parser sent it; else the array position
 *  (a caller that sends no `__row`). */
export function rowNumber(row: RawRow, index: number): number {
  const n = Number(row[ROW_NUMBER_KEY])
  return Number.isInteger(n) && n > 1 ? n : index + 2
}

// ── Verdicts ──────────────────────────────────────────────────────────────

export type ImportMode = 'validate' | 'commit'

/** Anything but an explicit `'validate'` commits: that is what every caller
 *  sent before the check step existed. */
export function importMode(body: unknown): ImportMode {
  return (body as { mode?: unknown } | null)?.mode === 'validate' ? 'validate' : 'commit'
}

export type ImportIssue = {
  /** The template label of the column to fix, when one column is at fault. */
  column?: string
  /** `error` skips the row; `warning` is reported and does not. */
  severity: 'error' | 'warning'
  message: string
}

/**
 * `ready`    — passes every check and will be written (validate only)
 * `created`  — was written (commit only)
 * `existing` — already in the tenant, or the same as an earlier row: nothing
 *              to write, and nothing to fix
 * `skipped`  — has at least one error; not written
 */
export type RowStatus = 'ready' | 'created' | 'existing' | 'skipped'

export type RowVerdict = { row: number; status: RowStatus; issues: ImportIssue[] }

export type ImportCounts = Record<RowStatus, number>

export type ImportResponse = {
  mode: ImportMode
  /** Non-blank rows seen. */
  total: number
  counts: ImportCounts
  /** Masters: distinct names per level (`states`, `districts`, …). */
  created?: Record<string, number>
  existing?: Record<string, number>
  rows: RowVerdict[]
  unrecognisedColumns: string[]
}

export function countVerdicts(rows: RowVerdict[]): ImportCounts {
  const counts: ImportCounts = { ready: 0, created: 0, existing: 0, skipped: 0 }
  for (const r of rows) counts[r.status]++
  return counts
}

export function hasError(issues: ImportIssue[]): boolean {
  return issues.some(i => i.severity === 'error')
}

export type FileError = { error: string; expectedColumns?: string[]; foundColumns?: string[] }

/**
 * The checks that refuse a whole request with a 400: not an array, no rows,
 * over the cap, a required column missing, an ambiguous alias. A row-level
 * mode cannot rescue a file with no State column.
 */
export function checkFile(
  rows: unknown,
  columns: ImportColumn[],
): { ok: false; body: FileError } | { ok: true; rows: RawRow[]; match: ColumnMatch } {
  if (!Array.isArray(rows)) return { ok: false, body: { error: 'rows must be an array' } }
  if (rows.length === 0) {
    return { ok: false, body: { error: 'This file has no data rows below the header row, so there was nothing to import.' } }
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    return { ok: false, body: { error: `This file has ${rows.length} rows; the limit is ${IMPORT_MAX_ROWS} per import. Split it into smaller files.` } }
  }
  const safe = (rows as unknown[]).map(r => (r && typeof r === 'object' ? r as RawRow : {}))
  const headers = [...new Set(safe.flatMap(r => Object.keys(r)))]
  const match = matchColumns(headers, columns)
  const shape = {
    expectedColumns: columns.map(c => c.label),
    foundColumns: headers.filter(h => !ignoredHeader(h)),
  }
  if (match.missing.length > 0) return { ok: false, body: { error: missingColumnsMessage(match, columns, headers), ...shape } }
  if (match.ambiguous.length > 0) return { ok: false, body: { error: ambiguousColumnsMessage(match), ...shape } }
  return { ok: true, rows: safe, match }
}

/** The 400 for a file whose every row is blank in the columns that matter. */
export const NO_USABLE_ROWS = 'No row in this file has a value in any of its import columns, so there was nothing to import.'

/** Lower-cased cumulative path keys: ["A","B"] → ["a", "a|b"]. Names repeat
 *  under different parents (Aurangabad is in two states), so a node is always
 *  identified by its whole path, never by its own name. */
export function pathKeys(path: string[]): string[] {
  const out: string[] = []
  for (const p of path) out.push(out.length ? `${out[out.length - 1]}|${p.toLowerCase()}` : p.toLowerCase())
  return out
}

// ── Hierarchies (the two master importers) ──────────────────────────────────

export type HierNode = { id: string; name: string; parent: string | null }

/**
 * The tenant's existing nodes of one hierarchy, keyed by lower-cased path
 * (`pathKeys`). Level 0 is added with `parent: null`; each deeper level is
 * added with its parent's id, and resolves only under a parent already added —
 * so a path key always means the same chain of ids.
 *
 * When two existing siblings differ only in case, the first one added wins;
 * its twin's children are not indexed, so a row naming them is resolved (or
 * created) under the winner rather than split across the two.
 */
export function nodeIndex() {
  const idByKey = new Map<string, string>()
  const keyById = new Map<string, string>()
  return {
    idByKey,
    add(nodes: HierNode[]) {
      for (const n of nodes) {
        const parentKey = n.parent === null ? null : keyById.get(n.parent)
        if (parentKey === undefined) continue
        const key = parentKey === null ? n.name.toLowerCase() : `${parentKey}|${n.name.toLowerCase()}`
        if (!idByKey.has(key)) { idByKey.set(key, n.id); keyById.set(n.id, key) }
      }
    },
    /** Existing ids at `depth - 1` that some row goes below: the only parents
     *  worth querying the next level under. */
    parentIds(paths: string[][], depth: number): string[] {
      const ids = new Set<string>()
      for (const keys of paths) {
        if (keys.length <= depth) continue
        const id = idByKey.get(keys[depth - 1])
        if (id) ids.add(id)
      }
      return [...ids]
    },
  }
}

export type NodeIndex = ReturnType<typeof nodeIndex>

/** A node the file creates: the row that first names it, its level, its
 *  name as that row spells it, and its parent's path key.
 *
 *  `source` is that row itself, as passed to `planHierarchy`, so an importer
 *  reads the row's other values (a product's price) from the object — never
 *  by looking `row` up again. `row` is the sheet number the client sent, for
 *  messages only: nothing stops a body sending the same number twice. */
export type NewNode<R = unknown> = { row: number; source: R; depth: number; name: string; parentKey: string | null }

/**
 * Decides each valid row's status against the tenant's existing nodes, in
 * sheet order:
 *
 *  - its deepest node already exists → `existing`
 *  - an earlier row in this file already creates it → `existing`, "same as row N"
 *  - otherwise → `ready`, and it claims every node on its path that neither
 *    exists nor is claimed yet
 *
 * Only rows passed in here can claim a node, and a row with an error is never
 * passed in, so a skipped row creates nothing — not even its parents — and no
 * other row depends on it: every row carries its own full path.
 */
export function planHierarchy<R extends { verdict: RowVerdict; path: string[] }>(
  rows: R[],
  index: NodeIndex,
): Map<string, NewNode<R>> {
  const created = new Map<string, NewNode<R>>()
  for (const source of rows) {
    const { verdict, path } = source
    const keys = pathKeys(path)
    const deepest = keys[keys.length - 1]
    if (index.idByKey.has(deepest)) { verdict.status = 'existing'; continue }
    const earlier = created.get(deepest)
    if (earlier) {
      verdict.status = 'existing'
      verdict.issues.push({ severity: 'warning', message: `Same as row ${earlier.row}; it is imported once` })
      continue
    }
    verdict.status = 'ready'
    keys.forEach((key, depth) => {
      if (index.idByKey.has(key) || created.has(key)) return
      created.set(key, { row: verdict.row, source, depth, name: path[depth], parentKey: depth === 0 ? null : keys[depth - 1] })
    })
  }
  return created
}

/** Distinct names per level: how many the file creates, and how many of the
 *  ones its non-skipped rows name were already there. */
export function levelCounts(
  levels: readonly string[],
  rows: { verdict: RowVerdict; path: string[] }[],
  index: NodeIndex,
  created: Map<string, NewNode>,
) {
  const made = Object.fromEntries(levels.map(l => [l, 0])) as Record<string, number>
  const found = Object.fromEntries(levels.map(l => [l, 0])) as Record<string, number>
  for (const n of created.values()) made[levels[n.depth]]++
  const seen = new Set<string>()
  for (const { verdict, path } of rows) {
    if (verdict.status === 'skipped') continue
    pathKeys(path).forEach((key, depth) => {
      if (seen.has(key) || !index.idByKey.has(key)) return
      seen.add(key)
      found[levels[depth]]++
    })
  }
  return { created: made, existing: found }
}
