import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma, dbErrorResult } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { fmtAmount } from '@/lib/format'
import {
  NO_USABLE_ROWS, cell, checkFile, countVerdicts, importMode, levelCounts, nodeIndex, pathKeys,
  planHierarchy, rowNumber, type ImportResponse, type NewNode, type RawRow, type RowVerdict,
} from '@/lib/bulk-import'
import { PRODUCT_COLUMNS } from '../_columns'

/** products.price is Decimal(12, 2). */
const MAX_PRICE = 9_999_999_999.99
/** Digits with an optional fraction: no sign, exponent, hex or empty string. */
const PLAIN_DECIMAL = /^(\d+(\.\d*)?|\.\d+)$/

const LEVELS = ['Category', 'Sub-Category', 'Product Name'] as const
/** The response's per-level count keys, as the import page reads them. */
const LEVEL_KEYS = ['categories', 'subcategories', 'products'] as const

type Row = {
  verdict: RowVerdict
  /** Category, then Sub-Category and Product Name as far as the row goes. */
  path: string[]
  /** Set exactly when the row names a product. */
  price: number | null
  sku: string
}

type ExistingProduct = { price: number; sku: string | null }

/** One verdict per non-blank row; `valid` holds the rows with no error. */
function readRows(raw: RawRow[], col: Record<string, string>): { verdicts: RowVerdict[]; valid: Row[] } {
  const verdicts: RowVerdict[] = []
  const valid: Row[] = []
  /** Product path key → the first valid row that names it. */
  const firstProduct = new Map<string, Row>()

  raw.forEach((r, i) => {
    const category    = cell(r, col['Category'])
    const subcategory = cell(r, col['Sub-Category'])
    const product     = cell(r, col['Product Name'])
    const priceText   = cell(r, col['Price'])
    const sku         = cell(r, col['SKU'])
    // A blank line in the sheet is not a row.
    if (!category && !subcategory && !product && !priceText && !sku) return
    const verdict: RowVerdict = { row: rowNumber(r, i), status: 'skipped', issues: [] }
    verdicts.push(verdict)
    const error = (column: string, message: string) => verdict.issues.push({ column, severity: 'error', message })

    // Every reason is collected, so the user fixes the row in one pass.
    if (!category) error('Category', subcategory || product ? `Category is blank; ${product ? `product "${product}"` : `sub-category "${subcategory}"`} needs one` : 'Category is blank')
    if (product) {
      if (!subcategory) error('Sub-Category', `Sub-Category is blank; product "${product}" needs one`)
      if (!priceText) error('Price', `Price is blank; product "${product}" needs one`)
    } else {
      if (priceText) error('Product Name', 'Price is filled in but Product Name is blank')
      if (sku) error('Product Name', 'SKU is filled in but Product Name is blank')
    }

    let price: number | null = null
    if (priceText) {
      // Tolerate "1,299" and "₹ 1299" — both are how a price is typed in a sheet.
      // Anything else must be a plain decimal: Number() alone would also take
      // "0x10" as 16, "1e3" as 1000 and a lone "₹" (empty once stripped) as 0.
      const digits = priceText.replace(/[,\s₹]/g, '')
      const n = PLAIN_DECIMAL.test(digits) ? Number(digits) : NaN
      if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) {
        error('Price', `Price "${priceText}" is not a valid amount; enter a number such as 1299 or 1299.50`)
      } else price = Math.round(n * 100) / 100
    }
    if (verdict.issues.length > 0) return

    const row: Row = { verdict, path: product ? [category, subcategory, product] : subcategory ? [category, subcategory] : [category], price: product ? price : null, sku }
    if (product) {
      // The same product twice with different values is a conflict: the
      // first row would silently win. The same values twice is harmless.
      const key = pathKeys(row.path)[2]
      const first = firstProduct.get(key)
      if (first) {
        if (first.price !== row.price) {
          error('Price', `Row ${first.verdict.row} already sets this product to ${fmtAmount(first.price)}`)
        }
        if ((first.sku || '') !== (row.sku || '')) {
          error('SKU', first.sku
            ? `Row ${first.verdict.row} already gives this product SKU "${first.sku}"`
            : `Row ${first.verdict.row} already imports this product with no SKU`)
        }
        if (verdict.issues.length > 0) return
      } else firstProduct.set(key, row)
    }
    valid.push(row)
  })
  return { verdicts, valid }
}

/** The tenant's existing categories, sub-categories and products on the paths
 *  the file names. Three queries whatever the file's size, each tenant-scoped. */
async function loadExisting(db: Prisma.TransactionClient, tid: string, rows: Row[]) {
  const index = nodeIndex()
  const paths = rows.map(r => pathKeys(r.path))
  index.add((await db.product_categories.findMany({
    where: { tenant_id: tid }, select: { id: true, name: true },
  })).map(c => ({ ...c, parent: null })))

  let parents = index.parentIds(paths, 1)
  if (parents.length) index.add((await db.product_subcategories.findMany({
    where: { tenant_id: tid, category_id: { in: parents } }, select: { id: true, name: true, category_id: true },
  })).map(s => ({ id: s.id, name: s.name, parent: s.category_id })))

  const products = new Map<string, ExistingProduct>()
  parents = index.parentIds(paths, 2)
  if (parents.length) {
    const found = await db.products.findMany({
      where: { tenant_id: tid, subcategory_id: { in: parents } },
      select: { id: true, name: true, subcategory_id: true, price: true, sku: true },
    })
    index.add(found.map(p => ({ id: p.id, name: p.name, parent: p.subcategory_id })))
    const idToProduct = new Map(found.map(p => [p.id, p]))
    for (const [key, id] of index.idByKey) {
      const p = idToProduct.get(id)
      if (p) products.set(key, { price: Number(p.price), sku: p.sku })
    }
  }
  return { index, products }
}

/**
 * Good rows are imported; bad rows are skipped and reported — see the location
 * importer for the flow, the single transaction and why a skipped row cannot
 * orphan another.
 *
 * Create-only. A product that already exists (same category, sub-category and
 * name) is reported as `existing` and never updated; if the file's price or
 * SKU differs, the row carries a warning saying so, because the price in the
 * system was deliberately not changed.
 *
 * This importer once passed `null` for a blank Price or Sub-Category into
 * `products.price` / `products.subcategory_id`, both NOT NULL (PLAN.md 13.4),
 * and the insert failed with a 500 after the categories were committed. Both
 * are row errors now, found before any write.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'products', 'edit')) return forbidden()
  const body = await req.json().catch(() => null) as { rows?: unknown; mode?: unknown } | null
  const mode = importMode(body)

  const file = checkFile(body?.rows, PRODUCT_COLUMNS)
  if (!file.ok) return NextResponse.json(file.body, { status: 400 })
  const { verdicts, valid } = readRows(file.rows, file.match.mapping)
  if (verdicts.length === 0) return NextResponse.json({ error: NO_USABLE_ROWS }, { status: 400 })

  const tid = getTenantId()

  /** Statuses, plus the stale-value warnings on existing products. */
  const plan = (existing: Awaited<ReturnType<typeof loadExisting>>) => {
    const created = planHierarchy(valid, existing.index)
    for (const r of valid) {
      if (r.path.length < 3 || r.verdict.status !== 'existing') continue
      const had = existing.products.get(pathKeys(r.path)[2])
      if (!had) continue
      const changed = [
        had.price !== r.price && `the price (${fmtAmount(had.price)})`,
        (had.sku || '') !== (r.sku || '') && `the SKU (${had.sku ? `"${had.sku}"` : 'none'})`,
      ].filter(Boolean)
      if (changed.length) r.verdict.issues.push({
        column: had.price !== r.price ? 'Price' : 'SKU', severity: 'warning',
        message: `Already exists; ${changed.join(' and ')} ${changed.length > 1 ? 'were' : 'was'} not changed`,
      })
    }
    return { created, counts: levelCounts(LEVELS, valid, existing.index, created) }
  }
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
      return respond(plan(await loadExisting(prisma, tid, valid)).counts)
    } catch (err) {
      const { error, status } = dbErrorResult(err)
      return NextResponse.json({ error: `The file could not be checked. ${error}` }, { status })
    }
  }

  // Every node the plan creates has its parent either already in the tenant
  // or created one level earlier in this transaction; a missing id or price
  // is a bug, and it rolls the whole file back rather than orphaning a row.
  const need = <T,>(v: T | undefined | null, what: string): T => {
    if (v === undefined || v === null) throw new Error(`Product import: ${what} was not resolved`)
    return v
  }
  let counts: ReturnType<typeof levelCounts>
  try {
    counts = await prisma.$transaction(async tx => {
      const existing = await loadExisting(tx, tid, valid)
      const { created, counts: planned } = plan(existing)
      const { index } = existing
      const todo = (depth: number) => [...created.values()].filter(n => n.depth === depth)
      const parentId = (n: NewNode<Row>) => need(index.idByKey.get(n.parentKey ?? ''), `parent of "${n.name}"`)

      // createManyAndReturn, not createMany: the ids are needed below (PLAN.md 8.4).
      const cats = todo(0)
      if (cats.length) index.add((await tx.product_categories.createManyAndReturn({
        data: cats.map(n => ({ tenant_id: tid, name: n.name, is_active: true })),
        select: { id: true, name: true },
      })).map(c => ({ ...c, parent: null })))

      const subs = todo(1)
      if (subs.length) index.add((await tx.product_subcategories.createManyAndReturn({
        data: subs.map(n => ({ tenant_id: tid, name: n.name, category_id: parentId(n), is_active: true })),
        select: { id: true, name: true, category_id: true },
      })).map(s => ({ id: s.id, name: s.name, parent: s.category_id })))

      const prods = todo(2)
      if (prods.length) await tx.products.createManyAndReturn({
        data: prods.map(n => {
          // The row object itself, never re-found by its client-sent number.
          const row = n.source
          const subId = parentId(n)
          return {
            tenant_id: tid,
            name: n.name,
            // The sub-category's own category: the row's Category resolved
            // to it, one level up the same path.
            category_id: need(index.idByKey.get(pathKeys(row.path)[0]), `category of "${n.name}"`),
            subcategory_id: subId,
            price: need(row.price, 'price'),
            sku: row.sku || null,
            is_active: true,
          }
        }),
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
