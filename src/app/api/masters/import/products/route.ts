import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

type RawRow = Record<string, string | number | null | undefined>

function field(row: RawRow, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()]
    if (v !== undefined && v !== null) return String(v).trim()
  }
  return ''
}

// Case-insensitive dedup: keeps first-seen casing, discards subsequent variants
function uniqueByLower(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n) }
  }
  return out
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'products', 'edit')) return forbidden()
  const body = await req.json() as { rows: RawRow[] }
  if (!Array.isArray(body.rows)) return NextResponse.json({ error: 'rows must be an array' }, { status: 400 })
  if (body.rows.length > 2000) return NextResponse.json({ error: 'Maximum 2000 rows per import' }, { status: 400 })

  const tid = getTenantId()

  const skipped: { row: number; reason: string }[] = []
  const created = { categories: 0, subcategories: 0, products: 0 }
  const existing = { categories: 0, subcategories: 0, products: 0 }

  const rows = body.rows.map((r, i) => ({
    rowNum: i + 2,
    category:    field(r, 'Category',     'CATEGORY'),
    subcategory: field(r, 'Sub-Category', 'SUB-CATEGORY', 'Subcategory', 'subcategory'),
    product:     field(r, 'Product Name', 'PRODUCT NAME', 'Product',     'product'),
    price:       field(r, 'Price',        'PRICE'),
    sku:         field(r, 'SKU',          'sku'),
  }))

  // ── 1. CATEGORIES ────────────────────────────────────────────────────────
  // Case-insensitive dedup of input names
  const catNames = uniqueByLower(rows.filter(r => r.category).map(r => r.category))

  // Fetch ALL categories for tenant → case-insensitive map
  const existingCats = await prisma.product_categories.findMany({
    where: { tenant_id: tid }, select: { id: true, name: true },
  })
  const catMap = new Map<string, string>(existingCats.map(c => [c.name.toLowerCase(), c.id]))

  existing.categories = catNames.filter(n => catMap.has(n.toLowerCase())).length
  const toCreateCats = catNames.filter(n => !catMap.has(n.toLowerCase()))

  if (toCreateCats.length > 0) {
    // createManyAndReturn, not createMany: the original .select()ed the inserted
    // rows and the ids are needed below (PLAN.md 8.4).
    let nc
    try {
      nc = await prisma.product_categories.createManyAndReturn({
        data: toCreateCats.map(name => ({ tenant_id: tid, name, is_active: true })),
        select: { id: true, name: true },
      })
    } catch (err) {
      return NextResponse.json({ error: `Categories: ${dbErrorMessage(err)}` }, { status: 500 })
    }
    for (const c of nc) catMap.set(c.name.toLowerCase(), c.id)
    created.categories = nc.length
  }

  // ── 2. SUB-CATEGORIES ────────────────────────────────────────────────────
  // Deduplicate inputs by compound key (categoryId|sub.lower), keep first-seen casing
  const subInputsMap = new Map<string, { name: string; categoryId: string }>()
  const skippedCatKeys = new Set<string>()
  for (const r of rows) {
    if (!r.category || !r.subcategory) continue
    const cid = catMap.get(r.category.toLowerCase())
    if (!cid) {
      if (!skippedCatKeys.has(r.category.toLowerCase())) {
        skipped.push({ row: r.rowNum, reason: `Category "${r.category}" not found` })
        skippedCatKeys.add(r.category.toLowerCase())
      }
      continue
    }
    const key = `${cid}|${r.subcategory.toLowerCase()}`
    if (!subInputsMap.has(key)) subInputsMap.set(key, { name: r.subcategory, categoryId: cid })
  }
  const subInputs = [...subInputsMap.values()]

  const subMap = new Map<string, string>()
  if (subInputs.length > 0) {
    // Fetch ALL subcategories for the relevant categories (avoids case-sensitive .in('name'))
    const relevantCatIds = [...new Set(subInputs.map(s => s.categoryId))]
    const ess = await prisma.product_subcategories.findMany({
      where: { tenant_id: tid, category_id: { in: relevantCatIds } },
      select: { id: true, name: true, category_id: true },
    })
    for (const s of ess) subMap.set(`${s.category_id}|${s.name.toLowerCase()}`, s.id)

    existing.subcategories = subInputs.filter(s => subMap.has(`${s.categoryId}|${s.name.toLowerCase()}`)).length
    const toCreate = subInputs.filter(s => !subMap.has(`${s.categoryId}|${s.name.toLowerCase()}`))
    if (toCreate.length > 0) {
      let ns
      try {
        ns = await prisma.product_subcategories.createManyAndReturn({
          data: toCreate.map(s => ({ tenant_id: tid, name: s.name, category_id: s.categoryId, is_active: true })),
          select: { id: true, name: true, category_id: true },
        })
      } catch (err) {
        return NextResponse.json({ error: `Sub-categories: ${dbErrorMessage(err)}` }, { status: 500 })
      }
      for (const s of ns) subMap.set(`${s.category_id}|${s.name.toLowerCase()}`, s.id)
      created.subcategories = ns.length
    }
  }

  // ── 3. PRODUCTS ──────────────────────────────────────────────────────────
  // Deduplicate by compound key (categoryId|subcategoryId|product.lower)
  const prodInputsMap = new Map<string, { name: string; categoryId: string; subcategoryId: string | null; price: number | null; sku: string | null }>()
  for (const r of rows) {
    if (!r.category || !r.product) continue
    const cid = catMap.get(r.category.toLowerCase())
    if (!cid) continue
    const sid = r.subcategory ? (subMap.get(`${cid}|${r.subcategory.toLowerCase()}`) ?? null) : null
    const price = r.price ? parseFloat(r.price) : null
    if (r.price && isNaN(price!)) {
      skipped.push({ row: r.rowNum, reason: `Invalid price "${r.price}"` })
      continue
    }
    const key = `${cid}|${sid ?? ''}|${r.product.toLowerCase()}`
    if (!prodInputsMap.has(key)) {
      prodInputsMap.set(key, { name: r.product, categoryId: cid, subcategoryId: sid, price, sku: r.sku || null })
    }
  }
  const prodInputs = [...prodInputsMap.values()]

  if (prodInputs.length > 0) {
    // Fetch ALL products for the relevant categories (avoids case-sensitive .in('name'))
    const relevantCatIds = [...new Set(prodInputs.map(p => p.categoryId))]
    const eps = await prisma.products.findMany({
      where: { tenant_id: tid, category_id: { in: relevantCatIds } },
      select: { id: true, name: true, category_id: true, subcategory_id: true },
    })
    const prodMap = new Map(eps.map(p => [
      `${p.category_id}|${p.subcategory_id ?? ''}|${p.name.toLowerCase()}`, p.id
    ]))

    existing.products = prodInputs.filter(p =>
      prodMap.has(`${p.categoryId}|${p.subcategoryId ?? ''}|${p.name.toLowerCase()}`)
    ).length
    const toCreate = prodInputs.filter(p =>
      !prodMap.has(`${p.categoryId}|${p.subcategoryId ?? ''}|${p.name.toLowerCase()}`)
    )
    if (toCreate.length > 0) {
      try {
        // PRESERVED BUG, do not "fix" here. products.subcategory_id and
        // products.price are both NOT NULL, but this importer passes null for
        // either when the spreadsheet omits a Sub-Category or a Price. The
        // Supabase insert failed on a not-null violation and the whole import
        // returned 500; that is unchanged. Prisma's types catch at compile time
        // what Postgres rejected at runtime, hence the cast. See PLAN.md 13.4.
        const np = await prisma.products.createManyAndReturn({
          data: toCreate.map(p => ({
            tenant_id: tid,
            name: p.name,
            category_id: p.categoryId,
            subcategory_id: p.subcategoryId,
            price: p.price,
            sku: p.sku,
            is_active: true,
          })) as unknown as Prisma.productsCreateManyInput[],
          select: { id: true },
        })
        created.products = np.length
      } catch (err) {
        return NextResponse.json({ error: `Products: ${dbErrorMessage(err)}` }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ created, existing, skipped })
}
