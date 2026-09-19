'use client'

/**
 * P5-T7 — REBUILD-PLAN.md §7.7: "Alerts on the relevant screen, not
 * reports." One of these is passed into the screen's own `sectionTabs`
 * slot (zone 1a of `templates/list-page.tsx`) — the slot the template
 * already renders AFTER its zone-1 `<h1>` title, so the heading stays the
 * first thing on the page (F19) with the banner directly beneath it.
 * `templates/list-page.tsx` is not touched, and nothing here is a new
 * prop on it.
 *
 * F20: one line, not two stacked two-line banners. The count and the
 * short cause stay in the line itself — §7.7 requires an incomplete
 * record to say WHAT is missing, and a bare count is exactly what that
 * rule forbids — but the fuller explanation that used to be a second
 * wrapped line now sits behind a tooltip/disclosure on the (i), so the
 * banner's height never depends on how long the sentence is.
 *
 * `count` must already be scope-filtered by the caller (every screen this
 * is used on reads from a `getDataScope`-scoped endpoint), so an
 * executive never sees a number that covers records they cannot open.
 *
 * A count of zero renders nothing — a healthy list says nothing about its
 * health, the same rule `list-page` applies to its own empty states.
 */

import type { ReactNode } from 'react'
import { InfoIcon, TriangleAlertIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function DataHealthAlert({
  count,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: {
  count: number
  title: string
  description?: ReactNode
  actionLabel: string
  onAction: () => void
  className?: string
}) {
  if (count <= 0) return null
  return (
    <div
      role="alert"
      className={cn(
        'mb-3 flex shrink-0 animate-in items-center gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-1.5 fade-in slide-in-from-top-1 text-warning duration-200',
        className
      )}
    >
      <TriangleAlertIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-body font-medium">{title}</span>
      {description && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Why: ${title}`}
                className="shrink-0 text-warning/70 hover:text-warning"
              />
            }
          >
            <InfoIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{description}</TooltipContent>
        </Tooltip>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="ml-1 shrink-0"
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    </div>
  )
}

/**
 * A dismissible "you're looking at the filtered view" chip — for the
 * one-click quick filter these banners set. `ListPage`'s own filter panel
 * has no prop to set from outside, so a click here narrows the rows this
 * screen already fetches (a local override, folded into the page's own
 * `load()`) rather than reaching into the template's internal state.
 */
export function QuickFilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="mb-3 flex shrink-0 items-center gap-2 rounded-lg border border-primary-border bg-primary-subtle px-3 py-1.5 text-meta text-text-primary">
      <span>{label}</span>
      <button
        type="button"
        onClick={onClear}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        Clear
      </button>
    </div>
  )
}
