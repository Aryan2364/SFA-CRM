'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { Boxes } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { invalidateMeCache, useMe } from '@/hooks/useMe'

import { activeHref, visibleNavItems, type NavItem } from './nav'

/**
 * Section 12.1. 260px open, a 64px icon rail collapsed.
 *
 * `expanded` comes from the shell rather than from here, because the
 * same component renders in both of section 9 rule 7's forms: as a
 * column that pushes the content at 1024 and above, and inside a sheet
 * over the content below it. In the sheet it is always expanded - a rail
 * inside an overlay would be an overlay carrying less than the thing it
 * covers.
 *
 * The shell is a LIGHT surface. The active item reads as active because
 * primary-subtle is a pale tint on white; on a dark panel it would be
 * the least visible item in the list.
 */

type SidebarProps = {
  expanded: boolean
  /** Closes the overlay after a navigation. Unused in `push` mode. */
  onNavigate?: () => void
}

export function Sidebar({ expanded, onNavigate }: SidebarProps) {
  const pathname = usePathname()
  const me = useMe()

  /*
   * Carried over from the sidebar this replaces: drop the cached
   * permissions on every navigation so a role change takes effect on the
   * next mount rather than at the next full page load. A user whose
   * access was just revoked should not keep a door open in the rail.
   */
  useEffect(() => {
    invalidateMeCache()
  }, [pathname])

  const items = visibleNavItems(me)
  const active = activeHref(pathname, items)

  return (
    <div className="flex h-full flex-col bg-surface">
      <div
        className={cn(
          'flex h-topbar shrink-0 items-center gap-2 border-b border-border-light px-3',
          !expanded && 'justify-center px-0'
        )}
      >
        <span
          aria-hidden
          className="flex size-control shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
        >
          <Boxes className="size-icon-nav" />
        </span>
        {expanded && (
          <span className="min-w-0">
            <span className="block truncate text-body font-medium text-text-primary">
              RGB SFA
            </span>
            <span className="block truncate text-meta text-text-muted">
              {me?.tenantName ?? ''}
            </span>
          </span>
        )}
      </div>

      <nav
        aria-label="Main"
        className={cn('flex-1 overflow-y-auto py-3', expanded ? 'px-3' : 'px-2')}
      >
        <ul className="space-y-1">
          {items.map(item => (
            <li key={item.href}>
              <NavLink
                item={item}
                active={item.href === active}
                expanded={expanded}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

type NavLinkProps = {
  item: NavItem
  active: boolean
  expanded: boolean
  onNavigate?: () => void
}

function NavLink({ item, active, expanded, onNavigate }: NavLinkProps) {
  const Icon = item.icon

  /*
   * Section 12.1's active item carries THREE signals together:
   * primary-subtle behind it, body strong weight, and a 3px accent bar
   * in primary down its left edge. Any two of the three read as an
   * accident.
   *
   * Section 6.4's four states apply to the active item as much as to a
   * resting one - it is still a link, and a control that does nothing
   * under the pointer reads as disabled. That is what the two derived
   * subtle tints in globals.css are for.
   */
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group/nav relative flex h-control items-center gap-1 overflow-hidden rounded-lg text-body transition-colors',
        'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring',
        expanded ? 'px-3' : 'justify-center px-0',
        active
          ? 'bg-primary-subtle font-medium text-text-primary hover:bg-primary-subtle-hover active:bg-primary-subtle-pressed'
          : 'text-text-secondary hover:bg-surface-control hover:text-text-primary active:bg-surface-control-pressed'
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-nav-accent bg-primary"
        />
      )}
      <Icon className="size-icon-nav shrink-0" />
      <span className={cn('truncate', !expanded && 'sr-only')}>
        {item.label}
      </span>
    </Link>
  )

  /*
   * Section 12.1: "When collapsed, each icon shows a tooltip with its
   * label on hover." Expanded, the label is already on screen, and
   * section 19 forbids a tooltip that repeats what is visible.
   *
   * The label stays in the DOM in both states - the rail hides it from
   * the eye with sr-only, not from a screen reader, because section 19's
   * argument is that a fact living only in a hover never reaches a
   * keyboard or touch user.
   */
  if (expanded) return link

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}
