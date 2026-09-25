import { Skeleton } from '@/components/ui/skeleton'

/**
 * Section 14 — the shape of the weekly plan while it is still arriving.
 *
 * A skeleton, never a spinner and never the word "Loading": the board's
 * chrome, week changer and seven columns land first, so nothing moves when
 * the data replaces them. The columns reuse `w-board-column`, the same token
 * the real board's columns use, so the two are the same width to the pixel.
 *
 * Below 768px the board is not offered at all (section 35.3), so the skeleton
 * mirrors that too: a stack of day cards instead of columns.
 */

function ColumnSkeleton({ cards }: { cards: number }) {
  return (
    <div className="flex h-full min-h-0 w-board-column shrink-0 flex-col rounded-xl border border-border-light bg-surface-sunken">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-light px-3 py-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-6" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  )
}

/** The seven columns on their own — for the in-page week switch. */
export function PlanBoardSkeleton() {
  // Uneven counts so it reads as content, not as a grid of identical blocks.
  const cardsPerDay = [3, 2, 3, 1, 2, 1, 0]

  return (
    <>
      <div
        className="hidden min-h-0 flex-1 items-stretch gap-4 overflow-hidden md:flex"
        aria-hidden="true"
      >
        {cardsPerDay.map((cards, i) => (
          <ColumnSkeleton key={i} cards={cards} />
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:hidden" aria-hidden="true">
        {[3, 2, 3].map((cards, i) => (
          <div key={i} className="rounded-xl border border-border-light bg-surface-sunken p-3">
            <Skeleton className="mb-3 h-4 w-28" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: cards }, (_, j) => (
                <Skeleton key={j} className="h-14 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only" role="status">Loading the weekly plan</span>
    </>
  )
}

/** The whole screen: pinned chrome, week changer, then the columns. */
export function WeeklyPlanSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-6 w-24" />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Skeleton className="size-control" />
          <Skeleton className="h-5 w-56" />
          <Skeleton className="size-control" />
        </div>
      </div>
      <PlanBoardSkeleton />
    </div>
  )
}
