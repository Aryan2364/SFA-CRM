#!/usr/bin/env node
/**
 * Seeds the disposable tenant used by the write-path tests (PLAN.md §8.3).
 *
 * Points at SCRATCH_DATABASE_URL — the LOCAL PostgreSQL 18 instance, never
 * Supabase and never RDS. It refuses to run against anything that looks like a
 * hosted database, because everything here is destructive.
 *
 * Run via `npm run scratch:setup`, which pushes prisma/schema.prisma first so
 * the scratch database is structurally identical to live.
 */
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

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

// Hard guard: this script truncates tables. It must never see a hosted database.
const host = new URL(raw).hostname
const LOCAL = new Set(['localhost', '127.0.0.1', '::1'])
if (!LOCAL.has(host)) {
  console.error(`REFUSING TO RUN: SCRATCH_DATABASE_URL points at "${host}", not a local host.`)
  console.error('The write-path harness is destructive and is only ever allowed to touch local PostgreSQL.')
  process.exit(1)
}

const url = new URL(raw)
url.searchParams.delete('sslmode')
url.searchParams.delete('connection_limit')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 5 }) })

// Fixed ids so the tests can address rows without a lookup round-trip.
export const SEED = {
  tenantA:      '0000000a-0000-4000-8000-000000000001',
  roleA:        '0000000a-0000-4000-8000-000000000010',
  adminA:       '0000000a-0000-4000-8000-000000000011',
  stateA:       '0000000a-0000-4000-8000-000000000020',
  districtA:    '0000000a-0000-4000-8000-000000000021',
  talukaA:      '0000000a-0000-4000-8000-000000000022',
  villageA:     '0000000a-0000-4000-8000-000000000023',
  catA:         '0000000a-0000-4000-8000-000000000030',
  subcatA:      '0000000a-0000-4000-8000-000000000031',
  deptA:        '0000000a-0000-4000-8000-000000000040',
  // A subordinate of adminA, with a user_visibility row so canView() passes.
  // Weekly-plan transitions need a real manager/subordinate pair.
  subA:         '0000000a-0000-4000-8000-000000000050',
  // Tenant B — the "other tenant" every isolation assertion aims at.
  tenantB:      '0000000b-0000-4000-8000-000000000001',
  stateB:       '0000000b-0000-4000-8000-000000000020',
  productB:     '0000000b-0000-4000-8000-000000000030',
  distributorB: '0000000b-0000-4000-8000-000000000040',
}

async function main() {
  console.log(`Seeding scratch database at ${host} …`)

  // Wipe in FK-safe order. Only ever the two scratch tenants.
  const tenants = [SEED.tenantA, SEED.tenantB]
  const wipe = { tenant_id: { in: tenants } }
  // Children that reference users / remarks must go before the parents.
  await prisma.remark_reads.deleteMany({ where: { tenant_id: { in: tenants } } })
  await prisma.contextual_remarks.deleteMany({ where: { tenant_id: { in: tenants } } })
  await prisma.point_events.deleteMany({ where: { tenant_id: { in: tenants } } })
  await prisma.point_config_history.deleteMany({ where: { tenant_id: { in: tenants } } })
  await prisma.point_config.deleteMany({ where: { tenant_id: { in: tenants } } })
  await prisma.tenant_point_settings.deleteMany({ where: { tenant_id: { in: tenants } } })
  await prisma.weekly_plan_audit_logs.deleteMany({ where: { tenant_id: { in: tenants } } })
  await prisma.weekly_plan_items.deleteMany({ where: { tenant_id: { in: tenants } } })
  await prisma.weekly_plans.deleteMany({ where: wipe })
  await prisma.notifications.deleteMany({ where: wipe })
  await prisma.user_visibility.deleteMany({ where: wipe })
  await prisma.order_items.deleteMany({ where: { orders: { tenant_id: { in: tenants } } } })
  await prisma.orders.deleteMany({ where: wipe })
  await prisma.products.deleteMany({ where: wipe })
  await prisma.product_subcategories.deleteMany({ where: wipe })
  await prisma.product_categories.deleteMany({ where: wipe })
  await prisma.business_partners.deleteMany({ where: wipe })
  await prisma.villages.deleteMany({ where: wipe })
  await prisma.talukas.deleteMany({ where: wipe })
  await prisma.districts.deleteMany({ where: wipe })
  await prisma.states.deleteMany({ where: wipe })
  await prisma.role_permissions.deleteMany({ where: wipe })
  await prisma.users.deleteMany({ where: wipe })
  await prisma.roles.deleteMany({ where: wipe })
  await prisma.designations.deleteMany({ where: wipe })
  await prisma.departments.deleteMany({ where: wipe })
  await prisma.expense_categories.deleteMany({ where: wipe })
  await prisma.lead_types.deleteMany({ where: wipe })
  await prisma.lead_stages.deleteMany({ where: wipe })
  await prisma.lead_temperatures.deleteMany({ where: wipe })
  await prisma.tenants.deleteMany({ where: { id: { in: tenants } } })

  await prisma.tenants.createMany({
    data: [
      { id: SEED.tenantA, name: 'Scratch Tenant A', is_active: true },
      { id: SEED.tenantB, name: 'Scratch Tenant B (isolation target)', is_active: true },
    ],
  })

  await prisma.roles.create({
    data: { id: SEED.roleA, tenant_id: SEED.tenantA, name: 'Scratch Role', is_system: false },
  })

  await prisma.users.create({
    data: {
      id: SEED.adminA, tenant_id: SEED.tenantA, name: 'Scratch Admin',
      email: 'scratch-admin@example.invalid', contact: '9000000001',
      password: '', profile: 'Administrator', status: 'Active',
    },
  })

  await prisma.users.create({
    data: {
      id: SEED.subA, tenant_id: SEED.tenantA, name: 'Scratch Subordinate',
      email: 'scratch-sub@example.invalid', contact: '9000000002',
      password: '', profile: 'Standard', status: 'Active',
      manager_user_id: SEED.adminA,
    },
  })

  // adminA can see subA — this is what canView() checks on every manager-side
  // weekly-plan transition.
  await prisma.user_visibility.create({
    data: { tenant_id: SEED.tenantA, viewer_user_id: SEED.adminA, target_user_id: SEED.subA },
  })

  // A non-admin role with a known permission matrix, for gating assertions.
  await prisma.role_permissions.createMany({
    data: ['states', 'districts', 'talukas', 'villages', 'products', 'product_categories',
      'product_subcategories', 'dealers', 'distributors', 'departments', 'designations']
      .map(section => ({
        tenant_id: SEED.tenantA, profile: 'Scratch Role', section,
        can_view: true, can_create: true, can_edit: true, can_delete: true, data_scope: 'all',
      })),
  })

  // Tenant A reference rows the write paths need.
  await prisma.states.create({ data: { id: SEED.stateA, tenant_id: SEED.tenantA, name: 'Scratch State A' } })
  await prisma.districts.create({ data: { id: SEED.districtA, tenant_id: SEED.tenantA, name: 'Scratch District A', state_id: SEED.stateA } })
  await prisma.talukas.create({ data: { id: SEED.talukaA, tenant_id: SEED.tenantA, name: 'Scratch Taluka A', district_id: SEED.districtA } })
  await prisma.villages.create({ data: { id: SEED.villageA, tenant_id: SEED.tenantA, name: 'Scratch Village A', taluka_id: SEED.talukaA } })
  await prisma.product_categories.create({ data: { id: SEED.catA, tenant_id: SEED.tenantA, name: 'Scratch Category A' } })
  await prisma.product_subcategories.create({ data: { id: SEED.subcatA, tenant_id: SEED.tenantA, name: 'Scratch Subcategory A', category_id: SEED.catA } })
  await prisma.departments.create({ data: { id: SEED.deptA, tenant_id: SEED.tenantA, name: 'Scratch Department A' } })

  // Tenant B rows — the cross-tenant targets. Every isolation test aims here.
  await prisma.states.create({ data: { id: SEED.stateB, tenant_id: SEED.tenantB, name: 'TENANT B STATE — MUST NEVER BE TOUCHED' } })
  const catB = await prisma.product_categories.create({ data: { tenant_id: SEED.tenantB, name: 'Tenant B Category' } })
  const subB = await prisma.product_subcategories.create({ data: { tenant_id: SEED.tenantB, name: 'Tenant B Subcategory', category_id: catB.id } })
  await prisma.products.create({
    data: { id: SEED.productB, tenant_id: SEED.tenantB, name: 'TENANT B PRODUCT — MUST NEVER BE TOUCHED',
      category_id: catB.id, subcategory_id: subB.id, price: 999.99 },
  })
  await prisma.business_partners.create({
    data: { id: SEED.distributorB, tenant_id: SEED.tenantB, type: 'Distributor', stage: 'Existing',
      name: 'TENANT B DISTRIBUTOR — MUST NEVER BE TOUCHED' },
  })

  console.log('Seeded:')
  console.log(`  tenant A ${SEED.tenantA}  (admin ${SEED.adminA})`)
  console.log(`  tenant B ${SEED.tenantB}  (isolation target)`)
  console.log(JSON.stringify(SEED, null, 2))
}

main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
