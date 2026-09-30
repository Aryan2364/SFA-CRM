/**
 * Which database a one-time release script talks to, and how.
 *
 * Shared by scripts/backfill-can-create.mjs, scripts/rehash-plaintext-passwords.mjs
 * and scripts/prod-readiness-check.mjs, so the three cannot drift apart on the
 * one question that matters: are we about to touch the database we think we are?
 *
 * --- PRODUCTION IS RDS, NOT .env.local ------------------------------------
 * The live site runs on AWS RDS. Its DATABASE_URL exists only in
 * `.env.production` on the server. `.env.local`'s DATABASE_URL is the local
 * database, so `--use-database-url` on its own stays local. To reach RDS, put
 * its URL in a local, gitignored
 * `.env.rds` and pass it with Node's `--env-file` (DEPLOYMENT.md has the exact
 * commands):
 *
 *   node --env-file=.env.rds scripts/<script>.mjs --use-database-url
 *
 * --- RESOLUTION ------------------------------------------------------------
 * Default target: SCRATCH_DATABASE_URL (the LOCAL database); a non-local host
 * there is refused. `--use-database-url` targets DATABASE_URL instead.
 *
 * A variable already in process.env (from `--env-file` or the shell) ALWAYS
 * wins over `.env.local`; `.env.local` is only read for a variable that is not
 * set at all. The CA path is taken from the SAME source as the URL, so an RDS
 * URL from `.env.rds` can never be paired with a CA left in `.env.local`.
 *
 * --- TLS -------------------------------------------------------------------
 * A non-local host is ALWAYS reached over TLS verified against
 * DATABASE_CA_CERT_PATH, including the hostname (node-postgres sets the SNI
 * servername, and Node checks the certificate against it: verify-full).
 * Whatever the URL's `sslmode` says, including `disable`, is ignored: every
 * ssl* parameter is stripped from the URL because node-postgres lets them
 * override the `ssl` option. No CA for a non-local host is a refusal, never a
 * fallback to unverified or plaintext. A local host keeps the old behaviour:
 * TLS only if the URL asks for it.
 *
 * --- CONFIRMATION ----------------------------------------------------------
 * The host and database name are printed BEFORE connecting. A write (`--apply`)
 * to a non-local host also needs `--host <hostname>` matching the URL's host
 * exactly, so a write cannot land on the wrong database because the wrong env
 * file was loaded. `--host` given without `--apply` is checked the same way.
 *
 * --- ALLOW-LIST ------------------------------------------------------------
 * Before anything else, the host must be local or end in `.rds.amazonaws.com`.
 * Every other host is refused, whatever flags are passed. This is an
 * allow-list on purpose: the only databases these scripts may reach are the
 * local one and AWS RDS.
 *
 * --- SSH TUNNEL (opt-in) ---------------------------------------------------
 * RDS resolves to a private VPC address, so from outside AWS it is reached
 * through an SSH tunnel the owner opens himself. `DATABASE_TUNNEL=127.0.0.1:15432`
 * (read from the same source as the URL) sends the TCP connection to that local
 * port instead. Everything else still runs against the URL's RDS host: the
 * allow-list, `--host`, and TLS, which is verified against the RDS hostname
 * (`servername`), not the tunnel's. The tunnel host must be local, and the URL
 * must be RDS. The client config is built field by field, never from
 * `connectionString`, so nothing in the URL can redirect the connection; other
 * URL query parameters are not carried over. Unset: behaviour is unchanged.
 *
 * Nothing here prints the URL, the user or the password.
 */
import fs from 'node:fs'
import { URL } from 'node:url'

const LOCAL = new Set(['localhost', '127.0.0.1', '::1'])
const RDS = /\.rds\.amazonaws\.com$/

// Every URL parameter node-postgres would read as TLS config (plus Prisma's
// connection_limit, which it rejects). Stripped so `ssl` below is the only control.
const STRIP_PARAMS = [
  'sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword',
  'sslnegotiation', 'uselibpqcompat', 'connection_limit',
]

function fromEnvLocal(key) {
  if (!fs.existsSync('.env.local')) return undefined
  const m = fs.readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/\r$/, '').replace(/^["']|["']$/g, '') : undefined
}

/** The value of `name <value>` in args, or undefined. */
export function flagValue(args, name) {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

/**
 * `host:port` or `[::1]:port` → { host, port }, or undefined if malformed.
 * `localhost` becomes 127.0.0.1: node-postgres overwrites `servername` with the
 * connect host whenever that host is a name rather than an IP, which would check
 * the RDS certificate against "localhost".
 */
function parseTunnel(value) {
  const m = value.trim().match(/^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/)
  if (!m) return undefined
  const host = (m[1] ?? m[2]).toLowerCase()
  const port = Number(m[3])
  if (port < 1 || port > 65535) return undefined
  return { host, connectHost: host === 'localhost' ? '127.0.0.1' : host, port }
}

/**
 * Resolves, checks and announces the target database. Exits the process on any
 * refusal. Returns the node-postgres connection config plus what was resolved.
 *
 * @param {object} o
 * @param {string}   o.script  name shown in the banner
 * @param {string[]} o.args    process.argv.slice(2)
 * @param {boolean}  o.apply   true when this run writes
 */
export function resolveReleaseDb({ script, args, apply }) {
  const live = args.includes('--use-database-url')
  const urlKey = live ? 'DATABASE_URL' : 'SCRATCH_DATABASE_URL'

  const hostIdx = args.indexOf('--host')
  const expectedHost = hostIdx === -1 ? undefined : args[hostIdx + 1]
  if (hostIdx !== -1 && (!expectedHost || expectedHost.startsWith('--'))) {
    fail('--host needs the database hostname, e.g. --host mydb.abc123.ap-south-1.rds.amazonaws.com')
  }

  // Set in process.env (even to '') means the caller chose it: never fall back.
  const fromProcess = process.env[urlKey] !== undefined
  const raw = fromProcess ? process.env[urlKey] : fromEnvLocal(urlKey)
  const source = fromProcess ? 'the environment (--env-file or shell)' : '.env.local'
  if (!raw) fail(`${urlKey} is not set, or is empty, in ${fromProcess ? 'the environment' : 'the environment or .env.local'}.`)

  let url
  try {
    url = new URL(raw)
  } catch {
    fail(`${urlKey} from ${source} is not a valid URL. (Its value is not printed.)`)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || '(default)'
  const local = LOCAL.has(host)

  // Allow-list: local or AWS RDS, nothing else. No flag widens it.
  if (!local && !RDS.test(host)) {
    fail(`REFUSING TO RUN: ${urlKey} (from ${source}) points at "${host}".\n` +
      'Only local or AWS RDS databases are allowed. Pass the RDS URL with:\n' +
      '  node --env-file=.env.rds scripts/<script>.mjs --use-database-url')
  }

  if (!live && !local) {
    fail(`REFUSING TO RUN: SCRATCH_DATABASE_URL points at "${host}", not a local host.\n` +
      'Pass --use-database-url to target DATABASE_URL on purpose.')
  }

  const tunnelKey = 'DATABASE_TUNNEL'
  const tunnelRaw = fromProcess ? process.env[tunnelKey] : fromEnvLocal(tunnelKey)
  let tunnel
  if (tunnelRaw) {
    tunnel = parseTunnel(tunnelRaw)
    if (!tunnel) {
      fail(`REFUSING TO RUN: ${tunnelKey} (from ${source}) must be host:port, e.g. ${tunnelKey}=127.0.0.1:15432`)
    }
    if (!LOCAL.has(tunnel.host)) {
      fail(`REFUSING TO RUN: ${tunnelKey} (from ${source}) points at "${tunnel.host}".\n` +
        'A tunnel must listen on this machine: 127.0.0.1, localhost or ::1.')
    }
    if (local) {
      fail(`REFUSING TO RUN: ${tunnelKey} is set, but ${urlKey} already points at the local host "${host}".\n` +
        `A tunnel is only for reaching RDS. Remove ${tunnelKey}, or target the RDS URL.`)
    }
  }
  const via = tunnel ? ` (via tunnel ${tunnel.connectHost.includes(':') ? `[${tunnel.connectHost}]` : tunnel.connectHost}:${tunnel.port})` : ''

  console.log(`\n${script} — ${apply ? 'APPLY (writes)' : 'DRY RUN / READ ONLY (writes nothing)'}`)
  console.log(`database host: ${host}${via}`)
  console.log(`database name: ${database}`)
  console.log(`url from:      ${urlKey} in ${source}`)

  if (expectedHost !== undefined && expectedHost.toLowerCase() !== host) {
    fail(`REFUSING TO RUN: --host "${expectedHost}" does not match the database host "${host}".\n` +
      'The URL that was loaded is not the one you confirmed. Check which env file you passed.')
  }
  if (apply && !local && expectedHost === undefined) {
    fail(`REFUSING TO WRITE: --apply against a non-local database needs the host confirmed.\n` +
      `Check the host above is the one you mean, then re-run with:  --host ${host}`)
  }

  const sslMode = url.searchParams.get('sslmode')
  for (const p of STRIP_PARAMS) url.searchParams.delete(p)

  let ssl
  if (!local || (sslMode && sslMode !== 'disable')) {
    const caKey = 'DATABASE_CA_CERT_PATH'
    const caPath = fromProcess ? process.env[caKey] : fromEnvLocal(caKey)
    if (!caPath || !fs.existsSync(caPath)) {
      fail(`REFUSING TO RUN: "${host}" needs a verified TLS connection, but no CA certificate was found` +
        `${caPath ? ` at "${caPath}"` : ` (${caKey} is not set in ${source})`}.\n` +
        `Set ${caKey} next to ${urlKey}` +
        `${fromProcess ? ' in the same env file' : ''}; for RDS use certs/rds-global-bundle.pem.`)
    }
    const ca = fs.readFileSync(caPath)
    if (!ca.includes('-----BEGIN CERTIFICATE-----')) {
      fail(`REFUSING TO RUN: "${caPath}" (${caKey}) does not contain a PEM certificate.`)
    }
    // Through a tunnel the socket goes to 127.0.0.1, so name the RDS host explicitly.
    ssl = tunnel ? { ca, servername: host, rejectUnauthorized: true } : { ca, rejectUnauthorized: true }
    console.log(`tls:           verified against ${caPath} (hostname checked${tunnel ? `: ${host}` : ''})` +
      (sslMode === 'disable' ? '  [sslmode=disable in the URL was ignored]' : ''))
  } else {
    console.log('tls:           none (local database)')
  }
  if (expectedHost !== undefined) console.log(`host confirmed: --host matches ${host}`)
  console.log('')

  const connection = tunnel
    ? {
        host: tunnel.connectHost,
        port: tunnel.port,
        ...(url.username ? { user: decodeURIComponent(url.username) } : {}),
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
        ...(database === '(default)' ? {} : { database }),
        ssl,
      }
    : { connectionString: url.toString(), ssl }

  return {
    connection,
    host,
    database,
    live,
    local,
  }
}
