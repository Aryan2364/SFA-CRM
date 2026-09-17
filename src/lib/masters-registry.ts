/**
 * THE MASTER REGISTRY — one list, nine consumers.
 *
 * Until this file existed, a master's permission key was written out by hand in
 * seven arrays plus two screen registries, and they had already drifted:
 * `Sidebar.tsx`, `masters/page.tsx` and the Access Control matrix each omitted
 * `dealers`, `distributors` and `institutions`, which meant those three masters
 * were invisible on the Masters page, did not count towards the sidebar's
 * "can this user see Masters at all" test, and — worst of the three — could not
 * be granted by any administrator, because the matrix is the only place the
 * toggle exists.
 *
 * Everything that needs the set of master sections now derives it from here:
 *
 *   src/lib/permissions.ts                              MasterSection, MASTER_SECTIONS
 *   src/app/api/auth/me/route.ts                        ALL_PERMISSION_KEYS
 *   src/app/api/settings/role-permissions/route.ts      ALL_SECTIONS
 *   src/app/api/settings/roles/route.ts                 ALL_SECTIONS
 *   src/app/(protected)/settings/access-control/page.tsx  PERM_GROUPS
 *   src/components/shell/nav.ts                         MASTER_SECTION_KEYS
 *   src/components/ui/Sidebar.tsx                       MASTER_SECTION_KEYS
 *   src/app/(protected)/masters/page.tsx                the card grid
 *   src/app/api/superadmin/companies/route.ts           the new-tenant seed
 *
 * ---------------------------------------------------------------------------
 * THE KEY IS A DATABASE VALUE, NOT A LABEL
 *
 * `key` is written to `role_permissions.section`, which carries a CHECK
 * constraint listing 31 permitted values. Renaming a key here without widening
 * that constraint makes every write fail; renaming it *with* the constraint but
 * without backfilling the rows silently revokes the permission for every
 * non-Administrator, because GET /api/settings/role-permissions returns `false`
 * for a section with no row. Treat `key` as immutable.
 *
 * ---------------------------------------------------------------------------
 * PRESENTATION LIVES IN THE SCREENS
 *
 * `group` is a stable identifier, not a heading. The Masters page and the
 * Access Control matrix group the same masters under different headings, in
 * different orders, so each screen maps `group` to its own title and ordering.
 * The same goes for icons: both screens draw inline heroicon paths today, and
 * `icon` records the lucide name the shell's icon map (AGENTS.md 23.2) will use
 * when those screens are converted. Nothing consumes `icon` yet.
 */

/** A row seeded into a master's table when a new tenant is provisioned. */
export type MasterSeedRow = {
  name: string
  sort_order: number
  /** `is_fixed` rows are hardcoded by name in six route files — see MASTERS below. */
  is_fixed?: boolean
}

export type MasterDef = {
  /** The `role_permissions.section` value. Immutable — see the header. */
  key: string
  /** Full name, used by the Access Control matrix. */
  label: string
  /** Name used on the Masters card, where the card title supplies the context. */
  shortLabel?: string
  /**
   * `/masters/<slug>`, or null when the API exists but no screen does yet.
   * A null href never becomes a link — it would be a dead end.
   */
  href: string | null
  /** `/api/masters/<slug>`. */
  api: string
  /** Prisma model name, for serialize(). */
  model: string
  /** Stable group id. Each screen maps it to its own heading. */
  group: MasterGroup
  /** Lucide icon name. Declared for the screens; not consumed yet. */
  icon: string
  /** Defaults written for a new tenant. Only four masters have any. */
  seeded?: readonly MasterSeedRow[]
}

export type MasterGroup =
  | 'locations'
  | 'business_partners'
  | 'products'
  | 'organisation'
  | 'lead_config'

/**
 * All seventeen master sections, in the order the old ALL_SECTIONS literals
 * used. The order is load-bearing: it is the order the Access Control matrix
 * and the seeded permission rows come out in.
 *
 * `as const satisfies` rather than a `: readonly MasterDef[]` annotation — an
 * annotation widens `key` to `string` and MasterSection stops being a union.
 */
export const MASTERS = [
  // ── Locations ────────────────────────────────────────────────────────────
  {
    key: 'states', label: 'States',
    href: '/masters/states', api: '/api/masters/states',
    model: 'states', group: 'locations', icon: 'map-pin',
  },
  {
    key: 'districts', label: 'Districts',
    href: '/masters/districts', api: '/api/masters/districts',
    model: 'districts', group: 'locations', icon: 'building-2',
  },
  {
    key: 'talukas', label: 'Talukas',
    href: '/masters/talukas', api: '/api/masters/talukas',
    model: 'talukas', group: 'locations', icon: 'landmark',
  },
  {
    key: 'villages', label: 'Villages',
    href: '/masters/villages', api: '/api/masters/villages',
    model: 'villages', group: 'locations', icon: 'home',
  },
  {
    key: 'territory_mapping', label: 'Territory Mapping',
    href: '/masters/territory-mapping', api: '/api/masters/territory-mapping',
    model: 'user_territory_mappings', group: 'locations', icon: 'globe',
  },

  // ── Business partners ────────────────────────────────────────────────────
  // All three are rows of `business_partners`, separated by its `type` column,
  // and each has its own permission key and its own API. Only `dealers` has a
  // screen; the other two are href: null until P1-T18 builds them.
  {
    key: 'dealers', label: 'Dealers',
    href: '/masters/dealers', api: '/api/masters/dealers',
    model: 'business_partners', group: 'business_partners', icon: 'store',
  },
  {
    key: 'distributors', label: 'Distributors',
    href: null, api: '/api/masters/distributors',
    model: 'business_partners', group: 'business_partners', icon: 'truck',
  },
  {
    key: 'institutions', label: 'Institutions',
    href: null, api: '/api/masters/institutions',
    model: 'business_partners', group: 'business_partners', icon: 'building',
  },

  // ── Products ─────────────────────────────────────────────────────────────
  {
    key: 'product_categories', label: 'Product Categories', shortLabel: 'Categories',
    href: '/masters/product-categories', api: '/api/masters/product-categories',
    model: 'product_categories', group: 'products', icon: 'tag',
  },
  {
    key: 'product_subcategories', label: 'Product Sub-Categories', shortLabel: 'Sub-Categories',
    href: '/masters/product-subcategories', api: '/api/masters/product-subcategories',
    model: 'product_subcategories', group: 'products', icon: 'tags',
  },
  {
    key: 'products', label: 'Products',
    href: '/masters/products', api: '/api/masters/products',
    model: 'products', group: 'products', icon: 'package',
  },

  // ── Organisation ─────────────────────────────────────────────────────────
  {
    key: 'departments', label: 'Departments',
    href: '/masters/departments', api: '/api/masters/departments',
    model: 'departments', group: 'organisation', icon: 'building-2',
  },
  {
    key: 'designations', label: 'Designations',
    href: '/masters/designations', api: '/api/masters/designations',
    model: 'designations', group: 'organisation', icon: 'id-card',
  },
  {
    key: 'expense_categories', label: 'Expense Categories',
    href: '/masters/expense-categories', api: '/api/masters/expense-categories',
    model: 'expense_categories', group: 'organisation', icon: 'receipt',
    seeded: [
      { name: 'Travel',        sort_order: 1 },
      { name: 'Food',          sort_order: 2 },
      { name: 'Accommodation', sort_order: 3 },
      { name: 'Communication', sort_order: 4 },
      { name: 'Miscellaneous', sort_order: 5 },
    ],
  },

  // ── Lead configuration ───────────────────────────────────────────────────
  {
    key: 'lead_types', label: 'Lead Types',
    href: '/masters/lead-types', api: '/api/masters/lead-types',
    model: 'lead_types', group: 'lead_config', icon: 'bookmark',
    seeded: [
      { name: 'Dealer',       sort_order: 1 },
      { name: 'Distributor',  sort_order: 2 },
      { name: 'Institution',  sort_order: 3 },
      { name: 'End Consumer', sort_order: 4 },
    ],
  },
  {
    key: 'lead_stages', label: 'Lead Stages',
    href: '/masters/lead-stages', api: '/api/masters/lead-stages',
    model: 'lead_stages', group: 'lead_config', icon: 'git-branch',
    /**
     * `Prospect` and `Existing` are is_fixed and are matched BY NAME in six
     * route files; `Existing` also sorts last by design (999, not 8). Changing
     * either name, either flag, or that sort order breaks five filtered views.
     */
    seeded: [
      { name: 'Prospect',    sort_order: 1,   is_fixed: true },
      { name: 'Contacted',   sort_order: 2,   is_fixed: false },
      { name: 'Interested',  sort_order: 3,   is_fixed: false },
      { name: 'Qualified',   sort_order: 4,   is_fixed: false },
      { name: 'Proposal',    sort_order: 5,   is_fixed: false },
      { name: 'Negotiation', sort_order: 6,   is_fixed: false },
      { name: 'Existing',    sort_order: 999, is_fixed: true },
    ],
  },
  {
    key: 'lead_temperatures', label: 'Lead Temperatures',
    href: '/masters/lead-temperatures', api: '/api/masters/lead-temperatures',
    model: 'lead_temperatures', group: 'lead_config', icon: 'thermometer',
    seeded: [
      { name: 'Cold', sort_order: 1 },
      { name: 'Warm', sort_order: 2 },
      { name: 'Hot',  sort_order: 3 },
    ],
  },
] as const satisfies readonly MasterDef[]

/**
 * MASTERS is deliberately narrow — every field is a literal type, which is what
 * makes MasterSection a union rather than `string`. The cost is that an entry
 * without `seeded` has no `seeded` property at all, so `m.seeded` does not
 * compile against the union.
 *
 * MASTER_DEFS is the same array widened to MasterDef. Read keys and types from
 * MASTERS; read optional fields from MASTER_DEFS or from the helpers below.
 */
export const MASTER_DEFS: readonly MasterDef[] = MASTERS

export const MASTER_SECTION_KEYS: string[] = MASTERS.map(m => m.key)

/** Only these get a link. See MasterDef.href. */
export const MASTERS_WITH_SCREENS: readonly MasterDef[] =
  MASTER_DEFS.filter(m => m.href !== null)

export function mastersInGroup(group: MasterGroup): readonly MasterDef[] {
  return MASTER_DEFS.filter(m => m.group === group)
}

/** The masters that seed default rows into a new tenant. */
export const SEEDED_MASTERS: readonly MasterDef[] =
  MASTER_DEFS.filter(m => m.seeded !== undefined)

/**
 * Sections that are NOT masters. `data_scope` applies to these — see
 * getDataScope() — which is exactly what makes them not masters.
 */
export const OPERATION_SECTIONS = [
  'meetings', 'expenses', 'weekly_plan', 'orders', 'leads', 'users',
] as const

/**
 * ⚠️ NOT STORABLE. `leaderboard` and `points_config` are absent from the
 * `role_permissions_section_check` constraint and have zero rows in the live
 * database, so an INSERT for either one fails. They are kept out of
 * ALL_SECTIONS for that reason: `POST /api/settings/roles` seeds a row per
 * section and would abort role creation outright.
 *
 * `/api/auth/me` includes them anyway — it builds a display-only map and never
 * writes — so the Access Control matrix can go on rendering their toggles
 * exactly as it did before this registry existed. Those toggles do not save
 * today and did not save before; fixing that needs the constraint widened, and
 * is not this task.
 */
export const POINTS_SECTIONS = ['leaderboard', 'points_config'] as const

/** The 23 sections that can be written to role_permissions. */
export const ALL_SECTIONS = [
  ...MASTER_SECTION_KEYS,
  ...OPERATION_SECTIONS,
]

/** The 25 keys the client's permission map carries. Read-only — see POINTS_SECTIONS. */
export const ALL_PERMISSION_KEYS = [
  ...ALL_SECTIONS,
  ...POINTS_SECTIONS,
]
