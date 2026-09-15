#!/usr/bin/env node
/**
 * Smoke-test runner (PLAN.md §8.3). Discovers every suite under scripts/smoke/
 * and runs it against a live dev server, so adding a batch means adding one
 * file — the runner never changes.
 *
 *   node scripts/smoke-test.mjs              # every suite
 *   node scripts/smoke-test.mjs --batch auth # one suite
 *
 * Requires a server at SMOKE_BASE_URL (default http://127.0.0.1:3011). To feed
 * the tenant-scope audit, start that server with PRISMA_QUERY_LOG set.
 *
 * Routes that could NOT be exercised are collected with their reasons and
 * printed at the end — PLAN.md §8.3 requires that list in the final report.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BASE, disconnect } from './smoke/lib.mjs'

const args = process.argv.slice(2)
const only = args.includes('--batch') ? args[args.indexOf('--batch') + 1] : undefined

const dir = path.join(process.cwd(), 'scripts', 'smoke')
const suites = fs.readdirSync(dir)
  .filter(f => f.endsWith('.mjs') && f !== 'lib.mjs')
  .map(f => f.replace(/\.mjs$/, ''))
  .filter(n => !only || n === only)
  .sort()

if (!suites.length) {
  console.error(only ? `No smoke suite named "${only}".` : 'No smoke suites found.')
  process.exit(1)
}

// Fail fast with a clear message rather than a wall of fetch errors.
try {
  await fetch(`${BASE}/login`, { redirect: 'manual' })
} catch {
  console.error(`No server reachable at ${BASE}. Start one with:\n  PRISMA_QUERY_LOG=.audit/query-log.jsonl npx next dev -p 3011`)
  process.exit(1)
}

console.log(`Smoke tests against ${BASE}`)
let pass = 0, fail = 0
const notExercised = []

for (const suite of suites) {
  console.log(`\n=== ${suite} ===`)
  const mod = await import(pathToFileURL(path.join(dir, `${suite}.mjs`)).href)
  const r = await mod.run()
  pass += r.pass
  fail += r.fail
  notExercised.push(...r.notExercised.map(n => ({ ...n, suite })))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`${fail === 0 ? 'SMOKE TESTS PASSED' : `SMOKE TESTS FAILED — ${fail}`}   (${pass} passed, ${fail} failed)`)

if (notExercised.length) {
  console.log(`\nROUTES NOT EXERCISED (${notExercised.length}) — required in the final report:`)
  for (const n of notExercised) console.log(`  [${n.suite}] ${n.route}\n      ${n.why}`)
}

await disconnect()
process.exit(fail ? 1 : 0)
