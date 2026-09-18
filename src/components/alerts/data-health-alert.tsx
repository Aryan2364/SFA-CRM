'use client'

/**
 * P5-T7 — REBUILD-PLAN.md §7.7: "Alerts on the relevant screen, not
 * reports." One of these sits above a list's own `ListPage`, inside the
 * same `flex h-full min-h-0 flex-col` wrapper the Deals pipeline strip
 * already uses (P2-T7's `className="h-auto min-h-0 flex-1"` pattern) —
 * `templates/list-page.tsx` is not touched, and nothing here is a prop on
 * it.
 *
 * `count` must already be scope-filtered by the caller (every screen this
 * is used on reads from a `getDataScope`-scoped endpoint), so an
 * executive never sees a number that covers records they cannot open.
 *
 * A count of zero renders nothing — a healthy list says nothing about its
 * health, the same rule `list-page` applies to its own empty states.
 */

import type { ReactNode } from 'react'
import { TriangleAlertIcon } from 'lucide-react'

import { Banner, BannerAction, BannerDescription, BannerTitle } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'

export function DataHealthAlert({
  count,
  title,
  description,
  actionLabel,
  onAction,
}: {
  count: number
  title: string
  description?: ReactNode
  actionLabel: string
  onAction: () => void
}) {
  if (count <= 0) return null
  return (
    <Banner
      variant="warning"
      className="mb-3 shrink-0 animate-in fade-in slide-in-from-top-1 duration-200"
    >
      <TriangleAlertIcon />
      <BannerTitle>{title}</BannerTitle>
      {description && <BannerDescription>{description}</BannerDescription>}
      <BannerAction>
        <Button variant="secondary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      </BannerAction>
    </Banner>
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
