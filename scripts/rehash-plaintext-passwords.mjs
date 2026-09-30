#!/usr/bin/env node
/**
 * T1.2 — rehash the `users.password` rows that are still stored in CLEARTEXT.
 *
 * Every write path now hashes (the tenant user routes always did; the three
 * SuperAdmin company routes were fixed alongside this script), and
 * `/api/auth/login` upgrades a plaintext row to a hash on the first successful
 * login. That covers every account that logs in. This script is for the ones
 * that do not — an administrator provisioned for a firm and never used, a
 * dormant salesperson — whose password would otherwise sit readable in the
 * database indefinitely.
 *
 *   node scripts/rehash-plaintext-passwords.mjs                              # dry run, LOCAL db
 *   node --env-file=.env.rds scripts/rehash-plaintext-passwords.mjs --use-database-url
 *                                                                            # dry run, PRODUCTION (RDS)
 *   node --env-file=.env.rds scripts/rehash-plaintext-passwords.mjs --use-database-url --apply --host <rds-host>
 *                                                                            # write, PRODUCTION (RDS)
 *
 * DRY RUN IS THE DEFAULT. Without `--apply` this opens a read-only connection's
 * worth of queries and writes nothing at all.
 *
 * --- WHAT COUNTS AS PLAINTEXT ---------------------------------------------
 * The same test `/api/auth/login` uses to decide whether to `bcrypt.compare` or
 * to compare strings: a stored value is hashed iff it starts with `$2`. That
 * covers the `$2a$` / `$2b$` / `$2y$` bcrypt prefixes. Anything else — and
 * anything that is not a non-empty string — is treated as cleartext. The SQL
 * below pre-filters on the same prefix, but the JavaScript test is the
 * authority, exactly so this cannot drift from the login route.
 *
 * Rows are rehashed ONE AT A TIME with `bcrypt.hash(value, 12)` — the same cost
 * factor as /api/masters/users, /api/auth/reset-password and the lazy upgrade in
 * /api/auth/login. Each UPDATE re-asserts the old value in its WHERE clause, so
 * a row that someone logged into mid-run (and which the login route therefore
 * already hashed) is left alone rather than double-hashed. Interrupting the run
 * is safe: rerunning only touches what is still cleartext.
 *
 * NOTHING IN THIS SCRIPT PRINTS A PASSWORD, hashed or not. Output is counts per
 * tenant plus row ids.
 *
 * --- DATABASE -------------------------------------------------------------
 * Resolved by scripts/release-db.mjs, shared with the can_create backfill and
 * the readiness check. SCRATCH_DATABASE_URL (the LOCAL database) by default;
 * `--use-database-url` targets DATABASE_URL. PRODUCTION IS RDS, so production needs
 * `--env-file=.env.rds`, whose values win over `.env.local`. A non-local host
 * is always reached over TLS verified against DATABASE_CA_CERT_PATH, the host
 * and database name are printed before connecting, and `--apply` against a
 * non-local host refuses unless `--host` names that host.
 */
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { resolveReleaseDb } from './release-db.mjs'

const COST = 12

/** The login route's test, verbatim in substance: hashed iff it starts with `$2`. */
function isPlaintext(password) {
  return typeof password === 'string' && password.length > 0 && !password.startsWith('$2')
}

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')

const db = resolveReleaseDb({ script: 'rehash-plaintext-passwords', args, apply: APPLY })
const client = new pg.Client(db.connection)

async function main() {
  await client.connect()

  // The NOT LIKE is only a pre-filter; isPlaintext() below has the final say.
  const { rows } = await client.query(`
    SELECT u.id, u.tenant_id, u.password, u.profile, u.status,
           COALESCE(t.name, '(no tenant)') AS tenant_name
      FROM users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.password IS NOT NULL
       AND u.password <> ''
       AND u.password NOT LIKE '$2%'
     ORDER BY u.tenant_id NULLS FIRST, u.created_at
  `)

  const targets = rows.filter(r => isPlaintext(r.password))

  if (targets.length === 0) {
    console.log('No cleartext passwords found. Nothing to do.')
    return
  }

  // Counts per tenant — never a value.
  const byTenant = new Map()
  for (const r of targets) {
    const key = `${r.tenant_name}  [${r.tenant_id ?? 'null'}]`
    const bucket = byTenant.get(key) ?? { total: 0, admins: 0, inactive: 0 }
    bucket.total += 1
    if (r.profile === 'Administrator') bucket.admins += 1
    if (r.status !== 'Active') bucket.inactive += 1
    byTenant.set(key, bucket)
  }

  console.log(`=== cleartext passwords: ${targets.length} row(s) across ${byTenant.size} tenant(s) ===`)
  for (const [tenant, b] of byTenant) {
    console.log(`  ${String(b.total).padStart(5)}  ${tenant}   (administrators: ${b.admins}, not Active: ${b.inactive})`)
  }

  if (!APPLY) {
    console.log('\nDry run — nothing was written. Re-run with --apply to rehash these rows.')
    return
  }

  console.log('\nRehashing…')
  let changed = 0, skipped = 0, failed = 0

  for (const row of targets) {
    try {
      const hash = await bcrypt.hash(row.password, COST)
      // `password = $3` guards against a login having rehashed this row since
      // the SELECT: that write wins and this one becomes a no-op.
      const res = await client.query(
        'UPDATE users SET password = $1 WHERE id = $2 AND password = $3',
        [hash, row.id, row.password]
      )
      if (res.rowCount === 1) {
        changed += 1
      } else {
        skipped += 1
        console.log(`  skipped (changed under us): ${row.id}`)
      }
    } catch (err) {
      failed += 1
      console.error(`  FAILED: ${row.id} — ${err.message}`)
    }
  }

  console.log(`\nrehashed: ${changed}   skipped: ${skipped}   failed: ${failed}`)
  if (failed > 0) {
    console.log('Rerun the script — it only touches rows that are still cleartext.')
    process.exitCode = 1
  }
}

main()
  .catch(err => {
    console.error(err.message)
    process.exitCode = 1
  })
  .finally(() => client.end())
