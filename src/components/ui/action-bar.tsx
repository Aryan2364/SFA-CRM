'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'
import { useLayout } from '@/lib/layout'
import { useKeyboardInsetHeight } from '@/lib/use-keyboard-inset'

/**
 * Phone foundation — FRONTEND_RULES_PHONE.md §41.6 rules 7-9, §41.7 rules
 * 3-4: a record's main actions, or a form's Save, fixed at the bottom of
 * the screen on phone.
 *
 *   - At most two buttons, sharing the width equally, written secondary
 *     first then primary (rule 8). More than two throws.
 *   - No buttons, no bar (rule 9).
 *   - Desktop: renders nothing — a desktop record's actions live in its
 *     header, a desktop form's in its footer bar (not this component's
 *     job to draw).
 *
 * Keyboard-aware: while the on-screen keyboard is open the bar sits just
 * above it (useKeyboardInsetHeight, §41.7 rule 4) rather than under it.
 *
 * Simplified port: no PermissionTooltip-wrapped disabled action — wrap an
 * individual disabled button yourself with <PermissionTooltip> before
 * passing it in.
 */
const MAX_ACTION_BAR_BUTTONS = 2

export function ActionBar({
  children,
  label = 'Actions',
  className,
}: {
  children?: React.ReactNode
  label?: string
  className?: string
}) {
  const { layout } = useLayout()
  const keyboardInset = useKeyboardInsetHeight()
  const items = React.Children.toArray(children).filter(Boolean)

  if (items.length > MAX_ACTION_BAR_BUTTONS) {
    throw new Error(
      `ActionBar was given ${items.length} buttons. FRONTEND_RULES_PHONE.md §41.6 rule 8 allows at most two; put the rest in the app bar's three-dot menu.`
    )
  }
  if (layout !== 'phone' || items.length === 0) return null

  return (
    <div
      role="group"
      aria-label={label}
      data-slot="action-bar"
      className={cn(
        'fixed inset-x-0 bottom-0 z-[--z-shell] flex gap-3 border-t border-border-light bg-surface px-4 py-3 transition-[bottom] duration-150',
        className
      )}
      style={{
        bottom: keyboardInset,
        paddingBottom: keyboardInset > 0 ? '12px' : 'calc(var(--safe-bottom) + 12px)',
        paddingLeft: 'calc(var(--safe-left) + 16px)',
        paddingRight: 'calc(var(--safe-right) + 16px)',
      }}
    >
      {items.map((child, index) => (
        <div key={index} className="flex-1">
          {child}
        </div>
      ))}
    </div>
  )
}

export { MAX_ACTION_BAR_BUTTONS }
