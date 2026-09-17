'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'
import { useSidebar } from './use-sidebar'

/**
 * Section 12. The frame every page sits inside, which never changes
 * between pages.
 *
 * The two forms of the sidebar are section 9 rule 7, and they are two
 * DIFFERENT renders driven by one toggle rather than one render that
 * changes width:
 *
 *   1024 and above   an <aside> in the flex row. Toggling it changes its
 *                    width between 260 and 64, and the content column
 *                    beside it is pushed.
 *   below 1024       a `sheet` - the kit's edge panel, which section 4.1
 *                    names for exactly this job. It is portalled out of
 *                    the row, so it slides OVER the content and the
 *                    content does not move at all.
 *
 * Both are always mounted and Tailwind's `lg:` boundary (1024px) decides
 * which is on screen, so the handover is a CSS fact rather than a render
 * that has to catch a resize.
 */

export function AppShell({ children }: { children: ReactNode }) {
  const sidebar = useSidebar()

  return (
    <div className="flex h-dvh overflow-hidden bg-surface-sunken">
      {/*
        The pushing form. `transition-[width]` rather than a snap:
        260 to 64 is a layout change the eye needs to follow, and the
        content beside it moves with it.
      */}
      <aside
        className={cn(
          'hidden min-w-0 shrink-0 overflow-hidden border-r border-border-light bg-surface transition-[width] duration-200 ease-out lg:block',
          sidebar.expanded ? 'w-sidebar' : 'w-sidebar-rail'
        )}
      >
        <Sidebar expanded={sidebar.expanded} />
      </aside>

      {/*
        The overlaying form. Always expanded: a 64px rail inside an
        overlay would be an overlay carrying less than the thing it
        covers. `onNavigate` closes it, because on a tablet the panel is
        on top of the page the user just asked for.
      */}
      <Sheet
        open={sidebar.mode === 'overlay' && sidebar.overlayOpen}
        onOpenChange={next => {
          if (!next) sidebar.close()
        }}
      >
        <SheetContent
          side="left"
          className="w-sidebar max-w-full gap-0 p-0 data-[side=left]:w-sidebar sm:max-w-sidebar"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar expanded onNavigate={sidebar.close} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onToggleSidebar={sidebar.toggle}
          toggleLabel={sidebar.toggleLabel}
        />

        {/*
          Section 12.3: 24px padding on all sides, capped at 1600px and
          centred. The content area is the only thing that scrolls - the
          top bar and the sidebar are fixed chrome, so the primary action
          in a page header stays reachable without scrolling back up.

          `min-w-0` above is section 9 rule 3: without it a long unbroken
          value in a table pushes this column wider than the window and
          takes the whole layout with it.
        */}
        <main className="flex-1 overflow-hidden">
          {/*
            Section 12.3: 24px on all sides, capped at 1600px, centred.

            THE WRAPPER IS THE SCROLL CONTAINER, and that is what lets one
            box serve two page types that want opposite things from it
            (section 10). A LIST page must not scroll - its data area owns
            the scroll - so it needs a definite height to divide between
            its zones. A DETAIL page must scroll, so it has to grow.

            `h-full` of a `main` that is itself flex-1 of the h-dvh root
            makes it definite, so templates/list-page resolves `h-full`
            against it and its zone 3 gets a real height. `overflow-y-auto`
            on the SAME element is what a taller page scrolls - and since
            the padding is on the scroller, the 24px at the bottom is part
            of the scrollable area rather than stranded at the fold.

            A list page never overflows this box, so the two scrollers
            never coexist and section 1 rule 8 is not in play: list-page is
            exactly 100% tall and only its zone 3 has anything to scroll.

            Every part of that was measured, and two earlier shapes each
            failed one half. `min-h-full` on the wrapper is a minimum and
            not a height, so a percentage inside it fell back to content
            size, the list page grew and the scroll landed on the page.
            `h-full` with the scroll left on `main` is a height but not a
            minimum, so a detail page overflowed it and lost its bottom
            padding at the end of the scroll - measured at a 0px gap
            below the last card instead of 24.
          */}
          <div className="mx-auto h-full max-w-content-max overflow-y-auto p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
