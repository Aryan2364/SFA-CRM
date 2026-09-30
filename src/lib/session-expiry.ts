'use client'

/**
 * What happens in the browser when the server says the session is gone.
 *
 * WHY THIS EXISTS: sessions now expire (see `exp` in src/lib/session.ts), and
 * middleware cannot be the thing that notices. It runs in the edge runtime
 * without SESSION_SECRET, so it checks only that a cookie EXISTS — a tab left
 * open past the deadline still holds one, sails past middleware, renders the
 * app, and then gets a 401 from every data call. Without something like this
 * the user sits in a shell where nothing loads and nothing explains why.
 *
 * So the browser watches its own traffic: any same-origin `/api/*` response of
 * 401 means the session is over, and the user is sent to the login screen with
 * the page they were on carried along so they come back to it.
 *
 * It patches `window.fetch` because there is no other single seam — the app
 * calls `fetch` directly from ~100 screens and hooks, and a helper only helps
 * the callers that adopt it. The patch OBSERVES and never alters: every
 * response is returned to its caller untouched, including the 401 itself, so a
 * screen that already handles 401 keeps handling it.
 */

import { PUBLIC_AUTH_API_PATHS } from './auth-paths'

const LOGIN_PATH = '/login'

/** Where redirectToLogin() sends the user. `/login` unless the shell that
 *  installed the handler named another — SuperAdmin names `/superadmin/login`.
 *  Set once, by the first installSessionExpiryHandler() call. */
let loginPath = LOGIN_PATH

/**
 * Routes that answer 401 as a normal part of their job, and must never trigger
 * the redirect — the login POST answering "wrong password" is the obvious one,
 * and bouncing to /login from /login is how a redirect loop starts.
 */
const EXEMPT_API_PATHS = [...PUBLIC_AUTH_API_PATHS, '/api/superadmin/auth/login']

/** Pages that are already the way out, and so cannot be redirected away from. */
const EXEMPT_PAGE_PATHS = [LOGIN_PATH, '/reset-password', '/superadmin/login']

/**
 * Is this a path we may send the browser to after login?
 *
 * ONLY a same-origin, root-relative path. `//evil.example` and `/\evil.example`
 * are both read by browsers as protocol-relative URLs pointing at another host,
 * so a `?next=` carrying either would turn the login screen into an open
 * redirect — a credible phishing step, since the victim really did just type
 * their password into the real site.
 *
 * Prefix checks alone are not enough: the URL parser STRIPS tab, CR and LF
 * before parsing, so `/<TAB>/evil.example` becomes `//evil.example` after the check
 * has passed it. Hence three layers, each of which must pass:
 *   1. no control character and no backslash, in the path as given OR after
 *      percent-decoding (`/%09/…`, `/%5C…`) — and a decoded `//` is refused
 *      too (`/%2F%2F…`), since some router somewhere will decode it;
 *   2. the path resolved against this site's own origin must stay on it;
 *   3. the resolved pathname must begin with exactly one `/`.
 * A path whose escapes cannot be decoded is refused rather than guessed at.
 */
const UNSAFE_PATH_CHARS = /[\u0000-\u001F\u007F-\u009F\\]/

export function isSafeReturnPath(path: string | null | undefined): path is string {
  if (typeof path !== 'string' || !path.startsWith('/')) return false

  // Decode until stable (bounded), so double-encoding cannot smuggle `%09` past.
  let decoded = path
  for (let i = 0; i < 3; i++) {
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      return false
    }
    if (next === decoded) break
    decoded = next
  }
  if (UNSAFE_PATH_CHARS.test(path) || UNSAFE_PATH_CHARS.test(decoded)) return false
  if (path.startsWith('//') || decoded.startsWith('//')) return false

  // On the server there is no window; a fixed base answers the same question.
  const origin = typeof window === 'undefined' ? 'http://return-path.invalid' : window.location.origin
  let url: URL
  try {
    url = new URL(path, origin)
  } catch {
    return false
  }
  if (url.origin !== origin) return false
  if (!url.pathname.startsWith('/') || url.pathname.startsWith('//')) return false
  return true
}

/** Where the user is now, in the form `?next=` wants. */
function currentReturnPath(): string {
  return `${window.location.pathname}${window.location.search}`
}

/** Set once the redirect is underway, so a page whose ten parallel fetches all
 *  401 at once navigates once rather than ten times. */
let redirecting = false

/**
 * Send the user to the login screen, returning them here afterwards.
 *
 * `location.replace`, not `href`: the page they are leaving cannot be rendered
 * without a session, so leaving it in history only gives the Back button a way
 * to bounce them straight back out again.
 */
export function redirectToLogin(): void {
  if (typeof window === 'undefined') return
  if (redirecting) return
  if (EXEMPT_PAGE_PATHS.some(p => window.location.pathname === p)) return
  redirecting = true

  const next = currentReturnPath()
  const target = isSafeReturnPath(next) && next !== '/'
    ? `${loginPath}?next=${encodeURIComponent(next)}`
    : loginPath
  window.location.replace(target)
}

/**
 * The probe that tells a revoked session apart from a genuine server fault.
 *
 * A session revoked server-side — password reset, an admin changing the
 * password or phone, a forged signature — makes requireUser() THROW, and most
 * handlers do not catch it, so the browser sees a 500, not a 401, and the
 * handler below would never fire. Rather than touch ~130 handlers, a 5xx from
 * our own API triggers one call to /api/auth/me, which answers 401 for exactly
 * those sessions (it checks the signature, expiry and credentials_version). A
 * 401 there means the session is over; anything else — 200, or /me failing
 * too because the server really is down — changes nothing.
 *
 * Main app only. /api/auth/me also answers 401 for a SuperAdmin token (it has
 * no tenant), so probing from the SuperAdmin shell would log every SuperAdmin
 * out on the first 500. The SuperAdmin routes do not throw on a bad session in
 * any case — they answer 403 — and there is no SuperAdmin session endpoint to
 * probe instead. So the probe runs only when the shell uses the default login.
 */
const SESSION_PROBE_PATH = '/api/auth/me'

/** At most one probe per this many ms, so a burst of 500s — or a real outage
 *  answering every call with one — costs a single /me call, not dozens. */
const PROBE_MIN_INTERVAL_MS = 5000

let probeInFlight = false
let lastProbeAt = 0

function probeSession(fetchImpl: typeof window.fetch): void {
  if (redirecting || probeInFlight) return
  if (loginPath !== LOGIN_PATH) return
  const now = Date.now()
  if (now - lastProbeAt < PROBE_MIN_INTERVAL_MS) return
  probeInFlight = true
  lastProbeAt = now
  // The unpatched fetch, so the probe's own response is never re-observed.
  fetchImpl(SESSION_PROBE_PATH, { cache: 'no-store' })
    .then(res => {
      if (res.status === 401) redirectToLogin()
    })
    .catch(() => {
      // A network failure says nothing about the session.
    })
    .finally(() => {
      probeInFlight = false
    })
}

let installed = false

/**
 * Patch `window.fetch` so any 401 from this app's own API ends the session in
 * the UI too, and a 5xx prompts a check of whether the session was revoked
 * (see probeSession above). Idempotent, and a no-op on the server.
 */
export function installSessionExpiryHandler(options: { loginPath?: string } = {}): void {
  if (typeof window === 'undefined') return
  if (installed) return
  installed = true
  if (options.loginPath) loginPath = options.loginPath

  const original = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init)
    if (res.status === 401 || res.status >= 500) {
      try {
        const raw =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const url = new URL(raw, window.location.href)
        const isOurApi =
          url.origin === window.location.origin && url.pathname.startsWith('/api/')
        if (isOurApi && !EXEMPT_API_PATHS.includes(url.pathname)) {
          if (res.status === 401) redirectToLogin()
          else if (url.pathname !== SESSION_PROBE_PATH) probeSession(original)
        }
      } catch {
        // An input shape we could not read is not a reason to fail the caller's
        // request — the response is already in hand and is returned below.
      }
    }
    return res
  }
}
