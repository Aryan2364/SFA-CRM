"use client"

import * as React from "react"
import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import { KanbanIcon, LayoutGridIcon, ListIcon } from "lucide-react"

import { useBoardAvailable } from "@/components/ui/board"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * The list page's view switcher (11.1 zone 2, 11.6, 35.1-35.3): list and
 * card, plus board where the record type has one, as a joined group on
 * the far right of the toolbar with the active side tinted
 * primary-subtle.
 *
 *   const [view, setView] = useListView("customers", { board: true })
 *   <ViewSwitcher value={view} onValueChange={setView} board />
 *
 * - `board` says the record type has a single master-data status field
 *   (35.2). Without it the board side is not rendered at all: hidden, not
 *   disabled, because a board does not exist for that record type.
 * - Below 768px the board side is not offered either (35.3), and a
 *   remembered board view shows the list instead, silently. The remembered
 *   choice itself is kept, so the board comes back on a wider screen.
 * - The choice is remembered per list (11.6), in this browser.
 */

type ListView = "list" | "card" | "board"

const VIEWS: { value: ListView; label: string; icon: React.ReactNode }[] = [
  { value: "list", label: "List view", icon: <ListIcon /> },
  { value: "card", label: "Card view", icon: <LayoutGridIcon /> },
  { value: "board", label: "Board view", icon: <KanbanIcon /> },
]

const storageKeyFor = (list: string) => `view:${list}`

/**
 * The view to show for one list, remembered in this browser. Returns the
 * view to RENDER, which is the list whenever the remembered board cannot
 * be shown here.
 */
const CHANGED = "view-switcher:change"

/** This visit's choices, for when storage is blocked. */
const memory = new Map<string, ListView>()

function readStored(list: string): ListView {
  try {
    const stored = window.localStorage.getItem(storageKeyFor(list))
    if (stored === "list" || stored === "card" || stored === "board") return stored
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
  return memory.get(list) ?? "list"
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(CHANGED, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(CHANGED, onChange)
  }
}

function useListView(list: string, { board = false }: { board?: boolean } = {}) {
  const boardAvailable = useBoardAvailable()
  // "list" on the server, the remembered choice in the browser, without a
  // hydration mismatch.
  const chosen = React.useSyncExternalStore(
    subscribe,
    () => readStored(list),
    () => "list" as ListView
  )

  const choose = React.useCallback(
    (next: ListView) => {
      memory.set(list, next)
      try {
        window.localStorage.setItem(storageKeyFor(list), next)
      } catch {
        // Blocked: memory above keeps it for this visit.
      }
      window.dispatchEvent(new Event(CHANGED))
    },
    [list]
  )

  const shown: ListView = chosen === "board" && !(board && boardAvailable) ? "list" : chosen
  return [shown, choose] as const
}

function ViewSwitcher({
  value,
  onValueChange,
  board = false,
  className,
}: {
  value: ListView
  onValueChange: (view: ListView) => void
  /** The record type has a board (35.2). */
  board?: boolean
  className?: string
}) {
  const boardAvailable = useBoardAvailable()
  const views = VIEWS.filter((v) => v.value !== "board" || (board && boardAvailable))

  return (
    <ToggleGroup
      data-slot="view-switcher"
      aria-label="View"
      value={[value]}
      // A single-choice group: pressing the side already chosen would
      // otherwise empty the group, leaving no view at all.
      onValueChange={(next) => {
        const picked = next[0] as ListView | undefined
        if (picked) onValueChange(picked)
      }}
      className={cn(
        // Section 6.5: the group owns the border, the radius and the
        // height; overflow-hidden clips each side's fill to the corners.
        "inline-flex h-control overflow-hidden rounded-lg border border-border bg-surface",
        className
      )}
    >
      {views.map((v) => (
        <Tooltip key={v.value}>
          <TooltipTrigger
            render={
              <Toggle
                value={v.value}
                aria-label={v.label}
                data-slot="view-switcher-item"
                className={cn(
                  "tap-area flex aspect-square h-full cursor-pointer items-center justify-center text-text-secondary",
                  "transition-[background-color,color] duration-(--duration-fast)",
                  "not-first:border-l not-first:border-border",
                  "not-data-pressed:hover:bg-surface-control not-data-pressed:hover:text-text-primary not-data-pressed:active:bg-surface-control-pressed",
                  // The chosen side: tinted, and not a control any more -
                  // pressing it changes nothing, so it has no hover.
                  "data-pressed:cursor-default data-pressed:bg-primary-subtle data-pressed:text-primary-text",
                  // Inset, so the group's overflow-hidden does not clip it.
                  "outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring",
                  "[&_svg]:size-icon-nav"
                )}
              />
            }
          >
            {v.icon}
          </TooltipTrigger>
          <TooltipContent>{v.label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  )
}

export { ViewSwitcher, useListView, type ListView }
