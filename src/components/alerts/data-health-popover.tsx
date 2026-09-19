'use client'

/**
 * F25 — the data-health alerts stop being page furniture.
 *
 * F20 shrank the banners; that missed the point. Aryan does not want them
 * in the page flow at all: "I don't [want] it to be sticking on main page
 * which should hold actual table top of it." So the alerts move behind a
 * single trigger that lives with the screen's other header controls (zone
 * 1 right of `templates/list-page.tsx`, its existing `action` slot — no
 * new prop on the template), and open into a popover.
 *
 * Nothing the alerts earned is given up; only the placement changes:
 *
 *  - The counts stay, and so does WHAT is missing. §7.7 requires an
 *    incomplete record to name the absent fields, and a bare count is
 *    exactly what that rule exists to prevent. A popover has room the
 *    one-line banner did not, so the detail is now plain text in the row
 *    rather than hidden behind a tooltip on an (i).
 *  - Counts are still scope-correct: every caller reads them from a
 *    `getDataScope`-scoped endpoint, so an executive never sees a number
 *    covering records they cannot open. This component does no fetching
 *    and no arithmetic of its own.
 *  - Clicking an alert still narrows the list, and the screen's own
 *    clear affordance still clears it.
 *
 * Two rules decide whether this is any good, and both are enforced here:
 *
 *  1. The trigger must say something needs attention BEFORE it is opened,
 *     or it is a feature nobody finds — hence the count badge. And zero
 *     alerts render NOTHING: not a quiet icon, not a confident "0". A
 *     healthy list says nothing about its health, the same rule
 *     `list-page` applies to its own empty states.
 *  2. The popover is not a dead end. Every row carries an action that
 *     leads somewhere — to the filtered list, or (when the caller gives
 *     one) to the record itself.
 */

import type { ReactNode } from 'react'
import { useState } from 'react'
import { TriangleAlertIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type DataHealthAlertItem = {
  /** Stable key. Also what the screen uses to name its own filter state. */
  id: string
  /** Scope-filtered by the CALLER. Zero means the alert does not exist. */
  count: number
  /** "7 leads are incomplete" — the count and the noun, never a bare number. */
  title: string
  /** §7.7: WHICH fields / WHY it is stuck. Required, not decorative. */
  detail: ReactNode
  /** The way out of this row. */
  actionLabel: string
  onAction: () => void
  /** True while this alert's narrowing is the one currently applied. */
  active?: boolean
}

/**
 * `alerts` may contain entries the user has no permission to act on —
 * callers are expected to omit those entirely rather than pass a disabled
 * row, since a control that only ever 403s should not be on screen at
 * all. Entries with `count <= 0` are dropped here so every caller does
 * not repeat the check.
 */
export function DataHealthAlerts({
  alerts,
  label = 'Data health',
  className,
}: {
  alerts: DataHealthAlertItem[]
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const live = alerts.filter(a => a.count > 0)

  // Rule 1: nothing to say, nothing on screen.
  if (live.length === 0) return null

  const badge = live.length
  const summary = `${label}: ${live.length} ${live.length === 1 ? 'alert' : 'alerts'}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={summary}
            title={summary}
            className={cn(
              /* 44px touch target (§9) at every width; sits in the header
                 control row beside the screen's primary action. */
              'relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg',
              'border border-warning-border bg-warning-bg text-warning',
              'transition-colors duration-200 hover:bg-warning-bg/70',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning',
              'data-popup-open:bg-warning-bg/70',
              className
            )}
          />
        }
      >
        <TriangleAlertIcon className="size-5" />
        {/* Rule 1: the count rides the icon, so the fact that something
            needs attention survives the popover being closed. */}
        <span
          aria-hidden
          className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full border border-surface bg-warning px-1 text-[11px] font-semibold leading-5 text-white"
        >
          {badge}
        </span>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        /* §7: portalled to <body> by `PopoverContent` itself, so no
           ancestor transform or overflow clips it, and z-50 puts it over
           the top bar. Width fits a 390px phone with the page gutter
           still showing. */
        className={cn(
          'w-[min(24rem,calc(100vw-2rem))] gap-0 p-0',
          'duration-200 data-open:zoom-in-95 data-open:slide-in-from-top-1',
          'data-closed:zoom-out-95 data-closed:slide-out-to-top-1'
        )}
      >
        <PopoverHeader className="border-b border-border-light px-4 py-3">
          <PopoverTitle>Needs attention</PopoverTitle>
        </PopoverHeader>

        <ul className="flex flex-col divide-y divide-border-light">
          {live.map(alert => (
            <li key={alert.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-col gap-0.5">
                <p className="text-body font-medium text-text-primary">{alert.title}</p>
                <p className="text-label text-text-secondary">{alert.detail}</p>
              </div>
              {/* Rule 2: no dead end. Even the already-applied row leads
                  back to the list rather than sitting inert — closing the
                  popover IS the way through to the rows it describes. */}
              <Button
                variant={alert.active ? 'ghost' : 'secondary'}
                size="sm"
                /* §9: a 44px touch target on a phone. `min-h` rather than
                   `h`, because the kit's own `h-control-sm` and a `h-*`
                   utility do not reliably merge in either direction. */
                className="min-h-11 self-start sm:min-h-8"
                onClick={() => {
                  if (!alert.active) alert.onAction()
                  setOpen(false)
                }}
              >
                {alert.active ? 'Showing these now' : alert.actionLabel}
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
