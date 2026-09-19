'use client'

/**
 * F25 retired `DataHealthAlert`, the one-line banner this file used to
 * export. The alerts it carried now live behind the header icon in
 * `data-health-popover.tsx` — Aryan did not want them in the page flow at
 * all, and F20's shorter banner was still page furniture. Nothing imports
 * the banner any more, so it is gone rather than left as a second way to
 * say the same thing.
 *
 * What remains is the chip, which is a different job: it is the user's own
 * applied filter, so it appears only while a filter IS applied and it
 * carries that filter's clear affordance.
 */

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
