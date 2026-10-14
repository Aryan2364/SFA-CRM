/**
 * Account and opportunity SHARING — the one place record access beyond the
 * Self / Team / Company data scope is decided.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL (approved by Aryan, 2026-10-13)
 *
 *   An account (`companies` row) keeps ONE owner (`owner_user_id`). On top of
 *   that it carries a "Shared with" list in `account_members`, each person at
 *   'work' or 'view'. Sharing an account includes EVERY opportunity on it
 *   (`deals.company_id` = that account), now and future, at the same level, and
 *   its linked contacts (`company_contacts`) and its orders.
 *
 *   An opportunity (`deals` row) can additionally be shared with people who are
 *   NOT on the account, in `deal_members`. They reach ONLY that opportunity: the
 *   account, its other opportunities, its contacts and its orders all stay a
 *   404 for them.
 *
 *   'work'  record access for everything the person's OWN ROLE allows.
 *   'view'  read-only record access.
 *
 * ⚠️ SHARING GRANTS RECORD ACCESS, NEVER A NEW ACTION. Every route still runs
 * its `checkPermission(user, section, action)` first; a 'work' member whose
 * role has no `deals.edit` cannot move a stage. And the scope is OR-ed INTO the
 * existing filter, never put in place of it: a user nothing is shared with sees
 * exactly what they saw before this file existed.
 *
 * What a 'work' member may NOT do, whatever their role, because it is owner-
 * level rather than record-level: delete the account / opportunity / contact,
 * or reassign its owner (or move an opportunity to another account). Those stay
 * with the owner-scope test (`'owner-scope'` below).
 *
 * ⚠️ OWNER-BASED THINGS STAY OWNER-BASED. Next-meeting reminders, the Missed /
 * outcome counts, reports, dashboards and data-health alerts all read
 * `owner_user_id` / `user_id` exactly as before and are NOT widened by sharing.
 * Nothing in those code paths should import from this file.
 *
 * Who may change the list: the owner, or anyone with `companies.edit`
 * (`deals.edit` for an opportunity) whose data scope covers the owner — see
 * `canShareCompany` / `canShareDeal`.
 *
 * ---------------------------------------------------------------------------
 * STORAGE — two tables a human creates (prisma db push is not for agents):
 *
 *   CREATE TABLE IF NOT EXISTS account_members (
 *     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     tenant_id uuid NOT NULL,
 *     company_id uuid NOT NULL,
 *     user_id uuid NOT NULL,
 *     access text NOT NULL CHECK (access IN ('work','view')),
 *     added_by uuid NOT NULL,
 *     created_at timestamptz NOT NULL DEFAULT now(),
 *     updated_by uuid NULL,
 *     updated_at timestamptz NULL,
 *     removed_by uuid NULL,
 *     removed_at timestamptz NULL
 *   );
 *   CREATE UNIQUE INDEX IF NOT EXISTS account_members_active_uq
 *     ON account_members (tenant_id, company_id, user_id) WHERE removed_at IS NULL;
 *   CREATE INDEX IF NOT EXISTS account_members_user_idx
 *     ON account_members (tenant_id, user_id) WHERE removed_at IS NULL;
 *
 *   CREATE TABLE IF NOT EXISTS deal_members (
 *     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     tenant_id uuid NOT NULL,
 *     deal_id uuid NOT NULL,
 *     user_id uuid NOT NULL,
 *     access text NOT NULL CHECK (access IN ('work','view')),
 *     added_by uuid NOT NULL,
 *     created_at timestamptz NOT NULL DEFAULT now(),
 *     updated_by uuid NULL,
 *     updated_at timestamptz NULL,
 *     removed_by uuid NULL,
 *     removed_at timestamptz NULL
 *   );
 *   CREATE UNIQUE INDEX IF NOT EXISTS deal_members_active_uq
 *     ON deal_members (tenant_id, deal_id, user_id) WHERE removed_at IS NULL;
 *   CREATE INDEX IF NOT EXISTS deal_members_user_idx
 *     ON deal_members (tenant_id, user_id) WHERE removed_at IS NULL;
 *
 * Active member = `removed_at IS NULL`. The rows ARE the change history:
 *   - add            a new row (`added_by`, `created_at`)
 *   - remove         the active row is closed (`removed_by`, `removed_at`)
 *   - change access  the active row is closed AND stamped `updated_by` /
 *                    `updated_at` (same instant as `removed_at`), and a new row
 *                    with the new access is inserted, in one transaction. So a
 *                    closed row with `updated_at` set was superseded by an
 *                    access change, one without it was removed — and every
 *                    level a person ever held, who set it and when, survives.
 *
 * ---------------------------------------------------------------------------
 * WHY RAW SQL, AND WHY EVERY CALL IS GUARDED — the same trap as
 * `src/lib/gst-setting.ts` and `src/lib/deal-stage-type.ts`.
 *
 * The tables are not in `prisma/schema.prisma` and may not exist in a given
 * database yet. So nothing touches them through Prisma's model API; every query
 * here is raw SQL, and a "table does not exist" failure (Postgres 42P01) is
 * caught: reads answer "nobody is shared" (`[]` / an empty map / `null`), and
 * writes answer `'unavailable'`, which routes turn into a 503 with
 * `SHARING_UNAVAILABLE`. Until the tables exist the whole app behaves exactly
 * as it did before sharing was written. Any OTHER failure is rethrown.
 *
 * ⚠️ EVERY raw query carries `tenant_id = $tenant`. These tables have no FK to
 * anything, so the predicate is the only thing keeping one tenant's sharing
 * out of another's. Every body-sourced id (company, deal, user) is looked up in
 * the caller's tenant before it is written.
 *
 * ⚠️ `npm run prisma:sync` runs `prisma db pull`; once the tables exist it will
 * add models for them. That is harmless (nothing here uses the models), but do
 * not switch these queries to the model API without re-reading this header.
 */

import { Prisma } from '@prisma/client'
import { prisma } from './db'
import { SessionUser } from './auth'
import { checkPermission } from './permissions'
import { scopedUserIds } from './scope'
import { asId, firstForeignTenantRef } from './tenant-fk'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const MEMBER_ACCESS = ['work', 'view'] as const
export type MemberAccess = (typeof MEMBER_ACCESS)[number]

/**
 * How the caller reaches a record.
 *   'owner-scope'  the owner is inside the caller's own data scope — the
 *                  pre-sharing rule, unchanged.
 *   'work'/'view'  reached only through a membership row.
 */
export type AccessLevel = 'owner-scope' | MemberAccess

/** What a route needs before it acts. */
export type AccessNeed = 'read' | 'write' | 'owner'

export function isMemberAccess(value: unknown): value is MemberAccess {
  return typeof value === 'string' && (MEMBER_ACCESS as readonly string[]).includes(value)
}

/** The sentence a write answers with while the tables do not exist. */
export const SHARING_UNAVAILABLE = 'This needs a database update first.'

const RANK: Record<AccessLevel, number> = { view: 1, work: 2, 'owner-scope': 3 }

/** The richer of two levels; `null` is "no access". */
export function richer(a: AccessLevel | null, b: AccessLevel | null): AccessLevel | null {
  if (!a) return b
  if (!b) return a
  return RANK[a] >= RANK[b] ? a : b
}

/**
 * Does `level` satisfy `need`?
 *   read   any access
 *   write  owner-scope or 'work'
 *   owner  owner-scope only (delete, reassign the owner, move to another account)
 */
export function meets(level: AccessLevel | null, need: AccessNeed): boolean {
  if (!level) return false
  if (need === 'read') return true
  if (need === 'write') return level === 'owner-scope' || level === 'work'
  return level === 'owner-scope'
}

// ---------------------------------------------------------------------------
// The missing-table guard
// ---------------------------------------------------------------------------

export type MemberTable = 'account_members' | 'deal_members'

/**
 * "This sharing table has not been created yet" — and nothing else.
 *
 * Probed through this repo's own client on Prisma 7.10 against the local
 * database with the table absent (2026-10-13), for $queryRaw, $executeRaw and
 * an interactive transaction alike:
 *
 *   code: 'P2010'
 *   meta.driverAdapterError.cause = {
 *     originalCode: '42P01',
 *     originalMessage: 'relation "account_members" does not exist',
 *     kind: 'TableDoesNotExist',
 *     table: 'account_members',
 *   }
 *
 * The structured branch checks WHICH table, so another relation going missing
 * is a real fault and is rethrown rather than read as "sharing not deployed".
 * The direct `code` / `meta.code` / `cause.code` checks cover a driver that
 * surfaces the Postgres code unwrapped; the message match is the fallback for a
 * Prisma release that moves the nested shape. If the fallback is ever the only
 * branch firing, the structured one has gone stale and needs re-probing.
 */
function isTableMissing(err: unknown, table: MemberTable): boolean {
  const e = err as {
    code?: unknown
    message?: unknown
    meta?: {
      code?: unknown
      driverAdapterError?: {
        cause?: { originalCode?: unknown; originalMessage?: unknown; kind?: unknown; table?: unknown }
      }
    }
    cause?: { code?: unknown; message?: unknown }
  }
  const named = (text: unknown) => typeof text === 'string' && new RegExp(`\\b${table}\\b`).test(text)

  const cause = e?.meta?.driverAdapterError?.cause
  if (cause) {
    const undefinedTable = cause.originalCode === '42P01' || cause.kind === 'TableDoesNotExist'
    return undefinedTable && (named(cause.table) || named(cause.originalMessage))
  }

  if (e?.code === '42P01' || e?.meta?.code === '42P01' || e?.cause?.code === '42P01') {
    return named(e?.message) || named(e?.cause?.message)
  }

  return (
    typeof e?.message === 'string' &&
    named(e.message) &&
    /42P01|relation .* does not exist|undefined[_ ]table/i.test(e.message)
  )
}

/** Postgres 23505 — the partial unique index refusing a second active member. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as {
    code?: unknown
    message?: unknown
    meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown; kind?: unknown } } }
  }
  const cause = e?.meta?.driverAdapterError?.cause
  if (cause) return cause.originalCode === '23505' || cause.kind === 'UniqueConstraintViolation'
  if (e?.code === '23505' || e?.code === 'P2002' || e?.meta?.code === '23505') return true
  return typeof e?.message === 'string' && /23505|duplicate key value|_active_uq/i.test(e.message)
}

/**
 * Once a table is known to be missing, reads skip it for a short while instead
 * of sending Postgres a failing statement on every list request (each one is an
 * ERROR line in the server log). Writes always try. Thirty seconds is how long a
 * freshly created table can take to be noticed — no restart needed.
 */
const MISSING_TTL_MS = 30_000
const missingUntil = new Map<MemberTable, number>()

function knownMissing(table: MemberTable): boolean {
  const until = missingUntil.get(table)
  return until !== undefined && until > Date.now()
}

async function guardedRead<T>(table: MemberTable, empty: T, run: () => Promise<T>): Promise<T> {
  if (knownMissing(table)) return empty
  try {
    return await run()
  } catch (err) {
    if (isTableMissing(err, table)) {
      missingUntil.set(table, Date.now() + MISSING_TTL_MS)
      return empty
    }
    throw err
  }
}

type WriteFailure = 'unavailable' | 'exists'

async function guardedWrite<T>(table: MemberTable, run: () => Promise<T>): Promise<T | WriteFailure> {
  try {
    const out = await run()
    missingUntil.delete(table)
    return out
  } catch (err) {
    if (isTableMissing(err, table)) {
      missingUntil.set(table, Date.now() + MISSING_TTL_MS)
      return 'unavailable'
    }
    if (isUniqueViolation(err)) return 'exists'
    throw err
  }
}

/**
 * The two tables differ only in their target column. Identifiers cannot be
 * bound as parameters, so they are spliced in with `Prisma.raw` — ONLY ever
 * from this constant map, never from anything a caller supplied.
 */
const TABLES: Record<MemberTable, { table: Prisma.Sql; target: Prisma.Sql }> = {
  account_members: { table: Prisma.raw('account_members'), target: Prisma.raw('company_id') },
  deal_members: { table: Prisma.raw('deal_members'), target: Prisma.raw('deal_id') },
}

/**
 * Whether the sharing tables exist yet, for the pages: until they do, the
 * "Shared with" sections are not rendered at all, so the screens look exactly
 * as they did before sharing was written. A one-row probe, tenant-scoped like
 * every other statement here. Pass the tables the page needs.
 */
export async function isSharingAvailable(tenantId: string, tables: MemberTable[]): Promise<boolean> {
  if (!asId(tenantId)) return false
  for (const table of tables) {
    const t = TABLES[table]
    const ok = await guardedRead<boolean>(table, false, async () => {
      await prisma.$queryRaw(Prisma.sql`SELECT 1 FROM ${t.table} WHERE tenant_id = ${tenantId}::uuid LIMIT 1`)
      return true
    })
    if (!ok) return false
  }
  return true
}

/**
 * The people a record may be shared with: ACTIVE users of this tenant, minus
 * the owner and minus anyone already on `exclude`. Names and ids only. The
 * routes serve it only to a caller who may share the record.
 */
export async function shareCandidates(
  tenantId: string,
  ownerId: string | null,
  exclude: string[]
): Promise<{ id: string; name: string }[]> {
  const skip = new Set([...(ownerId ? [ownerId] : []), ...exclude])
  const users = await prisma.users.findMany({
    where: { tenant_id: tenantId, status: 'Active' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  return users.filter(u => !skip.has(u.id))
}

// ---------------------------------------------------------------------------
// The caller's own memberships
// ---------------------------------------------------------------------------

type MembershipRow = { target_id: string; access: string }

async function membershipsOf(
  table: MemberTable,
  userId: string | null | undefined,
  tenantId: string
): Promise<Map<string, MemberAccess>> {
  const map = new Map<string, MemberAccess>()
  if (!asId(userId) || !asId(tenantId)) return map
  const t = TABLES[table]
  const rows = await guardedRead<MembershipRow[]>(table, [], () =>
    prisma.$queryRaw<MembershipRow[]>(Prisma.sql`
      SELECT ${t.target}::text AS target_id, access
        FROM ${t.table}
       WHERE tenant_id = ${tenantId}::uuid
         AND user_id = ${userId}::uuid
         AND removed_at IS NULL
    `)
  )
  for (const row of rows) if (isMemberAccess(row.access)) map.set(row.target_id, row.access)
  return map
}

/** Accounts shared with the caller, keyed by company id. */
export function getCompanyMemberships(user: SessionUser, tenantId: string): Promise<Map<string, MemberAccess>> {
  return membershipsOf('account_members', user.userId, tenantId)
}

/** Opportunities shared with the caller DIRECTLY (opportunity-only sharing). */
export function getDealMemberships(user: SessionUser, tenantId: string): Promise<Map<string, MemberAccess>> {
  return membershipsOf('deal_members', user.userId, tenantId)
}

function idsAtLeast(map: Map<string, MemberAccess>, min: MemberAccess): string[] {
  return [...map.entries()].filter(([, a]) => min === 'view' || a === 'work').map(([id]) => id)
}

/** Company ids shared with the caller at `min` or better. Tenant-filtered. */
export async function getAccessibleCompanyIds(
  user: SessionUser,
  tenantId: string,
  min: MemberAccess = 'view'
): Promise<string[]> {
  return idsAtLeast(await getCompanyMemberships(user, tenantId), min)
}

/** Deal ids shared with the caller directly, at `min` or better. Tenant-filtered. */
export async function getAccessibleDealIds(
  user: SessionUser,
  tenantId: string,
  min: MemberAccess = 'view'
): Promise<string[]> {
  return idsAtLeast(await getDealMemberships(user, tenantId), min)
}

/**
 * OR the membership predicates INTO a list's scope predicate.
 *
 * `scopePart` is what `scopeWhere(ids, column)` returned. `{}` means Company
 * scope — every row is already visible, so nothing is added. With no extras
 * the scope comes back untouched, which is the "nothing is shared" path and is
 * byte-for-byte the pre-sharing query.
 *
 * Returned under `AND: [...]` so it can be spread beside a `where` that has an
 * `OR` of its own (orders' company filter, the history's "earlier than").
 * Callers must not spread it beside another `AND`.
 */
export function widenScope(
  scopePart: Record<string, unknown>,
  extras: Record<string, unknown>[]
): Record<string, unknown> {
  if (Object.keys(scopePart).length === 0) return {}
  const real = extras.filter(e => Object.keys(e).length > 0)
  if (real.length === 0) return scopePart
  return { AND: [{ OR: [scopePart, ...real] }] }
}

// ---------------------------------------------------------------------------
// Access to one record
// ---------------------------------------------------------------------------

type OwnedRow = { owner_user_id: string | null }

async function ownerInScope(
  user: SessionUser,
  section: 'companies' | 'deals' | 'contacts',
  ownerId: string | null
): Promise<boolean> {
  const ids = await scopedUserIds(user, section)
  return ids === null || (!!ownerId && ids.includes(ownerId))
}

/**
 * How the caller reaches this account: 'owner-scope' (the existing rule),
 * else their `account_members` level, else `null`.
 *
 * Pass `company` when the row is already in hand; otherwise it is read here,
 * tenant-scoped. An id that is not a uuid, or not this tenant's, is `null`.
 */
export async function getCompanyAccessLevel(
  user: SessionUser,
  tenantId: string,
  companyId: string,
  company?: OwnedRow | null
): Promise<AccessLevel | null> {
  if (!asId(companyId)) return null
  const row = company ?? await prisma.companies.findFirst({
    where: { id: companyId, tenant_id: tenantId },
    select: { owner_user_id: true },
  })
  if (!row) return null
  if (await ownerInScope(user, 'companies', row.owner_user_id)) return 'owner-scope'
  return (await getCompanyMemberships(user, tenantId)).get(companyId) ?? null
}

type DealRow = { id: string; owner_user_id: string | null; company_id: string | null }

/**
 * How the caller reaches this opportunity — the richest of:
 *   - 'owner-scope'  the deal's owner is inside the caller's `deals` scope
 *   - the caller's `account_members` level on the deal's account
 *   - the caller's `deal_members` level on the deal itself
 *
 * ⚠️ Owner-scope on the ACCOUNT does not reach its deals: that was never the
 * rule (deals scope on their own owner) and sharing does not change it. Only an
 * account MEMBERSHIP carries over to the account's opportunities.
 */
export async function getDealAccessLevel(
  user: SessionUser,
  tenantId: string,
  dealId: string,
  deal?: DealRow | null
): Promise<AccessLevel | null> {
  if (!asId(dealId)) return null
  const row = deal ?? await prisma.deals.findFirst({
    where: { id: dealId, tenant_id: tenantId },
    select: { id: true, owner_user_id: true, company_id: true },
  })
  if (!row) return null
  if (await ownerInScope(user, 'deals', row.owner_user_id)) return 'owner-scope'
  const [accounts, deals] = await Promise.all([
    row.company_id ? getCompanyMemberships(user, tenantId) : Promise.resolve(new Map<string, MemberAccess>()),
    getDealMemberships(user, tenantId),
  ])
  return richer(
    (row.company_id ? accounts.get(row.company_id) : undefined) ?? null,
    deals.get(row.id) ?? null
  )
}

/**
 * How the caller reaches this contact: 'owner-scope' on the contact's own owner
 * (the existing rule), else the best `account_members` level among the accounts
 * it is linked to. Opportunity-only sharing reaches no contact.
 */
export async function getContactAccessLevel(
  user: SessionUser,
  tenantId: string,
  contactId: string
): Promise<AccessLevel | null> {
  if (!asId(contactId)) return null
  const row = await prisma.contacts.findFirst({
    where: { id: contactId, tenant_id: tenantId },
    select: {
      owner_user_id: true,
      company_contacts: { where: { tenant_id: tenantId }, select: { company_id: true } },
    },
  })
  if (!row) return null
  if (await ownerInScope(user, 'contacts', row.owner_user_id)) return 'owner-scope'
  if (row.company_contacts.length === 0) return null
  const accounts = await getCompanyMemberships(user, tenantId)
  let best: AccessLevel | null = null
  for (const link of row.company_contacts) best = richer(best, accounts.get(link.company_id) ?? null)
  return best
}

/**
 * The ids of this account's opportunities the caller is a DIRECT member of,
 * when that is their ONLY way in — they have no access to the account itself
 * (not owner-scope on `companies`, no `account_members` row). `[]` otherwise,
 * and always `[]` until `deal_members` exists.
 *
 * This is the "opportunity-only member" the meeting screens narrow for: they
 * see the account's name but not the account, and only the meetings linked to
 * opportunities they can access.
 */
export async function opportunityOnlyDealIds(
  user: SessionUser,
  tenantId: string,
  companyId: string
): Promise<string[]> {
  if (!asId(companyId)) return []
  const direct = await getDealMemberships(user, tenantId)
  if (direct.size === 0) return []
  const here = await prisma.deals.findMany({
    where: { tenant_id: tenantId, company_id: companyId, id: { in: [...direct.keys()] } },
    select: { id: true },
  })
  if (here.length === 0) return []
  if (await getCompanyAccessLevel(user, tenantId, companyId)) return []
  return here.map(d => d.id)
}

type VisitForSharing = { id: string; entity_id: string | null }

/**
 * Whether the caller may READ this meeting (`daily_visits` row) through
 * sharing alone — used when the meeting is outside their `meetings` data
 * scope. Decided by Aryan, 2026-10-13: "if an opportunity is shared then
 * meetings against that opportunity should also be shared — else what is the
 * meaning of sharing an opportunity."
 *
 * A meeting is reachable two ways, both READ-only:
 *   - its account (`entity_id`) is one the caller has at least READ access to
 *     (`getCompanyAccessLevel` — owner-scope, or an `account_members` row);
 *   - it is linked (`deal_meetings`) to an opportunity the caller has at
 *     least READ access to (`getDealAccessLevel` — owner-scope, an account
 *     member, or a `deal_members` row).
 *
 * Writing on the meeting (start/stop/delete, minutes, next-meeting, orders
 * from it) is never widened by this: every write route keeps its own
 * `meetings` scope check and never calls this function.
 */
export async function canReadVisitViaSharing(
  user: SessionUser,
  tenantId: string,
  visit: VisitForSharing
): Promise<boolean> {
  if (visit.entity_id) {
    const level = await getCompanyAccessLevel(user, tenantId, visit.entity_id)
    if (meets(level, 'read')) return true
  }
  const links = await prisma.deal_meetings.findMany({
    where: { tenant_id: tenantId, visit_id: visit.id },
    select: { deal_id: true },
  })
  for (const link of links) {
    const level = await getDealAccessLevel(user, tenantId, link.deal_id)
    if (meets(level, 'read')) return true
  }
  return false
}

/**
 * The extra OR-branches (for `widenScope`) that add the opportunities of ONE
 * account the caller may WORK through sharing: all of them when the account is
 * shared with the caller at 'work', plus any shared with them directly at
 * 'work'. `[]` when nothing is shared — the caller's plain scope is then the
 * whole answer, exactly as before. For lists of a single account's deals that
 * carry write controls (the meeting screen's next-meeting picker).
 */
export async function workSharedDealBranches(
  user: SessionUser,
  tenantId: string,
  companyId: string
): Promise<Record<string, unknown>[]> {
  if (!asId(companyId)) return []
  const [accounts, deals] = await Promise.all([
    getCompanyMemberships(user, tenantId),
    getDealMemberships(user, tenantId),
  ])
  const direct = idsAtLeast(deals, 'work')
  return [
    ...(accounts.get(companyId) === 'work' ? [{ company_id: companyId }] : []),
    ...(direct.length ? [{ id: { in: direct } }] : []),
  ]
}

// ---------------------------------------------------------------------------
// Who may change the list
// ---------------------------------------------------------------------------

/**
 * The owner, or someone with `companies.edit` whose `companies` scope covers
 * the owner. An unowned account can only be shared by a Company-scope editor.
 */
export async function canShareCompany(user: SessionUser, company: OwnedRow): Promise<boolean> {
  if (user.userId && company.owner_user_id === user.userId) return true
  if (!await checkPermission(user, 'companies', 'edit')) return false
  return ownerInScope(user, 'companies', company.owner_user_id)
}

/** The same rule for an opportunity, on `deals.edit` and the `deals` scope. */
export async function canShareDeal(user: SessionUser, deal: OwnedRow): Promise<boolean> {
  if (user.userId && deal.owner_user_id === user.userId) return true
  if (!await checkPermission(user, 'deals', 'edit')) return false
  return ownerInScope(user, 'deals', deal.owner_user_id)
}

// ---------------------------------------------------------------------------
// The member list
// ---------------------------------------------------------------------------

export type MemberRow = {
  id: string
  user_id: string
  name: string
  access: MemberAccess
  added_by: string
  added_by_name: string | null
  created_at: string
}

type RawMemberRow = Omit<MemberRow, 'created_at' | 'access'> & { access: string; created_at: Date | string }

function shapeMember(row: RawMemberRow): MemberRow {
  return {
    ...row,
    access: row.access === 'work' ? 'work' : 'view',
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

/**
 * Active members of one account or one opportunity, oldest first. `[]` while
 * the table does not exist. Both joins to `users` repeat the tenant predicate,
 * so a member row can never name a person from another tenant.
 */
async function listMembers(table: MemberTable, tenantId: string, targetId: string): Promise<MemberRow[]> {
  if (!asId(targetId) || !asId(tenantId)) return []
  const t = TABLES[table]
  const rows = await guardedRead<RawMemberRow[]>(table, [], () =>
    prisma.$queryRaw<RawMemberRow[]>(Prisma.sql`
      SELECT m.id::text       AS id,
             m.user_id::text  AS user_id,
             u.name           AS name,
             m.access         AS access,
             m.added_by::text AS added_by,
             ab.name          AS added_by_name,
             m.created_at     AS created_at
        FROM ${t.table} m
        JOIN users u
          ON u.id = m.user_id AND u.tenant_id = m.tenant_id
        LEFT JOIN users ab
          ON ab.id = m.added_by AND ab.tenant_id = m.tenant_id
       WHERE m.tenant_id = ${tenantId}::uuid
         AND m.${t.target} = ${targetId}::uuid
         AND m.removed_at IS NULL
       ORDER BY m.created_at ASC, m.id ASC
    `)
  )
  return rows.map(shapeMember)
}

export function listCompanyMembers(tenantId: string, companyId: string): Promise<MemberRow[]> {
  return listMembers('account_members', tenantId, companyId)
}

export function listDealMembers(tenantId: string, dealId: string): Promise<MemberRow[]> {
  return listMembers('deal_members', tenantId, dealId)
}

/**
 * The person being added must be an ACTIVE user of the caller's tenant, and
 * not the record's owner (who already has full access). Resolves to the 400
 * message, or `null` when the user is acceptable.
 */
export async function memberUserProblem(
  tenantId: string,
  userId: unknown,
  ownerId: string | null
): Promise<string | null> {
  if (userId === undefined || userId === null || userId === '') return 'Choose a person to share with'
  const miss = await firstForeignTenantRef([
    { value: userId, label: 'User',
      find: id => prisma.users.findFirst({ where: { id, tenant_id: tenantId, status: 'Active' }, select: { id: true } }) },
  ])
  if (miss) return miss
  if (ownerId && userId === ownerId) return 'The owner already has full access'
  return null
}

export type MemberWrite = 'ok' | 'exists' | 'not-found' | 'unavailable'

/** Add one person. `'exists'` when they are already an active member. */
async function addMember(
  table: MemberTable,
  tenantId: string,
  targetId: string,
  userId: string,
  access: MemberAccess,
  actorId: string
): Promise<MemberWrite> {
  const t = TABLES[table]
  const out = await guardedWrite(table, () =>
    prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${t.table} (tenant_id, ${t.target}, user_id, access, added_by)
      VALUES (${tenantId}::uuid, ${targetId}::uuid, ${userId}::uuid, ${access}, ${actorId}::uuid)
    `)
  )
  if (out === 'unavailable' || out === 'exists') return out
  return 'ok'
}

/**
 * Change one member's level: close the active row and open a new one, in one
 * transaction, so the old level survives as history (see the header).
 * `'not-found'` when the person is not an active member; `'ok'` and no write
 * when they already hold that level.
 */
async function changeMember(
  table: MemberTable,
  tenantId: string,
  targetId: string,
  userId: string,
  access: MemberAccess,
  actorId: string
): Promise<MemberWrite> {
  const t = TABLES[table]
  const out = await guardedWrite(table, () =>
    prisma.$transaction(async tx => {
      const current = await tx.$queryRaw<{ id: string; access: string }[]>(Prisma.sql`
        SELECT id::text AS id, access
          FROM ${t.table}
         WHERE tenant_id = ${tenantId}::uuid
           AND ${t.target} = ${targetId}::uuid
           AND user_id = ${userId}::uuid
           AND removed_at IS NULL
         FOR UPDATE
      `)
      if (current.length === 0) return 'not-found' as const
      if (current[0].access === access) return 'ok' as const
      await tx.$executeRaw(Prisma.sql`
        UPDATE ${t.table}
           SET updated_by = ${actorId}::uuid, updated_at = now(),
               removed_by = ${actorId}::uuid, removed_at = now()
         WHERE tenant_id = ${tenantId}::uuid
           AND id = ${current[0].id}::uuid
           AND removed_at IS NULL
      `)
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO ${t.table} (tenant_id, ${t.target}, user_id, access, added_by)
        VALUES (${tenantId}::uuid, ${targetId}::uuid, ${userId}::uuid, ${access}, ${actorId}::uuid)
      `)
      return 'ok' as const
    })
  )
  return out
}

/** Remove one member (close the active row). `'not-found'` when there is none. */
async function removeMember(
  table: MemberTable,
  tenantId: string,
  targetId: string,
  userId: string,
  actorId: string
): Promise<MemberWrite> {
  const t = TABLES[table]
  const out = await guardedWrite(table, () =>
    prisma.$executeRaw(Prisma.sql`
      UPDATE ${t.table}
         SET removed_by = ${actorId}::uuid, removed_at = now()
       WHERE tenant_id = ${tenantId}::uuid
         AND ${t.target} = ${targetId}::uuid
         AND user_id = ${userId}::uuid
         AND removed_at IS NULL
    `)
  )
  if (out === 'unavailable' || out === 'exists') return out
  return out > 0 ? 'ok' : 'not-found'
}

/*
 * The exported writes. Each takes ids the ROUTE has already proved: the target
 * row is this tenant's and the caller may share it, the user passed
 * `memberUserProblem`. They are tenant-scoped in SQL regardless.
 */

export const addCompanyMember = (tid: string, companyId: string, userId: string, access: MemberAccess, actorId: string) =>
  addMember('account_members', tid, companyId, userId, access, actorId)
export const changeCompanyMember = (tid: string, companyId: string, userId: string, access: MemberAccess, actorId: string) =>
  changeMember('account_members', tid, companyId, userId, access, actorId)
export const removeCompanyMember = (tid: string, companyId: string, userId: string, actorId: string) =>
  removeMember('account_members', tid, companyId, userId, actorId)

/**
 * Hard-delete every `account_members` row for one account — used only when
 * the account itself is being hard-deleted (no-history delete,
 * `/api/companies/[id]` DELETE). The table has no FK to `companies`, so
 * nothing else would clear these rows, and unlike `removeCompanyMember` this
 * actually removes the rows rather than closing them: there is no account
 * left for their history to be history OF. Guarded like every other write
 * here — a no-op, not an error, when the table does not exist yet.
 */
export async function deleteAllCompanyMembers(tenantId: string, companyId: string): Promise<void> {
  await guardedWrite('account_members', () =>
    prisma.$executeRaw(Prisma.sql`
      DELETE FROM account_members WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid
    `)
  )
}

export const addDealMember = (tid: string, dealId: string, userId: string, access: MemberAccess, actorId: string) =>
  addMember('deal_members', tid, dealId, userId, access, actorId)
export const changeDealMember = (tid: string, dealId: string, userId: string, access: MemberAccess, actorId: string) =>
  changeMember('deal_members', tid, dealId, userId, access, actorId)
export const removeDealMember = (tid: string, dealId: string, userId: string, actorId: string) =>
  removeMember('deal_members', tid, dealId, userId, actorId)
