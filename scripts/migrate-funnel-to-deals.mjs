#!/usr/bin/env node
/**
 * P2-T4 — migrate active funnel companies into Deals.
 *
 * `02-DATA-MODEL-PLAN.md` §4.3 / §5 step 13. Opens one Deal per active company
 * whose `stage` is a funnel position, and one `deal_follow_ups` row where the
 * company carried a `next_follow_up_date`.
 *
 *   FOR EACH companies WHERE stage <> 'Existing' AND is_active = true
 *
 * ⚠️ `stage = 'Existing'` is a TYPE DISCRIMINATOR, not a funnel position.
 * Including it opens a bogus Deal against every dealer, distributor and
 * institution in the tenant — the worst outcome available in this migration.
 * The exclusion is not configurable here, on purpose.
 *
 * Differences from the §4.3 pseudo-code, both deliberate:
 *   - `stage_entered_at` = the migration timestamp, NOT `updated_at`. No route
 *     ever writes `updated_at`, so ageing (§4.7) would read as years old for
 *     every migrated Deal on day one. Q10 recommends this; P2-T4 mandates it.
 *   - `probability` = 0 unless --probability-from-sort-order is passed. §4.3
 *     says "the stage's default band", but `deal_stages` has no probability
 *     column and the 0-30/40-60/70-100 bands in §10 are REPORT buckets, not
 *     per-stage defaults. There is nothing to read, so nothing is guessed.
 *
 * Idempotency: a company is skipped when a deal already exists with the same
 * (tenant_id, company_id, name) as the one this script would insert. Re-running
 * therefore inserts nothing and reports every row as already-migrated.
 *
 * Rollback: DELETE FROM deals — the sources are never written to.
 *
 * Points at SCRATCH_DATABASE_URL and refuses any non-local host: the purge step
 * below is destructive.
 *
 *   node scripts/migrate-funnel-to-deals.mjs --dry-run
 *   node scripts/migrate-funnel-to-deals.mjs
 *   node scripts/migrate-funnel-to-deals.mjs --tenant <uuid> --skip-purge
 */
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// ── env + guard (same shape as seed-dev.mjs / seed-scratch.mjs) ─────────────
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

// ── args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const has = f => argv.includes(f)
const valueOf = f => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const DRY = has('--dry-run')
const SKIP_PURGE = has('--skip-purge')
const BY_SORT_ORDER = has('--probability-from-sort-order')
const ONLY_TENANT = valueOf('--tenant')

/** The local demo tenant (scripts/seed-dev.mjs DEV.tenant). The purge only ever
 *  touches this one — seed-scratch's tenants a/b are asserted against by the
 *  write-path suites. */
const DEMO_TENANT = '0000000d-0000-4000-8000-000000000001'

/** Junk left behind by earlier P2 sessions in the demo tenant. Matched by exact
 *  name or LIKE pattern, never by a broad heuristic. */
const JUNK_LIKE = ['Pipeline deal %', 'Verification deal %']
const JUNK_EXACT = ['B22 drag verification deal', 'Err probe']

const STAGE_EXCLUDED = 'Existing'
const SUFFIX = ' — migrated'

const NOW = new Date()
const log = (...a) => console.log(...a)
const head = t => log(`\n${t}\n${'─'.repeat(t.length)}`)

// ── step 1: purge the junk test deals ──────────────────────────────────────
async function purge() {
  head('Step 1 — purge junk test deals (demo tenant only)')
  if (SKIP_PURGE) {
    log('  --skip-purge given; nothing purged.')
    return
  }
  const where = {
    tenant_id: DEMO_TENANT,
    OR: [...JUNK_LIKE.map(p => ({ name: { startsWith: p.replace(/%$/, '') } })),
         { name: { in: JUNK_EXACT } }],
  }
  const victims = await prisma.deals.findMany({ where, select: { id: true, name: true } })
  const ids = victims.map(v => v.id)
  for (const v of victims) log(`  ${DRY ? 'would delete' : 'delete'}: ${v.name}`)
  if (!victims.length) { log('  nothing to purge.'); return }

  // Every deal child FK is ON DELETE CASCADE in the database, but they are
  // deleted explicitly so the counts can be reported rather than assumed.
  const children = {
    deal_stage_logs: await prisma.deal_stage_logs.count({ where: { deal_id: { in: ids } } }),
    deal_follow_ups: await prisma.deal_follow_ups.count({ where: { deal_id: { in: ids } } }),
    deal_attachments: await prisma.deal_attachments.count({ where: { deal_id: { in: ids } } }),
    deal_meetings: await prisma.deal_meetings.count({ where: { deal_id: { in: ids } } }),
  }
  for (const [t, n] of Object.entries(children)) log(`  ${t}: ${n}`)

  if (DRY) { log(`  DRY RUN — would delete ${victims.length} deals.`); return }
  await prisma.$transaction([
    prisma.deal_stage_logs.deleteMany({ where: { deal_id: { in: ids } } }),
    prisma.deal_follow_ups.deleteMany({ where: { deal_id: { in: ids } } }),
    prisma.deal_attachments.deleteMany({ where: { deal_id: { in: ids } } }),
    prisma.deal_meetings.deleteMany({ where: { deal_id: { in: ids } } }),
    prisma.deals.deleteMany({ where: { id: { in: ids } } }),
  ])
  log(`  deleted ${victims.length} deals and ${Object.values(children).reduce((a, b) => a + b, 0)} dependent rows.`)
}

/** §4.3: "the stage's default band". Nothing stores one, so 0 unless asked.
 *  With the flag, a stage's position among its tenant's active stages maps
 *  linearly onto 0-100 in multiples of ten — explainable, but still derived. */
function probabilityFor(stage, stagesOfTenant) {
  if (!BY_SORT_ORDER) return 0
  const ordered = stagesOfTenant.slice().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const i = ordered.findIndex(s => s.id === stage.id)
  if (i < 0 || ordered.length < 2) return 0
  return Math.round((i / (ordered.length - 1)) * 10) * 10
}

// ── step 2: migrate ────────────────────────────────────────────────────────
async function migrate() {
  head('Step 2 — migrate active funnel companies into Deals')

  const companies = await prisma.companies.findMany({
    where: {
      is_active: true,
      stage: { not: STAGE_EXCLUDED },   // ⚠️ mandatory, non-negotiable
      ...(ONLY_TENANT ? { tenant_id: ONLY_TENANT } : {}),
    },
    select: {
      id: true, tenant_id: true, name: true, stage: true,
      created_by_user_id: true, owner_user_id: true, next_follow_up_date: true,
    },
    orderBy: [{ tenant_id: 'asc' }, { name: 'asc' }],
  })

  const tenants = [...new Set(companies.map(c => c.tenant_id))]
  const stageRows = tenants.length
    ? await prisma.deal_stages.findMany({
        where: { tenant_id: { in: tenants }, is_active: true },
        select: { id: true, tenant_id: true, name: true, sort_order: true },
      })
    : []
  const stagesByTenant = new Map()
  for (const s of stageRows) {
    if (!stagesByTenant.has(s.tenant_id)) stagesByTenant.set(s.tenant_id, [])
    stagesByTenant.get(s.tenant_id).push(s)
  }
  const stageKey = (t, n) => `${t}::${n.trim()}`
  const stageByName = new Map(stageRows.map(s => [stageKey(s.tenant_id, s.name), s]))

  // "the linked contact, if exactly one" (§4.3)
  const links = companies.length
    ? await prisma.company_contacts.findMany({
        where: { company_id: { in: companies.map(c => c.id) } },
        select: { company_id: true, contact_id: true },
      })
    : []
  const contactsByCompany = new Map()
  for (const l of links) {
    if (!contactsByCompany.has(l.company_id)) contactsByCompany.set(l.company_id, [])
    contactsByCompany.get(l.company_id).push(l.contact_id)
  }

  // Idempotency: the exact (tenant_id, company_id, name) this run would insert.
  const existing = new Set(
    (await prisma.deals.findMany({
      where: { company_id: { in: companies.map(c => c.id) } },
      select: { tenant_id: true, company_id: true, name: true },
    })).map(d => `${d.tenant_id}::${d.company_id}::${d.name}`)
  )

  const plan = []
  const unresolvedStage = []
  const alreadyMigrated = []
  const ambiguousContact = []
  let noOwner = 0
  let withFollowUp = 0

  for (const c of companies) {
    const name = `${c.name}${SUFFIX}`
    if (existing.has(`${c.tenant_id}::${c.id}::${name}`)) { alreadyMigrated.push(c); continue }

    const stage = stageByName.get(stageKey(c.tenant_id, c.stage))
    if (!stage) { unresolvedStage.push(c); continue }   // §4.3: do not guess

    const linked = contactsByCompany.get(c.id) ?? []
    if (linked.length > 1) ambiguousContact.push(c)
    const owner = c.owner_user_id ?? c.created_by_user_id ?? null
    if (!owner) noOwner += 1
    if (c.next_follow_up_date) withFollowUp += 1

    plan.push({
      company: c,
      row: {
        tenant_id: c.tenant_id,
        name,
        company_id: c.id,
        contact_id: linked.length === 1 ? linked[0] : null,
        deal_stage_id: stage.id,
        owner_user_id: owner,
        probability: probabilityFor(stage, stagesByTenant.get(c.tenant_id) ?? []),
        stage_entered_at: NOW,          // migration timestamp, never updated_at
        expected_value: 0,
      },
      follow_up: c.next_follow_up_date
        ? { tenant_id: c.tenant_id, due_date: c.next_follow_up_date, mode: 'Other', status: 'not_done' }
        : null,
    })
  }

  head('Plan')
  for (const p of plan) {
    log(`  + ${p.row.name}  [stage ${p.company.stage}]  owner=${p.row.owner_user_id ?? 'NULL (Unassigned)'}` +
        `  contact=${p.row.contact_id ?? 'none'}  prob=${p.row.probability}` +
        `${p.follow_up ? `  follow-up ${p.follow_up.due_date.toISOString().slice(0, 10)}` : ''}`)
  }
  if (!plan.length) log('  (no new deals to create)')

  if (!DRY) {
    for (const p of plan) {
      await prisma.$transaction(async tx => {
        const deal = await tx.deals.create({ data: p.row, select: { id: true } })
        if (p.follow_up) await tx.deal_follow_ups.create({ data: { ...p.follow_up, deal_id: deal.id } })
      })
    }
  }

  return { companies, plan, unresolvedStage, alreadyMigrated, ambiguousContact, noOwner, withFollowUp }
}

// ── report ─────────────────────────────────────────────────────────────────
async function report(r) {
  head('Report')
  log(`  mode                              : ${DRY ? 'DRY RUN (nothing written)' : 'APPLIED'}`)
  log(`  migration timestamp               : ${NOW.toISOString()}`)
  log(`  candidate companies (stage <> '${STAGE_EXCLUDED}', is_active) : ${r.companies.length}`)
  log(`  deals ${DRY ? 'that would be created' : 'created'}            : ${r.plan.length}`)
  log(`  follow-ups ${DRY ? 'that would be created' : 'created'}       : ${r.withFollowUp}`)
  log(`  skipped — already migrated        : ${r.alreadyMigrated.length}`)
  log(`  skipped — stage has no deal_stages row : ${r.unresolvedStage.length}`)
  if (r.unresolvedStage.length) {
    const byStage = new Map()
    for (const c of r.unresolvedStage) byStage.set(c.stage, (byStage.get(c.stage) ?? 0) + 1)
    for (const [s, n] of byStage) log(`      stage "${s}": ${n} row(s)`)
    for (const c of r.unresolvedStage) log(`      - ${c.name} (${c.id})`)
  }
  log(`  migrated deals with NO owner (Unassigned) : ${r.noOwner}`)
  log(`  companies with >1 contact (contact_id left NULL) : ${r.ambiguousContact.length}`)
  for (const c of r.ambiguousContact) log(`      - ${c.name} (${c.id})`)

  const excluded = await prisma.companies.count({
    where: { stage: STAGE_EXCLUDED, ...(ONLY_TENANT ? { tenant_id: ONLY_TENANT } : {}) },
  })
  log(`  companies EXCLUDED by stage = '${STAGE_EXCLUDED}'  : ${excluded}  (never get a Deal)`)

  head('Database totals now')
  for (const t of ['deals', 'deal_follow_ups', 'deal_stage_logs']) {
    log(`  ${t}: ${await prisma[t].count()}`)
  }
  if (!BY_SORT_ORDER) {
    log('\n  NOTE: probability = 0 on every migrated Deal. §4.3 asks for "the stage\'s')
    log('  default band" but deal_stages stores no probability and §10\'s bands are')
    log('  report buckets. Pass --probability-from-sort-order to derive one instead.')
  }
}

async function main() {
  log(`migrate-funnel-to-deals — ${DRY ? 'DRY RUN' : 'LIVE'} against ${host}`)
  await purge()
  const r = await migrate()
  await report(r)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
