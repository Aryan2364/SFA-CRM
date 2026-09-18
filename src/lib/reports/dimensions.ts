import { dateOnlyString } from '@/lib/db'
import type { PermSection } from '@/lib/permissions'
import { readPath, SOURCE_DEFS, SOURCES, type SourceKey } from './sources'

/**
 * THE DIMENSION REGISTRY — REBUILD-PLAN.md §7.2, declared as data.
 *
 * Each dimension declares, PER SOURCE, what it needs selected and how to read a
 * group key and a label out of one fetched row. `run.ts` is a loop over these;
 * it contains no dimension names.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ NOTHING HERE IS HARD-CODED FROM A MASTER (§2)
 *
 * Every master value in this system is user-defined. Company Type, Expense
 * Category, Deal Stage, Reason for Loss, Industry and Contact Type are all read
 * from the ROW, whatever the tenant happens to have configured — a dimension
 * never enumerates the values it expects, so a tenant that renames "Dealer" to
 * "Channel Partner" gets a report about Channel Partners with no code change.
 *
 * The three things that ARE enumerated are enumerated here, as configuration,
 * because they are DERIVED bands rather than master rows: the probability bands
 * (§10's 0-30/40-60/70-100 default), the deal ageing bands, and the meeting-type
 * derivation. Edit them here; do not inline them anywhere else.
 */

// ---------------------------------------------------------------------------
// Configuration — derived bands, not masters. §10 defaults.
// ---------------------------------------------------------------------------

/** §10: "0-30 / 40-60 / 70-100". A probability is a multiple of ten (§4.1), so
 *  there is no gap between 30 and 40 in practice. */
export const PROBABILITY_BANDS = [
  { key: '0-30', label: '0–30%', min: 0, max: 30 },
  { key: '40-60', label: '40–60%', min: 40, max: 60 },
  { key: '70-100', label: '70–100%', min: 70, max: 100 },
] as const

/** §7.2 "Days in current stage (ageing band)". */
export const AGEING_BANDS = [
  { key: '0-7', label: '0–7 days', min: 0, max: 7 },
  { key: '8-14', label: '8–14 days', min: 8, max: 14 },
  { key: '15-30', label: '15–30 days', min: 15, max: 30 },
  { key: '31-60', label: '31–60 days', min: 31, max: 60 },
  { key: '60+', label: 'Over 60 days', min: 61, max: Number.MAX_SAFE_INTEGER },
] as const

/**
 * §7.2 "Meeting type (Planned / Unplanned / Past Entry)". Not a master — it is
 * derived from two columns, and the derivation is the definition:
 *   - it came off a weekly plan item  -> Planned
 *   - it was typed in after the fact  -> Past Entry
 *   - otherwise                       -> Unplanned
 */
export const MEETING_TYPES = {
  planned: 'Planned',
  past_entry: 'Past Entry',
  unplanned: 'Unplanned',
} as const

// ---------------------------------------------------------------------------
// Lookups — the two joins Prisma cannot make
// ---------------------------------------------------------------------------

export type CompanyInfo = {
  id: string
  name: string
  type: string | null
  pincode: string | null
  is_complete: boolean
  industry: string | null
  state: string | null
}

/** Filled by `run.ts` with ONE tenant-scoped query each, only when needed. */
export type ReportLookups = {
  companies: Map<string, CompanyInfo>
  users: Map<string, string>
}

export type LookupNeed = 'company' | 'user'

export const UNSET_KEY = '__unset__'

export type DimBinding = {
  /** Merged into the query's `select`. */
  select: Record<string, unknown>
  /** Which of the two lookups this binding reads. */
  needs?: LookupNeed
  extract: (row: Record<string, unknown>, lookups: ReportLookups) => { key: string; label: string }
}

export type DimensionDef = {
  key: string
  label: string
  /** Ordering of the result. Time dimensions read chronologically; everything
   *  else reads as a ranking, biggest first. */
  sort: 'key' | 'value'
  /**
   * A section whose data this dimension reads beyond the source's own — e.g.
   * slicing Orders by Industry reads `companies`. `run.ts` requires `view` on
   * it. (It does NOT re-apply the Party scope: the label describes a row the
   * caller can already see, and `orders.entity_name` carries the company name
   * on the order row regardless.)
   */
  requiresSection?: PermSection
  on: Partial<Record<SourceKey, DimBinding>>
}

// ---------------------------------------------------------------------------
// Small binding builders
// ---------------------------------------------------------------------------

const str = (v: unknown, fallback: string) => {
  const s = v === null || v === undefined ? '' : String(v)
  return s.trim() === '' ? fallback : s
}

/** A plain column on the source: the value is both the key and the label. */
function plain(path: string[], unsetLabel: string): DimBinding {
  return {
    select: nestedSel(path),
    extract: row => {
      const v = readPath(row, path)
      if (v === null || v === undefined || String(v).trim() === '') {
        return { key: UNSET_KEY, label: unsetLabel }
      }
      return { key: String(v), label: String(v) }
    },
  }
}

/** A to-one relation with `id`/`name`, e.g. `deal_stages`. */
function related(rel: string, unsetLabel: string): DimBinding {
  return {
    select: { [rel]: { select: { id: true, name: true } } },
    extract: row => {
      const r = readPath(row, [rel]) as { id?: string; name?: string } | null
      if (!r?.id) return { key: UNSET_KEY, label: unsetLabel }
      return { key: r.id, label: str(r.name, unsetLabel) }
    },
  }
}

/** A company attribute, reached through the company lookup. */
function company(
  source: SourceKey,
  pick: (c: CompanyInfo) => string | null,
  unsetLabel: string,
  /** `true` when the company's identity is the group (Company dimension), so
   *  the id is the key; `false` when the ATTRIBUTE is the group. */
  keyById: boolean,
  /** A denormalised label already on the row, used when the company row is
   *  gone. `orders` and `daily_visits` both carry one. */
  fallbackPath?: string[]
): DimBinding | undefined {
  const idPath = SOURCE_DEFS[source].companyIdPath
  if (!idPath) return undefined
  return {
    select: fallbackPath
      ? { ...nestedSel(idPath), ...nestedSel(fallbackPath) }
      : nestedSel(idPath),
    needs: 'company',
    extract: (row, lookups) => {
      const id = readPath(row, idPath)
      const info = id ? lookups.companies.get(String(id)) : undefined
      const fallback = fallbackPath ? readPath(row, fallbackPath) : null
      if (keyById) {
        if (!id) return { key: UNSET_KEY, label: unsetLabel }
        return { key: String(id), label: str(info?.name ?? fallback, unsetLabel) }
      }
      const v = info ? pick(info) : (fallback as string | null)
      if (v === null || v === undefined || String(v).trim() === '') {
        return { key: UNSET_KEY, label: unsetLabel }
      }
      return { key: String(v), label: String(v) }
    },
  }
}

/** The owning user, reached through the user lookup. */
function owner(source: SourceKey): DimBinding {
  const path = SOURCE_DEFS[source].scopePath
  return {
    select: nestedSel(path),
    needs: 'user',
    extract: (row, lookups) => {
      const id = readPath(row, path)
      if (!id) return { key: UNSET_KEY, label: 'Unassigned' }
      return { key: String(id), label: lookups.users.get(String(id)) ?? 'Unknown user' }
    },
  }
}

function nestedSel(path: readonly string[]): Record<string, unknown> {
  if (path.length === 1) return { [path[0]]: true }
  return { [path[0]]: { select: nestedSel(path.slice(1)) } }
}

const ALL_SOURCES = Object.keys(SOURCES) as SourceKey[]

/** Builds a binding on every source, from each source's declared date column. */
function onEverySource(make: (source: SourceKey) => DimBinding | undefined) {
  const out: Partial<Record<SourceKey, DimBinding>> = {}
  for (const s of ALL_SOURCES) {
    const b = make(s)
    if (b) out[s] = b
  }
  return out
}

// ---------------------------------------------------------------------------
// Time buckets
// ---------------------------------------------------------------------------

export type TimeGrain = 'day' | 'week' | 'month' | 'quarter' | 'year'

/**
 * ⚠️ `dateOnlyString()`, never `String(date)` or `date.toLocaleDateString()`.
 *
 * Prisma hands back a `Date`, and every bucket below is used as a `Map` key and
 * compared with `<`. A raw `Date` keyed into a Map produces one group per
 * millisecond and sorts as "Mon Sep 14 2026 …" — both silent (PLAN.md §8.4).
 * `@db.Date` columns arrive as UTC midnight, so the slice is the calendar date;
 * `created_at` columns are timestamptz and bucket by their UTC day.
 */
export function timeBucket(date: Date, grain: TimeGrain): { key: string; label: string } {
  const iso = dateOnlyString(date)
  const [y, m, d] = iso.split('-')
  switch (grain) {
    case 'day':
      return { key: iso, label: iso }
    case 'month':
      return { key: `${y}-${m}`, label: `${MONTHS[Number(m) - 1]} ${y}` }
    case 'quarter': {
      const q = Math.floor((Number(m) - 1) / 3) + 1
      return { key: `${y}-Q${q}`, label: `Q${q} ${y}` }
    }
    case 'year':
      return { key: y, label: y }
    case 'week': {
      // Monday-start week, computed in UTC so it cannot shift by a day in IST.
      const t = Date.UTC(Number(y), Number(m) - 1, Number(d))
      const dow = new Date(t).getUTCDay() // 0 = Sunday
      const back = (dow + 6) % 7
      const start = dateOnlyString(new Date(t - back * 86_400_000))
      return { key: start, label: `Week of ${start}` }
    }
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function timeDimension(grain: TimeGrain, label: string): DimensionDef {
  return {
    key: `time_${grain}`,
    label,
    sort: 'key',
    on: onEverySource(source => {
      const path = SOURCE_DEFS[source].datePath
      return {
        select: nestedSel(path),
        extract: row => {
          const v = readPath(row, path)
          if (!(v instanceof Date)) return { key: UNSET_KEY, label: 'No date' }
          return timeBucket(v, grain)
        },
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const DIMENSION_LIST: DimensionDef[] = [
  // ── People ──────────────────────────────────────────────────────────────
  {
    key: 'sales_person',
    label: 'Sales Person',
    sort: 'value',
    on: onEverySource(s => owner(s)),
  },

  // ── Party (§7.2) ────────────────────────────────────────────────────────
  {
    key: 'company',
    label: 'Company',
    sort: 'value',
    requiresSection: 'companies',
    on: {
      orders: company('orders', c => c.name, 'No company', true, ['entity_name']),
      order_items: company('order_items', c => c.name, 'No company', true),
      visits: company('visits', c => c.name, 'No company', true, ['entity_name']),
      deals: company('deals', c => c.name, 'No company', true),
      companies: company('companies', c => c.name, 'No company', true, ['name']),
      follow_ups: company('follow_ups', c => c.name, 'No company', true),
    },
  },
  {
    key: 'company_type',
    label: 'Company Type',
    sort: 'value',
    requiresSection: 'companies',
    on: {
      // ⚠️ Read through the company row, not through `orders.entity_type` /
      // `daily_visits.visit_type`. Those are snapshots taken when the row was
      // written; the master is the truth today, and §2 says the master wins.
      // The snapshot is only the fallback for a company that no longer exists.
      orders: company('orders', c => c.type, 'Unknown type', false, ['entity_type']),
      order_items: company('order_items', c => c.type, 'Unknown type', false),
      visits: company('visits', c => c.type, 'Unknown type', false, ['visit_type']),
      deals: company('deals', c => c.type, 'Unknown type', false),
      companies: company('companies', c => c.type, 'Unknown type', false, ['type']),
      follow_ups: company('follow_ups', c => c.type, 'Unknown type', false),
    },
  },
  {
    key: 'industry',
    label: 'Industry / Segment',
    sort: 'value',
    requiresSection: 'companies',
    on: {
      orders: company('orders', c => c.industry, 'No industry', false),
      visits: company('visits', c => c.industry, 'No industry', false),
      deals: company('deals', c => c.industry, 'No industry', false),
      companies: company('companies', c => c.industry, 'No industry', false),
    },
  },
  {
    key: 'party_completeness',
    label: 'Party Completeness',
    sort: 'value',
    requiresSection: 'companies',
    on: {
      orders: company('orders', c => (c.is_complete ? 'Complete' : 'Incomplete'), 'Unknown', false),
      visits: company('visits', c => (c.is_complete ? 'Complete' : 'Incomplete'), 'Unknown', false),
      deals: company('deals', c => (c.is_complete ? 'Complete' : 'Incomplete'), 'Unknown', false),
      companies: company('companies', c => (c.is_complete ? 'Complete' : 'Incomplete'), 'Unknown', false),
    },
  },
  {
    key: 'contact_type',
    label: 'Contact Type',
    sort: 'value',
    on: { contacts: related('contact_types', 'No contact type') },
  },

  // ── Geography (§7.2) ────────────────────────────────────────────────────
  // ⚠️ Q5: `company_addresses.city` is NULL for every migrated row, so City is
  // deliberately absent. Pincode and State are the reliable two on day one.
  {
    key: 'pincode',
    label: 'Pincode',
    sort: 'value',
    requiresSection: 'companies',
    on: {
      orders: company('orders', c => c.pincode, 'No pincode', false),
      visits: company('visits', c => c.pincode, 'No pincode', false),
      deals: company('deals', c => c.pincode, 'No pincode', false),
      companies: company('companies', c => c.pincode, 'No pincode', false),
    },
  },
  {
    key: 'state',
    label: 'State',
    sort: 'value',
    requiresSection: 'companies',
    on: {
      orders: company('orders', c => c.state, 'No state', false),
      visits: company('visits', c => c.state, 'No state', false),
      deals: company('deals', c => c.state, 'No state', false),
      companies: company('companies', c => c.state, 'No state', false),
    },
  },

  // ── Deal (§7.2) ─────────────────────────────────────────────────────────
  { key: 'deal_stage', label: 'Deal Stage', sort: 'value', on: { deals: related('deal_stages', 'No stage') } },
  { key: 'reason_for_loss', label: 'Reason for Loss', sort: 'value', on: { deals: related('reason_for_loss', 'No reason recorded') } },
  { key: 'deal_source', label: 'Deal Source', sort: 'value', on: { deals: plain(['source'], 'No source') } },
  { key: 'deal_outcome', label: 'Won / Lost', sort: 'value', on: { deals: plain(['outcome'], 'Open') } },
  {
    key: 'probability_band',
    label: 'Probability Band',
    sort: 'key',
    on: {
      deals: {
        select: { probability: true },
        extract: row => {
          const p = Number(readPath(row, ['probability']) ?? 0)
          const band = PROBABILITY_BANDS.find(b => p >= b.min && p <= b.max)
          return band ? { key: band.key, label: band.label } : { key: UNSET_KEY, label: 'Unbanded' }
        },
      },
    },
  },
  {
    key: 'deal_ageing_band',
    label: 'Days in Current Stage',
    sort: 'key',
    on: {
      deals: {
        select: { stage_entered_at: true },
        extract: row => {
          const v = readPath(row, ['stage_entered_at'])
          if (!(v instanceof Date)) return { key: UNSET_KEY, label: 'Unknown' }
          const days = Math.max(0, Math.floor((Date.now() - v.getTime()) / 86_400_000))
          const band = AGEING_BANDS.find(b => days >= b.min && days <= b.max)
          return band ? { key: band.key, label: band.label } : { key: UNSET_KEY, label: 'Unknown' }
        },
      },
    },
  },

  // ── Order (§7.2) ────────────────────────────────────────────────────────
  { key: 'order_status', label: 'Order Status', sort: 'value', on: { orders: plain(['status'], 'No status') } },
  {
    key: 'discount_applied',
    label: 'Discount Applied',
    sort: 'value',
    on: {
      orders: {
        select: { has_discount: true },
        extract: row => {
          const yes = readPath(row, ['has_discount']) === true
          return { key: yes ? 'yes' : 'no', label: yes ? 'Yes' : 'No' }
        },
      },
    },
  },
  { key: 'blocked_reason', label: 'Order Blocked Reason', sort: 'value', on: { orders: plain(['blocked_reason'], 'Not blocked') } },

  // ── Product (§7.2) — order lines are the only place a product appears ────
  {
    key: 'product',
    label: 'Product',
    sort: 'value',
    requiresSection: 'products',
    on: { order_items: plain(['product_name'], 'Unnamed product') },
  },
  {
    key: 'product_category',
    label: 'Product Category',
    sort: 'value',
    requiresSection: 'product_categories',
    on: {
      order_items: {
        select: { products: { select: { product_categories: { select: { id: true, name: true } } } } },
        extract: row => {
          const c = readPath(row, ['products', 'product_categories']) as { id?: string; name?: string } | null
          if (!c?.id) return { key: UNSET_KEY, label: 'No category' }
          return { key: c.id, label: str(c.name, 'No category') }
        },
      },
      deals: related('product_categories', 'No category'),
    },
  },
  {
    key: 'product_subcategory',
    label: 'Product Sub-Category',
    sort: 'value',
    requiresSection: 'product_subcategories',
    on: {
      order_items: {
        select: { products: { select: { product_subcategories: { select: { id: true, name: true } } } } },
        extract: row => {
          const c = readPath(row, ['products', 'product_subcategories']) as { id?: string; name?: string } | null
          if (!c?.id) return { key: UNSET_KEY, label: 'No sub-category' }
          return { key: c.id, label: str(c.name, 'No sub-category') }
        },
      },
    },
  },

  // ── Activity (§7.2) ─────────────────────────────────────────────────────
  {
    key: 'meeting_type',
    label: 'Meeting Type',
    sort: 'value',
    on: {
      visits: {
        select: { weekly_plan_item_id: true, is_manual_entry: true },
        extract: row => {
          if (readPath(row, ['weekly_plan_item_id'])) return { key: 'planned', label: MEETING_TYPES.planned }
          if (readPath(row, ['is_manual_entry']) === true) return { key: 'past_entry', label: MEETING_TYPES.past_entry }
          return { key: 'unplanned', label: MEETING_TYPES.unplanned }
        },
      },
    },
  },
  {
    key: 'location_flagged',
    label: 'Location Flagged',
    sort: 'value',
    on: {
      visits: {
        select: { location_flagged: true },
        extract: row => {
          const yes = readPath(row, ['location_flagged']) === true
          return { key: yes ? 'yes' : 'no', label: yes ? 'Flagged' : 'Not flagged' }
        },
      },
    },
  },
  { key: 'follow_up_mode', label: 'Follow-up Mode', sort: 'value', on: { follow_ups: plain(['mode'], 'No mode') } },
  { key: 'follow_up_status', label: 'Follow-up Status', sort: 'value', on: { follow_ups: plain(['status'], 'No status') } },

  // ── Expense (§7.2) ──────────────────────────────────────────────────────
  // `expenses.category` stores the master's NAME. Grouping on the stored value
  // is what makes a renamed or newly-added category appear with no code change.
  { key: 'expense_category', label: 'Expense Category', sort: 'value', on: { expenses: plain(['category'], 'Uncategorised') } },

  // ── Time (§7.2) — every source, from its own declared date column ────────
  timeDimension('day', 'Day'),
  timeDimension('week', 'Week'),
  timeDimension('month', 'Month'),
  timeDimension('quarter', 'Quarter'),
  timeDimension('year', 'Year'),
]

export const DIMENSIONS: Record<string, DimensionDef> = Object.fromEntries(
  DIMENSION_LIST.map(d => [d.key, d])
)

export type DimensionKey = string

export function getDimension(key: string): DimensionDef | null {
  return DIMENSIONS[key] ?? null
}

/** Which dimensions can slice a given source. Drives the UI's picker (P5-T2). */
export function dimensionsForSource(source: SourceKey): DimensionDef[] {
  return DIMENSION_LIST.filter(d => d.on[source] !== undefined)
}
