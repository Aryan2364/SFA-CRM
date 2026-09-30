import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import {
  NO_USABLE_ROWS, cell, checkFile, countVerdicts, importMode, levelCounts, nodeIndex, pathKeys,
  planHierarchy, rowNumber, type HierNode, type ImportResponse, type NewNode, type RawRow, type RowVerdict,
} from '@/lib/bulk-import'
import { LOCATION_COLUMNS } from '../_columns'

const LEVELS = ['State', 'District', 'Taluka', 'Village'] as const
/** The response's per-level count keys, as the import page reads them. */
const LEVEL_KEYS = ['states', 'districts', 'talukas', 'villages'] as const

type Row = { verdict: RowVerdict; path: string[] }

/** One verdict per non-blank row; `valid` holds the rows with no error. */
function readRows(raw: RawRow[], col: Record<string, string>): { verdicts: RowVerdict[]; valid: Row[] } {
  const verdicts: RowVerdict[] = []
  const valid: Row[] = []
  raw.forEach((r, i) => {
    const values = LEVELS.map(l => cell(r, col[l]))
    // A blank line in the sheet is not a row.
    if (values.every(v => !v)) return
    const verdict: RowVerdict = { row: rowNumber(r, i), status: 'skipped', issues: [] }
    verdicts.push(verdict)

    // Each level needs every level above it. Every gap is reported, not the
    // first, so the user fixes the row in one pass.
    const deepest = values.reduce((d, v, idx) => (v ? idx : d), -1)
    values.slice(0, deepest).forEach((v, idx) => {
      if (!v) verdict.issues.push({
        column: LEVELS[idx], severity: 'error',
        message: `${LEVELS[idx]} is blank, but ${LEVELS[deepest]} "${values[deepest]}" needs it`,
      })
    })
    if (verdict.issues.length === 0) valid.push({ verdict, path: values.slice(0, deepest + 1) })
  })
  return { verdicts, valid }
}

/** The tenant's existing locations on the paths the file names. Four queries
 *  whatever the file's size, each tenant-scoped and narrowed to the parents
 *  the file actually goes below. */
async function loadExisting(db: Prisma.TransactionClient, tid: string, rows: Row[]) {
  const index = nodeIndex()
  const paths = rows.map(r => pathKeys(r.path))
  index.add((await db.states.findMany({
    where: { tenant_id: tid }, select: { id: true, name: true },
  })).map(s => ({ ...s, parent: null })))

  let parents = index.parentIds(paths, 1)
  if (parents.length) index.add((await db.districts.findMany({
    where: { tenant_id: tid, state_id: { in: parents } }, select: { id: true, name: true, state_id: true },
  })).map(d => ({ id: d.id, name: d.name, parent: d.state_id })))

  parents = index.parentIds(paths, 2)
  if (parents.length) index.add((await db.talukas.findMany({
    where: { tenant_id: tid, district_id: { in: parents } }, select: { id: true, name: true, district_id: true },
  })).map(t => ({ id: t.id, name: t.name, parent: t.district_id })))

  parents = index.parentIds(paths, 3)
  if (parents.length) index.add((await db.villages.findMany({
    where: { tenant_id: tid, taluka_id: { in: parents } }, select: { id: true, name: true, taluka_id: true },
  })).map(v => ({ id: v.id, name: v.name, parent: v.taluka_id })))

  return index
}

/**
 * Good rows are imported; bad rows are skipped and reported.
 *
 * `mode: 'validate'` answers what `commit` would do and writes nothing.
 * `commit` re-validates from scratch, inside the transaction that writes, and
 * writes only the rows with no error. A skipped row creates nothing, not even
 * its parents, and no other row depends on it: every row carries its own full
 * State → Village path, so a later row naming the same state creates it (or
 * finds it) on its own.
 *
 * The write is still ONE transaction. Row-level skipping is about bad data; a
 * database failure part way down the hierarchy rolls the whole file back
 * rather than leaving the states created and the districts not. Re-uploading
 * is safe either way — existing names are matched, never duplicated or renamed.
 *
 * One transaction is sized for the file: at most IMPORT_MAX_ROWS rows, which
 * is at most four multi-row inserts, well inside the timeout below.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'states', 'edit')) return forbidden()
  const body = await req.json().catch(() => null) as { rows?: unknown; mode?: unknown } | null
  const mode = importMode(body)

  const file = checkFile(body?.rows, LOCATION_COLUMNS)
  if (!file.ok) return NextResponse.json(file.body, { status: 400 })
  const { verdicts, valid } = readRows(file.rows, file.match.mapping)
  if (verdicts.length === 0) return NextResponse.json({ error: NO_USABLE_ROWS }, { status: 400 })

  const tid = getTenantId()
  const respond = (counts: ReturnType<typeof levelCounts>) => {
    const perLevel = (m: Record<string, number>) =>
      Object.fromEntries(LEVELS.map((l, i) => [LEVEL_KEYS[i], m[l]]))
    const out: ImportResponse = {
      mode,
      total: verdicts.length,
      counts: countVerdicts(verdicts),
      created: perLevel(counts.created),
      existing: perLevel(counts.existing),
      rows: verdicts,
      unrecognisedColumns: file.match.unrecognised,
    }
    return NextResponse.json(out)
  }

  if (mode === 'validate') {
    try {
      const index = await loadExisting(prisma, tid, valid)
      // Nothing is created by a check: report what WOULD be, per level.
      return respond(levelCounts(LEVELS, valid, index, planHierarchy(valid, index)))
    } catch (err) {
      const { error, status } = dbErrorResult(err)
      return NextResponse.json({ error: `The file could not be checked. ${error}` }, { status })
    }
  }

  // Every node the plan creates has its parent either already in the tenant
  // or created one level earlier in this transaction. A missing id below is
  // therefore a bug, and it rolls the whole file back rather than orphaning.
  const need = (v: string | undefined, what: string): string => {
    if (v === undefined) throw new Error(`Location import: ${what} was not resolved`)
    return v
  }

  let counts: ReturnType<typeof levelCounts>
  try {
    counts = await prisma.$transaction(async tx => {
      const index = await loadExisting(tx, tid, valid)
      const created = planHierarchy(valid, index)
      // Counted now, against what was there BEFORE this file: the index
      // also collects the nodes created below.
      const planned = levelCounts(LEVELS, valid, index, created)
      const todo = (depth: number) => [...created.values()].filter(n => n.depth === depth)
      const parentId = (n: NewNode) => need(index.idByKey.get(n.parentKey ?? ''), `parent of "${n.name}"`)

      // createManyAndReturn, not createMany: the ids are needed below (PLAN.md 8.4).
      const states = todo(0)
      if (states.length) index.add((await tx.states.createManyAndReturn({
        data: states.map(n => ({ tenant_id: tid, name: n.name, is_active: true })),
        select: { id: true, name: true },
      })).map((s): HierNode => ({ ...s, parent: null })))

      const districts = todo(1)
      if (districts.length) index.add((await tx.districts.createManyAndReturn({
        data: districts.map(n => ({ tenant_id: tid, name: n.name, state_id: parentId(n), is_active: true })),
        select: { id: true, name: true, state_id: true },
      })).map(d => ({ id: d.id, name: d.name, parent: d.state_id })))

      const talukas = todo(2)
      if (talukas.length) index.add((await tx.talukas.createManyAndReturn({
        data: talukas.map(n => ({ tenant_id: tid, name: n.name, district_id: parentId(n), is_active: true })),
        select: { id: true, name: true, district_id: true },
      })).map(t => ({ id: t.id, name: t.name, parent: t.district_id })))

      const villages = todo(3)
      if (villages.length) await tx.villages.createManyAndReturn({
        data: villages.map(n => ({ tenant_id: tid, name: n.name, taluka_id: parentId(n), is_active: true })),
        select: { id: true },
      })

      return planned
    }, { maxWait: 10_000, timeout: 60_000 })
  } catch (err) {
    const { error, status } = dbErrorResult(err)
    return NextResponse.json({ error: `Nothing was imported. ${error}` }, { status })
  }

  for (const v of verdicts) if (v.status === 'ready') v.status = 'created'
  return respond(counts)
}
