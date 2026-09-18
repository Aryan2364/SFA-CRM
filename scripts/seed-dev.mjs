#!/usr/bin/env node
/**
 * Seeds a browsable DEMO tenant into the LOCAL database, so `npm run dev:local`
 * has something to show without ever touching Supabase.
 *
 * This is NOT the write-path fixture — that is scripts/seed-scratch.mjs, whose
 * two tenants and fixed ids the test suites assert against. This script owns one
 * separate tenant (DEV.tenant) and only ever wipes that one, so the two can live
 * in the same database without stepping on each other.
 *
 * Points at SCRATCH_DATABASE_URL and refuses any non-local host: everything here
 * is destructive.
 *
 * Run via `npm run dev:seed`.
 */
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

function readEnv(key) {
  if (process.env[key]) return process.env[key]
  if (!fs.existsSync('.env.local')) return undefined
  const m = fs.readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
}

const raw = readEnv('SCRATCH_DATABASE_URL')
if (!raw) {
  console.error('SCRATCH_DATABASE_URL is not set (env or .env.local).')
  process.exit(1)
}

// Hard guard: this script deletes rows. It must never see a hosted database.
const host = new URL(raw).hostname
const LOCAL = new Set(['localhost', '127.0.0.1', '::1'])
if (!LOCAL.has(host)) {
  console.error(`REFUSING TO RUN: SCRATCH_DATABASE_URL points at "${host}", not a local host.`)
  process.exit(1)
}
const live = readEnv('DATABASE_URL')
if (live && live.trim() === raw.trim()) {
  console.error('REFUSING TO RUN: SCRATCH_DATABASE_URL is identical to DATABASE_URL.')
  process.exit(1)
}

const url = new URL(raw)
url.searchParams.delete('sslmode')
url.searchParams.delete('connection_limit')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 5 }) })

// Fixed ids so a re-seed is idempotent and so the login phones below always map
// to the same rows. 0000000d = "dev", distinct from seed-scratch's a/b tenants.
const DEV = {
  tenant:  '0000000d-0000-4000-8000-000000000001',
  admin:   '0000000d-0000-4000-8000-000000000101',
  manager: '0000000d-0000-4000-8000-000000000102',
  rep1:    '0000000d-0000-4000-8000-000000000103',
  rep2:    '0000000d-0000-4000-8000-000000000104',
  rep3:    '0000000d-0000-4000-8000-000000000105',
}
const PASSWORD = 'dev1234'

const T = DEV.tenant
const tid = { tenant_id: T }

// ── helpers ────────────────────────────────────────────────────────────────
// Deterministic pseudo-randomness: the same seed always produces the same data,
// which is what makes a re-seed comparable to the run before it.
let _s = 42
const rnd = () => (_s = (_s * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = arr => arr[Math.floor(rnd() * arr.length)]
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))

const TODAY = new Date()
/** A @db.Date value N days from today. Built from UTC parts so it cannot drift. */
const dayOffset = n => {
  const d = new Date(Date.UTC(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate()))
  d.setUTCDate(d.getUTCDate() + n)
  return d
}
/** A timestamptz roughly at hour:min IST on the date N days from today. */
const at = (n, hour, min = 0) => {
  const d = dayOffset(n)
  d.setUTCHours(hour, min, 0, 0)
  d.setUTCMinutes(d.getUTCMinutes() - 330)
  return d
}
/** The Monday of the week containing the date N days from today. */
const monday = n => {
  const d = dayOffset(n)
  const dow = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - (dow - 1))
  return d
}

async function main() {
  console.log(`Seeding DEMO tenant ${T} at ${host} …`)

  // ── wipe: this tenant only, children before parents ──────────────────────
  const order = [
    'remark_reads', 'contextual_remarks',
    'point_events', 'point_config_history', 'point_config', 'tenant_point_settings',
    'weekly_plan_audit_logs', 'weekly_plan_items', 'weekly_plans',
    'notifications', 'user_visibility',
    'custom_field_values', 'custom_field_defs',
    'order_items', 'orders', 'daily_visits', 'attendance', 'expenses',
    'company_addresses', 'company_contacts', 'contacts', 'contact_types',
    'expense_categories', 'lead_types', 'lead_stages', 'lead_temperatures',
    'products', 'product_subcategories', 'product_categories',
    'business_partners', 'industries', 'user_territory_mappings',
    'villages', 'talukas', 'districts', 'states',
    'users', 'designations', 'departments', 'roles', 'role_permissions',
  ]
  for (const table of order) {
    if (!prisma[table]) continue
    await prisma[table].deleteMany({ where: tid })
  }
  await prisma.tenants.deleteMany({ where: { id: T } })

  // ── tenant ───────────────────────────────────────────────────────────────
  await prisma.tenants.create({
    data: {
      id: T, name: 'Demo Agro Industries (LOCAL)', email: 'demo@example.invalid',
      phone: '9000000100', address: 'Plot 14, MIDC, Pune, Maharashtra',
      gstin: '27AAAAA0000A1Z5', license_count: 25, payment_status: 'Active', is_active: true,
    },
  })

  // ── org: departments, designations, roles, permissions ───────────────────
  const depts = {}
  for (const name of ['Sales', 'Marketing', 'Operations']) {
    depts[name] = await prisma.departments.create({ data: { ...tid, name } })
  }
  const desig = {}
  for (const [name, dept] of [
    ['National Sales Head', 'Sales'], ['Regional Manager', 'Sales'],
    ['Territory Executive', 'Sales'], ['Marketing Executive', 'Marketing'],
    ['Dispatch Officer', 'Operations'],
  ]) {
    desig[name] = await prisma.designations.create({ data: { ...tid, name, department_id: depts[dept].id } })
  }

  // The 25 sections role_permissions accepts (src/lib/masters-registry.ts,
  // ALL_SECTIONS). `leaderboard`/`points_config` are absent from the live CHECK
  // constraint and are deliberately not seeded.
  const MASTER_SECTIONS = [
    'states', 'districts', 'talukas', 'villages', 'territory_mapping',
    'dealers', 'distributors', 'institutions',
    'product_categories', 'product_subcategories', 'products',
    'departments', 'designations', 'expense_categories',
    'lead_types', 'lead_stages', 'lead_temperatures', 'contact_types', 'industries',
  ]
  const OPERATION_SECTIONS = ['meetings', 'expenses', 'weekly_plan', 'orders', 'leads', 'users']

  const roleManager = await prisma.roles.create({ data: { ...tid, name: 'Sales Manager', is_system: false } })
  const roleExec = await prisma.roles.create({ data: { ...tid, name: 'Sales Executive', is_system: false } })

  // Manager: everything, team scope. Executive: read-only masters, own data.
  await prisma.role_permissions.createMany({
    data: [
      ...MASTER_SECTIONS.map(section => ({
        ...tid, profile: 'Sales Manager', section,
        can_view: true, can_create: true, can_edit: true, can_delete: false, data_scope: 'all',
      })),
      ...OPERATION_SECTIONS.map(section => ({
        ...tid, profile: 'Sales Manager', section,
        can_view: true, can_create: true, can_edit: true, can_delete: false, data_scope: 'team',
      })),
      ...MASTER_SECTIONS.map(section => ({
        ...tid, profile: 'Sales Executive', section,
        can_view: true, can_create: false, can_edit: false, can_delete: false, data_scope: 'all',
      })),
      ...OPERATION_SECTIONS.map(section => ({
        ...tid, profile: 'Sales Executive', section,
        can_view: true, can_create: section !== 'users', can_edit: section !== 'users',
        can_delete: false, data_scope: 'own',
      })),
    ],
  })

  // ── users ────────────────────────────────────────────────────────────────
  const password = await bcrypt.hash(PASSWORD, 10)
  const mkUser = data => prisma.users.create({
    data: { ...tid, password, status: 'Active', ...data },
  })
  await mkUser({
    id: DEV.admin, name: 'Ravi Deshmukh', email: 'ravi@example.invalid', contact: '9000000100',
    profile: 'Administrator', department_id: depts.Sales.id, designation_id: desig['National Sales Head'].id,
  })
  await mkUser({
    id: DEV.manager, name: 'Priya Nair', email: 'priya@example.invalid', contact: '9000000101',
    profile: 'Standard', role_id: roleManager.id, manager_user_id: DEV.admin,
    department_id: depts.Sales.id, designation_id: desig['Regional Manager'].id,
  })
  const repSpec = [
    [DEV.rep1, 'Amit Kulkarni', 'amit', '9000000102'],
    [DEV.rep2, 'Sunita Patil', 'sunita', '9000000103'],
    [DEV.rep3, 'Imran Shaikh', 'imran', '9000000104'],
  ]
  for (const [id, name, mail, contact] of repSpec) {
    await mkUser({
      id, name, email: `${mail}@example.invalid`, contact,
      profile: 'Standard', role_id: roleExec.id, manager_user_id: DEV.manager,
      department_id: depts.Sales.id, designation_id: desig['Territory Executive'].id,
    })
  }
  const reps = [DEV.rep1, DEV.rep2, DEV.rep3]

  // canView() reads user_visibility on every manager-side transition: the
  // manager must see all three reps, and the admin must see everyone.
  await prisma.user_visibility.createMany({
    data: [
      ...reps.map(r => ({ ...tid, viewer_user_id: DEV.manager, target_user_id: r })),
      ...[DEV.manager, ...reps].map(t => ({ ...tid, viewer_user_id: DEV.admin, target_user_id: t })),
    ],
  })

  // ── locations: states → districts → talukas → villages ───────────────────
  const geo = {
    Maharashtra: {
      Pune: { Haveli: ['Wagholi', 'Lonikand'], Baramati: ['Malegaon', 'Supe'] },
      Nashik: { Niphad: ['Pimpalgaon', 'Ozar'], Sinnar: ['Dodi', 'Shah'] },
    },
    Gujarat: {
      Ahmedabad: { Daskroi: ['Bopal', 'Sanand'], Dholka: ['Koth', 'Badarkha'] },
    },
    Karnataka: {
      Belagavi: { Bailhongal: ['Neginhal', 'Tigadi'], Gokak: ['Mudalgi', 'Konnur'] },
    },
  }
  const villages = []
  const districtPairs = []
  for (const [stateName, dists] of Object.entries(geo)) {
    const state = await prisma.states.create({ data: { ...tid, name: stateName } })
    for (const [distName, taluks] of Object.entries(dists)) {
      const district = await prisma.districts.create({ data: { ...tid, name: distName, state_id: state.id } })
      districtPairs.push({ state: state.id, district: district.id })
      for (const [talName, vills] of Object.entries(taluks)) {
        const taluka = await prisma.talukas.create({ data: { ...tid, name: talName, district_id: district.id } })
        for (const vName of vills) {
          const village = await prisma.villages.create({ data: { ...tid, name: vName, taluka_id: taluka.id } })
          villages.push({ state: state.id, district: district.id, taluka: taluka.id, village: village.id, name: vName })
        }
      }
    }
  }

  // Each rep owns a slice of the districts, with the talukas/villages beneath.
  for (let i = 0; i < reps.length; i++) {
    const mine = districtPairs.filter((_, idx) => idx % reps.length === i)
    const below = villages.filter(v => mine.some(m => m.district === v.district))
    await prisma.user_territory_mappings.create({
      data: {
        ...tid, user_id: reps[i],
        state_ids: [...new Set(mine.map(m => m.state))],
        district_ids: mine.map(m => m.district),
        taluka_ids: [...new Set(below.map(v => v.taluka))],
        village_ids: below.map(v => v.village),
      },
    })
  }

  // ── products ─────────────────────────────────────────────────────────────
  const catalogue = {
    Seeds: {
      'Hybrid Cotton': [['Sunrise BT-9', 1250], ['Sunrise BT-12', 1480]],
      'Vegetable Seeds': [['Tomato Rakshak', 640], ['Okra Sadabahar', 390]],
    },
    Fertilizers: {
      'Water Soluble': [['NPK 19:19:19 (1kg)', 210], ['Calcium Nitrate (5kg)', 780]],
      Organic: [['Vermicompost (20kg)', 320], ['Neem Cake (10kg)', 260]],
    },
    'Crop Protection': {
      Insecticides: [['Imidaclear 17.8 SL', 545], ['Lambda Shield 5 EC', 430]],
      Fungicides: [['Mancozeb 75 WP', 385], ['Copper Guard 50 WP', 470]],
    },
  }
  const products = []
  let sku = 1000
  for (const [catName, subs] of Object.entries(catalogue)) {
    const cat = await prisma.product_categories.create({ data: { ...tid, name: catName } })
    for (const [subName, items] of Object.entries(subs)) {
      const sub = await prisma.product_subcategories.create({ data: { ...tid, name: subName, category_id: cat.id } })
      for (const [name, price] of items) {
        products.push(await prisma.products.create({
          data: { ...tid, name, category_id: cat.id, subcategory_id: sub.id, price, sku: `SKU-${++sku}` },
        }))
      }
    }
  }

  // ── list masters ─────────────────────────────────────────────────────────
  const listRows = (model, names) => prisma[model].createMany({
    data: names.map((name, i) => ({ ...tid, name, sort_order: i + 1, is_active: true })),
  })
  await listRows('expense_categories', ['Travel', 'Fuel', 'Food', 'Lodging', 'Mobile & Internet', 'Miscellaneous'])
  await listRows('lead_types', ['Dealer', 'Distributor', 'Institution'])
  await prisma.deal_stages.createMany({
    data: ['Prospect', 'Contacted', 'Demo Given', 'Negotiation', 'Won', 'Lost']
      .map((name, i) => ({ ...tid, name, sort_order: i + 1, is_fixed: i === 0, is_active: true })),
  })
  await listRows('lead_temperatures', ['Hot', 'Warm', 'Cold'])
  await listRows('contact_types', ['Owner', 'Purchase Manager', 'Accountant', 'Agronomist'])
  await listRows('industries', ['Agri Retail', 'Cooperative Society', 'Institutional Buyer', 'Contract Farming'])

  const contactTypes = await prisma.contact_types.findMany({ where: tid })
  const industries = await prisma.industries.findMany({ where: tid })
  const expenseCats = await prisma.expense_categories.findMany({ where: tid })

  // ── business partners: distributors → dealers, institutions, leads ───────
  const mkPartner = (type, name, extra = {}) => {
    const loc = pick(villages)
    return prisma.companies.create({
      data: {
        ...tid, type, name, stage: 'Existing',
        mobile_1: `98${int(10000000, 99999999)}`,
        contact_person_name: `${pick(['Sanjay', 'Meera', 'Kiran', 'Farhan', 'Deepa'])} ${pick(['Shah', 'Rao', 'Jadhav', 'Menon'])}`,
        address: `${int(1, 90)}, Market Road, ${loc.name}`,
        state_id: loc.state, district_id: loc.district, taluka_id: loc.taluka, village_id: loc.village,
        pincode: String(int(411000, 425999)),
        gst_number: `27AAB${int(1000, 9999)}C1Z${int(1, 9)}`,
        email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.invalid`,
        industry_id: pick(industries).id,
        owner_user_id: pick(reps), created_by_user_id: DEV.admin,
        is_active: true,
        ...extra,
      },
    })
  }

  const distributors = []
  for (const name of ['Shree Krishna Agencies', 'Godavari Agro Distributors', 'Sardar Krishi Kendra', 'Malnad Agri Supplies']) {
    distributors.push(await mkPartner('Distributor', name))
  }
  const dealers = []
  for (const name of ['Balaji Krushi Seva Kendra', 'Ganesh Beej Bhandar', 'Jai Kisan Agro Centre',
    'Patil Agri Store', 'Sai Krupa Traders', 'Navjeevan Seeds', 'Annapurna Agro Mart',
    'Vishwas Krushi Kendra']) {
    dealers.push(await mkPartner('Dealer', name, { distributor_id: pick(distributors).id }))
  }
  const institutions = []
  for (const name of ['Pune Zilla Sahakari Sangh', 'Nashik Grape Growers Federation', 'Belagavi Agri University Farm']) {
    institutions.push(await mkPartner('Institution', name))
  }
  // Leads live in the same table, separated by stage — this is what /leads lists.
  const leads = []
  for (const name of ['Shubham Agro (new)', 'Kisan Mitra Centre (new)', 'Deshmukh Beej (new)',
    'Green Field Traders (new)', 'Ambika Krushi (new)']) {
    leads.push(await mkPartner(pick(['Dealer', 'Distributor']), name, {
      stage: 'Prospect',
      temperature: pick(['Hot', 'Warm', 'Cold']),
      sub_type: pick(['Walk-in', 'Referral', 'Exhibition']),
      next_follow_up_date: dayOffset(int(1, 12)),
      gst_number: null,
    }))
  }
  const companies = [...distributors, ...dealers, ...institutions]

  // ── contacts, and their company links / addresses ────────────────────────
  let contactCount = 0
  for (const company of companies) {
    const n = int(1, 2)
    for (let i = 0; i < n; i++) {
      const contact = await prisma.contacts.create({
        data: {
          ...tid,
          name: `${pick(['Nilesh', 'Asha', 'Rahul', 'Zoya', 'Mahesh', 'Kavita', 'Suresh'])} ${pick(['Patil', 'Iyer', 'Bhosale', 'Khan', 'Gowda', 'Joshi'])}`,
          mobile: `97${int(10000000, 99999999)}`,
          whatsapp: `97${int(10000000, 99999999)}`,
          email: `contact${int(100, 999)}@example.invalid`,
          designation: pick(['Proprietor', 'Partner', 'Purchase Head', 'Accounts']),
          contact_type_id: pick(contactTypes).id,
          owner_user_id: company.owner_user_id,
          birthday: dayOffset(-int(7000, 16000)),
          notes: 'Seeded demo contact.',
          is_active: true,
        },
      })
      await prisma.company_contacts.create({
        data: { ...tid, company_id: company.id, contact_id: contact.id, is_primary: i === 0 },
      })
      contactCount++
    }
    await prisma.company_addresses.create({
      data: {
        ...tid, company_id: company.id, label: 'Shop', address_line: company.address,
        city: 'Pune', state_id: company.state_id, district_id: company.district_id,
        taluka_id: company.taluka_id, village_id: company.village_id,
        pincode: company.pincode, is_primary: true,
      },
    })
  }

  // ── attendance: the last three weeks, Sundays off ────────────────────────
  let attendanceCount = 0
  for (const rep of reps) {
    for (let d = 20; d >= 0; d--) {
      const date = dayOffset(-d)
      if (date.getUTCDay() === 0) continue      // Sundays off
      if (rnd() < 0.08) continue                // the odd absence
      await prisma.attendance.create({
        data: {
          ...tid, user_id: rep, date,
          check_in_time: at(-d, int(9, 10), int(0, 59)),
          check_in_latitude: 18.5 + rnd(), check_in_longitude: 73.8 + rnd(),
          check_in_address: `${pick(villages).name}, Maharashtra`,
          check_out_time: d === 0 ? null : at(-d, int(18, 20), int(0, 59)),
          check_out_latitude: d === 0 ? null : 18.5 + rnd(),
          check_out_longitude: d === 0 ? null : 73.8 + rnd(),
          check_out_address: d === 0 ? null : `${pick(villages).name}, Maharashtra`,
        },
      })
      attendanceCount++
    }
  }

  // ── visits, and the orders booked on some of them ────────────────────────
  let visitCount = 0, orderCount = 0
  for (const rep of reps) {
    for (let d = 20; d >= 0; d--) {
      if (dayOffset(-d).getUTCDay() === 0) continue
      // Today always gets at least one visit: /api/daily-activity defaults to
      // today and shows only the caller's own rows, so a rep with none lands on
      // an empty screen.
      const perDay = d === 0 ? int(1, 3) : int(0, 3)
      for (let v = 0; v < perDay; v++) {
        const target = pick(rnd() < 0.2 ? leads : companies)
        const completed = d > 0 || rnd() < 0.5
        const startHour = 10 + v * 2
        const visit = await prisma.daily_visits.create({
          data: {
            ...tid, user_id: rep, visit_date: dayOffset(-d),
            visit_type: target.type, entity_id: target.id, entity_name: target.name,
            is_new_entity: target.stage === 'Prospect',
            start_time: at(-d, startHour, int(0, 45)),
            end_time: completed ? at(-d, startHour + 1, int(0, 45)) : null,
            duration_secs: completed ? int(900, 5400) : null,
            latitude: 18.5 + rnd(), longitude: 73.8 + rnd(),
            address: target.address,
            status: completed ? 'Completed' : 'Pending',
            notes: pick([
              'Stock check done, reorder next week.',
              'Discussed the new season scheme.',
              'Owner unavailable, met the accountant.',
              'Sample handed over for trial.',
              'Payment follow-up; cheque promised.',
            ]),
          },
        })
        visitCount++

        if (completed && rnd() < 0.45) {
          const lines = []
          let total = 0
          for (let i = 0; i < int(1, 3); i++) {
            const p = pick(products)
            const qty = int(2, 40)
            const rate = Number(p.price)
            const amount = Number((qty * rate).toFixed(2))
            total += amount
            lines.push({ ...tid, product_id: p.id, product_name: p.name, qty, rate, amount })
          }
          const order = await prisma.orders.create({
            data: {
              ...tid, user_id: rep, visit_id: visit.id, order_date: dayOffset(-d),
              total_amount: Number(total.toFixed(2)), order_source: 'meeting',
              entity_type: target.type, entity_id: target.id, entity_name: target.name,
              status: pick(['Confirmed', 'Confirmed', 'Dispatched']),
            },
          })
          await prisma.order_items.createMany({ data: lines.map(l => ({ ...l, order_id: order.id })) })
          orderCount++
        }
      }
    }
  }

  // ── expenses ─────────────────────────────────────────────────────────────
  let expenseCount = 0
  for (const rep of reps) {
    for (let d = 20; d >= 0; d--) {
      // Same reason as visits: /api/expenses defaults to today, own rows only.
      if (d !== 0 && rnd() < 0.5) continue
      await prisma.expenses.create({
        data: {
          ...tid, user_id: rep, expense_date: dayOffset(-d),
          category: pick(expenseCats).name,
          amount: int(80, 2400) + 0.5,
          notes: pick(['Bike fuel for field visits', 'Lunch on tour', 'Bus fare to the taluka', 'Night halt', 'Prepaid recharge']),
          // No photo: R2 holds no object for a seeded row, and
          // /api/expenses/photo/[id] would 404 on a fabricated key.
          photo_url: null,
        },
      })
      expenseCount++
    }
  }

  // ── weekly plans: the last two weeks plus the current one ────────────────
  const weeks = [
    { back: 14, status: 'Approved' },
    { back: 7, status: 'Submitted' },
    { back: 0, status: 'Draft' },
  ]
  for (const rep of reps) {
    for (const { back, status } of weeks) {
      const start = monday(-back)
      const end = new Date(start)
      end.setUTCDate(end.getUTCDate() + 6)
      const plan = await prisma.weekly_plans.create({
        data: {
          ...tid, user_id: rep, week_start_date: start, week_end_date: end, status,
          week_goal: pick(['Cover all A-class dealers', 'Push kharif seed pre-booking', 'Recover overdue payments']),
          submitted_at: status === 'Draft' ? null : at(-back, 18),
          last_status_changed_at: at(-back, 18),
          current_manager_id: status === 'Draft' ? null : DEV.manager,
          manager_comment: status === 'Approved' ? 'Approved. Keep the Baramati coverage up.' : null,
        },
      })
      for (let i = 0; i < 6; i++) {
        const from = pick(villages), to = pick(villages)
        const planDate = new Date(start)
        planDate.setUTCDate(planDate.getUTCDate() + i)
        await prisma.weekly_plan_items.create({
          data: {
            ...tid, weekly_plan_id: plan.id, plan_date: planDate,
            from_place: from.name, to_place: to.name,
            new_dealers_goal: int(0, 2), existing_dealers_goal: int(2, 6),
            mode_of_travel: pick(['Bike', 'Bus', 'Car', 'Train']),
            notes: pick(['Market day, good footfall', 'Collection focus', 'Demo planned at 11am', null]),
          },
        })
      }
      // actor_role is NOT NULL and the routes write 'User' / 'Manager' into it.
      if (status !== 'Draft') {
        await prisma.weekly_plan_audit_logs.create({
          data: {
            ...tid, weekly_plan_id: plan.id, actor_user_id: rep, actor_role: 'User',
            action_type: 'Submit', previous_status: 'Draft', new_status: 'Submitted',
            comment: 'Submitted for approval.',
          },
        })
      }
      if (status === 'Approved') {
        await prisma.weekly_plan_audit_logs.create({
          data: {
            ...tid, weekly_plan_id: plan.id, actor_user_id: DEV.manager, actor_role: 'Manager',
            action_type: 'Approve', previous_status: 'Submitted', new_status: 'Approved',
            comment: 'Approved.',
          },
        })
      }
    }
  }

  console.log('')
  console.log('Seeded demo tenant:')
  console.log(`  tenant            ${T}  Demo Agro Industries (LOCAL)`)
  console.log(`  users             5 (1 admin, 1 manager, 3 executives)`)
  console.log(`  locations         ${villages.length} villages under 3 states`)
  console.log(`  products          ${products.length}`)
  console.log(`  partners          ${distributors.length} distributors, ${dealers.length} dealers, ${institutions.length} institutions, ${leads.length} leads`)
  console.log(`  contacts          ${contactCount}`)
  console.log(`  attendance        ${attendanceCount}`)
  console.log(`  visits / orders   ${visitCount} / ${orderCount}`)
  console.log(`  expenses          ${expenseCount}`)
  console.log(`  weekly plans      ${reps.length * weeks.length}`)
  console.log('')
  console.log('Log in at http://localhost:3007/login with any of:')
  console.log(`  9000000100  ${PASSWORD}   Ravi Deshmukh   (Administrator)`)
  console.log(`  9000000101  ${PASSWORD}   Priya Nair      (Sales Manager, team scope)`)
  console.log(`  9000000102  ${PASSWORD}   Amit Kulkarni   (Sales Executive, own scope)`)
  console.log(`  9000000103  ${PASSWORD}   Sunita Patil    (Sales Executive)`)
  console.log(`  9000000104  ${PASSWORD}   Imran Shaikh    (Sales Executive)`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
