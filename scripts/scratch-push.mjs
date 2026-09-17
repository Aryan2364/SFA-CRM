#!/usr/bin/env node
/**
 * Pushes prisma/schema.prisma at the scratch database — and only ever at the
 * scratch database (PLAN.md §8.3).
 *
 * `prisma db push --accept-data-loss` takes its connection from
 * prisma.config.ts, which reads DATABASE_URL — the LIVE database. Running the
 * bare CLI therefore pushes the schema over production and drops whatever does
 * not match. This wrapper exists so that can never happen: it resolves
 * SCRATCH_DATABASE_URL, refuses anything that is not local, refuses a value
 * equal to DATABASE_URL, and then overrides DATABASE_URL in the child process
 * so the CLI can only see the scratch host.
 *
 * Run via `npm run scratch:push`.
 */
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { URL } from 'node:url'

function readEnv(key) {
  if (process.env[key]) return process.env[key]
  if (!fs.existsSync('.env.local')) return undefined
  const m = fs.readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
}

const raw = readEnv('SCRATCH_DATABASE_URL')
if (!raw) {
  console.error('SCRATCH_DATABASE_URL is not set (env or .env.local).')
  process.exit(1)
}

// Hard guard: this script pushes with --accept-data-loss. It must never see a
// hosted database.
const host = new URL(raw).hostname
const LOCAL = new Set(['localhost', '127.0.0.1', '::1'])
if (!LOCAL.has(host)) {
  console.error(`REFUSING TO RUN: SCRATCH_DATABASE_URL points at "${host}", not a local host.`)
  console.error('The write-path harness is destructive and is only ever allowed to touch local PostgreSQL.')
  process.exit(1)
}

// Belt and braces: the hostname check alone would pass if the live database
// were ever reachable on a local host, so refuse on equality regardless.
const live = readEnv('DATABASE_URL')
if (live && live.trim() === raw.trim()) {
  console.error('REFUSING TO RUN: SCRATCH_DATABASE_URL is identical to DATABASE_URL.')
  console.error('That is the live database. The scratch database must be a separate, local one.')
  process.exit(1)
}

console.log(`Pushing prisma/schema.prisma to scratch database at ${host} …`)

// prisma.config.ts resolves the datasource from DATABASE_URL, so overriding it
// for the child is the only way to aim the push.
// `--skip-generate` was removed in Prisma 7 and is now a hard CLI error; push
// no longer generates a client, so there is nothing left to skip.
const child = spawnSync(
  'npx',
  ['prisma', 'db', 'push', '--schema', 'prisma/schema.prisma', '--accept-data-loss'],
  { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, DATABASE_URL: raw } },
)

if (child.error) {
  console.error(child.error.message)
  process.exit(1)
}
process.exit(child.status ?? 1)
