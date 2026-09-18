#!/usr/bin/env node
/**
 * Runs `next dev` against the LOCAL database instead of Supabase.
 *
 * Next loads .env.local itself, and .env.local's DATABASE_URL is the live
 * Supabase database — so a plain `next dev` browses production data. This
 * wrapper resolves SCRATCH_DATABASE_URL, refuses anything that is not a local
 * host, and overrides DATABASE_URL in the child process. Because an explicit
 * process env wins over a value loaded from .env.local, the app can only see
 * the local database for the life of this server.
 *
 * DATABASE_CA_CERT_PATH is cleared too: the local URL carries no sslmode, so
 * src/lib/db.ts takes its no-TLS branch and never consults a CA.
 *
 * Run via `npm run dev:local` (port 3007).
 */
import fs from 'node:fs'
import { spawn } from 'node:child_process'

function readEnv(key) {
  if (process.env[key]) return process.env[key]
  if (!fs.existsSync('.env.local')) return undefined
  const m = fs.readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
}

const raw = readEnv('SCRATCH_DATABASE_URL')
if (!raw) {
  console.error('SCRATCH_DATABASE_URL is not set (env or .env.local).')
  console.error('Expected something like postgresql://postgres:postgres@localhost:5432/sfacrm_local')
  process.exit(1)
}

const host = new URL(raw).hostname
const LOCAL = new Set(['localhost', '127.0.0.1', '::1'])
if (!LOCAL.has(host)) {
  console.error(`REFUSING TO RUN: SCRATCH_DATABASE_URL points at "${host}", not a local host.`)
  console.error('dev:local exists precisely so the dev server cannot reach a hosted database.')
  process.exit(1)
}

const live = readEnv('DATABASE_URL')
if (live && live.trim() === raw.trim()) {
  console.error('REFUSING TO RUN: SCRATCH_DATABASE_URL is identical to DATABASE_URL.')
  process.exit(1)
}

// The demo tenant seeded by scripts/seed-dev.mjs. Login derives the tenant from
// the user row, so this only matters to the routes that fall back to it
// (forgot-password / reset-password — PLAN.md §13.2).
const DEV_TENANT_ID = '0000000d-0000-4000-8000-000000000001'

const port = process.argv[2] ?? '3007'

console.log(`Dev server on port ${port}, database ${new URL(raw).pathname.slice(1)} @ ${host} (NOT Supabase).`)

const child = spawn('npx', ['next', 'dev', '-p', port], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    DATABASE_URL: raw,
    DATABASE_CA_CERT_PATH: '',
    DEFAULT_TENANT_ID: DEV_TENANT_ID,
  },
})

child.on('exit', code => process.exit(code ?? 0))
