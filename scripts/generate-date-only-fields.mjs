#!/usr/bin/env node
/**
 * Emits src/lib/generated/date-only-fields.ts from prisma/schema.prisma.
 *
 * Why this exists: PostgREST serialised `date` columns as "YYYY-MM-DD" and
 * `timestamptz` as a full ISO string, and the UI renders both raw. Prisma hands
 * back a plain `Date` for both, so the serialiser needs to know which columns
 * are date-only.
 *
 * The runtime DMMF (`Prisma.dmmf.datamodel.models[].fields[]`) does NOT carry
 * `nativeType` — every date column is simply `type: "DateTime"` — so DMMF alone
 * cannot answer this. The schema file can, and it is the same artefact
 * `prisma db pull` regenerates, so this map cannot silently drift: re-run it
 * after every pull (npm run prisma:sync does both).
 *
 * Keys are "model.field", so a future `plan_date timestamptz` on another model
 * is simply absent from the set and serialises as a timestamp automatically.
 */
import fs from 'node:fs'
import path from 'node:path'

const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma')
const outPath = path.join(process.cwd(), 'src', 'lib', 'generated', 'date-only-fields.ts')

const schema = fs.readFileSync(schemaPath, 'utf8')

const entries = []
let model = null
for (const line of schema.split(/\r?\n/)) {
  const s = line.trim()
  const m = s.match(/^model\s+(\w+)\s*\{/)
  if (m) { model = m[1]; continue }
  if (model && s === '}') { model = null; continue }
  if (!model || !s || s.startsWith('//') || s.startsWith('@@')) continue
  // A date-only column: `@db.Date` and NOT `@db.DateTime`/`@db.Timestamptz`.
  if (/@db\.Date\b/.test(s)) {
    const field = s.split(/\s+/)[0]
    entries.push(`${model}.${field}`)
  }
}
entries.sort()

const banner = `// GENERATED FILE — do not edit by hand.
// Regenerate with: npm run prisma:sync  (or: node scripts/generate-date-only-fields.mjs)
// Source: prisma/schema.prisma — every column declared @db.Date.
//
// These are the columns PostgREST sent as "YYYY-MM-DD" rather than a full ISO
// timestamp. serialize() in src/lib/db.ts uses this to preserve that contract.
`

const body = `${banner}
/** "model.field" keys for every date-only (\`@db.Date\`) column. */
export const DATE_ONLY_FIELDS: ReadonlySet<string> = new Set([
${entries.map(e => `  '${e}',`).join('\n')}
])

/**
 * Bare field names that are date-only in at least one model. Used only when a
 * caller does not tell serialize() which model a row came from.
 */
export const DATE_ONLY_FIELD_NAMES: ReadonlySet<string> = new Set([
${[...new Set(entries.map(e => e.split('.')[1]))].sort().map(e => `  '${e}',`).join('\n')}
])

/**
 * Field names that are date-only on one model but a timestamp on another.
 * Serialising such a field without model context is ambiguous, so serialize()
 * throws rather than guessing. Empty today; it is a tripwire for future schema
 * changes, which is the whole point of generating this file.
 */
export const AMBIGUOUS_DATE_FIELD_NAMES: ReadonlySet<string> = new Set([
__AMBIGUOUS__
])
`

// Work out which bare names are date-only somewhere and a timestamp elsewhere.
const dateNames = new Set(entries.map(e => e.split('.')[1]))
const tsNames = new Set()
model = null
for (const line of schema.split(/\r?\n/)) {
  const s = line.trim()
  const m = s.match(/^model\s+(\w+)\s*\{/)
  if (m) { model = m[1]; continue }
  if (model && s === '}') { model = null; continue }
  if (!model || !s || s.startsWith('//') || s.startsWith('@@')) continue
  if (/@db\.Timestamptz|@db\.Timestamp\b/.test(s)) tsNames.add(s.split(/\s+/)[0])
}
const ambiguous = [...dateNames].filter(n => tsNames.has(n)).sort()

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, body.replace('__AMBIGUOUS__', ambiguous.map(e => `  '${e}',`).join('\n')), 'utf8')

console.log(`date-only columns: ${entries.length}  (${dateNames.size} distinct names)`)
console.log(`timestamp column names: ${tsNames.size}`)
console.log(ambiguous.length
  ? `AMBIGUOUS names (date-only on one model, timestamp on another): ${ambiguous.join(', ')}`
  : 'no ambiguous names — bare-name fallback is safe')
console.log(`wrote ${path.relative(process.cwd(), outPath)}`)
