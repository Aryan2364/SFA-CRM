"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * Section 33. A list page's optional fifth zone.
 *
 * **Sibling views of ONE SECTION** — three reports over the same data —
 * which is a different job from the `tabs` on a detail page, where the
 * tabs are a record's child collections. Same component underneath;
 * section 33.1 gives the test for which is which: a detail page's tabs
 * are about one RECORD, section tabs are about one SECTION.
 *
 * **Sub-navigation is deliberately rare, and each instance is agreed.**
 * This is a thin wiring layer over `tabs`, not a second tab component
 * and not a licence to add one to every screen. Section 12.1 caps the
 * sidebar at seven items for a reason, and a view is not a destination
 * in its own right — but nor is a tab bar a place to hide a screen that
 * deserves its own sidebar entry.
 *
 * It sits BETWEEN THE HEADER AND THE TOOLBAR and does not scroll. The
 * header names the section and this divides it, so it comes after the
 * title; the toolbar comes after it, because search and filters belong
 * to the active tab rather than to the section. A search box above a
 * tab bar implies it searches all of them, and it does not.
 *
 * The active tab lives in the URL (section 33.4), so a view can be
 * linked to and the browser's own back button returns to the tab the
 * user came from — the navigation this system has instead of a back
 * button (section 1 rule 11). Switching REPLACES the history entry:
 * flipping between three views should not make the back button walk
 * through every flip.
 *
 * **`useSearchParams` requires a Suspense boundary above it** when the
 * page it sits on is prerendered. Render it inside one, or the route
 * opts out of static rendering without saying so.
 */

export interface SectionTab {
  value: string
  label: string
}

export function SectionTabs({
  tabs,
  value,
  param = "view",
}: {
  /** Section 33.5: at most four. */
  tabs: SectionTab[]
  value: string
  /** The query parameter that carries the active tab. */
  param?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  if (tabs.length > 4) {
    throw new Error(
      `[design-system] A section tab bar was given ${tabs.length} tabs. ` +
        `AGENTS.md section 33.5: maximum four. Past that it is not a ` +
        `section with views, it is an information architecture problem.`,
    )
  }

  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const params = new URLSearchParams(searchParams.toString())
        params.set(param, String(next))
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      }}
      // shrink-0: fixed chrome. Only the data area scrolls beneath it.
      className="mt-6 shrink-0"
    >
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
