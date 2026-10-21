import { prisma } from '@/lib/db'
import { SessionUser } from '@/lib/auth'
import { checkPermission, getDataScope, type PermSection } from '@/lib/permissions'
import { scopeWhere } from '@/lib/scope'
import { getVisibleUserIds } from '@/lib/visibility'
import {
  getCompanyMemberships,
  getDealMemberships,
  widenScope,
  type MemberAccess,
} from '@/lib/sharing'

/**
 * The five record types global search covers, and the query logic shared by
 * `/api/search` (the top bar dropdown AND the "See all results" page's
 * per-type paging) and `/api/search/recent` (re-checking a Recent list).
 *
 * Each `search*` function is gated and scoped exactly the way that type's own
 * list route is — see the long comment in the old `route.ts` this was split
 * from, preserved on `GET` below. Reusing these same five functions from both
 * routes, rather than writing the scope test twice, is what keeps Recent and
 * "See all results" from drifting out of sync with the dropdown's own rules.
 *
 * `opts.q` (substring match) and `opts.ids` (exact id set, for Recent) are
 * mutually exclusive; neither given means "nothing can match" and the
 * function returns empty without querying — an unfiltered type listing is
 * never what any caller here wants.
 */
export type ResultType = 'account' | 'contact' | 'opportunity' | 'order' | 'meeting'
export type Result = { type: ResultType; id: string; title: string; subtitle: string | null; href: string }
export type SearchPage = { rows: Result[]; total: number }

export type SearchOpts = {
  /** Substring to match (dropdown and "See all results"). */
  q?: string
  /** Exact ids to re-check (Recent). Only rows still in scope come back. */
  ids?: string[]
  take: number
  skip?: number
  /** Whether the exact total is wanted. Recent and the dropdown never need it. */
  withTotal?: boolean
  /**
   * The caller's per-request lookups (see `createSearchCtx`). The dropdown
   * runs five searchers for one request and passes one of these to all of
   * them; a searcher called without one makes its own.
   */
  ctx?: SearchCtx
}

const EMPTY: SearchPage = { rows: [], total: 0 }

/**
 * What every searcher would otherwise look up for itself, once per request.
 *
 * Five searchers each resolved the caller's visible-user closure and their
 * account / opportunity memberships on their own: about a dozen identical
 * queries per keystroke against a pool of five. These are lazy and memoised,
 * so a request that never needs one (a Company-scope caller, or no sharing
 * tables) still never runs it.
 */
export type SearchCtx = {
  visibleUserIds: () => Promise<string[]>
  companyMemberships: () => Promise<Map<string, MemberAccess>>
  dealMemberships: () => Promise<Map<string, MemberAccess>>
}

function once<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => (pending ??= run())
}

export function createSearchCtx(user: SessionUser, tid: string): SearchCtx {
  return {
    // Keyed on the user's own tenant, exactly as `scopedUserIds` calls it.
    visibleUserIds: once(() => getVisibleUserIds(user.userId as string, user.tenantId)),
    companyMemberships: once(() => getCompanyMemberships(user, tid)),
    dealMemberships: once(() => getDealMemberships(user, tid)),
  }
}

/**
 * `scopedUserIds` (src/lib/scope.ts) with the visibility lookup shared across
 * the request. The rules are the same line for line: `null` is Company scope,
 * a session with no user row owns nothing, `own` is the caller alone, and
 * `team` is the caller plus their whole visibility closure.
 */
async function scopedIds(user: SessionUser, ctx: SearchCtx, section: PermSection): Promise<string[] | null> {
  const scope = await getDataScope(user, section)
  if (scope === 'all') return null
  if (!user.userId) return []
  if (scope === 'own') return [user.userId]
  return [user.userId, ...(await ctx.visibleUserIds())]
}

/**
 * The exact total for a page, without the COUNT query when the page itself
 * proves it: a page that is not full, and is not past the end, is the last
 * page, so the total is `skip + rows`. Only a full page (or one past the end)
 * needs the count.
 */
async function pageTotal(opts: SearchOpts, rows: number, count: () => Promise<number>): Promise<number> {
  if (!opts.withTotal) return 0
  const skip = opts.skip ?? 0
  if (rows > 0 && rows < opts.take) return skip + rows
  if (rows === 0 && skip === 0) return 0
  return count()
}

export async function searchAccounts(user: SessionUser, tid: string, opts: SearchOpts): Promise<SearchPage> {
  if (!(await checkPermission(user, 'companies', 'view'))) return EMPTY
  const q = opts.q?.trim()
  if (!q && !opts.ids?.length) return EMPTY
  const digits = q?.replace(/\D/g, '')
  const ctx = opts.ctx ?? createSearchCtx(user, tid)
  const ids = await scopedIds(user, ctx, 'companies')
  const memberships: Map<string, MemberAccess> = ids === null ? new Map() : await ctx.companyMemberships()
  const scope = {
    tenant_id: tid,
    ...widenScope(
      scopeWhere(ids, 'owner_user_id'),
      memberships.size ? [{ id: { in: [...memberships.keys()] } }] : []
    ),
  }
  const matcher = opts.ids?.length
    ? { id: { in: opts.ids } }
    : {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          ...(digits
            ? [{ mobile_1: { contains: digits } }, { mobile_2: { contains: digits } }]
            : []),
          { gst_number: { contains: q, mode: 'insensitive' as const } },
        ],
      }
  const where = { ...scope, ...matcher }
  const rows = await prisma.companies.findMany({
    where,
    select: { id: true, name: true, mobile_1: true, type: true },
    orderBy: { name: 'asc' },
    take: opts.take,
    skip: opts.skip,
  })
  const total = await pageTotal(opts, rows.length, () => prisma.companies.count({ where }))
  return {
    total,
    rows: rows.map(r => ({
      type: 'account',
      id: r.id,
      title: r.name,
      subtitle: r.mobile_1 ?? r.type,
      href: `/parties/companies/${r.id}`,
    })),
  }
}

export async function searchContacts(user: SessionUser, tid: string, opts: SearchOpts): Promise<SearchPage> {
  if (!(await checkPermission(user, 'contacts', 'view'))) return EMPTY
  const q = opts.q?.trim()
  if (!q && !opts.ids?.length) return EMPTY
  const digits = q?.replace(/\D/g, '')
  const ctx = opts.ctx ?? createSearchCtx(user, tid)
  const ids = await scopedIds(user, ctx, 'contacts')
  const memberships: Map<string, MemberAccess> = ids === null ? new Map() : await ctx.companyMemberships()
  const sharedCompanies = [...memberships.keys()]
  const scope = {
    tenant_id: tid,
    is_active: true,
    ...widenScope(
      scopeWhere(ids, 'owner_user_id'),
      sharedCompanies.length
        ? [{ company_contacts: { some: { tenant_id: tid, company_id: { in: sharedCompanies } } } }]
        : []
    ),
  }
  const matcher = opts.ids?.length
    ? { id: { in: opts.ids } }
    : {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          ...(digits
            ? [{ mobile: { contains: digits } }, { alternate_mobile: { contains: digits } }]
            : []),
          { email: { contains: q, mode: 'insensitive' as const } },
        ],
      }
  const where = { ...scope, ...matcher }
  const rows = await prisma.contacts.findMany({
    where,
    select: { id: true, name: true, mobile: true },
    orderBy: { name: 'asc' },
    take: opts.take,
    skip: opts.skip,
  })
  const total = await pageTotal(opts, rows.length, () => prisma.contacts.count({ where }))
  return {
    total,
    rows: rows.map(r => ({
      type: 'contact',
      id: r.id,
      title: r.name,
      subtitle: r.mobile,
      href: `/parties/contacts/${r.id}`,
    })),
  }
}

export async function searchOpportunities(user: SessionUser, tid: string, opts: SearchOpts): Promise<SearchPage> {
  if (!(await checkPermission(user, 'deals', 'view'))) return EMPTY
  const q = opts.q?.trim()
  if (!q && !opts.ids?.length) return EMPTY
  const ctx = opts.ctx ?? createSearchCtx(user, tid)
  const ids = await scopedIds(user, ctx, 'deals')
  const widen = ids !== null
  // Every membership counts, view or work: the default floor of `getAccessibleCompanyIds` / `getAccessibleDealIds`.
  const [accounts, direct] = widen
    ? await Promise.all([ctx.companyMemberships(), ctx.dealMemberships()]).then(([a, d]) => [[...a.keys()], [...d.keys()]])
    : [[], []]
  const scope = {
    tenant_id: tid,
    ...widenScope(scopeWhere(ids, 'owner_user_id'), [
      ...(accounts.length ? [{ company_id: { in: accounts } }] : []),
      ...(direct.length ? [{ id: { in: direct } }] : []),
    ]),
  }
  const matcher = opts.ids?.length
    ? { id: { in: opts.ids } }
    : { name: { contains: q, mode: 'insensitive' as const } }
  const where = { ...scope, ...matcher }
  const rows = await prisma.deals.findMany({
    where,
    select: { id: true, name: true, companies: { select: { name: true } } },
    orderBy: { created_at: 'desc' },
    take: opts.take,
    skip: opts.skip,
  })
  const total = await pageTotal(opts, rows.length, () => prisma.deals.count({ where }))
  return {
    total,
    rows: rows.map(r => ({
      type: 'opportunity',
      id: r.id,
      title: r.name,
      subtitle: r.companies?.name ?? null,
      href: `/deals/${r.id}`,
    })),
  }
}

export async function searchOrders(user: SessionUser, tid: string, opts: SearchOpts): Promise<SearchPage> {
  if (!(await checkPermission(user, 'orders', 'view'))) return EMPTY
  const q = opts.q?.trim()
  if (!q && !opts.ids?.length) return EMPTY
  const ctx = opts.ctx ?? createSearchCtx(user, tid)
  const ids = await scopedIds(user, ctx, 'orders')
  const shared = ids === null ? [] : [...(await ctx.companyMemberships()).keys()]
  const scope = {
    tenant_id: tid,
    ...widenScope(scopeWhere(ids), [
      ...(shared.length
        ? [
            { entity_id: { in: shared } },
            { daily_visits: { is: { tenant_id: tid, entity_id: { in: shared } } } },
          ]
        : []),
    ]),
  }
  const matcher = opts.ids?.length
    ? { id: { in: opts.ids } }
    : { entity_name: { contains: q, mode: 'insensitive' as const } }
  const where = { ...scope, ...matcher }
  const rows = await prisma.orders.findMany({
    where,
    select: { id: true, entity_name: true, order_date: true, status: true },
    orderBy: [{ order_date: 'desc' }, { created_at: 'desc' }],
    take: opts.take,
    skip: opts.skip,
  })
  const total = await pageTotal(opts, rows.length, () => prisma.orders.count({ where }))
  return {
    total,
    rows: rows.map(r => ({
      type: 'order',
      id: r.id,
      title: r.entity_name ?? 'Order',
      subtitle: `${r.status} · ${r.order_date.toISOString().slice(0, 10)}`,
      href: `/orders/${r.id}`,
    })),
  }
}

export async function searchMeetings(user: SessionUser, tid: string, opts: SearchOpts): Promise<SearchPage> {
  if (!(await checkPermission(user, 'meetings', 'view'))) return EMPTY
  const q = opts.q?.trim()
  if (!q && !opts.ids?.length) return EMPTY
  const ids = await scopedIds(user, opts.ctx ?? createSearchCtx(user, tid), 'meetings')
  const scope = { tenant_id: tid, ...scopeWhere(ids) }
  const matcher = opts.ids?.length
    ? { id: { in: opts.ids } }
    : { entity_name: { contains: q, mode: 'insensitive' as const } }
  const where = { ...scope, ...matcher }
  const rows = await prisma.daily_visits.findMany({
    where,
    select: { id: true, entity_name: true, visit_date: true, user_id: true, visit_type: true },
    orderBy: { visit_date: 'desc' },
    take: opts.take,
    skip: opts.skip,
  })
  const total = await pageTotal(opts, rows.length, () => prisma.daily_visits.count({ where }))
  return {
    total,
    rows: rows.map(r => {
      const date = r.visit_date.toISOString().slice(0, 10)
      // The caller's own day: /daily-activity, whose tab values are
      // plans/meetings/expenses/summary. A colleague's: /review/[userId],
      // which reuses the same screen under different tab VALUES
      // (plans/activity/summary/expenses — "activity" holds the meetings).
      const href =
        r.user_id === user.userId
          ? `/daily-activity?date=${date}&tab=meetings`
          : `/review/${r.user_id}?date=${date}&tab=activity`
      return {
        type: 'meeting',
        id: r.id,
        title: r.entity_name ?? r.visit_type,
        subtitle: date,
        href,
      }
    }),
  }
}

export const SEARCHERS: Record<
  ResultType,
  (user: SessionUser, tid: string, opts: SearchOpts) => Promise<SearchPage>
> = {
  account: searchAccounts,
  contact: searchContacts,
  opportunity: searchOpportunities,
  order: searchOrders,
  meeting: searchMeetings,
}
