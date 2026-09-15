#!/usr/bin/env node
/**
 * Guards the Prisma client against being rebuilt on every property access.
 *
 * `src/lib/db.ts` exports `prisma` as a lazy Proxy so that importing it during
 * `next build` (which runs with no database) is free. The cost of that trick is
 * that the Proxy calls getClient() on EVERY property access — so if getClient()
 * does not cache, each access constructs a fresh PrismaClient with a fresh pg
 * Pool.
 *
 * That shipped once. The standard Prisma snippet caches only outside production,
 * because it normally holds the client in a module-scope const; this file has no
 * such const, so production was the case that cached nothing. Connections then
 * multiplied per property access rather than per request, and production died
 * with "too many connections for role sfacrm_app".
 *
 * No database is contacted: a pg Pool does not connect until a query runs, so a
 * syntactically valid DATABASE_URL is enough to construct the adapter.
 *
 * Run:  npm run verify:singleton   (compiles src/lib/db.ts first)
 */
// SET THIS FIRST, BEFORE THE MODULE IS LOADED OR ANY PROPERTY IS TOUCHED.
// The bug lived in a `NODE_ENV !== 'production'` branch, so a check that flips
// NODE_ENV *after* the client is already cached proves nothing — the cached
// client is simply returned. An earlier draft of this file did exactly that and
// passed cleanly against the broken code.
process.env.NODE_ENV = 'production'
process.env.DATABASE_URL ||= 'postgresql://u:p@127.0.0.1:5432/nonexistent_do_not_connect'
delete process.env.PRISMA_QUERY_LOG

// Import the COMPILED db.ts (the npm script runs tsc first), exactly as
// verify-data-layer.mjs does — src/lib/db.ts uses extensionless imports that
// Node's ESM resolver cannot follow. Importing the real module, not a copy of
// its logic, is the whole point: a copy could not have caught this bug.
const { createRequire } = await import('node:module')
const require_ = createRequire(import.meta.url)
const { prisma } = require_('../.verify-build/db.js')

let pass = 0
let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('prisma singleton check')

// Each PrismaClient builds its own model delegates, so two accesses returning
// the same delegate object proves the same underlying client served both. If
// getClient() rebuilt, these would be different objects — and each rebuild would
// have carried its own connection pool.
const a = prisma.states
const b = prisma.states
check('prisma.states is the same object across two accesses', a === b,
  'getClient() is rebuilding the client — every property access opens a new pool')

const c = prisma.users
check('a different model also comes from that same client', c !== undefined && prisma.users === c)

// NOTE: a `prisma.$transaction === prisma.$transaction` assertion was tried here
// and REMOVED. It passed even against the broken code, because $transaction
// comes off the prototype and is the same function reference on every instance.
// An assertion that cannot fail is worse than no assertion — it pads the count
// and reads as coverage.

// Everything above already ran under NODE_ENV=production, set before the module
// loaded. That is what makes those assertions meaningful: under the old code the
// production branch cached nothing, so `prisma.states === prisma.states` was
// FALSE and each access carried its own pool.
check('NODE_ENV is production for this whole run', process.env.NODE_ENV === 'production')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
