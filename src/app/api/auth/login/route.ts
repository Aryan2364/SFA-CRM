import { NextRequest, NextResponse } from 'next/server'
import { signSession, sessionMaxAgeSecondsFor, COOKIE_NAME } from '@/lib/session'
import { getRequestLayout } from '@/lib/layout.server'
import { prisma } from '@/lib/db'
import { asId } from '@/lib/tenant-fk'
import bcrypt from 'bcryptjs'

/**
 * A real bcrypt hash of a value nobody knows, at the same cost as every hash
 * this app writes. It is compared against on the two paths that would otherwise
 * answer instantly and so ADVERTISE something: a phone number matching no row
 * at all, and a row whose password is still stored in cleartext (`===`, which
 * costs nothing). Both now spend one bcrypt compare, so neither is faster than
 * an ordinary wrong password.
 *
 * What this buys and no more: a single login attempt cannot be timed to tell
 * "no such phone" from "wrong password" from "a legacy cleartext account". It
 * is NOT a defence against volume — this endpoint is unauthenticated and
 * un-rate-limited, and `MAX_CANDIDATES` below caps the work per request rather
 * than the requests themselves.
 */
const ABSENT_USER_HASH = '$2b$12$edUlAGhrCboNTEFnoK0tyu0S8cE0ZKI/WKMoHIJUKITyRXc34Y92y'

/**
 * Ceiling on the rows one phone number may put through bcrypt in a single
 * request. Each compare is a deliberate ~100ms of CPU, so an unbounded lookup
 * turns one unauthenticated POST into as many hundred-millisecond burns as
 * there are duplicate rows for that number.
 *
 * Ten is far above any real count of companies one person works for. Hitting
 * it is therefore a signal, and is logged as one.
 */
const MAX_CANDIDATES = 10

type Candidate = Awaited<ReturnType<typeof findUsersByContact>>[number]

/** Last 4 digits only, so an operator can act on a report without the log
 *  carrying a customer's staff phone number in clear. */
function redactContact(contact: string | null): string {
  if (!contact) return '(none)'
  return contact.length <= 4 ? '****' : `${'*'.repeat(contact.length - 4)}${contact.slice(-4)}`
}

/** The one answer for every credential failure, so no branch can be told apart by its body. */
function invalidCredentials() {
  return NextResponse.json({ error: 'Invalid phone or password' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  // Shape-checked before any lookup. A body that is not a JSON object, or a
  // `phone`/`password` that is not a string (a number, array or object would
  // reach `phone.trim()` and bcrypt and throw), is a 400, never a 500.
  const body: unknown = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { phone, password, tenantId: rawTenantId } = body as Record<string, unknown>
  if (!phone || !password) return NextResponse.json({ error: 'Phone and password are required' }, { status: 400 })
  if (typeof phone !== 'string' || typeof password !== 'string' || !phone.trim()) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Present only on the second step of a multi-company login, after the caller
  // picked from the `chooseCompany` list. It is a CHOICE, never a credential:
  // everything below re-verifies the phone and password from scratch, and the
  // tenant is honoured only if the password also matches that tenant's row.
  // Shape-checked before any work, so a malformed value costs no bcrypt.
  const hasTenantChoice = rawTenantId !== undefined && rawTenantId !== null
  const tenantChoice = hasTenantChoice ? asId(rawTenantId) : null
  if (hasTenantChoice && !tenantChoice) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  // Query users by contact globally (multi-tenant: no tenant filter)
  //
  // The old client surfaced database failures as a value (`dbError`) and this route
  // fell through to the generic 401 rather than raising. Prisma throws, so the
  // lookup is wrapped to preserve that exact behaviour (PLAN.md §5.4).
  let candidates: Candidate[] = []
  try {
    candidates = await findUsersByContact(phone.trim())
  } catch {
    candidates = []
  }

  if (candidates.length > MAX_CANDIDATES) {
    console.error(
      `[auth/login][CANDIDATE-CAP] ${candidates.length} rows share one phone number; ` +
        `only the oldest ${MAX_CANDIDATES} were considered. Beyond a duplicate-account ` +
        'problem this is a CPU amplifier on an unauthenticated endpoint — investigate. ' +
        JSON.stringify({ contact: redactContact(phone.trim()), rows: candidates.length }),
    )
  }

  // `contact` is unique per tenant, not globally (prisma/schema.prisma:405), so
  // one phone number can name a row in several firms. The password decides which
  // one — previously the OLDEST row won unconditionally and everyone else's
  // account was unreachable behind a generic 401.
  const matched: Candidate[] = []
  for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
    const isHashed = candidate.password?.startsWith('$2')
    let isValid: boolean
    if (isHashed) {
      isValid = await bcrypt.compare(password, candidate.password)
    } else {
      // A cleartext row is compared with `===`, which is free. The dummy
      // compare buys back the ~100ms so this answer is not measurably faster
      // than a hashed row's — without it a quick "no" MARKS an account as a
      // legacy cleartext one, which is exactly the accounts worth attacking.
      await bcrypt.compare(password, ABSENT_USER_HASH)
      isValid = candidate.password === password
    }
    if (!isValid) continue
    matched.push(candidate)
    // Upgrade a cleartext password to a hash on the first successful login,
    // which migrates every surviving legacy account as its owner signs in.
    // Awaited, not fire-and-forget: the row must actually be rewritten, and the
    // cost is one UPDATE on a request that has already spent bcrypt time. A
    // failure here must never block a valid login, so it is swallowed.
    //
    // Conditional on the exact cleartext just compared. Between the read above
    // and this write the owner may have changed their password (or an admin or
    // a reset may have); an unconditional write would then put hash(OLD
    // password) back over the new one. If the row moved on, this matches
    // nothing and the newer password stands.
    if (!isHashed) {
      const hash = await bcrypt.hash(password, 12)
      await prisma.users
        .updateMany({
          where: { id: candidate.id, tenant_id: candidate.tenant_id, password: candidate.password },
          data: { password: hash },
        })
        .catch(() => {})
    }
  }

  if (matched.length === 0) {
    // Spend the same time a wrong password would, so an unknown phone number is
    // indistinguishable from a known one.
    if (candidates.length === 0) await bcrypt.compare(password, ABSENT_USER_HASH)
    return invalidCredentials()
  }

  // Apply the account/tenant-health gate to every password match, then let the
  // survivors decide the outcome. A firm that is disabled or suspended can
  // therefore never be reached through this route.
  const gated = await Promise.all(matched.map(async c => ({ candidate: c, denial: await denialFor(c) })))
  const eligible = gated.filter(g => g.denial === null).map(g => g.candidate)

  // Second step of a multi-company login: the caller named the company. The
  // candidates above were fetched and password-verified afresh on THIS request
  // — nothing from the first call is trusted — and the choice selects among
  // them only. A tenant whose row did not match this password (a forged or
  // mistyped id, or a company this person has no account in) gets exactly the
  // bad-credentials 401, so the id reveals nothing a stranger could probe.
  let user: Candidate
  if (tenantChoice) {
    const chosen = gated.find(g => g.candidate.tenant_id === tenantChoice)
    if (!chosen) return invalidCredentials()
    // The same account/firm-health answer a one-company login gets. Only a
    // caller who has just proven this row's password can see it.
    if (chosen.denial) return chosen.denial
    user = chosen.candidate
  } else {
    if (eligible.length === 0) {
      // Every match is blocked. Answer with the oldest match's reason, which is
      // exactly what this route returned before when it only ever saw that row.
      return gated[0].denial as NextResponse
    }

    // `contact` is unique per tenant, so each eligible row is a different
    // company; the dedupe is belt and braces. Oldest first, off the lookup's
    // `created_at asc` ordering, which matched/gated/eligible all preserve.
    const tenantIds = Array.from(new Set(eligible.map(u => u.tenant_id)))
    if (tenantIds.length > 1) {
      // The same phone AND the same password in more than one live company —
      // an expected state: one person may work for several firms. Rather than
      // guess, set NO cookie and ask which one.
      //
      // Naming the companies leaks nothing to a stranger: a tenant is listed
      // only if the caller has just proven valid credentials for that tenant's
      // own row, and passed its health gate. Someone without the password gets
      // the flat 401 above and never reaches this line.
      const tenants = await prisma.tenants.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true },
      })
      const nameOf = new Map(tenants.map(t => [t.id, t.name]))
      console.info(
        '[auth/login][AMBIGUOUS-DUPLICATE-PHONE] one phone number and one password match ' +
          'several companies; offered the caller a choice. No session issued yet. ' +
          JSON.stringify({
            // Last 4 digits only. The user ids below identify the rows exactly,
            // so an operator loses nothing, while stdout — which is shipped,
            // aggregated and retained well beyond this process — stops carrying
            // a customer's staff phone number in clear on every such login.
            contact: redactContact(eligible[0].contact),
            candidates: eligible.map(u => ({ userId: u.id, tenantId: u.tenant_id })),
          }),
      )
      return NextResponse.json({
        chooseCompany: tenantIds.map(id => ({ tenantId: id, companyName: nameOf.get(id) ?? 'Unnamed company' })),
      })
    }

    // One company. With a single match (the overwhelmingly common case) this
    // is simply that match.
    user = eligible[0]
  }

  // Resolve the effective role the same way requireUser() does:
  // Administrator profile stays 'Administrator'; otherwise use the assigned
  // role name (from role_id → roles.name), falling back to 'NoRole'.
  const roleName = user.roles?.name
  const effectiveRole =
    user.profile === 'Administrator' ? 'Administrator' : (roleName ?? 'NoRole')

  // One number for both the token's `exp` and the cookie's maxAge; phones get the longer lifetime.
  const maxAge = sessionMaxAgeSecondsFor(getRequestLayout(req))
  const token = await signSession({
    phone: user.contact,
    userId: user.id,
    name: user.name,
    role: effectiveRole,
    tenantId: user.tenant_id ?? process.env.DEFAULT_TENANT_ID ?? '',
    cv: user.credentials_version ?? 1,
  }, maxAge)
  // NOTE: the previous fire-and-forget insert into `user_login_logs` was
  // removed here. That table does not exist in the database, so the write had
  // been failing silently (the old client returned the error as an ignored value).
  // See PLAN.md §13.1 — the capability is gone, not migrated.
  const res = NextResponse.json({ ok: true })
  // maxAge is the same number signSession() used for `exp`, so the
  // cookie and the token it carries die at the same moment. A cookie that
  // outlived its token would leave the browser sending a dead session and
  // middleware — which only checks that a cookie exists — waving it through.
  res.cookies.set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge })
  return res
}

/**
 * The account and tenant-health gate, unchanged in substance from when it was
 * inline: inactive account first, then the firm's `is_active` and
 * `payment_status`. Returns the response to send, or null if this row may log in.
 */
async function denialFor(user: Candidate): Promise<NextResponse | null> {
  if (user.status !== 'Active') {
    return NextResponse.json({ error: 'Account is inactive. Contact your administrator.' }, { status: 403 })
  }

  if (user.tenant_id) {
    const tenant = await prisma.tenants.findUnique({
      where: { id: user.tenant_id },
      select: { is_active: true, payment_status: true },
    })
    if (tenant) {
      if (!tenant.is_active) {
        return NextResponse.json({ error: 'Your company account is disabled. Please contact support.' }, { status: 403 })
      }
      if (tenant.payment_status === 'Suspended') {
        return NextResponse.json({ error: "Your company's access has been suspended. Please contact support." }, { status: 403 })
      }
    }
  }

  return null
}

/**
 * Every row carrying this phone number, oldest first — the ordering the old
 * `.order('created_at').limit(1).maybeSingle()` used, kept so that the oldest
 * row still supplies the rejection message when nothing is eligible, and so
 * that the company choice above is listed oldest account first.
 *
 * `take` is MAX_CANDIDATES + 1, not MAX_CANDIDATES: the extra row is how the
 * caller can tell "exactly at the cap" from "over it" and log the second.
 *
 * Deliberately not tenant-scoped — login resolves a user across all tenants and
 * derives the tenant FROM the row it picks. This is on the tenant-scope
 * allowlist (PLAN.md §8.2) with that reason.
 */
function findUsersByContact(contact: string) {
  return prisma.users.findMany({
    where: { contact },
    orderBy: { created_at: 'asc' },
    take: MAX_CANDIDATES + 1,
    select: {
      id: true,
      name: true,
      profile: true,
      contact: true,
      password: true,
      status: true,
      tenant_id: true,
      credentials_version: true,
      roles: { select: { name: true } },
    },
  })
}
