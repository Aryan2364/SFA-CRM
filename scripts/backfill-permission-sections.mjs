#!/usr/bin/env node
/**
 * P1-T9 — backfill `role_permissions` rows for the new `companies` and
 * `contacts` sections.
 *
 * `src/lib/masters-registry.ts` gained both keys. That half is harmless on its
 * own only in appearance: `GET /api/settings/role-permissions` reports `false`
 * for any section with no row, and `checkPermission()` returns false when
 * `findUnique` misses. So a deploy with the new keys and no rows does not throw
 * anything — it silently denies Companies and Contacts to every role except
 * Administrator (which short-circuits before the query). This script is the
 * other half.
 *
 * Each new row COPIES that (tenant, role)'s existing `leads` grant — the
 * Companies screen replaces the Leads screen, so "whatever you could do to
 * Leads" is the correct starting point, and `data_scope` is copied with it.
 *
 *   node scripts/backfill-permission-sections.mjs              # dry run (default)
 *   node scripts/backfill-permission-sections.mjs --commit     # actually write
 *
 * The dry run is not an estimate: it runs the identical INSERTs inside a
 * transaction and ROLLBACKs, so its counts are the counts a commit produces.
 *
 * Idempotent. The INSERT is guarded by NOT EXISTS on (tenant_id, profile,
 * section) rather than by ON CONFLICT — the unique index is there on both
 * databases, but NOT EXISTS states the intent and cannot be defeated by a
 * missing index. A second run inserts 0.
 *
 * --- DATABASE -------------------------------------------------------------
 * Reads SCRATCH_DATABASE_URL by default (the LOCAL database). Pass
 * `--use-database-url` to target DATABASE_URL instead — that is production, and
 * the flag exists so nobody can hit it by accident.
 *
 * ⚠️ `role_permissions.section` carries a CHECK constraint in PRODUCTION
 * enumerating 31 values (`companies` and `contacts` among them). The LOCAL
 * database has NO such constraint — Prisma does not model CHECK constraints, so
 * `db push` never created it. A section key that is missing from production's
 * constraint therefore fails there and passes locally. This script asserts the
 * keys it writes are permitted, and reports when there is no constraint to
 * check them against.
 */
import fs from 'node:fs'
import pg from 'pg'
import { URL } from 'node:url'

// Copied from `leads`. Order is cosmetic — the rows are keyed, not ordered.
const NEW_SECTIONS = ['companies', 'contacts']
const SOURCE_SECTION = 'leads'

function readEnv(key) {
  if (process.env[key]) return process.env[key]
  if (!fs.existsSync('.env.local')) return undefined
  const m = fs.readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/\r$/, '').replace(/^["']|["']$/g, '') : undefined
}

const COMMIT = process.argv.includes('--commit')
const USE_LIVE = process.argv.includes('--use-database-url')

const url = readEnv(USE_LIVE ? 'DATABASE_URL' : 'SCRATCH_DATABASE_URL')
if (!url) {
  console.error(`${USE_LIVE ? 'DATABASE_URL' : 'SCRATCH_DATABASE_URL'} is not set (env or .env.local).`)
  process.exit(1)
}

const host = new URL(url).hostname
const LOCAL = new Set(['localhost', '127.0.0.1', '::1'])
if (!USE_LIVE && !LOCAL.has(host)) {
  console.error(`REFUSING TO RUN: SCRATCH_DATABASE_URL points at "${host}", not a local host.`)
  process.exit(1)
}

const needsSsl = /[?&]sslmode=(?!disable)/.test(url)
const client = new pg.Client({
  connectionString: url.replace(/[?&]sslmode=[^&]*/, '').replace(/[?&]connection_limit=[^&]*/, ''),
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
})

const pad = n => String(n).padStart(5)

async function table(label, sql, params = []) {
  const { rows } = await client.query(sql, params)
  console.log(`\n${label}`)
  if (rows.length === 0) console.log('  (no rows)')
  for (const r of rows) console.log('  ' + Object.values(r).map(v => String(v)).join('  |  '))
  return rows
}

async function counts(when) {
  console.log(`\n=== role_permissions — ${when} ===`)
  const { rows } = await client.query(
    `SELECT section, count(*)::int AS n FROM role_permissions
      WHERE section = ANY($1::text[]) GROUP BY section ORDER BY section`,
    [[SOURCE_SECTION, ...NEW_SECTIONS]],
  )
  const bySection = new Map(rows.map(r => [r.section, r.n]))
  for (const s of [SOURCE_SECTION, ...NEW_SECTIONS]) {
    console.log(`  ${s.padEnd(12)} ${pad(bySection.get(s) ?? 0)}`)
  }
  const { rows: t } = await client.query('SELECT count(*)::int AS n FROM role_permissions')
  console.log(`  ${'TOTAL'.padEnd(12)} ${pad(t[0].n)}`)
  return t[0].n
}

async function checkConstraint() {
  const { rows } = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'role_permissions'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%section%'
  `)
  if (rows.length === 0) {
    console.log('\n⚠️  No CHECK constraint on role_permissions.section on this database.')
    console.log('   Local has none (Prisma does not model CHECK constraints, so db push never')
    console.log('   created it). PRODUCTION DOES — a key missing from it fails there and')
    console.log('   passes here. Do not read this as "the constraint is gone everywhere".')
    return
  }
  for (const r of rows) {
    console.log(`\nCHECK constraint ${r.conname}:\n  ${r.def}`)
    for (const s of NEW_SECTIONS) {
      const ok = r.def.includes(`'${s}'`)
      console.log(`  ${s.padEnd(12)} ${ok ? 'permitted' : 'NOT PERMITTED — the INSERT will fail'}`)
      if (!ok) throw new Error(`Section "${s}" is not in ${r.conname}. Widen the constraint first.`)
    }
  }
}

async function backfill(section) {
  const sql = `
    INSERT INTO role_permissions
      (tenant_id, profile, section, can_view, can_edit, can_delete, can_create, data_scope)
    SELECT src.tenant_id, src.profile, $1, src.can_view, src.can_edit, src.can_delete,
           src.can_create, src.data_scope
      FROM role_permissions src
     WHERE src.section = $2
       AND NOT EXISTS (
             SELECT 1 FROM role_permissions dst
              WHERE dst.tenant_id = src.tenant_id
                AND dst.profile   = src.profile
                AND dst.section   = $1
           )
    RETURNING id
  `
  const r = await client.query(sql, [section, SOURCE_SECTION])
  console.log(`  ${section.padEnd(12)} ${pad(r.rowCount)} inserted`)
  return r.rowCount
}

async function main() {
  await client.connect()
  console.log(`database : ${url.replace(/:[^:@/]*@/, ':***@')}`)
  console.log(`mode     : ${COMMIT ? 'COMMIT' : 'DRY RUN (rolled back)'}`)

  await checkConstraint()
  const before = await counts('BEFORE')

  await client.query('BEGIN')
  try {
    console.log('\n=== INSERT ===')
    let total = 0
    for (const s of NEW_SECTIONS) total += await backfill(s)

    await counts('AFTER (inside the transaction)')
    await table(
      '\nthe new rows',
      `SELECT profile, section, can_view, can_create, can_edit, can_delete, data_scope
         FROM role_permissions WHERE section = ANY($1::text[])
        ORDER BY section, profile`,
      [NEW_SECTIONS],
    )

    if (COMMIT) {
      await client.query('COMMIT')
      console.log(`\nCOMMITTED. ${total} rows inserted; role_permissions ${before} -> ${before + total}.`)
    } else {
      await client.query('ROLLBACK')
      console.log(`\nDRY RUN — rolled back. A --commit run would insert ${total} rows (${before} -> ${before + total}).`)
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message)
  process.exit(1)
})
