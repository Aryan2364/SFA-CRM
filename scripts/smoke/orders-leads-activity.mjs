/**
 * Batch 4 — orders, leads, business-partners, daily-activity, attendance and
 * the three non-storage expenses routes. 17 routes, READ paths against live.
 *
 * expenses/upload is NOT here: it is the only Supabase Storage call site in the
 * codebase and stays on Supabase until Phase B has R2 credentials.
 */
import { db, mintSession, req, ctx } from './lib.mjs'

export const name = 'orders-leads-activity'

export async function run() {
  const t = ctx()
  const prisma = db()

  const viewerRow = await prisma.user_visibility.findFirst({ select: { viewer_user_id: true } })
  const admin = await prisma.users.findFirst({
    where: viewerRow ? { id: viewerRow.viewer_user_id } : { profile: 'Administrator', status: 'Active' },
    select: { id: true, name: true, contact: true, tenant_id: true, credentials_version: true },
  })
  if (!admin) { t.skip('all Batch 4 routes', 'no usable user'); return t.result() }
  const tid = admin.tenant_id
  const token = await mintSession({
    phone: admin.contact, userId: admin.id, name: admin.name,
    role: 'Administrator', tenantId: tid, cv: admin.credentials_version ?? 1,
  })
  const get = p => req(p, { token })

  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
  const ISO = /^\d{4}-\d{2}-\d{2}T.*Z$/

  // ---- orders: the trickiest embeds in the codebase -------------------------
  t.section('orders list — order_items(count) + the FK-hint embed')
  const or = await get('/api/orders')
  const ob = await or.json()
  t.ok('-> 200', or.status === 200, or.status)
  t.ok('returns an array', Array.isArray(ob))
  if (ob.length) {
    t.ok('tenant-pure', ob.every(o => o.tenant_id === tid))
    t.ok('order_date is DATE-ONLY', ob.every(o => DATE_ONLY.test(o.order_date)), ob[0].order_date)
    t.ok('created_at is a full ISO timestamp', ob.every(o => ISO.test(o.created_at)))
    t.ok('total_amount is a NUMBER, not a Decimal string', ob.every(o => typeof o.total_amount === 'number'), ob[0].total_amount)
    t.ok('FK-hint embed is exposed as `users`', ob.every(o => 'users' in o))
    t.ok('users embed is an OBJECT or null, never an array', ob.every(o => o.users === null || (typeof o.users === 'object' && !Array.isArray(o.users))), ob[0].users)
    // The nested count is the one embed whose JSON shape differs between
    // PostgREST and Prisma, so check the SHAPE and the VALUE separately.
    t.ok('order_items is the PostgREST count shape: [{ count: N }]',
      ob.every(o => Array.isArray(o.order_items) && o.order_items.length === 1 && typeof o.order_items[0].count === 'number'),
      ob[0].order_items)
    let countMismatch = 0
    for (const o of ob.slice(0, 25)) {
      const real = await prisma.order_items.count({ where: { order_id: o.id } })
      if (o.order_items[0].count !== real) countMismatch++
    }
    t.ok(`nested count matches a direct COUNT (${Math.min(ob.length, 25)} orders checked)`, countMismatch === 0, `${countMismatch} mismatch(es)`)
    t.ok('ordered by order_date DESC', ob.every((o, i) => i === 0 || ob[i - 1].order_date >= o.order_date))
  } else t.skip('orders row shapes', 'no orders visible to this user')

  t.section('orders filters')
  const anyOrder = await prisma.orders.findFirst({ where: { tenant_id: tid }, select: { id: true, status: true, order_date: true, user_id: true, visit_id: true } })
  if (anyOrder) {
    const sb = await (await get(`/api/orders?status=${encodeURIComponent(anyOrder.status)}`)).json()
    t.ok('?status= filters', Array.isArray(sb) && sb.every(o => o.status === anyOrder.status))
    const d = anyOrder.order_date.toISOString().slice(0, 10)
    const db2 = await (await get(`/api/orders?dateFrom=${d}&dateTo=${d}`)).json()
    t.ok('?dateFrom/?dateTo filter on a DATE column', Array.isArray(db2) && db2.every(o => o.order_date === d), db2[0]?.order_date)

    t.section('orders single-order mode (?visitId=)')
    if (anyOrder.visit_id) {
      const vr = await get(`/api/orders?visitId=${anyOrder.visit_id}`)
      const vb = await vr.json()
      t.ok('-> 200 with the order', vr.status === 200 && vb?.id === anyOrder.id, { status: vr.status, id: vb?.id })
      t.ok('order_items is the FULL row array here, not a count', Array.isArray(vb.order_items) && (vb.order_items.length === 0 || 'product_name' in vb.order_items[0]), vb.order_items[0])
      t.ok('nested rate/amount are numbers', vb.order_items.every(i => typeof i.rate === 'number' && typeof i.amount === 'number'))
    } else t.skip('orders ?visitId=', 'no order with a visit_id')
    const missing = await get('/api/orders?visitId=00000000-0000-4000-8000-0000000000ff')
    t.ok('?visitId= with no match -> null (PGRST116 branch)', missing.status === 200 && (await missing.json()) === null)

    t.section('GET /api/orders/[id]')
    const dr = await get(`/api/orders/${anyOrder.id}`)
    const dbo = await dr.json()
    if (dr.status === 200) {
      t.ok('order_items is a full array', Array.isArray(dbo.order_items))
      t.ok('users embed is an object or null', dbo.users === null || !Array.isArray(dbo.users))
      t.ok('total_amount is a number', typeof dbo.total_amount === 'number')
    } else t.ok('-> 404 when the order is outside the caller\'s visibility', dr.status === 404, dr.status)
    t.ok('an unknown order id -> 404', (await get('/api/orders/00000000-0000-4000-8000-0000000000ff')).status === 404)
  } else t.skip('orders filters and detail', 'no orders in this tenant')

  t.section('GET /api/orders/team')
  const tr = await get('/api/orders/team')
  const tb = await tr.json()
  t.ok('-> 200 array', tr.status === 200 && Array.isArray(tb), tr.status)
  t.ok('includes the caller', tb.some(u => u.id === admin.id))
  t.ok('exposes only id and name', tb.every(u => Object.keys(u).sort().join(',') === 'id,name'))

  // ---- leads / business-partners -------------------------------------------
  t.section('leads')
  const lr = await get('/api/leads')
  const lb = await lr.json()
  const leadCount = await prisma.business_partners.count({ where: { tenant_id: tid } })
  t.ok(`-> 200 with all ${leadCount} partners`, lr.status === 200 && lb.length === leadCount, { status: lr.status, got: lb.length })
  if (lb.length) {
    t.ok('ALIASED embed is exposed as `created_by`, not the relation name',
      lb.every(l => 'created_by' in l && !('users' in l)), Object.keys(lb[0]).filter(k => k === 'users' || k === 'created_by'))
    t.ok('created_by is an OBJECT or null, never an array', lb.every(l => l.created_by === null || (typeof l.created_by === 'object' && !Array.isArray(l.created_by))), lb.find(l => l.created_by)?.created_by)
    t.ok('districts/talukas/villages embeds are objects or null',
      lb.every(l => ['districts', 'talukas', 'villages'].every(k => l[k] === null || (typeof l[k] === 'object' && !Array.isArray(l[k])))))
    t.ok('latitude/longitude are numbers or null', lb.every(l => (l.latitude === null || typeof l.latitude === 'number') && (l.longitude === null || typeof l.longitude === 'number')))
    t.ok('next_follow_up_date is DATE-ONLY or null', lb.every(l => l.next_follow_up_date === null || DATE_ONLY.test(l.next_follow_up_date)), lb[0].next_follow_up_date)
    const someType = lb[0].type
    const tb2 = await (await get(`/api/leads?type=${encodeURIComponent(someType)}`)).json()
    const expType = await prisma.business_partners.count({ where: { tenant_id: tid, type: someType } })
    t.ok(`?type= filters exactly (${expType})`, tb2.length === expType, tb2.length)
  }

  t.section('business-partners lookup (.neq preserved)')
  const bpe = await get('/api/business-partners?status=existing')
  const bpeb = await bpe.json()
  const expExisting = await prisma.business_partners.count({ where: { tenant_id: tid, is_active: true, stage: 'Existing' } })
  t.ok(`status=existing -> ${expExisting}`, bpe.status === 200 && bpeb.length === expExisting, { status: bpe.status, got: bpeb.length })
  const bpl = await get('/api/business-partners?status=lead')
  const bplb = await bpl.json()
  const expLead = await prisma.business_partners.count({ where: { tenant_id: tid, is_active: true, stage: { not: 'Existing' } } })
  t.ok(`status=lead -> ${expLead} (the .neq branch)`, bpl.status === 200 && bplb.length === expLead, { status: bpl.status, got: bplb.length })
  t.ok('the two branches are disjoint', !bpeb.some(a => bplb.some(b => b.id === a.id)))

  t.section('leads/bulk-template generates a workbook')
  const bt = await get('/api/leads/bulk-template')
  t.ok('-> 200', bt.status === 200, bt.status)
  const buf = Buffer.from(await bt.arrayBuffer())
  t.ok('body is a real XLSX (PK zip magic)', buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b, { len: buf.length, magic: buf.slice(0, 2) })

  // ---- daily-activity -------------------------------------------------------
  t.section('daily-activity')
  const visit = await prisma.daily_visits.findFirst({ where: { tenant_id: tid, user_id: admin.id }, select: { visit_date: true } })
  if (visit) {
    const d = visit.visit_date.toISOString().slice(0, 10)
    const dr2 = await get(`/api/daily-activity?date=${d}`)
    const db3 = await dr2.json()
    const exp = await prisma.daily_visits.count({ where: { tenant_id: tid, user_id: admin.id, visit_date: visit.visit_date } })
    t.ok(`-> 200 with all ${exp} visits for that date`, dr2.status === 200 && db3.length === exp, { status: dr2.status, got: db3.length })
    t.ok('visit_date is DATE-ONLY', db3.every(v => DATE_ONLY.test(v.visit_date)), db3[0]?.visit_date)
    t.ok('start_time is ISO or null — .slice(0,10) works on it', db3.every(v => v.start_time === null || ISO.test(v.start_time)), db3[0]?.start_time)
    t.ok('latitude/longitude are numbers or null', db3.every(v => (v.latitude === null || typeof v.latitude === 'number')))
  } else t.skip('daily-activity list', 'this user has no visits')

  t.section('daily-activity/calendar — the filledDates Set')
  const anyVisit = await prisma.daily_visits.findFirst({ where: { tenant_id: tid }, select: { user_id: true, visit_date: true } })
  if (anyVisit) {
    const month = anyVisit.visit_date.toISOString().slice(0, 7)
    const cr = await get(`/api/daily-activity/calendar?month=${month}&userId=${anyVisit.user_id}`)
    const cb = await cr.json()
    t.ok('-> 200', cr.status === 200, cr.status)
    t.ok('filledDates are DATE-ONLY strings, not ISO timestamps',
      Array.isArray(cb.filledDates) && cb.filledDates.every(d => DATE_ONLY.test(d)), cb.filledDates?.slice(0, 3))
    const realDays = new Set((await prisma.daily_visits.findMany({
      where: { tenant_id: tid, user_id: anyVisit.user_id, visit_date: { gte: new Date(`${month}-01`) } },
      select: { visit_date: true },
    })).filter(v => v.visit_date.toISOString().slice(0, 7) === month).map(v => v.visit_date.toISOString().slice(0, 10)))
    t.ok(`deduplicated to ${realDays.size} distinct days — a Date-keyed Set would not dedupe`,
      cb.filledDates.length === realDays.size, { got: cb.filledDates.length, expected: realDays.size })
    t.ok('every returned day exists in the database', cb.filledDates.every(d => realDays.has(d)))
  } else t.skip('daily-activity calendar', 'no visits in this tenant')

  // ---- attendance -----------------------------------------------------------
  t.section('attendance')
  const att = await prisma.attendance.findFirst({ where: { tenant_id: tid }, select: { user_id: true, date: true } })
  const ar = await get('/api/attendance')
  t.ok('-> 200 (null or a row)', ar.status === 200, ar.status)
  if (att) {
    const attToken = await mintSession({ phone: admin.contact, userId: att.user_id, name: admin.name, role: 'Administrator', tenantId: tid, cv: 1 })
    const d = att.date.toISOString().slice(0, 10)
    const ar2 = await req(`/api/attendance?date=${d}`, { token: attToken })
    const ab = await ar2.json()
    t.ok('a real attendance row is returned', ar2.status === 200 && ab !== null, { status: ar2.status, ab })
    t.ok('date is DATE-ONLY', DATE_ONLY.test(ab.date), ab.date)
    t.ok('check_in_time is ISO or null', ab.check_in_time === null || ISO.test(ab.check_in_time), ab.check_in_time)
    t.ok('check_in_latitude is a number or null', ab.check_in_latitude === null || typeof ab.check_in_latitude === 'number')
  } else t.skip('attendance row shape', 'no attendance rows in this tenant')
  const arNone = await get('/api/attendance?date=2019-01-01')
  t.ok('a date with no attendance -> null', arNone.status === 200 && (await arNone.json()) === null)

  // ---- expenses -------------------------------------------------------------
  t.section('expenses')
  const exp = await prisma.expenses.findFirst({ where: { tenant_id: tid, user_id: admin.id }, select: { expense_date: true } })
  if (exp) {
    const d = exp.expense_date.toISOString().slice(0, 10)
    const er = await get(`/api/expenses?date=${d}`)
    const eb = await er.json()
    const expCount = await prisma.expenses.count({ where: { tenant_id: tid, user_id: admin.id, expense_date: exp.expense_date } })
    t.ok(`-> 200 with all ${expCount} expenses`, er.status === 200 && eb.length === expCount, { status: er.status, got: eb.length })
    t.ok('amount is a NUMBER, not a Decimal string', eb.every(x => typeof x.amount === 'number'), eb[0]?.amount)
    t.ok('expense_date is DATE-ONLY', eb.every(x => DATE_ONLY.test(x.expense_date)), eb[0]?.expense_date)
    t.ok('created_at is a full ISO timestamp', eb.every(x => ISO.test(x.created_at)))
  } else t.skip('expenses list', 'this user has no expenses')

  t.section('expenses/calendar')
  const anyExp = await prisma.expenses.findFirst({ where: { tenant_id: tid }, select: { user_id: true, expense_date: true } })
  if (anyExp) {
    const month = anyExp.expense_date.toISOString().slice(0, 7)
    const ecr = await get(`/api/expenses/calendar?month=${month}&userId=${anyExp.user_id}`)
    const ecb = await ecr.json()
    t.ok('-> 200 with DATE-ONLY filledDates', ecr.status === 200 && ecb.filledDates.every(d => DATE_ONLY.test(d)), ecb.filledDates?.slice(0, 3))
  } else t.skip('expenses calendar', 'no expenses in this tenant')

  t.section('routes not exercised against live')
  t.skip('POST /api/orders (both flows), PATCH /api/orders/[id]', 'creates real orders and order_items, and the meeting flow upserts on visit_id. Covered on the scratch database.')
  t.skip('POST /api/leads, PUT+DELETE /api/leads/[id], POST /api/leads/bulk-import', 'create, edit and delete real business_partners rows for a production tenant.')
  t.skip('POST /api/daily-activity, PATCH /api/daily-activity/[id] (start/stop/delete/update_notes)', 'create and mutate real meeting records, and start/stop auto-completes stale visits.')
  t.skip('POST /api/attendance/check-in and check-out', 'write real attendance rows and award points to real users.')
  t.skip('POST /api/expenses, DELETE /api/expenses/[id]', 'create and delete real expense records.')
  t.skip('POST /api/expenses/upload', 'STILL ON SUPABASE — the only Supabase Storage call site in the codebase, waiting on R2 credentials for Phase B. Not converted, not exercised.')

  return t.result()
}
