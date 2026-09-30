#!/usr/bin/env node
/**
 * One-time data fix: copy `can_edit` into `can_create` on the `meetings`,
 * `expenses` and `orders` sections of role_permissions.
 *
 * `role_permissions.can_create` is `NOT NULL DEFAULT false`, and until now
 * nothing checked it for these three sections: creating a meeting, an expense
 * or an order was gated on `edit` (or not gated at all). The routes now check
 * `create`, so a role that was granted Edit but never had Create ticked, which
 * is every role created before the matrix had a Create column for them, would
 * lose the ability to log meetings, expenses and orders on deploy. This script
 * keeps those roles working: wherever `can_edit = true AND can_create = false`
 * on one of those three sections, it sets `can_create = true`. Nothing else is
 * touched: no other section, no other column, no row where Edit is off.
 *
 *   node scripts/backfill-can-create.mjs                                   # dry run, LOCAL db
 *   node scripts/backfill-can-create.mjs --tenant <uuid>                   # dry run, one tenant
 *   node --env-file=.env.rds scripts/backfill-can-create.mjs --use-database-url
 *                                                                          # dry run, PRODUCTION (RDS)
 *   node --env-file=.env.rds scripts/backfill-can-create.mjs --use-database-url --apply --host <rds-host>
 *                                                                          # write, PRODUCTION (RDS)
 *
 * DRY RUN IS THE DEFAULT. Without `--apply` this runs one SELECT and writes
 * nothing. It prints per-tenant, per-role, per-section what it WOULD change.
 *
 * IDEMPOTENT. The UPDATE re-asserts `can_edit = true AND can_create = false`
 * in its WHERE, so a rerun matches nothing and changes nothing, and a row an
 * administrator edited between the SELECT and the UPDATE is left as they set it.
 *
 * --- DATABASE -------------------------------------------------------------
 * Resolved by scripts/release-db.mjs, shared with the rehash script and the
 * readiness check. SCRATCH_DATABASE_URL (the LOCAL database) by default;
 * `--use-database-url` targets DATABASE_URL. Only local or AWS RDS hosts are
 * allowed. PRODUCTION IS RDS, so production needs `--env-file=.env.rds`, whose values win over `.env.local`. A non-local host
 * is always reached over TLS verified against DATABASE_CA_CERT_PATH, the host
 * and database name are printed before connecting, and `--apply` against a
 * non-local host refuses unless `--host` names that host.
 */
import pg from 'pg'
import { resolveReleaseDb } from './release-db.mjs'

const SECTIONS = ['meetings', 'expenses', 'orders']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const tenantIdx = args.indexOf('--tenant')
const TENANT = tenantIdx >= 0 ? args[tenantIdx + 1] : undefined
if (tenantIdx >= 0 && (!TENANT || !UUID.test(TENANT))) {
  console.error('--tenant needs a tenant uuid, e.g. --tenant 00000000-0000-0000-0000-000000000001')
  process.exit(1)
}
const hostIdx = args.indexOf('--host')
const KNOWN = new Set(['--apply', '--use-database-url', '--tenant', '--host'])
const valueAt = new Set([tenantIdx, hostIdx].filter(i => i >= 0).map(i => i + 1))
const unknown = args.filter((a, i) => !KNOWN.has(a) && !valueAt.has(i))
if (unknown.length) {
  console.error(`Unknown argument(s): ${unknown.join(' ')}`)
  process.exit(1)
}

const db = resolveReleaseDb({ script: 'backfill-can-create', args, apply: APPLY })
const client = new pg.Client(db.connection)

// The one predicate both the SELECT and the UPDATE use, so the dry run reports
// exactly the rows --apply would change. $1 = sections, $2 = tenant or null.
const MATCH = `
  rp.section = ANY($1::text[])
  AND rp.can_edit = true
  AND rp.can_create = false
  AND ($2::uuid IS NULL OR rp.tenant_id = $2::uuid)
`

async function main() {
  await client.connect()

  console.log(`sections: ${SECTIONS.join(', ')}`)
  console.log(`tenant:   ${TENANT ?? 'all tenants'}\n`)

  const { rows } = await client.query(`
    SELECT rp.tenant_id, COALESCE(t.name, '(no tenant row)') AS tenant_name,
           rp.profile, rp.section
      FROM role_permissions rp
      LEFT JOIN tenants t ON t.id = rp.tenant_id
     WHERE ${MATCH}
     ORDER BY t.name NULLS LAST, rp.tenant_id, rp.profile, rp.section
  `, [SECTIONS, TENANT ?? null])

  if (rows.length === 0) {
    console.log('No role has Edit without Create on these sections. Nothing to do.')
    return
  }

  // tenant -> role -> sections
  const byTenant = new Map()
  for (const r of rows) {
    const key = `${r.tenant_name}  [${r.tenant_id}]`
    const roles = byTenant.get(key) ?? new Map()
    const secs = roles.get(r.profile) ?? []
    secs.push(r.section)
    roles.set(r.profile, secs)
    byTenant.set(key, roles)
  }

  const perSection = Object.fromEntries(SECTIONS.map(s => [s, rows.filter(r => r.section === s).length]))
  console.log(`=== ${APPLY ? 'changing' : 'would change'}: ${rows.length} row(s) across ${byTenant.size} tenant(s) ===`)
  console.log(`    per section: ${SECTIONS.map(s => `${s} ${perSection[s]}`).join(', ')}`)
  for (const [tenant, roles] of byTenant) {
    const count = [...roles.values()].reduce((n, s) => n + s.length, 0)
    console.log(`\n  ${tenant}   (${count} row(s), ${roles.size} role(s))`)
    for (const [role, secs] of roles) {
      console.log(`    ${role.padEnd(32)} ${secs.join(', ')}`)
    }
  }

  if (!APPLY) {
    console.log('\nDry run — nothing was written. Re-run with --apply to set can_create = true on these rows.')
    return
  }

  // One statement in one transaction: all or nothing. The WHERE re-asserts
  // the match, which is what makes a rerun a no-op.
  await client.query('BEGIN')
  try {
    const res = await client.query(`UPDATE role_permissions rp SET can_create = true WHERE ${MATCH}`, [SECTIONS, TENANT ?? null])
    await client.query('COMMIT')
    console.log(`\nupdated: ${res.rowCount} row(s)${res.rowCount !== rows.length ? `  (the dry-run count was ${rows.length}: rows changed between the two queries)` : ''}`)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

main()
  .catch(err => {
    console.error(err.message)
    process.exitCode = 1
  })
  .finally(() => client.end())
