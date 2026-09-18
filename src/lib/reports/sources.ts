import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { PermSection } from '@/lib/permissions'

/**
 * THE SOURCE REGISTRY — the nine tables a report can be built over.
 *
 * REBUILD-PLAN.md §7.1 asks for one engine, not 41 screens. The engine is a
 * lookup over three registries: sources (here), measures and dimensions. A
 * report is `Measure × 1-2 Dimensions × Date Range × Filters`; nothing in
 * `run.ts` knows the name of a single report.
 *
 * A source declares, as DATA:
 *   - the Prisma model it reads, and the model name `serialize()` needs;
 *   - the permission section that governs it — this is what `run.ts` passes to
 *     `checkPermission()` and to `scopedUserIds()`, so adding a source without
 *     a section is impossible by the type;
 *   - `scopePath` — where the OWNING USER id lives, relative to the queried
 *     model. ⚠️ It differs by table and getting it wrong is silent: the Party
 *     tables scope on `owner_user_id`, the activity tables on `user_id`, and
 *     two sources carry no user column at all and reach it through a relation
 *     (`deal_follow_ups` → `deals.owner_user_id`, `weekly_plan_items` →
 *     `weekly_plans.user_id`).
 *   - `datePath` — the column the report's date range filters on;
 *   - `companyIdPath` — where the company this row is about can be found, for
 *     the Party dimensions. ⚠️ `orders.entity_id` and `daily_visits.entity_id`
 *     are NOT declared foreign keys, so Prisma cannot join them; `run.ts`
 *     resolves them with one tenant-scoped lookup instead (`buildLookups`).
 *
 * ⚠️ There is NO raw SQL in this engine, deliberately — see `run.ts`.
 */

export type SourceKey =
  | 'orders'
  | 'order_items'
  | 'visits'
  | 'expenses'
  | 'deals'
  | 'companies'
  | 'contacts'
  | 'follow_ups'
  | 'plan_items'

export type SourceDef = {
  key: SourceKey
  label: string
  /** Prisma model name — passed to `serialize()`, which needs it to tell a
   *  `@db.Date` from a `@db.Timestamptz`. */
  model: Prisma.ModelName
  /** The permission section that governs this data. */
  section: PermSection
  /** Path to the owning user id, relative to `model`. */
  scopePath: readonly string[]
  /** Path to the date column the range filters on. */
  datePath: readonly string[]
  /** True when `datePath` points at a `@db.Date` (UTC midnight) rather than a
   *  timestamptz. Only affects the comment on how a day bucket is derived —
   *  both are bucketed through `dateOnlyString()`. */
  dateIsDateOnly: boolean
  /** Where the company this row concerns is identified, if anywhere. */
  companyIdPath?: readonly string[]
  /** Always-on predicate, e.g. excluding soft-deleted rows. */
  baseWhere?: Record<string, unknown>
}

export const SOURCES = {
  orders: {
    key: 'orders',
    label: 'Orders',
    model: 'orders',
    section: 'orders',
    scopePath: ['user_id'],
    datePath: ['order_date'],
    dateIsDateOnly: true,
    // Denormalised, not a foreign key — resolved by lookup, not by join.
    companyIdPath: ['entity_id'],
  },
  order_items: {
    key: 'order_items',
    label: 'Order lines',
    model: 'order_items',
    section: 'orders',
    // No user column of its own; the order owns it.
    scopePath: ['orders', 'user_id'],
    datePath: ['orders', 'order_date'],
    dateIsDateOnly: true,
    companyIdPath: ['orders', 'entity_id'],
  },
  visits: {
    key: 'visits',
    label: 'Meetings',
    model: 'daily_visits',
    section: 'meetings',
    scopePath: ['user_id'],
    datePath: ['visit_date'],
    dateIsDateOnly: true,
    companyIdPath: ['entity_id'],
  },
  expenses: {
    key: 'expenses',
    label: 'Expenses',
    model: 'expenses',
    section: 'expenses',
    scopePath: ['user_id'],
    datePath: ['expense_date'],
    dateIsDateOnly: true,
  },
  deals: {
    key: 'deals',
    label: 'Deals',
    model: 'deals',
    section: 'deals',
    // ⚠️ Party-side tables scope on owner_user_id, not user_id.
    scopePath: ['owner_user_id'],
    datePath: ['created_at'],
    dateIsDateOnly: false,
    companyIdPath: ['company_id'],
    baseWhere: { is_active: true },
  },
  companies: {
    key: 'companies',
    label: 'Companies',
    model: 'companies',
    section: 'companies',
    scopePath: ['owner_user_id'],
    datePath: ['created_at'],
    dateIsDateOnly: false,
    companyIdPath: ['id'],
    baseWhere: { is_active: true },
  },
  contacts: {
    key: 'contacts',
    label: 'Contacts',
    model: 'contacts',
    section: 'contacts',
    scopePath: ['owner_user_id'],
    datePath: ['created_at'],
    dateIsDateOnly: false,
    baseWhere: { is_active: true },
  },
  follow_ups: {
    key: 'follow_ups',
    label: 'Follow-ups',
    model: 'deal_follow_ups',
    section: 'deals',
    scopePath: ['deals', 'owner_user_id'],
    datePath: ['due_date'],
    dateIsDateOnly: true,
    companyIdPath: ['deals', 'company_id'],
  },
  plan_items: {
    key: 'plan_items',
    label: 'Weekly plan items',
    model: 'weekly_plan_items',
    section: 'weekly_plan',
    scopePath: ['weekly_plans', 'user_id'],
    datePath: ['plan_date'],
    dateIsDateOnly: true,
  },
} as const satisfies Record<SourceKey, SourceDef>

/**
 * SOURCES is deliberately narrow — `as const` is what keeps `SourceKey` a union
 * of literals rather than `string`. The cost is the same one `masters-registry`
 * pays: a source with no `companyIdPath` has no such property at all, so
 * `SOURCES[k].companyIdPath` does not compile against the union.
 *
 * SOURCE_DEFS is the same table widened. Read keys from SOURCES; read optional
 * fields from here.
 */
export const SOURCE_DEFS: Record<SourceKey, SourceDef> = SOURCES

/**
 * Prisma's delegates are individually typed, so the dynamic dispatch has to
 * live somewhere. It lives here, once, behind an explicit map — a `prisma[name]`
 * index would accept any string and fail at runtime instead of at compile time.
 */
type Delegate = {
  findMany: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>
}

export function delegateFor(key: SourceKey): Delegate {
  switch (key) {
    case 'orders': return prisma.orders as unknown as Delegate
    case 'order_items': return prisma.order_items as unknown as Delegate
    case 'visits': return prisma.daily_visits as unknown as Delegate
    case 'expenses': return prisma.expenses as unknown as Delegate
    case 'deals': return prisma.deals as unknown as Delegate
    case 'companies': return prisma.companies as unknown as Delegate
    case 'contacts': return prisma.contacts as unknown as Delegate
    case 'follow_ups': return prisma.deal_follow_ups as unknown as Delegate
    case 'plan_items': return prisma.weekly_plan_items as unknown as Delegate
  }
}

// ---------------------------------------------------------------------------
// Path helpers — how a declared path becomes a Prisma fragment
// ---------------------------------------------------------------------------

/**
 * `['orders','user_id']` + `{ in: ids }` -> `{ orders: { user_id: { in: ids } } }`.
 *
 * The un-wrapped form is the Prisma shorthand for a REQUIRED to-one relation
 * filter, which is what every relation in `scopePath`/`datePath` above is.
 */
export function nestedWhere(path: readonly string[], leaf: unknown): Record<string, unknown> {
  if (path.length === 0) return {}
  if (path.length === 1) return { [path[0]]: leaf }
  return { [path[0]]: nestedWhere(path.slice(1), leaf) }
}

/** `['orders','order_date']` -> `{ orders: { select: { order_date: true } } }`. */
export function nestedSelect(path: readonly string[]): Record<string, unknown> {
  if (path.length === 0) return {}
  if (path.length === 1) return { [path[0]]: true }
  return { [path[0]]: { select: nestedSelect(path.slice(1)) } }
}

/** Reads a declared path out of a fetched row. */
export function readPath(row: unknown, path: readonly string[]): unknown {
  let cur: unknown = row
  for (const seg of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur ?? null
}

/**
 * Deep-merges Prisma `select` / `where` fragments.
 *
 * Load-bearing for `order_items`, where the scope predicate, the date predicate
 * and the Company dimension all want to nest under the same `orders` key — a
 * shallow `{...a, ...b}` would drop two of the three and the query would come
 * back unscoped. `true` (a select leaf) always wins over an object, because a
 * whole-relation select is a superset of any partial one.
 */
export function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a }
  for (const [k, bv] of Object.entries(b)) {
    const av = out[k]
    if (av === true || bv === true) {
      out[k] = true
    } else if (isPlain(av) && isPlain(bv)) {
      out[k] = deepMerge(av, bv)
    } else {
      out[k] = bv
    }
  }
  return out
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
