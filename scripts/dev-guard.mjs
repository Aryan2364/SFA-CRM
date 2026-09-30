#!/usr/bin/env node
/**
 * Stands in front of `npm run dev`.
 *
 * `next dev` connects to whatever DATABASE_URL resolves to: the process env
 * first, then .env.development.local, .env.local, .env.development and .env.
 * .env.local points it at the local database. This is an allow-list: the dev
 * server starts only when that host is local (localhost, 127.0.0.1, ::1), and
 * every other host is refused, with no override, because a dev server on a
 * hosted database browses and edits that database's data.
 *
 * The guard was added after `npm run dev` was run by accident against a hosted
 * database and spent several minutes throwing DatabaseNotReachable at it.
 * Nothing was damaged that time, only because the connection failed.
 *
 * DATABASE_URL is resolved with @next/env, the loader `next dev` itself uses,
 * so the guard judges the same value the server would connect with. The URL,
 * user and password are never printed; only the host.
 */
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import nextEnv from '@next/env'

// Same definition as scripts/release-db.mjs.
const LOCAL = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * What `npm run dev` should do with this DATABASE_URL. Pure: no env, no I/O.
 *
 * @param {string | undefined} raw  the resolved DATABASE_URL
 * @returns {{ action: 'start' | 'refuse', reason: 'local' | 'unset' | 'invalid' | 'non-local', host?: string }}
 */
export function decide(raw) {
  if (!raw) return { action: 'refuse', reason: 'unset' }
  let host
  try {
    host = new URL(raw).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return { action: 'refuse', reason: 'invalid' }
  }
  if (LOCAL.has(host)) return { action: 'start', reason: 'local', host }
  return { action: 'refuse', reason: 'non-local', host }
}

function main() {
  const say = (s = '') => process.stderr.write(s + '\n')

  // Snapshot before @next/env writes the loaded files into process.env, so the
  // child starts with the caller's env and does its own loading as usual.
  const childEnv = { ...process.env }
  nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error: console.error })
  const verdict = decide(process.env.DATABASE_URL)

  if (verdict.action === 'refuse') {
    say()
    switch (verdict.reason) {
      case 'unset':
        say('  REFUSING: DATABASE_URL is not set, in the environment or any .env file.')
        break
      case 'invalid':
        say('  REFUSING: DATABASE_URL is not a valid URL. (Its value is not printed.)')
        break
      case 'non-local':
        say(`  REFUSING: DATABASE_URL points at "${verdict.host}", not a local host.`)
        break
    }
    say()
    say('  npm run dev only runs against a local database. Set DATABASE_URL in')
    say('  .env.local to it, for example:')
    say('      DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sfacrm_local')
    say()
    process.exit(1)
  }

  say(`\n  Starting next dev against the local database at "${verdict.host}".\n`)
  spawn('next', ['dev', ...process.argv.slice(2)], { stdio: 'inherit', shell: true, env: childEnv }).on(
    'exit',
    code => process.exit(code ?? 0)
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
