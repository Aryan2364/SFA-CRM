#!/usr/bin/env node
/**
 * Stands in front of `npm run dev`.
 *
 * `next dev` loads .env.local, whose DATABASE_URL is the LIVE SUPABASE
 * database. So the most obvious command in the repo — the one every Node
 * developer types without thinking, and the one every README implies — browses
 * and edits production. That is not a trap worth documenting; it is a trap
 * worth removing, so this refuses and names the command that is safe.
 *
 * It was added after `npm run dev` was run by accident and spent several
 * minutes throwing DatabaseNotReachable at production. Nothing was damaged that
 * time, only because the connection failed. The next time it might succeed.
 *
 * To run against production deliberately — which should be close to never —
 * set I_REALLY_WANT_PRODUCTION=1. The length of that name is the point.
 */
import { spawn } from 'node:child_process'

const ESCAPE = 'I_REALLY_WANT_PRODUCTION'

if (!process.env[ESCAPE]) {
  const say = (s = '') => process.stderr.write(s + '\n')
  say()
  say('  REFUSING: `npm run dev` points at the LIVE SUPABASE database.')
  say()
  say('  It runs plain `next dev`, which reads DATABASE_URL from .env.local,')
  say('  and that is production. Browsing with it edits real customer data.')
  say()
  say('  Use the local database instead:')
  say()
  say('      node scripts/dev-local.mjs 3010')
  say()
  say('  (`npm run dev:local` also works, but hardcodes port 3007 — if a')
  say('   server is already up on 3010, prefer the line above and start')
  say('   nothing. Two dev servers sharing one .next corrupts the build and')
  say('   500s every route on both.)')
  say()
  say(`  To target production on purpose, set ${ESCAPE}=1.`)
  say()
  process.exit(1)
}

process.stderr.write(
  `\n  ${ESCAPE} is set. Starting next dev against DATABASE_URL — production.\n\n`
)
spawn('next', ['dev', ...process.argv.slice(2)], { stdio: 'inherit', shell: true }).on(
  'exit',
  code => process.exit(code ?? 0)
)
