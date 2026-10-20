#!/usr/bin/env node
/**
 * Phase 1 of docs/multi-firm-build-plan.md — backfill `people` and
 * `user_tenant_memberships` from the existing `users` table.
 *
 * One `people` row per distinct human, one `user_tenant_memberships` row per
 * existing `users` row, `user_id` pointing at that row and `profile` copied
 * from it. Nothing reads either table yet: after this script the application
 * behaves exactly as it did before, and every existing session keeps working.
 *
 *   node scripts/backfill-people-memberships.mjs            # dry run (default)
 *   node scripts/backfill-people-memberships.mjs --commit   # actually write
 *
 * The dry run is not an estimate: it runs the identical INSERTs inside a
 * transaction and ROLLBACKs, so its counts are the counts a commit produces.
 *
 * --- WHAT "DISTINCT HUMAN" MEANS HERE -------------------------------------
 * `users` is unique on (tenant_id, contact), so one phone can exist in two
 * firms. Those two rows MAY be the same human — and may not. This script is
 * not allowed to decide: it creates SEPARATE `people` rows, one per `users`
 * row, which is safe (nobody gains access they did not already have) and fully
 * reversible. Every cross-tenant `contact` collision is printed at the end as
 * the worklist for the Phase 4 human-confirmed merge. It NEVER auto-merges two
 * identities, and it never guesses when two rows carry different passwords.
 *
 * That is also why `people.contact` carries no unique index yet — see the
 * comment on the model in prisma/schema.prisma. Phase 5 adds it, after Phase 4
 * has merged the duplicates this script reports.
 *
 * --- IDEMPOTENCE ----------------------------------------------------------
 * A `users` row is "done" when a membership already points at it
 * (`user_tenant_memberships` is UNIQUE on `user_id`). Those rows are skipped
 * whole — no second `people` row, no second membership. A second run therefore
 * writes nothing and reports 0 created.
 *
 * --- DATABASE -------------------------------------------------------------
 * Reads SCRATCH_DATABASE_URL — the LOCAL database — and refuses any non-local
 * host. There is deliberately no flag to aim it at DATABASE_URL: the live
 * migration is run by a human, not by this script.
 *
 * Uses `pg` directly rather than Prisma, so it runs before `prisma generate`
 * has been re-run for the two new models.
 *
 * Requires that a human has already run `npm run scratch:push` — agents cannot
 * push the schema in this repo. The script checks for the tables and says so.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import pg from 'pg'
import { URL } from 'node:url'

function readEnv(key) {
  if (process.env[key]) return process.env[key]
  if (!fs.existsSync('.env.local')) return undefined
  const m = fs.readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/\r$/, '').replace(/^["']|["']$/g, '') : undefined
}

const COMMIT = process.argv.includes('--commit')

const raw = readEnv('SCRATCH_DATABASE_URL')
if (!raw) {
  console.error('SCRATCH_DATABASE_URL is not set (env or .env.local).')
  process.exit(1)
}

// Hard guard: this script writes rows. It must never see a hosted database.
const host = new URL(raw).hostname
const LOCAL = new Set(['localhost', '127.0.0.1', '::1'])
if (!LOCAL.has(host)) {
  console.error(`REFUSING TO RUN: SCRATCH_DATABASE_URL points at "${host}", not a local host.`)
  process.exit(1)
}
// Belt and braces: the hostname check alone would pass if the live database
// were ever reachable on a local host, so refuse on equality regardless.
const live = readEnv('DATABASE_URL')
if (live && live.trim() === raw.trim()) {
  console.error('REFUSING TO RUN: SCRATCH_DATABASE_URL is identical to DATABASE_URL.')
  process.exit(1)
}

const needsSsl = /[?&]sslmode=(?!disable)/.test(raw)
const client = new pg.Client({
  connectionString: raw.replace(/[?&]sslmode=[^&]*/, '').replace(/[?&]connection_limit=[^&]*/, ''),
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
})

const pad = n => String(n).padStart(5)

async function tablesExist() {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('people', 'user_tenant_memberships')`,
  )
  return new Set(rows.map(r => r.table_name))
}

async function main() {
  await client.connect()

  const have = await tablesExist()
  const missing = ['people', 'user_tenant_memberships'].filter(t => !have.has(t))
  if (missing.length > 0) {
    console.error(`\nMissing table(s): ${missing.join(', ')}.`)
    console.error('The Phase 1 models are in prisma/schema.prisma but have not been pushed.')
    console.error('`prisma db push` is blocked for AI agents in this repo — a human must run:')
    console.error('\n  npm run scratch:push\n')
    process.exit(1)
  }

  console.log(`\n=== Phase 1 backfill — people + user_tenant_memberships ===`)
  console.log(`database: ${host}   mode: ${COMMIT ? 'COMMIT' : 'DRY RUN (rolls back)'}`)

  // Ordered oldest-first so the row that today's login actually resolves to
  // (login is `findFirst` by contact ordered by created_at ASC) is processed
  // first and reads first in the collision report.
  const { rows: users } = await client.query(
    `SELECT u.id, u.tenant_id, u.name, u.email, u.contact, u.password,
            u.credentials_version, u.status, u.profile, u.created_at,
            t.id IS NOT NULL AS tenant_exists,
            m.id IS NOT NULL AS already_mapped
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN user_tenant_memberships m ON m.user_id = u.id
      ORDER BY u.created_at ASC, u.id ASC`,
  )

  const skipped = []   // { id, contact, reason }
  const todo = []
  let alreadyMapped = 0

  for (const u of users) {
    if (u.already_mapped) { alreadyMapped++; continue }
    if (!u.tenant_exists) {
      skipped.push({ id: u.id, contact: u.contact, reason: `tenant_id ${u.tenant_id} has no tenants row` })
      continue
    }
    const contact = (u.contact ?? '').trim()
    if (contact === '') {
      // `contact` is the login identifier. A people row without one can never
      // be logged into and would collide with every other blank in Phase 5.
      skipped.push({ id: u.id, contact: u.contact, reason: 'blank contact (no login identifier)' })
      continue
    }
    todo.push({ ...u, contact })
  }

  await client.query('BEGIN')
  let peopleCreated = 0
  let membershipsCreated = 0
  try {
    for (const u of todo) {
      const personId = crypto.randomUUID()
      // One people row per users row — never a merge. `password` and
      // `credentials_version` are copied verbatim from the source row, so the
      // person's existing credential keeps working unchanged.
      await client.query(
        `INSERT INTO people (id, contact, email, name, password, credentials_version, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [personId, u.contact, u.email ?? '', u.name ?? '', u.password ?? '',
         u.credentials_version ?? 1, u.status === 'Active' ? 'Active' : 'Inactive', u.created_at],
      )
      peopleCreated++

      // Membership status mirrors the source row rather than inventing one: a
      // deactivated `users` row becomes a Suspended membership, not an absent
      // one, so no access is granted that did not exist and no history is lost.
      // `joined_at` is the users row's created_at — the best truth available.
      await client.query(
        `INSERT INTO user_tenant_memberships (id, person_id, tenant_id, user_id, profile, status, joined_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [crypto.randomUUID(), personId, u.tenant_id, u.id, u.profile ?? 'Standard',
         u.status === 'Active' ? 'Active' : 'Suspended', u.created_at],
      )
      membershipsCreated++
    }

    // Reconcile INSIDE the transaction, so a dry run reports the post-commit
    // state and a commit refuses to finish on a mismatch.
    const { rows: [after] } = await client.query(
      `SELECT (SELECT count(*) FROM users)                                        AS users,
              (SELECT count(*) FROM people)                                       AS people,
              (SELECT count(*) FROM user_tenant_memberships)                      AS memberships,
              (SELECT count(*) FROM user_tenant_memberships m
                 LEFT JOIN users u ON u.id = m.user_id WHERE u.id IS NULL)        AS orphan_memberships,
              (SELECT count(*) FROM user_tenant_memberships m
                 LEFT JOIN people p ON p.id = m.person_id WHERE p.id IS NULL)     AS orphan_people_refs`,
    )

    const expectedMemberships = Number(after.users) - skipped.length
    const reconciles =
      Number(after.memberships) === expectedMemberships &&
      Number(after.orphan_memberships) === 0 &&
      Number(after.orphan_people_refs) === 0

    console.log('\n--- reconciliation -------------------------------------------')
    console.log(`  users rows                     ${pad(after.users)}`)
    console.log(`  already mapped before this run ${pad(alreadyMapped)}`)
    console.log(`  people created                 ${pad(peopleCreated)}`)
    console.log(`  memberships created            ${pad(membershipsCreated)}`)
    console.log(`  users skipped (see below)      ${pad(skipped.length)}`)
    console.log(`  people rows total              ${pad(after.people)}`)
    console.log(`  membership rows total          ${pad(after.memberships)}  (expected ${expectedMemberships})`)
    console.log(`  orphan memberships             ${pad(after.orphan_memberships)}`)
    console.log(`  memberships with no person     ${pad(after.orphan_people_refs)}`)

    if (skipped.length > 0) {
      console.log('\n--- users rows NOT mapped ------------------------------------')
      for (const s of skipped) console.log(`  ${s.id}  contact=${JSON.stringify(s.contact)}  — ${s.reason}`)
    }

    // Phase 4 worklist. Same phone in more than one firm: possibly one human,
    // possibly two. Each is now a separate people row, by design.
    const { rows: collisions } = await client.query(
      `SELECT u.contact,
              count(*)                                   AS user_rows,
              count(DISTINCT u.tenant_id)                AS tenants,
              count(DISTINCT u.password)                 AS distinct_hashes,
              string_agg(DISTINCT u.name, ' | ')         AS names
         FROM users u
        WHERE coalesce(btrim(u.contact), '') <> ''
        GROUP BY u.contact
       HAVING count(DISTINCT u.tenant_id) > 1
        ORDER BY count(*) DESC, u.contact`,
    )
    console.log('\n--- cross-tenant contact collisions (Phase 4 worklist) -------')
    if (collisions.length === 0) {
      console.log('  none — every contact appears in exactly one firm')
    } else {
      console.log('  Each of these is now SEVERAL people rows, deliberately. Phase 4 merges')
      console.log('  them per human, with the customer\'s confirmation. Never merged here.')
      for (const c of collisions) {
        console.log(`  ${c.contact}  firms=${c.tenants}  user_rows=${c.user_rows}  distinct_hashes=${c.distinct_hashes}  names=${c.names}`)
      }
    }

    if (!reconciles) {
      console.error('\nRECONCILIATION FAILED — rolling back. Nothing was written.')
      await client.query('ROLLBACK')
      process.exitCode = 1
      return
    }

    if (COMMIT) {
      await client.query('COMMIT')
      console.log('\nCOMMITTED.')
    } else {
      await client.query('ROLLBACK')
      console.log('\nDRY RUN — rolled back. Re-run with --commit to write.')
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

main()
  .catch(err => {
    console.error('\nFAILED:', err.message)
    process.exitCode = 1
  })
  .finally(() => client.end())
