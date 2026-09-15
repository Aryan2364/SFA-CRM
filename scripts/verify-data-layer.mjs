#!/usr/bin/env node
/**
 * Verification harness for the Prisma data layer. READ-ONLY — it performs no
 * INSERT/UPDATE/DELETE, so it is safe to point at the live database.
 *
 * Run with:  npm run verify:data-layer
 * (that script compiles src/lib/db.ts first, so the REAL serialize() is
 * exercised here rather than a copy of it that could drift.)
 *
 * Covers the PLAN.md §5 traps against real rows:
 *   §5.1 date/decimal serialisation, both date shapes, nested relations
 *   §5.2 relation cardinality (to-one is an object, to-many is an array)
 *   §5.3 findUnique/findFirst null semantics vs .single()/.maybeSingle()
 *   §5.5 tenant scoping — wrong tenant must return nothing
 * plus the §6.3 role-resolution matrix for auth.ts.
 *
 * This is the seed the Batch 1 smoke-test harness extends.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const require = createRequire(import.meta.url)
const compiled = path.join(process.cwd(), '.verify-build', 'db.js')
if (!fs.existsSync(compiled)) {
  console.error('Compiled db.js not found. Run `npm run verify:data-layer` (it compiles first).')
  process.exit(1)
}
const { serialize } = require(compiled)

function readEnv(key) {
  const text = fs.readFileSync('.env.local', 'utf8')
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
}

const url = new URL(process.env.DATABASE_URL ?? readEnv('DATABASE_URL'))
const sslmode = url.searchParams.get('sslmode')
const limit = url.searchParams.get('connection_limit')
url.searchParams.delete('sslmode')
url.searchParams.delete('connection_limit')
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: url.toString(),
    ssl: sslmode && sslmode !== 'disable' ? { rejectUnauthorized: false } : undefined,
    max: limit ? +limit : 5,
  }),
})

let fail = 0, pass = 0, skip = 0
const ok = (n, c, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : `   got: ${JSON.stringify(got)}`}`); c ? pass++ : fail++ }
const skipped = (n, why) => { console.log(`SKIP  ${n}  (${why})`); skip++ }
const section = n => console.log(`\n--- ${n} ---`)

// The role resolution from src/lib/auth.ts requireUser(), verbatim.
async function resolveRole(userId) {
  const d = await prisma.users.findUnique({
    where: { id: userId },
    select: { profile: true, status: true, roles: { select: { name: true } } },
  })
  if (d?.status === 'Inactive') return 'Deactivated'
  if (d?.profile === 'Administrator') return 'Administrator'
  return d?.roles?.name ?? 'NoRole'
}

section('row counts (read-only)')
console.log('users:', await prisma.users.count(), '| roles:', await prisma.roles.count(),
  '| role_permissions:', await prisma.role_permissions.count(),
  '| user_visibility:', await prisma.user_visibility.count(),
  '| expenses:', await prisma.expenses.count(),
  '| point_config:', await prisma.point_config.count(),
  '| point_events:', await prisma.point_events.count())

section('auth.ts — role resolution (§6.3)')
const admin = await prisma.users.findFirst({ where: { profile: 'Administrator', status: 'Active' }, select: { id: true } })
if (admin) ok('Administrator -> "Administrator"', await resolveRole(admin.id) === 'Administrator', await resolveRole(admin.id))
else skipped('Administrator resolution', 'no active Administrator')

const roleU = await prisma.users.findFirst({
  where: { status: 'Active', NOT: { profile: 'Administrator' }, role_id: { not: null } },
  select: { id: true, tenant_id: true, roles: { select: { name: true } } },
})
if (roleU) ok(`role-holder -> its role name ("${roleU.roles.name}")`, await resolveRole(roleU.id) === roleU.roles.name, await resolveRole(roleU.id))
else skipped('role-holder resolution', 'no active non-admin user with a role')

const inactive = await prisma.users.findFirst({ where: { status: 'Inactive' }, select: { id: true } })
if (inactive) ok('Inactive -> "Deactivated"', await resolveRole(inactive.id) === 'Deactivated', await resolveRole(inactive.id))
else skipped('Inactive resolution', 'no Inactive user')

ok('unknown user -> "NoRole"', await resolveRole('44444444-4444-4444-4444-444444444444') === 'NoRole')

section('§5.2 relation cardinality')
if (roleU) {
  const u = await prisma.users.findUnique({ where: { id: roleU.id }, select: { roles: { select: { name: true } } } })
  ok('to-one `roles` is an OBJECT, not an array', u.roles !== null && !Array.isArray(u.roles) && typeof u.roles.name === 'string', u.roles)
} else skipped('to-one cardinality', 'no role-holding user')

const wpSome = await prisma.weekly_plans.findFirst({ where: { weekly_plan_items: { some: {} } }, include: { weekly_plan_items: true } })
if (wpSome) ok('to-many `weekly_plan_items` is an ARRAY', Array.isArray(wpSome.weekly_plan_items), typeof wpSome.weekly_plan_items)
else skipped('to-many cardinality', 'no weekly_plans with items')

section('permissions.ts — §5.3 findUnique == maybeSingle, §5.5 tenant scope')
const anyRp = await prisma.role_permissions.findFirst({ select: { tenant_id: true, profile: true, section: true } })
if (anyRp) {
  const rp = await prisma.role_permissions.findUnique({
    where: { tenant_id_profile_section: anyRp },
    select: { can_view: true, can_create: true, can_edit: true, can_delete: true, data_scope: true },
  })
  ok(`compound findUnique returns the row (${anyRp.profile}/${anyRp.section})`, !!rp)
  ok('can_* are booleans, never null', [rp.can_view, rp.can_create, rp.can_edit, rp.can_delete].every(v => typeof v === 'boolean'), rp)
  ok('data_scope is a non-null string', typeof rp.data_scope === 'string', rp.data_scope)
  ok('WRONG TENANT -> null',
    (await prisma.role_permissions.findUnique({ where: { tenant_id_profile_section: { ...anyRp, tenant_id: '00000000-0000-0000-0000-0000000000ff' } } })) === null)
} else skipped('permission lookups', 'role_permissions empty')
ok('missing permission row -> null, does not throw',
  (await prisma.role_permissions.findUnique({ where: { tenant_id_profile_section: { tenant_id: '00000000-0000-0000-0000-0000000000ff', profile: 'Nobody', section: 'orders' } } })) === null)

section('visibility.ts — §5.5 tenant scope')
const uv = await prisma.user_visibility.findFirst({ select: { viewer_user_id: true, target_user_id: true, tenant_id: true } })
if (uv) {
  const ids = (await prisma.user_visibility.findMany({ where: { viewer_user_id: uv.viewer_user_id, tenant_id: uv.tenant_id }, select: { target_user_id: true } })).map(r => r.target_user_id)
  ok('getVisibleUserIds includes the known target', ids.includes(uv.target_user_id), ids.length)
  ok('canView true for a real pair', (await prisma.user_visibility.count({ where: { viewer_user_id: uv.viewer_user_id, target_user_id: uv.target_user_id, tenant_id: uv.tenant_id } })) > 0)
  ok('canView false under WRONG TENANT', (await prisma.user_visibility.count({ where: { viewer_user_id: uv.viewer_user_id, target_user_id: uv.target_user_id, tenant_id: '00000000-0000-0000-0000-0000000000ff' } })) === 0)
} else skipped('visibility checks', 'user_visibility empty')

section('points.ts — §5.3 + daily-cap window (read paths only; no writes)')
const cfg = await prisma.point_config.findFirst({ select: { tenant_id: true, action_type: true } })
if (cfg) {
  const config = await prisma.point_config.findUnique({
    where: { tenant_id_action_type: cfg },
    select: { points: true, cap_per_day: true, is_active: true },
  })
  ok(`point_config findUnique returns the row ("${cfg.action_type}")`, !!config)
  ok('points is a plain Int, not a Decimal', typeof config.points === 'number', typeof config.points)
  ok('cap_per_day is number|null — the branch awardPoint tests', config.cap_per_day === null || typeof config.cap_per_day === 'number', config.cap_per_day)
  ok('unknown action_type -> null (=> awardPoint returns 0)',
    (await prisma.point_config.findUnique({ where: { tenant_id_action_type: { tenant_id: cfg.tenant_id, action_type: '__no_such_action__' } } })) === null)
  ok('WRONG TENANT config -> null',
    (await prisma.point_config.findUnique({ where: { tenant_id_action_type: { tenant_id: '00000000-0000-0000-0000-0000000000ff', action_type: cfg.action_type } } })) === null)
} else skipped('point_config lookups', 'point_config empty')

const ev = await prisma.point_events.findFirst({ select: { tenant_id: true, user_id: true, action_type: true, earned_at: true } })
if (ev) {
  const day = ev.earned_at.toISOString().split('T')[0]
  const win = { gte: new Date(`${day}T00:00:00.000Z`), lte: new Date(`${day}T23:59:59.999Z`) }
  ok(`daily-cap window counts the known event (${day})`,
    (await prisma.point_events.count({ where: { tenant_id: ev.tenant_id, user_id: ev.user_id, action_type: ev.action_type, earned_at: win } })) >= 1)
  ok('daily-cap count under WRONG TENANT is 0',
    (await prisma.point_events.count({ where: { tenant_id: '00000000-0000-0000-0000-0000000000ff', user_id: ev.user_id, action_type: ev.action_type, earned_at: win } })) === 0)
  ok('window excludes other days',
    (await prisma.point_events.count({ where: { tenant_id: ev.tenant_id, user_id: ev.user_id, action_type: ev.action_type, earned_at: { gte: new Date('1990-01-01T00:00:00.000Z'), lte: new Date('1990-01-01T23:59:59.999Z') } } })) === 0)
} else skipped('daily-cap window', 'point_events empty')
console.log('      (point_events.create() deliberately NOT exercised — it would write to production)')

section('§5.1 serialize() — the real helper from src/lib/db.ts')
const exp = await prisma.expenses.findFirst({ include: { users: true } })
if (exp) {
  ok('RAW amount is a Decimal object (the trap is real)', exp.amount instanceof Prisma.Decimal, typeof exp.amount)
  ok('RAW expense_date is a Date object', exp.expense_date instanceof Date)
  const s = serialize(exp, 'expenses')
  ok('amount -> JS number', typeof s.amount === 'number', s.amount)
  ok('amount survives JSON.stringify as a number', typeof JSON.parse(JSON.stringify(s)).amount === 'number')
  ok('expense_date -> date-only "YYYY-MM-DD"', /^\d{4}-\d{2}-\d{2}$/.test(s.expense_date), s.expense_date)
  ok('created_at -> full ISO string', /^\d{4}-\d{2}-\d{2}T.*Z$/.test(s.created_at), s.created_at)
  ok('.slice(0,10) works on a date field (daily-activity trap)', s.expense_date.slice(0, 10) === s.expense_date)
  ok('.localeCompare works on a timestamp field (conversations trap)', s.created_at.localeCompare(s.created_at) === 0)
  ok('nested users.created_at -> full ISO (relation walked with the right model)', /^\d{4}-\d{2}-\d{2}T.*Z$/.test(s.users.created_at), s.users.created_at)
} else skipped('expense serialisation', 'no expense rows')

if (wpSome) {
  const s = serialize(wpSome, 'weekly_plans')
  ok('weekly_plans.week_start_date -> date-only', /^\d{4}-\d{2}-\d{2}$/.test(s.week_start_date), s.week_start_date)
  ok('nested weekly_plan_items[].plan_date -> date-only (model switch across relation)', s.weekly_plan_items.every(i => /^\d{4}-\d{2}-\d{2}$/.test(i.plan_date)), s.weekly_plan_items[0]?.plan_date)
  ok('nested weekly_plan_items[].created_at -> full ISO', /^\d{4}-\d{2}-\d{2}T.*Z$/.test(s.weekly_plan_items[0].created_at))
  ok('plan_date.localeCompare() sorts (review/[userId]/page.tsx:257)',
    [...s.weekly_plan_items].sort((a, b) => a.plan_date.localeCompare(b.plan_date)).length === s.weekly_plan_items.length)
}

const att = await prisma.attendance.findFirst()
if (att) ok('attendance.date -> date-only (regression: was full ISO under name-only keying)', /^\d{4}-\d{2}-\d{2}$/.test(serialize(att, 'attendance').date), serialize(att, 'attendance').date)
else skipped('attendance.date', 'no attendance rows')

const ord = await prisma.orders.findFirst({ where: { order_items: { some: {} } }, include: { order_items: true } })
if (ord) {
  const s = serialize(ord, 'orders')
  ok('orders.total_amount -> number', typeof s.total_amount === 'number', s.total_amount)
  ok('orders.order_date -> date-only', /^\d{4}-\d{2}-\d{2}$/.test(s.order_date), s.order_date)
  ok('nested order_items[].rate/.amount -> numbers', s.order_items.every(i => typeof i.rate === 'number' && typeof i.amount === 'number'))
} else skipped('order serialisation', 'no orders with items')

const dv = await prisma.daily_visits.findFirst({ where: { start_time: { not: null } } })
if (dv) ok('daily_visits.start_time -> ISO, .slice(0,10) works (daily-activity/[id] trap)', serialize(dv, 'daily_visits').start_time.slice(0, 10).length === 10)
else skipped('start_time serialisation', 'no daily_visits with start_time')

ok('null passes through', serialize({ photo_url: null }, 'expenses').photo_url === null)
ok('Decimal outside any model still -> number', serialize({ x: new Prisma.Decimal('2.50') }).x === 2.5)

console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`}   (${pass} passed, ${fail} failed, ${skip} skipped)`)
await prisma.$disconnect()
process.exit(fail ? 1 : 0)
