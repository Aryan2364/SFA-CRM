/**
 * Batch 2 — masters: location & product. 18 routes.
 *   states / districts / talukas / villages          (list + [id])
 *   product-categories / product-subcategories / products
 *   distributors / dealers                            (both over business_partners)
 *
 * READ-ONLY against production: only GET is exercised. POST/PUT/DELETE would
 * create or mutate real master data, so they are recorded as not-exercised with
 * reasons instead of being faked green.
 *
 * Two things this batch is specifically watching:
 *  - embed CARDINALITY per level of the location hierarchy. A to-one arriving as
 *    an array fails silently, exactly as it would have in auth.ts (PLAN.md §5.2).
 *  - NUMERIC columns arriving as numbers, not Decimal-stringified. products.price
 *    and business_partners.latitude/longitude are the live cases.
 */
import { db, mintSession, req, ctx } from './lib.mjs'

export const name = 'masters-location-product'

export async function run() {
  const t = ctx()
  const prisma = db()

  const admin = await prisma.users.findFirst({
    where: { profile: 'Administrator', status: 'Active' },
    select: { id: true, name: true, contact: true, tenant_id: true, credentials_version: true },
  })
  if (!admin) {
    t.skip('all Batch 2 routes', 'no active Administrator to authenticate as')
    return t.result()
  }
  const tid = admin.tenant_id
  const token = await mintSession({
    phone: admin.contact, userId: admin.id, name: admin.name,
    role: 'Administrator', tenantId: tid, cv: admin.credentials_version ?? 1,
  })
  const get = path => req(path, { token })

  // -- list endpoints return every tenant row, and only tenant rows ----------
  t.section('list endpoints: row counts match the database exactly')
  const simple = [
    ['/api/masters/states', 'states'],
    ['/api/masters/districts', 'districts'],
    ['/api/masters/talukas', 'talukas'],
    ['/api/masters/villages', 'villages'],
    ['/api/masters/product-categories', 'product_categories'],
    ['/api/masters/product-subcategories', 'product_subcategories'],
    ['/api/masters/products', 'products'],
  ]
  const bodies = {}
  for (const [path, model] of simple) {
    const r = await get(path)
    const b = await r.json()
    bodies[model] = b
    const expected = await prisma[model].count({ where: { tenant_id: tid } })
    t.ok(`GET ${path} -> 200`, r.status === 200, r.status)
    t.ok(`  returns all ${expected} tenant rows (no pagination on these routes)`, Array.isArray(b) && b.length === expected, Array.isArray(b) ? b.length : b)
    t.ok('  every row belongs to the session tenant', Array.isArray(b) && b.every(x => x.tenant_id === tid), 'mixed tenant_id!')
    t.ok('  sorted by name ascending', Array.isArray(b) && isSortedByName(b), 'not sorted')
  }

  // -- §5.2 cardinality, one level at a time --------------------------------
  t.section('§5.2 embed cardinality through the location hierarchy')
  const levels = [
    ['districts', 'states'],
    ['talukas', 'districts'],
    ['villages', 'talukas'],
    ['product_subcategories', 'product_categories'],
  ]
  for (const [child, parent] of levels) {
    const rows = bodies[child]
    const withParent = Array.isArray(rows) ? rows.filter(r => r[parent] != null) : []
    if (!withParent.length) { t.skip(`${child}.${parent} cardinality`, `no ${child} rows with a ${parent}`); continue }
    t.ok(`${child}.${parent} is an OBJECT, never an array`, withParent.every(r => !Array.isArray(r[parent]) && typeof r[parent] === 'object'), withParent[0][parent])
    t.ok(`${child}.${parent}.name is a string`, withParent.every(r => typeof r[parent].name === 'string'), withParent[0][parent])
  }
  const prods = bodies.products
  if (Array.isArray(prods) && prods.length) {
    t.ok('products.product_categories is an OBJECT', prods.filter(p => p.product_categories).every(p => !Array.isArray(p.product_categories)), prods[0].product_categories)
    t.ok('products.product_subcategories is an OBJECT', prods.filter(p => p.product_subcategories).every(p => !Array.isArray(p.product_subcategories)), prods[0].product_subcategories)
  }

  // Cross-check one embed against the database rather than against itself.
  const dist = Array.isArray(bodies.districts) ? bodies.districts.find(d => d.states) : null
  if (dist) {
    const parent = await prisma.states.findUnique({ where: { id: dist.state_id }, select: { name: true, tenant_id: true } })
    t.ok('districts.states.name matches the states row in the DB', dist.states.name === parent?.name, `${dist.states.name} vs ${parent?.name}`)
    t.ok('the embedded parent is in the same tenant', parent?.tenant_id === tid, parent?.tenant_id)
  }

  // -- §5.1 numerics and dates ----------------------------------------------
  t.section('§5.1 NUMERIC columns arrive as numbers, not Decimal strings')
  if (Array.isArray(prods) && prods.length) {
    const priced = prods.filter(p => p.price !== null)
    t.ok(`products.price is a number (${priced.length} priced rows)`, priced.every(p => typeof p.price === 'number'), priced[0]?.price)
    const dbProd = await prisma.products.findUnique({ where: { id: prods[0].id }, select: { price: true } })
    t.ok('products.price value matches the DB exactly', Number(dbProd.price) === prods[0].price, `${prods[0].price} vs ${String(dbProd.price)}`)
    t.ok('products.created_at is a full ISO string', prods.every(p => p.created_at == null || /^\d{4}-\d{2}-\d{2}T.*Z$/.test(p.created_at)), prods[0].created_at)
  } else t.skip('products numeric checks', 'no product rows in this tenant')

  // -- distributors & dealers (business_partners) ---------------------------
  t.section('distributors & dealers — both over business_partners')
  for (const [path, type, attached] of [
    ['/api/masters/distributors', 'Distributor', 'dealers'],
    ['/api/masters/dealers', 'Dealer', 'distributors'],
  ]) {
    const r = await get(path)
    const b = await r.json()
    const expected = await prisma.companies.count({ where: { tenant_id: tid, type, stage: 'Existing' } })
    t.ok(`GET ${path} -> 200`, r.status === 200, r.status)
    t.ok(`  returns all ${expected} ${type} rows`, Array.isArray(b) && b.length === expected, Array.isArray(b) ? b.length : b)
    if (!Array.isArray(b) || !b.length) { t.skip(`${path} row-shape checks`, `no ${type} rows in this tenant`); continue }
    t.ok('  every row belongs to the session tenant', b.every(x => x.tenant_id === tid))
    t.ok(`  every row is type=${type}`, b.every(x => x.type === type))
    t.ok('  latitude/longitude are numbers or null (not Decimal strings)', b.every(x => (x.latitude === null || typeof x.latitude === 'number') && (x.longitude === null || typeof x.longitude === 'number')), { lat: b[0].latitude, lon: b[0].longitude })
    t.ok('  next_follow_up_date is date-only or null', b.every(x => x.next_follow_up_date === null || /^\d{4}-\d{2}-\d{2}$/.test(x.next_follow_up_date)), b[0].next_follow_up_date)
    t.ok('  states/districts/talukas/villages embeds are objects or null', b.every(x => ['states', 'districts', 'talukas', 'villages'].every(k => x[k] === null || (typeof x[k] === 'object' && !Array.isArray(x[k])))))
    if (attached === 'dealers') {
      t.ok('  attached `dealers` is an ARRAY on every row', b.every(x => Array.isArray(x.dealers)), typeof b[0].dealers)
      const withDealers = b.find(x => x.dealers.length)
      if (withDealers) {
        const expectedDealers = await prisma.companies.count({ where: { tenant_id: tid, type: 'Dealer', distributor_id: withDealers.id } })
        t.ok('  dealer count per distributor matches the DB', withDealers.dealers.length === expectedDealers, `${withDealers.dealers.length} vs ${expectedDealers}`)
      } else t.skip('distributor->dealers count', 'no distributor in this tenant has dealers')
    } else {
      t.ok('  attached `distributors` is an OBJECT or null, never an array', b.every(x => x.distributors === null || (typeof x.distributors === 'object' && !Array.isArray(x.distributors))), b[0].distributors)
    }
  }

  // -- filters and search ---------------------------------------------------
  t.section('query filters')
  const anyState = await prisma.states.findFirst({ where: { tenant_id: tid }, select: { id: true, name: true } })
  if (anyState) {
    const r = await get(`/api/masters/districts?stateId=${anyState.id}`)
    const b = await r.json()
    const expected = await prisma.districts.count({ where: { tenant_id: tid, state_id: anyState.id } })
    t.ok(`?stateId= filters districts (${expected} expected)`, Array.isArray(b) && b.length === expected, Array.isArray(b) ? b.length : b)
    t.ok('  every returned district has that state_id', Array.isArray(b) && b.every(d => d.state_id === anyState.id))

    const term = anyState.name.slice(0, 3)
    const rs = await get(`/api/masters/states?q=${encodeURIComponent(term.toLowerCase())}`)
    const bs = await rs.json()
    const expectedQ = await prisma.states.count({ where: { tenant_id: tid, name: { contains: term, mode: 'insensitive' } } })
    t.ok(`?q= is case-insensitive, like .ilike() ("${term.toLowerCase()}" -> ${expectedQ})`, Array.isArray(bs) && bs.length === expectedQ, Array.isArray(bs) ? bs.length : bs)
  } else t.skip('filter checks', 'no states in this tenant')

  t.section('permission gating')
  const noRole = await mintSession({ phone: admin.contact, userId: admin.id, name: admin.name, role: 'NoRole', tenantId: tid, cv: admin.credentials_version ?? 1 })
  // NB: requireUser() re-resolves the role from the DB, so this user stays an
  // Administrator. The assertion is that the forged role does NOT downgrade it.
  t.ok('forged NoRole cookie does not bypass the DB role lookup', (await req('/api/masters/products', { token: noRole })).status === 200)

  t.section('routes not exercised')
  t.skip('POST /api/masters/{states,districts,talukas,villages,product-categories,product-subcategories,products,distributors,dealers}', 'creating rows would add real master data to a production tenant. 9 POST handlers unexercised.')
  t.skip('PUT /api/masters/*/[id]', 'would mutate real master rows. 9 PUT handlers unexercised — including the extendedWhereUnique tenant guard and the business_partners `type` guard.')
  t.skip('DELETE /api/masters/*/[id]', 'would delete real master rows, and several are referenced by FKs. 9 DELETE handlers unexercised — including the deleteMany-vs-delete no-match behaviour.')

  return t.result()
}

function isSortedByName(rows) {
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i - 1].name ?? '').localeCompare(String(rows[i].name ?? '')) > 0) return false
  }
  return true
}
