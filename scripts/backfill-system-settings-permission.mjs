#!/usr/bin/env node
/**
 * P3-T1 — backfill `role_permissions` rows for the new `system_settings`
 * section.
 *
 * `src/lib/masters-registry.ts` gained the key. That half alone does not throw
 * anything: `GET /api/settings/role-permissions` reports `false` for a section
 * with no row and `checkPermission()` returns false when `findUnique` misses,
 * so the section is simply denied to every role except Administrator (which
 * short-circuits before the query). This script is the other half.
 *
 * --- WHY THE ROWS ARE WRITTEN DENIED, NOT COPIED --------------------------
 *
 * `scripts/backfill-permission-sections.mjs` copies each role's `leads` grant
 * into `companies`/`contacts`, and that is right THERE: the Companies screen
 * REPLACES the Leads screen, so a role that could edit Leads and suddenly
 * cannot edit Companies has lost something it used to have. Copying restores
 * the status quo.
 *
 * `system_settings` is not a replacement. Nobody held it before, because there
 * was no settings store at all until this task — so there is no status quo to
 * restore, and "denied" is not a regression.
 *
 * It also must not be copied, because of what these three values do. They
 * govern auto check-out (whose time decides when a rep's working day is closed
 * for them), the distance at which a meeting is flagged for review, and the
 * deal ageing window. A role whose `leads` or `users` grant says "can edit"
 * has been given permission to edit RECORDS; it has not been given permission
 * to move the line that decides whether its own meetings look suspicious.
 * Inheriting that from an unrelated grant would be a privilege escalation
 * performed silently by a migration, which is precisely the kind of thing
 * nobody reviews after the fact.
 *
 * So every (tenant, role) gets an explicit all-false row. The row exists — so
 * the Access Control matrix shows a real, toggleable state and an audit can
 * see the section — and an administrator grants it deliberately, to whoever
 * should have it. `--copy-from <section>` is available if the owner decides
 * otherwise; it is not the default and has to be typed.
 *
 *   node scripts/backfill-system-settings-permission.mjs                 # dry run
 *   node scripts/backfill-system-settings-permission.mjs --commit        # write
 *   node scripts/backfill-system-settings-permission.mjs --copy-from users --commit
 *
 * The dry run is not an estimate: it runs the identical INSERTs inside a
 * transaction and ROLLBACKs, so its counts are the counts a commit produces.
 *
 * Idempotent. The INSERT is guarded by NOT EXISTS on (tenant_id, profile,
 * section). A second run inserts 0.
 *
 * --- DATABASE -------------------------------------------------------------
 * Reads SCRATCH_DATABASE_URL by default (the LOCAL database). Pass
 * `--use-database-url` to target DATABASE_URL instead — that is production,
 * and the flag exists so nobody can hit it by accident.
 *
 * ⚠️ `role_permissions.section` carries a CHECK constraint in PRODUCTION
 * enumerating 31 values. `system_settings` is almost certainly NOT among them,
 * because that constraint predates this task. The LOCAL database has NO such
 * constraint — Prisma does not model CHECK constraints, so `db push` never
 * created it — which means this script and the whole feature pass locally and
 * would fail in production on the first INSERT. The constraint must be widened
 * there BEFORE this runs. That check is below and it is fatal, not a warning.
 */
import fs from 'node:fs'
import pg from 'pg'
import { URL } from 'node:url'

const NEW_SECTION = 'system_settings'

function readEnv(key) {
  if (process.env[key]) return process.env[key]
  if (!fs.existsSync('.env.local')) return undefined
  const m = fs.readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/\r$/, '').replace(/^["']|["']$/g, '') : undefined
}

function flagValue(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

const COMMIT = process.argv.includes('--commit')
const USE_LIVE = process.argv.includes('--use-database-url')
const COPY_FROM = flagValue('--copy-from')

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
    console.log('   created it). PRODUCTION DOES, and `system_settings` is almost certainly')
    console.log('   absent from it — this section is NEW. Widen the constraint there before')
    console.log('   deploying, or every INSERT and every permission toggle fails in production')
    console.log('   while passing here.')
    return
  }
  for (const r of rows) {
    console.log(`\nCHECK constraint ${r.conname}:\n  ${r.def}`)
    const ok = r.def.includes(`'${NEW_SECTION}'`)
    console.log(`  ${NEW_SECTION.padEnd(16)} ${ok ? 'permitted' : 'NOT PERMITTED — the INSERT will fail'}`)
    if (!ok) throw new Error(`Section "${NEW_SECTION}" is not in ${r.conname}. Widen the constraint first.`)
  }
}

async function counts(when) {
  console.log(`\n=== role_permissions — ${when} ===`)
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM role_permissions WHERE section = $1`,
    [NEW_SECTION],
  )
  console.log(`  ${NEW_SECTION.padEnd(16)} ${pad(rows[0].n)}`)
  const { rows: t } = await client.query('SELECT count(*)::int AS n FROM role_permissions')
  console.log(`  ${'TOTAL'.padEnd(16)} ${pad(t[0].n)}`)
  return t[0].n
}

/**
 * One row per distinct (tenant_id, profile) that already has ANY permission
 * row — that set IS the set of roles the tenant has configured. Deriving it
 * from role_permissions rather than from `roles` means this script has one
 * source of truth for "which roles exist" and cannot create a row for a role
 * the matrix does not render.
 */
async function backfillDenied() {
  const sql = `
    INSERT INTO role_permissions
      (tenant_id, profile, section, can_view, can_edit, can_delete, can_create, data_scope)
    SELECT DISTINCT src.tenant_id, src.profile, $1, false, false, false, false, 'all'
      FROM role_permissions src
     WHERE NOT EXISTS (
             SELECT 1 FROM role_permissions dst
              WHERE dst.tenant_id = src.tenant_id
                AND dst.profile   = src.profile
                AND dst.section   = $1
           )
    RETURNING id
  `
  const r = await client.query(sql, [NEW_SECTION])
  console.log(`  ${NEW_SECTION.padEnd(16)} ${pad(r.rowCount)} inserted (denied)`)
  return r.rowCount
}

/** Only via an explicit --copy-from. See the header for why this is not default. */
async function backfillCopied(source) {
  const sql = `
    INSERT INTO role_permissions
      (tenant_id, profile, section, can_view, can_edit, can_delete, can_create, data_scope)
    SELECT src.tenant_id, src.profile, $1, src.can_view, src.can_edit, src.can_delete,
           src.can_create, 'all'
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
  const r = await client.query(sql, [NEW_SECTION, source])
  console.log(`  ${NEW_SECTION.padEnd(16)} ${pad(r.rowCount)} inserted (copied from "${source}")`)
  return r.rowCount
}

async function main() {
  await client.connect()
  console.log(`database : ${url.replace(/:[^:@/]*@/, ':***@')}`)
  console.log(`mode     : ${COMMIT ? 'COMMIT' : 'DRY RUN (rolled back)'}`)
  console.log(`grants   : ${COPY_FROM ? `copied from "${COPY_FROM}"` : 'DENIED (all four flags false)'}`)

  await checkConstraint()
  const before = await counts('BEFORE')

  await client.query('BEGIN')
  try {
    console.log('\n=== INSERT ===')
    const total = COPY_FROM ? await backfillCopied(COPY_FROM) : await backfillDenied()

    await counts('AFTER (inside the transaction)')
    await table(
      '\nthe new rows',
      `SELECT profile, section, can_view, can_create, can_edit, can_delete, data_scope
         FROM role_permissions WHERE section = $1 ORDER BY tenant_id, profile`,
      [NEW_SECTION],
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
