#!/usr/bin/env node
/**
 * Tenant-scope audit (PLAN.md §8.2). Run once per batch — it is a GATE, not a
 * final check. Dropping a tenant_id filter leaks data across tenants with
 * nothing crashing, which is the single highest-consequence failure in this
 * migration.
 *
 * Two independent passes, because each catches what the other misses:
 *
 *   A. STATIC / git cross-check. For every file in the batch, compare the
 *      .eq('tenant_id', …) filters in the pre-migration version against the
 *      tenant_id predicates in the converted version. Catches a filter dropped
 *      during conversion even on a code path no test exercises.
 *
 *   B. RUNTIME query log. Parse the SQL actually emitted while the smoke tests
 *      ran and flag any SELECT/UPDATE/DELETE against a tenant-scoped table with
 *      no tenant_id predicate. Catches filters lost inside Prisma's query
 *      building, which static reading cannot see.
 *
 * Usage:
 *   node scripts/audit-tenant-scope.mjs --batch auth [--base <git-ref>] [--log <path>]
 *
 * Exit code is non-zero if either pass reports an unexplained violation.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const argOf = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const batchName = argOf('--batch') ?? 'unknown'
const baseRef = argOf('--base') ?? 'HEAD'
const logPath = argOf('--log') ?? '.audit/query-log.jsonl'

/** Files converted in each batch. Add the next batch's entry; do not rewrite. */
const BATCH_FILES = {
  'phase-a': [
    'src/lib/auth.ts',
    'src/lib/permissions.ts',
    'src/lib/visibility.ts',
    'src/lib/points.ts',
  ],
  auth: [
    'src/app/api/auth/login/route.ts',
    'src/app/api/auth/me/route.ts',
    'src/app/api/auth/logout/route.ts',
    'src/app/api/auth/forgot-password/route.ts',
    'src/app/api/auth/reset-password/route.ts',
  ],
}

const allowlist = JSON.parse(fs.readFileSync('scripts/tenant-scope-allowlist.json', 'utf8')).allow

// Tenant-scoped tables are derived from the schema, so a new table is covered
// automatically rather than relying on someone updating a hardcoded list.
const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
const tenantScoped = new Set()
const allModels = new Set()
{
  let model = null
  for (const line of schema.split(/\r?\n/)) {
    const s = line.trim()
    const m = s.match(/^model\s+(\w+)\s*\{/)
    if (m) { model = m[1]; allModels.add(model); continue }
    if (model && s === '}') { model = null; continue }
    if (model && /^tenant_id\s/.test(s)) tenantScoped.add(model)
  }
}

let failures = 0
const bad = msg => { console.log(`  VIOLATION  ${msg}`); failures++ }

console.log(`Tenant-scope audit — batch "${batchName}"`)
console.log(`  tenant-scoped tables: ${tenantScoped.size} of ${allModels.size}`)
console.log(`  exempt (no tenant_id column): ${[...allModels].filter(m => !tenantScoped.has(m)).join(', ') || 'none'}`)

// ---------------------------------------------------------------------------
// Pass A — static / git cross-check
// ---------------------------------------------------------------------------
console.log('\n[A] static cross-check against the pre-migration version')
const files = BATCH_FILES[batchName]
if (!files) {
  console.log(`  no file list registered for batch "${batchName}" — add one to BATCH_FILES`)
  failures++
} else {
  for (const file of files) {
    let before = ''
    try {
      before = execFileSync('git', ['show', `${baseRef}:${file}`], { encoding: 'utf8' })
    } catch {
      console.log(`  SKIP  ${file} (not present at ${baseRef})`)
      continue
    }
    const after = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    // Supabase filters, minus ones inside a comment line.
    const beforeFilters = (before.match(/\.eq\(\s*['"]tenant_id['"]/g) || []).length
    // Prisma predicates: tenant_id used as an object key in a where/data clause.
    const afterCode = after.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')
    const afterFilters = (afterCode.match(/\btenant_id\s*:/g) || []).length
    const ok = afterFilters >= beforeFilters
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${file}  (${beforeFilters} supabase -> ${afterFilters} prisma)`)
    if (!ok) bad(`${file} lost ${beforeFilters - afterFilters} tenant_id filter(s) in conversion`)
  }
}

// ---------------------------------------------------------------------------
// Pass B — runtime query log
// ---------------------------------------------------------------------------
console.log(`\n[B] runtime query log (${logPath})`)
if (!fs.existsSync(logPath)) {
  console.log('  NO LOG FOUND — run the smoke tests with PRISMA_QUERY_LOG set first.')
  console.log('  Pass B is required; treating its absence as a failure.')
  failures++
} else {
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  const seen = new Map()
  for (const line of lines) {
    let q
    try { q = JSON.parse(line).query } catch { continue }
    if (!/^\s*(SELECT|UPDATE|DELETE)/i.test(q)) continue
    // Which tenant-scoped tables does this statement touch?
    for (const table of tenantScoped) {
      const touches = new RegExp(`"public"\\."${table}"`).test(q)
      if (!touches) continue
      const hasTenant = /"tenant_id"/.test(q)
      if (hasTenant) continue
      const match = allowlist.find(a => a.table === table && new RegExp(a.queryPattern).test(q))
      const key = `${table}::${q.slice(0, 160)}`
      if (seen.has(key)) continue
      seen.set(key, true)
      if (match) {
        console.log(`  allowed  ${table}  [${match.id}]`)
      } else {
        bad(`${table} queried with no tenant_id predicate and no allowlist entry:\n             ${q.slice(0, 400)}`)
      }
    }
  }
  console.log(`  statements inspected: ${lines.length}`)
  if (!lines.length) { console.log('  log is EMPTY — the smoke run produced no queries.'); failures++ }
}

console.log(`\n${failures === 0 ? 'TENANT-SCOPE AUDIT CLEAN' : `TENANT-SCOPE AUDIT FAILED — ${failures} issue(s)`}`)
process.exit(failures ? 1 : 0)
