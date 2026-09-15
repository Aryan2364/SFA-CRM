/**
 * Shared helpers for the smoke suites. Each batch adds a module under
 * scripts/smoke/<batch>.mjs exporting { name, run }; the runner discovers them,
 * so adding a batch never means editing the runner.
 */
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

export const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3011'
export const COOKIE_NAME = 'rgb_session'

export function readEnv(key) {
  const text = fs.readFileSync('.env.local', 'utf8')
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^"|"$/g, '') : undefined
}

let _prisma
export function db() {
  if (_prisma) return _prisma
  const url = new URL(process.env.DATABASE_URL ?? readEnv('DATABASE_URL'))
  const sslmode = url.searchParams.get('sslmode')
  url.searchParams.delete('sslmode')
  url.searchParams.delete('connection_limit')
  _prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url.toString(),
      ssl: sslmode && sslmode !== 'disable' ? { rejectUnauthorized: false } : undefined,
      max: 5,
    }),
  })
  return _prisma
}

export async function disconnect() {
  if (_prisma) await _prisma.$disconnect()
}

/**
 * Mint a session cookie with the app's own HMAC scheme (src/lib/session.ts).
 * Used so protected routes can be exercised as a specific real user without
 * needing that person's password. The signing key is the app's own
 * SESSION_SECRET, so these are genuine sessions, not a bypass.
 */
export async function mintSession(payload) {
  const secret = readEnv('SESSION_SECRET')
  const enc = new TextEncoder()
  const data = btoa(JSON.stringify(payload))
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'HMAC', hash: 'SHA-256' }, key, enc.encode(data))
  let s = ''
  for (const b of new Uint8Array(sig)) s += String.fromCharCode(b)
  return `${data}.${btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`
}

export function req(path, { token, method = 'GET', body } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(token ? { cookie: `${COOKIE_NAME}=${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

/** Per-suite result collector. */
export function ctx() {
  const notExercised = []
  let pass = 0, fail = 0
  return {
    ok(name, cond, got) {
      console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `   got: ${JSON.stringify(got)}`}`)
      cond ? pass++ : fail++
    },
    /** Record a route we could NOT exercise, with the reason. Goes in the report. */
    skip(route, why) {
      console.log(`  SKIP  ${route}  (${why})`)
      notExercised.push({ route, why })
    },
    section(n) { console.log(`\n  -- ${n} --`) },
    result() { return { pass, fail, notExercised } },
  }
}
