import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Database,
  Handshake,
  LayoutDashboard,
  MessageSquare,
  Settings,
  ShoppingCart,
  UserRoundCheck,
  UserRoundSearch,
  type LucideIcon,
} from 'lucide-react'

import { MASTER_SECTION_KEYS } from '@/lib/masters-registry'
import type { Me } from '@/hooks/useMe'

/**
 * The sidebar's destinations. One list, filtered by permission at
 * render - never a second, reduced navigation for a lesser role
 * (section 26, and section 4 rule 2).
 *
 * ---------------------------------------------------------------------
 * SECTION 23.2 ICON MAP - this product's rows
 *
 * Section 23.2: "A product adds one row per top-level navigation section
 * and one for its own product mark, in the same commit that adds the
 * navigation item." AGENTS.md belongs to the kit, so this product's rows
 * are recorded here, beside the items they name. Lucide only, and the
 * meaning is fixed everywhere it appears.
 *
 *   | Meaning        | Icon                |
 *   |----------------|---------------------|
 *   | Product mark   | boxes               |  (in sidebar.tsx)
 *   | Dashboard      | layout-dashboard    |  from 23.2's own table
 *   | Daily Activity | calendar-days       |
 *   | Weekly Plan    | clipboard-list      |
 *   | Orders         | shopping-cart       |
 *   | Parties        | user-round-search   |
 *   | Deals          | handshake           |
 *   | Review         | user-round-check    |
 *   | Conversations  | message-square      |
 *   | Reports        | bar-chart-3         |
 *   | Masters        | database            |
 *   | Settings       | settings            |  from 23.2's own table
 *
 * Weekly Plan and Review are deliberately not both clipboards. At 18px
 * in a 64px rail with no labels, two clipboards are one icon, and the
 * rail is the state where the icon is all there is.
 *
 * ---------------------------------------------------------------------
 * THE SEVEN-ITEM CEILING
 *
 * Section 12.1 caps the top level at seven, and the cap is about what
 * ONE USER SEES rather than about the union across every role. Section
 * 26 is what brings it under seven: whole areas a user has no access to
 * are hidden, not disabled.
 *
 * Eleven entries are declared. A field rep sees eight; a manager sees
 * nine; an administrator sees all eleven, which is the one role the cap
 * does not hold for and the one role that is not scanning for a
 * destination it has never used.
 *
 * Reports is the eleventh (P5-T2) and it is the one that pushes a field
 * rep to eight. It is not droppable: §7.1 makes the builder the ONLY
 * report surface in the product, so there is no second route to it.
 *
 * Deals is the tenth (P2-T7). It is NOT a tab on Parties: section 33.1's
 * test is whether the views are siblings of ONE section, and a Deal is a
 * different record with its own permission section, its own masters and
 * its own scope — a Party is who you sell to, a Deal is what you are
 * selling them.
 *
 * Three destinations are deliberately NOT here, and none is lost:
 *
 *   - Users, /masters/users, is a child route of Masters and is reached
 *     from the Masters page.
 *   - Access Control and Points Config are children of Settings and are
 *     reached from the Settings page.
 *   - My Points, /points, is in the USER MENU in the top bar. It is a
 *     page about the current user rather than a section of the product.
 *
 * ---------------------------------------------------------------------
 * GATING
 *
 * Every predicate reads me.permissions, which /api/auth/me builds from
 * the role_permissions table - the same table checkPermission() on the
 * server reads. No entry gates on a role NAME, with the one stated
 * exception below, because an administrator arrives here with every
 * section already true.
 */

export type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  /** Section 26. False hides the entry; there is no disabled state. */
  visible: (me: Me) => boolean
}

function canView(me: Me, section: string): boolean {
  return me.permissions?.[section]?.view ?? false
}

/*
 * Masters is one entry over every master section. It appears when the
 * user can view any of them, which is the same test the Masters page
 * itself applies before deciding it has nothing to show.
 *
 * The list is MASTER_SECTION_KEYS from src/lib/masters-registry.ts. It
 * used to be a literal here and a second, divergent literal in
 * Sidebar.tsx, and the two had already disagreed about dealers,
 * distributors and institutions.
 */

/*
 * THE ONE ROLE CHECK, and why it is not the thing CLAUDE.md forbids.
 *
 * Access Control has no row in role_permissions - there is no section
 * key for it. Its API routes authorise with user.role !== 'Administrator'
 * and return 403 to everyone else. Section 26 says never show a control
 * that fails after being clicked, so the interface has to mirror what the
 * server actually enforces, and for this one area that is the role.
 *
 * Mirroring the server is the opposite of inventing a role gate in place
 * of the permission table. If Access Control ever gains a section key,
 * this function is the single place that changes.
 */
export function canReachAccessControl(me: Me): boolean {
  return me.role === 'Administrator'
}

/**
 * Every permission section a report can be built from — the `section` of each
 * entry in `src/lib/reports/sources.ts`. Kept here as a literal rather than
 * imported, because that module reaches `@/lib/db` and this one is pulled into
 * a client component.
 */
const REPORT_SECTIONS = [
  'orders',
  'meetings',
  'expenses',
  'deals',
  'companies',
  'contacts',
  'weekly_plan',
] as const

export const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
    visible: () => true,
  },
  {
    label: 'Daily Activity',
    href: '/daily-activity',
    icon: CalendarDays,
    visible: me => canView(me, 'meetings'),
  },
  {
    label: 'Weekly Plan',
    href: '/weekly-plan',
    icon: ClipboardList,
    visible: me => canView(me, 'weekly_plan'),
  },
  {
    label: 'Orders',
    href: '/orders',
    icon: ShoppingCart,
    visible: me => canView(me, 'orders'),
  },
  {
    /*
     * ONE destination for both halves of the Party surface (P1-T13,
     * REBUILD-PLAN.md section 3.2): Companies and Contacts are tabs on
     * `/parties`, not two sidebar entries. Section 12.1's seven-item
     * ceiling is the reason the second one is not here, and section
     * 33.1's test is the reason a tab is the right home for it — these
     * are sibling views of ONE section.
     *
     * Visible on EITHER permission. The page hides the tab the user
     * cannot view, so someone granted contacts and not companies still
     * has a way in; testing only `companies` would strand them.
     */
    label: 'Parties',
    href: '/parties',
    icon: UserRoundSearch,
    visible: me => canView(me, 'companies') || canView(me, 'contacts'),
  },
  {
    /*
     * REBUILD-PLAN.md §4. Gated on the `deals` section of
     * role_permissions — the same table `checkPermission(user,'deals',…)`
     * reads on the server, so the entry appears exactly when
     * `GET /api/deals` would answer rather than 403.
     */
    label: 'Deals',
    href: '/deals',
    icon: Handshake,
    visible: me => canView(me, 'deals'),
  },
  {
    /*
     * Manager and above, expressed as the data rather than as a role
     * name: the page reviews the people this user can see, so a user
     * with nobody under them has nothing to review and would reach an
     * empty page rather than a forbidden one.
     */
    label: 'Review',
    href: '/review',
    icon: UserRoundCheck,
    visible: me => me.hasSubordinates,
  },
  {
    label: 'Conversations',
    href: '/conversations',
    icon: MessageSquare,
    visible: () => true,
  },
  {
    /*
     * REBUILD-PLAN.md §7.1 and §10: Reports is a TOP-LEVEL destination,
     * not a tab on Dashboard. §33.1's test is whether the views are
     * siblings of one section — the Dashboard answers "how am I doing
     * today", the report builder answers an arbitrary question about
     * any section, and they share no records.
     *
     * Gated on the data rather than on a role, because there is no
     * `reports` row in role_permissions: the builder is assembled from
     * the sections the user can view, and `/api/reports/meta` returns an
     * empty measure list to someone who can view none of them. The
     * predicate below is the client-side statement of that same fact, so
     * the entry appears exactly when the page would have something in
     * it. The list is the sections `src/lib/reports/sources.ts` declares.
     */
    label: 'Reports',
    href: '/reports',
    icon: BarChart3,
    visible: me => REPORT_SECTIONS.some(section => canView(me, section)),
  },
  {
    label: 'Masters',
    href: '/masters',
    icon: Database,
    visible: me => MASTER_SECTION_KEYS.some(section => canView(me, section)),
  },
  {
    /*
     * Settings holds Access Control and Points Config, so it appears
     * when either child is reachable. Showing it to a user who could
     * open neither would be an empty page reached in one click.
     */
    label: 'Settings',
    href: '/settings',
    icon: Settings,
    visible: me => canView(me, 'points_config') || canReachAccessControl(me),
  },
]

export function visibleNavItems(me: Me | null): NavItem[] {
  if (!me) return []
  return NAV_ITEMS.filter(item => item.visible(me))
}

/**
 * Which entry is highlighted for a given path.
 *
 * Section 12.1: "The sidebar never changes when the user drills into a
 * record. The top-level section stays highlighted and the breadcrumb
 * inside the page shows the depth."
 *
 * So a prefix match, and the LONGEST matching entry wins. That second
 * part is load-bearing where one destination sits inside another:
 * /masters/states highlights Masters, /review/<id> highlights Review,
 * and /settings/points highlights Settings.
 *
 * The root is matched exactly, because every path starts with it.
 */
export function activeHref(pathname: string, items: NavItem[]): string | null {
  let match: string | null = null
  for (const item of items) {
    const hit =
      item.href === '/'
        ? pathname === '/'
        : pathname === item.href || pathname.startsWith(`${item.href}/`)
    if (hit && (match === null || item.href.length > match.length)) {
      match = item.href
    }
  }
  return match
}
