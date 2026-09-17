import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Section 11.1. The list page's four fixed zones, in this order,
 * always:
 *
 *   1  Header      title left, one primary action right, record count
 *                  as meta text under the title. Does not scroll.
 *   1a Section tabs optional (section 33). The ONLY thing permitted
 *                  between the header and the toolbar.
 *   2  Toolbar     search left at a fixed 260-320px, filter and sort
 *                  beside it, view switcher far right. Does not scroll.
 *   3  Data area   THE ONLY SCROLLING ZONE. Fixed height from the
 *                  window. Column headers stay visible as rows scroll.
 *   4  Pagination  count left, page controls right. Does not scroll.
 *
 * ---------------------------------------------------------------------
 * ZONE 3'S HEIGHT IS THE WHOLE TEMPLATE
 *
 * Section 10: on a list page the data area owns the scroll and the page
 * itself does not scroll. If the page body scrolls, this template has
 * failed however good the rest of it looks.
 *
 * The height is derived, not measured and not guessed at. `app-shell`
 * roots the application at `h-dvh`, and its content wrapper carries a
 * DEFINITE height — 100% of a box that is itself flex-1 of that root.
 * This template is `h-full` inside that wrapper, and zone 3 is
 * `flex-1 min-h-0` inside this template. So zone 3's height IS the
 * window height minus the top bar, minus the page padding, minus zones
 * 1, 2 and 4 — arithmetic the browser redoes on every resize, with no
 * constant to go stale and no resize listener to miss a frame.
 *
 * `min-h-full` on the wrapper is NOT enough and was tried first: a
 * minimum is not a height, so a percentage flex-basis inside it falls
 * back to content size, the wrapper grows to the table, and the scroll
 * lands on the page. That failure looks exactly like this template
 * working until you notice the page scrollbar.
 *
 * `min-h-0` at every step is load-bearing. A flex item defaults to
 * `min-height: auto`, which is its content height, so without it a long
 * table refuses to shrink and pushes the page taller than the window —
 * the scroll then lands on the page instead of on zone 3, which is
 * exactly the failure above.
 *
 * Zone 3 scrolls both axes on ONE element. That is not the nesting
 * section 1 rule 8 forbids: the card around it is `overflow-hidden` and
 * the page does not scroll at all, so no two scrollers ever compete for
 * the same gesture.
 *
 * ---------------------------------------------------------------------
 * WHAT THIS TEMPLATE DOES NOT KNOW
 *
 * It composes zones. It does not fetch, filter, paginate, or know what
 * a record is. Every zone is a slot; the screen decides what goes in
 * one and this file decides where it sits and how it behaves. If
 * anything screen-specific ever needs importing here, the boundary has
 * moved to the wrong place.
 *
 * That includes zone 3's state. Section 13's three empty states and
 * section 14's loading state are three or four branches the SCREEN
 * chooses between — section 14 rule 3 is explicit that a failure
 * sharing a branch with loading is not a state. The template renders
 * whichever it is handed. An `EmptyState` passed here should carry
 * `h-full` so it centres in the zone rather than sitting at the top of
 * an empty box.
 */

export type ListPageProps = {
  /** Zone 1. The one page title on the screen (section 3 rule 3). */
  title: string
  /**
   * Zone 1, under the title, in meta style. The record count, and
   * section 27.1's result count when a search is active. Rendered as
   * meta by this file, so a screen never picks the colour or the size.
   */
  meta?: ReactNode
  /**
   * Zone 1, right. EXACTLY ONE primary action (section 6.1 rule 1).
   * Everything else the screen can do belongs in zone 2 or in the row.
   */
  action?: ReactNode
  /**
   * Zone 1a. Section 33's tab bar, the only thing permitted between the
   * header and the toolbar. Section 33 is not built in this product
   * yet; the slot exists so the first screen that needs one puts it in
   * the one place section 33.2 allows rather than inventing a position.
   */
  sectionTabs?: ReactNode
  /**
   * Zone 2, left. Section 27.1's search field. This file fixes the
   * width at `--spacing-search` (280px, inside section 11.1's 260-320
   * band) so no screen decides it and none goes full width.
   */
  search?: ReactNode
  /** Zone 2, beside search. Filter and sort, as secondary controls. */
  filters?: ReactNode
  /**
   * Zone 2, far right. The list/card joined pair, active side tinted
   * `primary-subtle`. Orders has no card view, so nothing has been
   * built against this slot yet.
   */
  viewSwitcher?: ReactNode
  /** Zone 3. The only thing on the page that scrolls. */
  children: ReactNode
  /** Zone 4. `PaginationBar` from components/ui already is this zone. */
  pagination?: ReactNode
  className?: string
}

export function ListPage({
  title,
  meta,
  action,
  sectionTabs,
  search,
  filters,
  viewSwitcher,
  children,
  pagination,
  className,
}: ListPageProps) {
  const hasToolbar = Boolean(search || filters || viewSwitcher)

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {/* ── ZONE 1 ── header. Does not scroll. */}
      <header className="flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-page-title font-medium text-text-primary">
            {title}
          </h1>
          {meta !== undefined && meta !== null && (
            <p className="mt-1 text-meta text-text-muted">{meta}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>

      {/* ── ZONE 1a ── section tabs (section 33). Optional, does not scroll. */}
      {sectionTabs && <div className="mt-4 shrink-0">{sectionTabs}</div>}

      {/* ── ZONE 2 ── toolbar. Does not scroll.
          `flex-wrap` rather than a breakpoint: the controls a screen puts
          here vary, so the row folds when it runs out of width instead of
          at a width guessed in advance (section 9 rule 2). */}
      {hasToolbar && (
        <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2">
          {search && (
            /* Fixed 280px, and `max-w-full` so it still shrinks on a
               narrow screen rather than pushing the row wider than the
               page (section 9 rule 3). */
            <div className="w-search max-w-full shrink-0">{search}</div>
          )}
          {filters}
          {viewSwitcher && <div className="ml-auto shrink-0">{viewSwitcher}</div>}
        </div>
      )}

      {/* ── ZONES 3 and 4 ── one panel.
          `overflow-hidden` here is what clips the scrolling child to the
          panel's radius AND what stops this element from becoming a
          second vertical scroller around zone 3. */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-light bg-surface">
        {/* ZONE 3. The only scrolling zone on the page. */}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {/* ZONE 4. `PaginationBar` carries its own shrink-0 and top border. */}
        {pagination}
      </div>
    </div>
  )
}
