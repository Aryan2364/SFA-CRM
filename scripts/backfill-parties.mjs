#!/usr/bin/env node
/**
 * P1-T7 — split `business_partners` into Companies + Contacts + Addresses.
 *
 * Implements `02-DATA-MODEL-PLAN.md` §4.2 (contacts), §4.4 (addresses) and the
 * §3.5 completeness rule recorded in `REBUILD-PLAN.md` line 182.
 *
 * Runs against the LIVE database in `DATABASE_URL`. Everything it does is
 * additive: it INSERTs into `contacts`, `company_contacts` and
 * `company_addresses`, and UPDATEs exactly two columns on `business_partners`
 * (`is_complete`, `completeness_missing`). It never DELETEs and never touches
 * any other pre-existing column.
 *
 *   node scripts/backfill-parties.mjs              # dry run (default)
 *   node scripts/backfill-parties.mjs --commit     # actually write
 *
 * The dry run is not an estimate. It executes the identical statements inside a
 * transaction and ROLLBACKs, so its numbers are the numbers a commit produces.
 *
 * Idempotent. The guards are "does this company already have a linked contact"
 * and "does this company already have a primary address" — not "are the tables
 * empty" — so a second run inserts nothing. The completeness UPDATE skips rows
 * whose computed value already matches, which also keeps the `updated_at`
 * trigger from firing on a re-run.
 */
import fs from 'node:fs'
import pg from 'pg'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readEnv(key) {
  if (process.env[key]) return process.env[key]
  if (!fs.existsSync('.env.local')) return undefined
  const m = fs.readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/\r$/, '').replace(/^["']|["']$/g, '') : undefined
}

const COMMIT = process.argv.includes('--commit')
if (COMMIT && process.argv.includes('--dry-run')) {
  console.error('Pass either --commit or --dry-run, not both.')
  process.exit(1)
}

const url = readEnv('DATABASE_URL')
if (!url) {
  console.error('DATABASE_URL is not set (env or .env.local).')
  process.exit(1)
}

// §3.5 / REBUILD-PLAN.md:182 — the five compulsory fields, in the order they
// are listed there. The order is fixed so the generated string is stable and
// a re-run compares equal.
const REQUIRED = ['Primary Address', 'City', 'State', 'Pincode', 'GST Number']

// A `business_partners` row carries "address data" if ANY of these is set.
// Matches §4.4 and the shape measurement.
const HAS_ADDRESS_DATA = `(
     (bp.address IS NOT NULL AND btrim(bp.address) <> '')
  OR (bp.pincode IS NOT NULL AND btrim(bp.pincode) <> '')
  OR bp.state_id    IS NOT NULL
  OR bp.district_id IS NOT NULL
  OR bp.taluka_id   IS NOT NULL
  OR bp.village_id  IS NOT NULL
  OR bp.latitude    IS NOT NULL
  OR bp.longitude   IS NOT NULL
)`

const HAS_CONTACT_NAME = `(bp.contact_person_name IS NOT NULL AND btrim(bp.contact_person_name) <> '')`

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const fmt = (n) => String(n).padStart(5)
let failed = false

function line(label, value, expected) {
  const ok = expected === undefined || Number(value) === Number(expected)
  if (!ok) failed = true
  const tail = expected === undefined ? '' : ok ? '  ok' : `  MISMATCH (expected ${expected})`
  console.log(`  ${label.padEnd(42)} ${fmt(value)}${tail}`)
}

function heading(s) {
  console.log(`\n${s}\n${'-'.repeat(s.length)}`)
}

async function scalar(client, sql, params = []) {
  const r = await client.query(sql, params)
  return Number(Object.values(r.rows[0])[0])
}

// ---------------------------------------------------------------------------
// Step 0 — assertions. The measured shape this task was planned against.
// Anything that differs means the data moved under us; stop rather than guess.
// ---------------------------------------------------------------------------

async function assertShape(client) {
  heading('STEP 0 — source-data assertions (STOP on any mismatch)')

  line('business_partners total', await scalar(client, 'SELECT count(*) FROM business_partners'), 594)
  line("  stage = 'Prospect'", await scalar(client, "SELECT count(*) FROM business_partners WHERE stage = 'Prospect'"), 546)
  line("  stage = 'Existing'", await scalar(client, "SELECT count(*) FROM business_partners WHERE stage = 'Existing'"), 48)
  line('with contact_person_name', await scalar(client, `SELECT count(*) FROM business_partners bp WHERE ${HAS_CONTACT_NAME}`), 47)

  // contacts.mobile is NOT NULL. Assert no source row would violate it rather
  // than assuming the measurement still holds. A placeholder mobile would be
  // invented data, so this is a hard stop, not a fallback.
  line(
    '  of those, mobile_1 NULL or blank',
    await scalar(
      client,
      `SELECT count(*) FROM business_partners bp
        WHERE ${HAS_CONTACT_NAME} AND (bp.mobile_1 IS NULL OR btrim(bp.mobile_1) = '')`,
    ),
    0,
  )

  line('with any address data', await scalar(client, `SELECT count(*) FROM business_partners bp WHERE ${HAS_ADDRESS_DATA}`), 197)
  line('created_by_user_id NULL', await scalar(client, 'SELECT count(*) FROM business_partners WHERE created_by_user_id IS NULL'), 99)
  line(
    'with a GST number',
    await scalar(client, "SELECT count(*) FROM business_partners WHERE gst_number IS NOT NULL AND btrim(gst_number) <> ''"),
    0,
  )

  // Informational only — these are 0 on a first run and non-zero on a re-run,
  // so they must not gate. Idempotency is proved by the insert counts instead.
  console.log('\n  (informational — non-zero on a re-run, not a gate)')
  line('contacts', await scalar(client, 'SELECT count(*) FROM contacts'))
  line('company_contacts', await scalar(client, 'SELECT count(*) FROM company_contacts'))
  line('company_addresses', await scalar(client, 'SELECT count(*) FROM company_addresses'))

  if (failed) {
    throw new Error('Source data does not match the measured shape this task was planned against. Refusing to write.')
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Contacts (§4.2)
//
// One source row = one contact. A `contact_person_name` like "Rajesh / Suresh"
// is inserted verbatim; splitting it would invent a second person.
// ---------------------------------------------------------------------------

async function backfillContacts(client) {
  heading('STEP 1 — contacts + company_contacts (§4.2)')

  // `src` is MATERIALIZED so gen_random_uuid() is evaluated exactly once and
  // both INSERTs see the same contact id. Without it, PostgreSQL could inline
  // the CTE per reference and mint two different uuids.
  const sql = `
    WITH src AS MATERIALIZED (
      SELECT gen_random_uuid()          AS contact_id,
             bp.id                      AS company_id,
             bp.tenant_id,
             bp.contact_person_name     AS name,
             bp.mobile_1,
             bp.created_by_user_id,
             bp.is_active
        FROM business_partners bp
       WHERE ${HAS_CONTACT_NAME}
         AND NOT EXISTS (SELECT 1 FROM company_contacts cc WHERE cc.company_id = bp.id)
    ),
    ins_contact AS (
      INSERT INTO contacts (id, tenant_id, name, mobile, owner_user_id, is_complete, is_active)
      SELECT contact_id, tenant_id, name, mobile_1, created_by_user_id, (mobile_1 IS NOT NULL), is_active
        FROM src
      RETURNING id
    ),
    ins_link AS (
      INSERT INTO company_contacts (tenant_id, company_id, contact_id, is_primary)
      SELECT tenant_id, company_id, contact_id, true
        FROM src
      RETURNING id
    )
    SELECT (SELECT count(*) FROM ins_contact) AS contacts,
           (SELECT count(*) FROM ins_link)    AS links
  `
  const { rows } = await client.query(sql)
  line('contacts inserted', rows[0].contacts)
  line('company_contacts inserted', rows[0].links)

  // Measured inside the transaction, so this is the post-insert total: it must
  // equal 47 whether this run inserted them or a previous one did.
  const linked = await scalar(
    client,
    `SELECT count(*) FROM business_partners bp
      WHERE ${HAS_CONTACT_NAME}
        AND EXISTS (SELECT 1 FROM company_contacts cc WHERE cc.company_id = bp.id)`,
  )
  line('companies now carrying a contact (total)', linked, 47)

  return { contacts: Number(rows[0].contacts), links: Number(rows[0].links) }
}

// ---------------------------------------------------------------------------
// Step 2 — Addresses (§4.4)
//
// `city` is deliberately left NULL — there is no source column for it (Q5).
// Deriving it from taluka or village would bake in an answer the client has
// not given.
// ---------------------------------------------------------------------------

async function backfillAddresses(client) {
  heading('STEP 2 — company_addresses (§4.4)')

  const sql = `
    INSERT INTO company_addresses (
      tenant_id, company_id, label, address_line, pincode,
      state_id, district_id, taluka_id, village_id, latitude, longitude, is_primary
    )
    SELECT bp.tenant_id, bp.id, 'Primary', bp.address, bp.pincode,
           bp.state_id, bp.district_id, bp.taluka_id, bp.village_id,
           bp.latitude, bp.longitude, true
      FROM business_partners bp
     WHERE ${HAS_ADDRESS_DATA}
       AND NOT EXISTS (
             SELECT 1 FROM company_addresses ca
              WHERE ca.company_id = bp.id AND ca.is_primary
           )
    RETURNING id
  `
  const r = await client.query(sql)
  line('company_addresses inserted', r.rowCount)

  // Post-insert total, as above: 197 on every run, inserted now or earlier.
  const withAddr = await scalar(
    client,
    `SELECT count(*) FROM business_partners bp
      WHERE ${HAS_ADDRESS_DATA}
        AND EXISTS (SELECT 1 FROM company_addresses ca WHERE ca.company_id = bp.id AND ca.is_primary)`,
  )
  line('companies now carrying a primary address (total)', withAddr, 197)

  return { addresses: r.rowCount }
}

// ---------------------------------------------------------------------------
// Step 4 — Completeness (§3.5)
//
// Records state only. No order gating, no UI enforcement — that is a Phase 2
// decision. The four address-derived fields are read from the company's PRIMARY
// ADDRESS (the new source of truth), not from `business_partners` directly.
// Both hold the same values after step 2; the primary address is the column set
// the new model will edit.
// ---------------------------------------------------------------------------

const PRIMARY_ADDRESS_JOIN = `
  LEFT JOIN LATERAL (
    SELECT ca.address_line, ca.city, ca.state_id, ca.pincode
      FROM company_addresses ca
     WHERE ca.company_id = bp.id AND ca.is_primary
     ORDER BY ca.created_at, ca.id
     LIMIT 1
  ) pa ON true
`

// Emits e.g. 'Primary Address, City, State, Pincode, GST Number', or NULL when
// the row wants for nothing.
const MISSING_EXPR = `
  NULLIF(array_to_string(
      ARRAY[]::text[]
   || CASE WHEN pa.address_line IS NULL OR btrim(pa.address_line) = '' THEN ARRAY['Primary Address'] ELSE ARRAY[]::text[] END
   || CASE WHEN pa.city         IS NULL OR btrim(pa.city)         = '' THEN ARRAY['City']           ELSE ARRAY[]::text[] END
   || CASE WHEN pa.state_id     IS NULL                                THEN ARRAY['State']          ELSE ARRAY[]::text[] END
   || CASE WHEN pa.pincode      IS NULL OR btrim(pa.pincode)      = '' THEN ARRAY['Pincode']        ELSE ARRAY[]::text[] END
   || CASE WHEN bp.gst_number   IS NULL OR btrim(bp.gst_number)   = '' THEN ARRAY['GST Number']     ELSE ARRAY[]::text[] END
  , ', '), '')
`

async function backfillCompleteness(client) {
  heading('STEP 4 — is_complete / completeness_missing (§3.5)')
  console.log(`  required fields: ${REQUIRED.join(', ')}`)

  // The WHERE guard means a re-run matches zero rows, so the updated_at trigger
  // does not fire a second time.
  const sql = `
    WITH computed AS (
      SELECT bp.id, ${MISSING_EXPR} AS missing
        FROM business_partners bp
        ${PRIMARY_ADDRESS_JOIN}
    )
    UPDATE business_partners bp
       SET completeness_missing = c.missing,
           is_complete          = (c.missing IS NULL)
      FROM computed c
     WHERE bp.id = c.id
       AND (bp.completeness_missing IS DISTINCT FROM c.missing
         OR bp.is_complete          IS DISTINCT FROM (c.missing IS NULL))
    RETURNING bp.id
  `
  const r = await client.query(sql)
  line('rows updated', r.rowCount)
  line('rows already correct, left alone', 594 - r.rowCount)

  const dist = await client.query(`
    SELECT completeness_missing, count(*)::int AS n
      FROM business_partners
     GROUP BY 1
     ORDER BY n DESC
  `)
  console.log('\n  completeness_missing distribution:')
  for (const row of dist.rows) {
    console.log(`    ${fmt(row.n)}  ${row.completeness_missing ?? '(complete — nothing missing)'}`)
  }

  line('\n  is_complete = true', await scalar(client, 'SELECT count(*) FROM business_partners WHERE is_complete'))
  line('  completeness_missing IS NOT NULL', await scalar(client, 'SELECT count(*) FROM business_partners WHERE completeness_missing IS NOT NULL'))

  return { updated: r.rowCount }
}

// ---------------------------------------------------------------------------
// Reporting — P1-T7 requires these be surfaced, not silently handled.
// Nothing here writes.
// ---------------------------------------------------------------------------

async function report(client) {
  heading('REPORT — flagged, not handled (§10: migrate as-is, flag, report)')

  line(
    'companies with no contact name (0 contacts)',
    await scalar(client, `SELECT count(*) FROM business_partners bp WHERE NOT ${HAS_CONTACT_NAME}`),
  )
  line('contacts created with a NULL mobile', await scalar(client, 'SELECT count(*) FROM contacts WHERE mobile IS NULL'))
  line(
    'duplicate (tenant, lower(name)) groups',
    await scalar(
      client,
      `SELECT count(*) FROM (
         SELECT tenant_id, lower(btrim(name)) FROM business_partners GROUP BY 1, 2 HAVING count(*) > 1
       ) g`,
    ),
  )
  line(
    'duplicate (tenant, mobile_1) groups',
    await scalar(
      client,
      `SELECT count(*) FROM (
         SELECT tenant_id, btrim(mobile_1) FROM business_partners
          WHERE mobile_1 IS NOT NULL AND btrim(mobile_1) <> ''
          GROUP BY 1, 2 HAVING count(*) > 1
       ) g`,
    ),
  )
  line(
    'rows whose stage is not in lead_stages',
    await scalar(
      client,
      `SELECT count(*) FROM business_partners bp
        WHERE NOT EXISTS (
          SELECT 1 FROM lead_stages ls WHERE ls.tenant_id = bp.tenant_id AND ls.name = bp.stage
        )`,
    ),
  )

  // The "with any address data" cohort is driven almost entirely by state_id;
  // very few rows carry a street address. Both readings are surfaced because
  // they change the wording of completeness_missing (never is_complete, which
  // is false either way while city and GST are empty).
  console.log('')
  line(
    'companies with a primary address row',
    await scalar(client, 'SELECT count(*) FROM business_partners bp WHERE EXISTS (SELECT 1 FROM company_addresses ca WHERE ca.company_id = bp.id AND ca.is_primary)'),
  )
  line(
    '  of those, address_line populated',
    await scalar(client, "SELECT count(*) FROM company_addresses WHERE is_primary AND address_line IS NOT NULL AND btrim(address_line) <> ''"),
  )
  line('  of those, city populated (no source column)', await scalar(client, "SELECT count(*) FROM company_addresses WHERE is_primary AND city IS NOT NULL AND btrim(city) <> ''"))
}

// ---------------------------------------------------------------------------
// Referential sanity — cheap, and the one class of bug the soft references in
// this schema will not catch for us.
// ---------------------------------------------------------------------------

async function verifyIntegrity(client) {
  heading('INTEGRITY')

  line(
    'company_contacts with no such company',
    await scalar(client, 'SELECT count(*) FROM company_contacts cc WHERE NOT EXISTS (SELECT 1 FROM business_partners bp WHERE bp.id = cc.company_id)'),
    0,
  )
  line(
    'company_contacts with no such contact',
    await scalar(client, 'SELECT count(*) FROM company_contacts cc WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = cc.contact_id)'),
    0,
  )
  line(
    'company_addresses with no such company',
    await scalar(client, 'SELECT count(*) FROM company_addresses ca WHERE NOT EXISTS (SELECT 1 FROM business_partners bp WHERE bp.id = ca.company_id)'),
    0,
  )
  line(
    'contacts with a dangling owner_user_id',
    await scalar(client, 'SELECT count(*) FROM contacts c WHERE c.owner_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.owner_user_id)'),
    0,
  )
  line(
    'company_contacts whose tenant <> company tenant',
    await scalar(client, 'SELECT count(*) FROM company_contacts cc JOIN business_partners bp ON bp.id = cc.company_id WHERE cc.tenant_id <> bp.tenant_id'),
    0,
  )
  line(
    'contacts whose tenant <> company tenant',
    await scalar(client, 'SELECT count(*) FROM company_contacts cc JOIN contacts c ON c.id = cc.contact_id JOIN business_partners bp ON bp.id = cc.company_id WHERE c.tenant_id <> bp.tenant_id'),
    0,
  )
  line(
    'company_addresses whose tenant <> company tenant',
    await scalar(client, 'SELECT count(*) FROM company_addresses ca JOIN business_partners bp ON bp.id = ca.company_id WHERE ca.tenant_id <> bp.tenant_id'),
    0,
  )
  line('companies with more than one primary address', await scalar(client, 'SELECT count(*) FROM (SELECT company_id FROM company_addresses WHERE is_primary GROUP BY 1 HAVING count(*) > 1) g'), 0)
  line('companies with more than one primary contact', await scalar(client, 'SELECT count(*) FROM (SELECT company_id FROM company_contacts WHERE is_primary GROUP BY 1 HAVING count(*) > 1) g'), 0)

  // The source table must come through untouched apart from the two columns.
  line('business_partners total (must be unchanged)', await scalar(client, 'SELECT count(*) FROM business_partners'), 594)
}

// ---------------------------------------------------------------------------

async function main() {
  const mode = COMMIT ? 'COMMIT' : 'DRY RUN'
  const host = new URL(url).hostname
  console.log(`\nP1-T7 backfill-parties — ${mode}`)
  console.log(`database: ${host}`)
  if (!COMMIT) console.log('nothing will be written; pass --commit to write')

  const client = new pg.Client({ connectionString: url })
  await client.connect()

  let ok = false
  try {
    await client.query('BEGIN')
    await assertShape(client)
    const c = await backfillContacts(client)
    const a = await backfillAddresses(client)
    const m = await backfillCompleteness(client)
    await report(client)
    await verifyIntegrity(client)

    if (failed) throw new Error('A verification above failed. Rolling back.')

    heading('SUMMARY')
    console.log(`  contacts inserted           ${fmt(c.contacts)}`)
    console.log(`  company_contacts inserted   ${fmt(c.links)}`)
    console.log(`  company_addresses inserted  ${fmt(a.addresses)}`)
    console.log(`  completeness rows updated   ${fmt(m.updated)}`)

    if (COMMIT) {
      await client.query('COMMIT')
      console.log('\nCOMMITTED.')
    } else {
      await client.query('ROLLBACK')
      console.log('\nROLLED BACK — dry run. Re-run with --commit to apply exactly these numbers.')
    }
    ok = true
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(`\nROLLED BACK — ${err.message}`)
  } finally {
    await client.end()
  }

  process.exit(ok ? 0 : 1)
}

main()
