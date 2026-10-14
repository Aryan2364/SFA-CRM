#!/usr/bin/env node
/**
 * Applies a .sql file to the LOCAL database only (SCRATCH_DATABASE_URL in .env.local).
 * Refuses any host other than localhost / 127.0.0.1 / ::1. Runs statements one by one
 * and prints OK / ERR per statement, plus the rows of any SELECT (used for pre-checks).
 *
 * Usage: node scripts/local-sql.mjs <file.sql>
 * Never point it at RDS: production SQL is run by the owner on the server.
 */
import fs from 'node:fs'
import pg from 'pg'
const env = fs.readFileSync('.env.local', 'utf8')
const raw = (env.match(/^SCRATCH_DATABASE_URL=(.*)$/m) || [])[1]?.trim().replace(/^"|"$/g, '')
if (!raw) { console.error('SCRATCH_DATABASE_URL not set'); process.exit(1) }
const u = new URL(raw)
if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname)) { console.error('REFUSING: not local: ' + u.hostname); process.exit(1) }
console.log(`Target: ${u.hostname}:${u.port || 5432}${u.pathname}`)
const sql = fs.readFileSync(process.argv[2], 'utf8')
const client = new pg.Client({ connectionString: raw })
await client.connect()
// statements are separated by ";" at line end; run one at a time so a failure is pinpointed
const stmts = sql.split(/;\s*(?:\r?\n|$)/).map(s => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)
for (const s of stmts) {
  try {
    const r = await client.query(s)
    const first = s.split('\n')[0].slice(0, 90)
    if (r.command === 'SELECT') console.log(`OK  ${first}\n    -> ${r.rowCount} row(s)`, r.rows)
    else console.log(`OK  ${first}`)
  } catch (e) { console.log(`ERR ${s.split('\n')[0].slice(0, 90)}\n    -> ${e.message}`) }
}
await client.end()
