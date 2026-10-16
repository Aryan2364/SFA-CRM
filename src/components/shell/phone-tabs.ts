import { CalendarDays, Handshake, MoreHorizontal, ShoppingCart, UserRoundSearch, type LucideIcon } from 'lucide-react'

import type { Me } from '@/hooks/useMe'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.4 rules 11-19: the ONE
 * config array the phone tab bar is built from, so the set of tabs can be
 * changed later in one place (the build brief's own requirement).
 *
 * Gated with the SAME permission data the desktop sidebar's nav.ts uses
 * (me.permissions[section].view / me.role === 'Administrator'); never a
 * hardcoded role name beyond the Administrator short-circuit nav.ts itself
 * already relies on. A tab the user cannot view is not rendered; it is
 * never shown disabled (§41.4 rule 17 — a whole destination, not a single
 * action).
 */

export type PhoneTab = {
  label: string
  href: string
  icon: LucideIcon
  /** Whether `me` may see this tab. Mirrors src/components/shell/nav.ts's predicates. */
  visible: (me: Me) => boolean
}

function canView(me: Me, section: string): boolean {
  return me.role === 'Administrator' || (me.permissions?.[section]?.view ?? false)
}

export const PHONE_TABS: PhoneTab[] = [
  {
    label: 'Today',
    href: '/today',
    icon: CalendarDays,
    visible: () => true,
  },
  {
    label: 'Accounts',
    href: '/parties',
    icon: UserRoundSearch,
    visible: me => canView(me, 'companies') || canView(me, 'contacts'),
  },
  {
    label: 'Opportunities',
    href: '/deals',
    icon: Handshake,
    visible: me => canView(me, 'deals'),
  },
  {
    label: 'Orders',
    href: '/orders',
    icon: ShoppingCart,
    visible: me => canView(me, 'orders'),
  },
  {
    label: 'More',
    href: '/more',
    icon: MoreHorizontal,
    visible: () => true,
  },
]

/**
 * §41.4 rule 17: the one place that filters the tab list by permission.
 * Both the tab bar and /more must call this rather than filtering on
 * their own, so the two can never disagree about a destination.
 */
export function visiblePhoneTabs(me: Me | null): PhoneTab[] {
  if (!me) return []
  return PHONE_TABS.filter(tab => tab.visible(me))
}
