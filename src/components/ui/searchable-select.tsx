"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useLayout } from "@/lib/layout"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  CHOOSE_TITLE,
  phoneSheetTitle,
  selectTriggerClassName,
} from "@/components/ui/select"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  useSheetStep,
} from "@/components/ui/sheet"

/**
 * Section 16.3.
 *
 * "More than 6 options: the menu gets a search box fixed at the top,
 * which does not scroll with the options. More than about 20 options:
 * it should not be a dropdown. Use a searchable picker or a dialog."
 *
 * This is that picker. The trigger is the plain Select's trigger -
 * imported, not copied, so the two cannot drift apart - and the search
 * box sits outside the scrolling list, so it stays put while the
 * options move underneath it.
 *
 * Selected and hovered stay distinct, as in section 16.2: selected is
 * primary-subtle with a tick, hovered is neutral grey.
 *
 * ON PHONE (41.7 rule 7, 41.8 rule 8) the same trigger opens a bottom
 * sheet at full height, titled by the field's label, with the search box
 * fixed at the top and the rows scrolling below it, so the keyboard never
 * covers the list. The search box is never focused by itself (41.8 rule
 * 19). Choosing a row closes the sheet and focus returns to the trigger.
 * Inside another bottom sheet the list opens as a full-height step of it
 * instead (41.8 rules 8 and 9). The caller never chooses (41.3 rule 4).
 * That phone form is useSearchPicker below, shared with MultiSelect.
 */
function SearchableSelect({
  options,
  value,
  onValueChange,
  id,
  placeholder = "Select an option",
  searchPlaceholder = "Search",
  emptyMessage = "Nothing matches that search.",
  disabled,
  className,
}: {
  /** value to label. */
  options: Record<string, string>
  value?: string
  onValueChange?: (value: string) => void
  id?: string
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
}) {
  const entries = Object.entries(options)

  const { phone, open, setOpen, onOpenChange, trigger, sheet } = useSearchPicker((close) => (
    <SearchableOptions
      entries={entries}
      value={value}
      onPick={(v) => {
        onValueChange?.(v)
        close()
      }}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
    />
  ))

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            ref={trigger}
            id={id}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            data-slot="searchable-select-trigger"
            data-placeholder={value ? undefined : ""}
            className={cn(selectTriggerClassName, className)}
          />
        }
      >
        <span className="flex-1 truncate text-left">
          {value ? options[value] : placeholder}
        </span>
        <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-text-secondary transition-transform data-popup-open:rotate-180" />
      </PopoverTrigger>
      {phone ? (
        sheet
      ) : (
        <PopoverContent
          align="start"
          className="w-(--anchor-width) gap-0 p-0"
        >
          <SearchableOptions
            entries={entries}
            value={value}
            onPick={(v) => {
              onValueChange?.(v)
              setOpen(false)
            }}
            searchPlaceholder={searchPlaceholder}
            emptyMessage={emptyMessage}
          />
        </PopoverContent>
      )}
    </Popover>
  )
}

/**
 * The phone sheet's body for a searchable list: it does not scroll
 * itself. The search box stays fixed at its top and the list below is
 * the one thing that scrolls (41.8 rule 8, 1 rule 8).
 */
const PHONE_SEARCH_BODY = "flex flex-col overflow-hidden p-0"

/**
 * The open state and phone form of a searchable picker, written once for
 * SearchableSelect and MultiSelect (4 rule 4). Each keeps its own Popover
 * and trigger, which take `open`, `onOpenChange` and `trigger`. On
 * desktop this is only that open state; the popover is the caller's.
 *
 * On phone (41.7 rule 7) an open becomes:
 *   - `sheet`: a bottom sheet at full height (41.8 rule 8), titled by the
 *     field's label (11.3), the search box fixed at the top, focus back
 *     to the trigger on close (16.4); or,
 *   - inside another bottom sheet, a full-height step of it with a back
 *     arrow (41.8 rules 8 and 9), and `sheet` is nothing.
 *
 * `options(close, asStep)` draws the search box and the rows. `close`
 * shuts the sheet, or returns from the step. A step is drawn as it was
 * given when it opened (sheet.tsx), so `asStep` tells the caller to give
 * rows that change while it is open state of their own.
 */
function useSearchPicker(
  options: (close: () => void, asStep: boolean) => React.ReactNode
) {
  const phone = useLayout().layout === "phone"
  const step = useSheetStep()
  const trigger = React.useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState(CHOOSE_TITLE)

  const onOpenChange = (next: boolean) => {
    if (!phone || !next) {
      setOpen(next)
      return
    }
    // The field's label names the sheet: the Label above it (11.3).
    const name = phoneSheetTitle(trigger.current, { content: false }) ?? CHOOSE_TITLE
    if (step.inSheet) {
      // 39.3: the step returns focus to what had it when it opened.
      trigger.current?.focus({ preventScroll: true })
      step.open({
        title: name,
        // 41.8 rule 8: a searchable list takes the sheet's full height
        // as a step too, so the keyboard never covers the list.
        fullHeight: true,
        content: (
          <SheetBody className={PHONE_SEARCH_BODY}>{options(step.back, true)}</SheetBody>
        ),
      })
      return
    }
    setTitle(name)
    setOpen(true)
  }

  const sheet =
    phone && !step.inSheet ? (
      <Sheet open={open} onOpenChange={(next) => setOpen(next)}>
        <SheetContent
          side="bottom"
          // 41.8 rule 8: a searchable list opens at full height.
          fullHeight
          // 16.4: focus returns to the trigger on close.
          finalFocus={trigger}
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <SheetBody className={PHONE_SEARCH_BODY}>
            {options(() => setOpen(false), false)}
          </SheetBody>
        </SheetContent>
      </Sheet>
    ) : null

  return { phone, open, setOpen, onOpenChange, trigger, sheet }
}

/** The search box and the options: the popover's content, and the sheet's. */
function SearchableOptions({
  entries,
  value,
  onPick,
  searchPlaceholder,
  emptyMessage,
}: {
  entries: [string, string][]
  value?: string
  onPick: (value: string) => void
  searchPlaceholder: string
  emptyMessage: string
}) {
  // The chosen row's cmdk value, which is its label.
  const chosenLabel = entries.find(([v]) => v === value)?.[1]
  return (
    // Phone: the chosen row is the one cmdk marks while no key has moved
    // its highlight, so it alone is aria-selected and no other row turns
    // grey (command.tsx). Ignored on desktop.
    <Command chosenValue={chosenLabel}>
      {/* Fixed at the top: it is a sibling of the list, not inside
          its scroll container. */}
      <CommandInput placeholder={searchPlaceholder} />
      <CommandList className="max-h-menu-max overflow-y-auto">
        <CommandEmpty>{emptyMessage}</CommandEmpty>
        <CommandGroup>
          {entries.map(([v, label]) => {
            const isSelected = v === value
            return (
              <CommandItem
                key={v}
                value={label}
                // Not aria-selected: cmdk owns that attribute for
                // its own highlight, and section 16.2 needs the
                // chosen row and the highlighted row to stay
                // visually distinct. `data-chosen` carries ours.
                data-chosen={isSelected || undefined}
                // CommandItem already renders the tick, keyed to
                // data-checked. Rule 4: do not build it twice.
                data-checked={isSelected}
                onSelect={() => onPick(v)}
                className={cn(
                  "h-control rounded-lg px-3",
                  // data-selected is cmdk's highlight. Without restating the
                  // chosen fill under it, the chosen row turned hover
                  // grey when highlighted - the 16.2 defect again.
                  isSelected &&
                    "bg-primary-subtle text-primary-text data-selected:bg-primary-subtle data-selected:text-primary-text"
                )}
              >
                {/* Phone: the label wraps rather than truncating (41.9 rule 7). */}
                <span className="flex-1 truncate phone:break-words phone:whitespace-normal">
                  {label}
                </span>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

export { SearchableSelect, useSearchPicker }
