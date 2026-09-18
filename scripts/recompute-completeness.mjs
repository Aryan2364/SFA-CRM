#!/usr/bin/env node
/**
 * Recompute `companies.is_complete` / `companies.completeness_missing` for every
 * company in the LOCAL database.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/lib/completeness.ts` owns the rule and the API routes call it after every
 * write that could change the answer. `scripts/seed-dev.mjs` never calls it, so
 * the demo tenant it writes has both columns at their column defaults:
 * `is_complete = false` on every row, `completeness_missing` null on almost
 * every row. The two columns therefore disagree with each other AND with the
 * data — a company with a full primary address and a GST number reads as
 * incomplete, and a company that really is missing four fields records none of
 * them. The Parties list, the completeness banner on the Company page and the
 * §3.5 report filter all read those columns, so all three are wrong on local.
 *
 * This is a one-off repair, not a substitute for the routes calling the helper.
 *
 * THE RULE IS NOT REIMPLEMENTED HERE
 * ----------------------------------
 * The stored string's field list, its ORDER and its ", " separator are part of
 * the value: `scripts/backfill-parties.mjs` STEP 4 computes the same string in
 * SQL, and a second implementation that drifted by one word would make every
 * subsequent run of either script rewrite every row. So this script imports
 * `recomputeCompanyCompleteness()` itself and only decides WHICH rows to call it
 * for and WHAT to print. It does not know what "complete" means.
 *
 * HOW THE DRY RUN CAN BE A DRY RUN
 * --------------------------------
 * That helper writes — that is its job. `src/lib/db.ts` builds its client lazily
 * and caches it on `globalThis.prisma`, checked BEFORE the adapter is
 * constructed, so this script installs its own client there first. Two things
 * follow:
 *
 *   1. `DATABASE_URL` is never read by `db.ts` in this process. The live
 *      database is not merely refused, it is never resolved — the only
 *      connection string that exists here is the scratch one, checked below.
 *   2. The dry run wraps that client so `companies.updateMany` is RECORDED
 *      instead of executed. The rule still runs exactly as it runs in
 *      production; only the write is intercepted. The same wrapper counts the
 *      writes in `--commit` mode, which is what proves the second run is a
 *      no-op.
 *
 * USAGE
 *   node scripts/recompute-completeness.mjs            # dry run, writes nothing
 *   node scripts/recompute-completeness.mjs --commit   # writes
 */
import fs from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const COMMIT = process.argv.includes('--commit')

// ---------------------------------------------------------------------------
// 1. Resolve the connection — scratch only, local only.
//    Same convention as scripts/seed-dev.mjs and scripts/scratch-push.mjs.
// ---------------------------------------------------------------------------

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

// Hard guard: this script issues UPDATEs. It must never see a hosted database.
const host = new URL(raw).hostname
const LOCAL = new Set(['localhost', '127.0.0.1', '::1'])
if (!LOCAL.has(host)) {
  console.error(`REFUSING TO RUN: SCRATCH_DATABASE_URL points at "${host}", not a local host.`)
  console.error('This script rewrites company rows and is only ever allowed to touch local PostgreSQL.')
  process.exit(1)
}

// Belt and braces: the hostname check alone would pass if the live database
// were ever reachable on a local host, so refuse on equality regardless.
const live = readEnv('DATABASE_URL')
if (live && live.trim() === raw.trim()) {
  console.error('REFUSING TO RUN: SCRATCH_DATABASE_URL is identical to DATABASE_URL.')
  console.error('That is the live database. The scratch database must be a separate, local one.')
  process.exit(1)
}

// `sslmode` and `connection_limit` are Prisma-engine parameters that
// node-postgres does not understand; db.ts strips them for the same reason.
const url = new URL(raw)
url.searchParams.delete('sslmode')
url.searchParams.delete('connection_limit')

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString(), max: 5 }),
})

// ---------------------------------------------------------------------------
// 2. Wrap the client, then install it as the singleton db.ts will find.
// ---------------------------------------------------------------------------

/** Every `companies.updateMany` the helper asked for, in call order. */
const writes = []

/**
 * Forward everything to the real client except `companies.updateMany`, which is
 * recorded — and, on a dry run, not executed.
 *
 * Methods are bound to their own receiver: a Prisma delegate's methods are not
 * free functions and calling one with the Proxy as `this` is not the same call.
 */
function wrapClient(target) {
  const companiesProxy = model =>
    new Proxy(model, {
      get(m, prop, receiver) {
        if (prop !== 'updateMany') {
          const value = Reflect.get(m, prop, receiver)
          return typeof value === 'function' ? value.bind(m) : value
        }
        return async args => {
          writes.push(args)
          if (!COMMIT) return { count: 0 }
          return m.updateMany(args)
        }
      },
    })

  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver)
      if (prop === 'companies') return companiesProxy(value)
      return typeof value === 'function' ? value.bind(t) : value
    },
  })
}

// db.ts: `if (globalForPrisma.prisma) return globalForPrisma.prisma` — checked
// before buildAdapter(), so this is what the helper gets and DATABASE_URL is
// never read. Set BEFORE the import below; the import itself is lazy, but the
// first property access would build a client from DATABASE_URL if this were
// missing.
globalThis.prisma = wrapClient(client)

// ---------------------------------------------------------------------------
// 3. Import the real helper.
//
// `src/lib/completeness.ts` imports `./db`, extensionless, which Node's ESM
// resolver will not find (it is TypeScript's convention, not Node's). Node
// strips the types itself; only the specifier needs help, so a resolve hook
// appends `.ts` for relative specifiers that resolve to one. Nothing is
// transformed and no build directory is produced — the file that runs is the
// file in `src/lib`.
// ---------------------------------------------------------------------------

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
      try {
        const base = new URL(specifier, context.parentURL)
        for (const candidate of [`${base.href}.ts`, `${base.href}/index.ts`]) {
          if (fs.existsSync(fileURLToPath(candidate))) return nextResolve(candidate, context)
        }
      } catch {
        // Not resolvable as a URL — fall through to Node's own resolver, which
        // will report it properly.
      }
    }
    return nextResolve(specifier, context)
  },
})

const { recomputeCompanyCompleteness } = await import(
  new URL('../src/lib/completeness.ts', import.meta.url).href
)

// ---------------------------------------------------------------------------
// 4. Run.
// ---------------------------------------------------------------------------

/** `"City, GST Number"` → a stable key for the distribution table. */
function missingKey(value) {
  return value === null || value === undefined ? '(none — complete)' : value
}

function distribution(rows, pick) {
  const counts = new Map()
  for (const row of rows) {
    const key = missingKey(pick(row))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function printDistribution(title, entries) {
  console.log(`\n  ${title}`)
  for (const [key, count] of entries) {
    console.log(`    ${String(count).padStart(4)}  ${key}`)
  }
}

async function main() {
  // Prove at runtime what the URL claimed. A tunnel or a hosts entry could make
  // "localhost" mean something else; the database NAME is the second signal.
  const [{ db, server }] = await client.$queryRaw`
    SELECT current_database() AS db, coalesce(host(inet_server_addr()), 'local socket') AS server
  `
  console.log(
    `${COMMIT ? 'COMMIT' : 'DRY RUN'} — database "${db}" on ${server} (url host: ${host})`
  )
  if (!COMMIT) console.log('Nothing will be written. Re-run with --commit to apply.')

  // Enumeration only — which rows to visit, not what complete means.
  const before = await client.companies.findMany({
    select: { id: true, tenant_id: true, name: true, is_complete: true, completeness_missing: true },
    orderBy: [{ tenant_id: 'asc' }, { name: 'asc' }],
  })

  console.log(`\n${before.length} companies.`)
  console.log(
    `  before: is_complete true on ${before.filter(c => c.is_complete).length}, ` +
      `completeness_missing set on ${before.filter(c => c.completeness_missing !== null).length}`
  )
  printDistribution('before — completeness_missing:', distribution(before, c => c.completeness_missing))

  const after = []
  const changed = []
  for (const company of before) {
    const result = await recomputeCompanyCompleteness(company.id, company.tenant_id)
    if (!result) {
      // findFirst inside the helper returned nothing — only possible if the row
      // vanished between the two queries. Report it rather than swallowing it.
      console.error(`  ! ${company.name} (${company.id}) could not be read back; skipped.`)
      continue
    }
    after.push({ ...company, ...result })
    if (
      result.is_complete !== company.is_complete ||
      result.completeness_missing !== company.completeness_missing
    ) {
      changed.push({ company, result })
    }
  }

  console.log(
    `\n  after:  is_complete true on ${after.filter(c => c.is_complete).length}, ` +
      `completeness_missing set on ${after.filter(c => c.completeness_missing !== null).length}`
  )
  printDistribution('after — completeness_missing:', distribution(after, c => c.completeness_missing))

  console.log(`\n${changed.length} rows differ from what is stored. ${writes.length} UPDATE(s) ${COMMIT ? 'issued' : 'suppressed'}.`)
  for (const { company, result } of changed.slice(0, 40)) {
    const from = `${company.is_complete ? 'complete' : 'incomplete'}/${missingKey(company.completeness_missing)}`
    const to = `${result.is_complete ? 'complete' : 'incomplete'}/${missingKey(result.completeness_missing)}`
    console.log(`  ${company.name}\n      ${from}\n   -> ${to}`)
  }
  if (changed.length > 40) console.log(`  … and ${changed.length - 40} more.`)

  if (!COMMIT && changed.length > 0) {
    console.log('\nDry run: the database is unchanged. Re-run with --commit to write the above.')
  }
  if (COMMIT && changed.length === 0) {
    console.log('\nNothing to do — every row already holds the computed value. (Idempotent.)')
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await client.$disconnect()
  })
