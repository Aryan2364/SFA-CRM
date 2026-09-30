#!/usr/bin/env node
/**
 * READ-ONLY pre-release checks against the database the release will run on.
 *
 *   node scripts/prod-readiness-check.mjs                                          # LOCAL db
 *   node --env-file=.env.rds scripts/prod-readiness-check.mjs --use-database-url   # PRODUCTION (RDS)
 *   ... --out readiness.json    # write the full report to a file instead of stdout
 *   ... --host <rds-host>       # optional: refuse unless the loaded URL is this host
 *
 * It compares the live schema with prisma/schema.prisma (missing tables and
 * columns), lists the CHECK constraints and weekly_plans triggers the release
 * depends on, confirms the named columns the release reads exist, reports the
 * server timezone, and counts the rows the one-time scripts would touch per
 * tenant. A short summary prints first; the full detail follows as JSON.
 *
 * --- READ ONLY BY CONSTRUCTION ------------------------------------------------
 * Three independent locks, any one of which is enough:
 *   1. The session starts with `default_transaction_read_only=on`.
 *   2. Everything runs inside `BEGIN READ ONLY … ROLLBACK`, and the script
 *      checks `transaction_read_only = on` before its first query.
 *   3. The query helper refuses any statement that is not a SELECT (or WITH).
 * It prints no secrets: no URL, user, password, or users.password value.
 *
 * --- DATABASE -------------------------------------------------------------
 * Resolved by scripts/release-db.mjs, the same rules as the backfill and rehash
 * scripts. PRODUCTION IS RDS, so production needs `--env-file=.env.rds`. A non-local host is
 * always reached over TLS verified against DATABASE_CA_CERT_PATH.
 */
import fs from 'node:fs'
import pg from 'pg'
import { resolveReleaseDb, flagValue } from './release-db.mjs'

const args = process.argv.slice(2)
if (args.includes('--apply')) {
  console.error('prod-readiness-check is read-only; --apply means nothing here.')
  process.exit(1)
}
const OUT = flagValue(args, '--out')
if (args.includes('--out') && (!OUT || OUT.startsWith('--'))) {
  console.error('--out needs a file path, e.g. --out readiness.json')
  process.exit(1)
}

const db = resolveReleaseDb({ script: 'prod-readiness-check', args, apply: false })
const client = new pg.Client({
  ...db.connection,
  options: '-c default_transaction_read_only=on',
})

const out = { host: db.host, database: db.database }

async function select(sql, params) {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error(`refusing a non-SELECT statement: ${sql.trim().slice(0, 40)}…`)
  return (await client.query(sql, params)).rows
}
const q = async (label, sql, params) => (out[label] = await select(sql, params))

// schema.prisma scalar fields per model
const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
const models = {}
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) models[m[1]] = m[2]
const modelNames = new Set(Object.keys(models))
const expected = {}
for (const [name, body] of Object.entries(models)) {
  expected[name] = []
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('//') || t.startsWith('@@')) continue
    const [field, type] = t.split(/\s+/)
    if (!type) continue
    const base = type.replace(/[?\[\]]/g, '')
    if (type.endsWith('[]') || modelNames.has(base) || t.includes('@relation')) continue
    expected[name].push(field)
  }
}

async function main() {
  await client.connect()
  await client.query('BEGIN READ ONLY')
  const [{ ro }] = await select(`SELECT current_setting('transaction_read_only') ro`)
  if (ro !== 'on') throw new Error(`transaction is not read-only (transaction_read_only=${ro}); stopping`)

  await q('session', `SELECT current_database() db, version(), current_setting('transaction_read_only') tx_ro,
    current_setting('default_transaction_read_only') default_ro,
    (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) ssl,
    (SELECT version FROM pg_stat_ssl WHERE pid = pg_backend_pid()) tls_version`)
  await q('timezone', `SELECT current_setting('TimeZone') tz, now()::text now, (now() AT TIME ZONE 'UTC')::text now_utc,
    (SELECT setting FROM pg_settings WHERE name='TimeZone') setting, (SELECT source FROM pg_settings WHERE name='TimeZone') source,
    (SELECT boot_val FROM pg_settings WHERE name='TimeZone') boot_val, (SELECT reset_val FROM pg_settings WHERE name='TimeZone') reset_val`)
  await q('db_role_tz', `SELECT r.rolname, d.datname, s.setconfig FROM pg_db_role_setting s
    LEFT JOIN pg_roles r ON r.oid = s.setrole LEFT JOIN pg_database d ON d.oid = s.setdatabase
    WHERE array_to_string(s.setconfig, ',') ILIKE '%timezone%'`)

  const exists = async t => (await select(`SELECT to_regclass($1) r`, [`public.${t}`]))[0].r
  const tbls = ['daily_visits', 'remarks', 'contextual_remarks', 'weekly_plans', 'role_permissions', 'companies', 'orders']
  const present = []
  for (const t of tbls) if (await exists(t)) present.push(t)
  out.tables_checked = { present, missing: tbls.filter(t => !present.includes(t)) }
  await q('check_constraints', `SELECT c.conrelid::regclass::text tbl, c.conname, pg_get_constraintdef(c.oid) def
    FROM pg_constraint c WHERE c.contype='c' AND c.conrelid = ANY($1::regclass[]) ORDER BY 1,2`,
  [present.map(t => `public.${t}`)])

  if (present.includes('weekly_plans')) {
    await q('weekly_plans_triggers', `SELECT t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) def, p.proname,
      pg_get_functiondef(p.oid) fn FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = 'public.weekly_plans'::regclass AND NOT t.tgisinternal`)
  }

  const want = [
    ['users', 'credentials_version'], ['users', 'password_reset_token'], ['users', 'password_reset_expires'],
    ['weekly_plans', 'updated_at'], ['companies', 'owner_user_id'], ['companies', 'created_by_user_id'],
    ['role_permissions', 'can_create'], ['role_permissions', 'data_scope'],
  ]
  const cols = await select(`SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema='public'`)
  const live = new Map()
  for (const r of cols) { if (!live.has(r.table_name)) live.set(r.table_name, new Map()); live.get(r.table_name).set(r.column_name, r) }
  out.named_columns = want.map(([t, c]) => ({ t, c, present: !!live.get(t)?.get(c), info: live.get(t)?.get(c) ?? null }))
  out.point_config_journal = ['point_config', 'point_config_history', 'journal_entries'].map(t => ({
    t, table: live.has(t), missing_cols: live.has(t) ? (expected[t] ?? []).filter(c => !live.get(t).has(c)) : (expected[t] ?? []) }))

  // full schema.prisma vs live diff
  const missingTables = [], missingCols = []
  for (const [t, fields] of Object.entries(expected)) {
    if (!live.has(t)) { missingTables.push(t); continue }
    for (const f of fields) if (!live.get(t).has(f)) missingCols.push(`${t}.${f}`)
  }
  const extraTables = [...live.keys()].filter(t => !expected[t]).sort()
  out.schema_diff = { models: Object.keys(expected).length, missingTables, missingCols, extraTables }

  // lat/long
  out.latlong = []
  for (const t of ['companies', 'company_addresses']) {
    const cs = ['latitude', 'longitude'].filter(c => live.get(t)?.has(c))
    const row = { t, table: live.has(t), columns: cs }
    if (cs.length) {
      const [r] = await select(`SELECT count(*)::int total, ${cs.map(c => `count(${c})::int nn_${c}`).join(', ')},
        count(*) FILTER (WHERE ${cs.map(c => `${c} IS NOT NULL`).join(' OR ')})::int any_nn FROM ${t}`)
      Object.assign(row, r)
    }
    out.latlong.push(row)
  }

  await q('tenants', `SELECT id, name, status FROM tenants ORDER BY name`)
  await q('perm_sections', `SELECT t.name, t.id, s.section, count(rp.id)::int n,
      count(rp.id) FILTER (WHERE rp.can_view)::int can_view
    FROM tenants t CROSS JOIN unnest(ARRAY['deals','contact_types','industries','reason_for_loss']) s(section)
    LEFT JOIN role_permissions rp ON rp.tenant_id = t.id AND rp.section = s.section
    GROUP BY 1,2,3 ORDER BY 1,3`)
  await q('perm_profiles', `SELECT t.name, count(DISTINCT rp.profile)::int profiles FROM tenants t
    LEFT JOIN role_permissions rp ON rp.tenant_id = t.id GROUP BY 1 ORDER BY 1`)
  if (live.get('companies')?.has('owner_user_id')) {
    await q('unowned_companies', `SELECT t.name, t.id, count(c.id)::int total,
        count(c.id) FILTER (WHERE c.owner_user_id IS NULL)::int no_owner
      FROM tenants t LEFT JOIN companies c ON c.tenant_id = t.id GROUP BY 1,2 ORDER BY 1`)
  }
  if (live.get('role_permissions')?.has('can_create')) {
    // What scripts/backfill-can-create.mjs would change, per tenant.
    await q('can_create_backfill_pending', `SELECT t.name, rp.tenant_id, count(*)::int AS n
      FROM role_permissions rp LEFT JOIN tenants t ON t.id = rp.tenant_id
      WHERE rp.section = ANY(ARRAY['meetings','expenses','orders']) AND rp.can_edit AND NOT rp.can_create
      GROUP BY 1,2 ORDER BY 1`)
  }
  // What scripts/rehash-plaintext-passwords.mjs would change, per tenant. Counts only.
  await q('plaintext_passwords_pending', `SELECT COALESCE(t.name, '(no tenant)') AS name, u.tenant_id, count(*)::int AS n
    FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE u.password IS NOT NULL AND u.password <> '' AND u.password NOT LIKE '$2%'
    GROUP BY 1,2 ORDER BY 1`)
  if (present.includes('daily_visits'))
    await q('visit_type_values', `SELECT visit_type, count(*)::int n FROM daily_visits GROUP BY 1 ORDER BY 2 DESC`)
  if (present.includes('contextual_remarks'))
    await q('remark_context_values', `SELECT context_type, count(*)::int n FROM contextual_remarks GROUP BY 1 ORDER BY 2 DESC`)
  if (present.includes('weekly_plans'))
    await q('weekly_plan_status_values', `SELECT status, count(*)::int n FROM weekly_plans GROUP BY 1 ORDER BY 2 DESC`)

  const s = out.session[0]
  const missingNamed = out.named_columns.filter(c => !c.present).map(c => `${c.t}.${c.c}`)
  const sum = rows => (rows ?? []).reduce((n, r) => n + r.n, 0)
  console.log('=== summary ===')
  console.log(`read-only:            transaction ${s.tx_ro}, session default ${s.default_ro}`)
  console.log(`tls:                  ${s.ssl ? `yes (${s.tls_version})` : 'NO'}`)
  console.log(`server timezone:      ${out.timezone[0].tz}`)
  console.log(`tenants:              ${out.tenants.length}`)
  console.log(`missing tables:       ${missingTables.length ? missingTables.join(', ') : 'none'}`)
  console.log(`missing columns:      ${missingCols.length ? missingCols.join(', ') : 'none'}`)
  console.log(`release columns:      ${missingNamed.length ? `MISSING ${missingNamed.join(', ')}` : 'all present'}`)
  console.log(`can_create backfill:  ${out.can_create_backfill_pending ? `${sum(out.can_create_backfill_pending)} row(s) pending` : 'n/a (no can_create column)'}`)
  console.log(`plaintext passwords:  ${sum(out.plaintext_passwords_pending)} row(s) pending`)

  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
    console.log(`\nfull report written to ${OUT}`)
  } else {
    console.log('\n=== full report ===')
    console.log(JSON.stringify(out, null, 2))
  }
}

main()
  .catch(err => {
    console.error('ERR', err.code ?? '', err.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await client.query('ROLLBACK').catch(() => {})
    await client.end()
  })
