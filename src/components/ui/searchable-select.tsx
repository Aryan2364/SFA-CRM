"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { selectTriggerClassName } from "@/components/ui/select"

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
 * GROUPED FORM — one picker holding two KINDS of thing.
 *
 * Section 4 rule 4: a second flavour of an existing control is a variant
 * on it, never a second component. `groups` is that variant. Each group
 * carries a heading and, optionally, an icon rendered on every one of its
 * rows AND on the trigger once one is chosen — so the kind of thing
 * selected is still legible after the menu has closed, which a heading
 * alone cannot do.
 *
 * cmdk hides a group with no matching rows, so the headings keep telling
 * the two kinds apart while the user is typing, not only at rest.
 *
 * `options` and `groups` are the same control: pass one. `options` alone
 * renders a single unheaded group, which is exactly what every existing
 * caller already gets.
 */
type SearchableSelectGroup = {
  heading: string
  /** Rendered on every row in this group and on the trigger when chosen. */
  icon?: React.ReactNode
  /** value to label. */
  options: Record<string, string>
}

function SearchableSelect({
  options,
  groups,
  value,
  onValueChange,
  id,
  placeholder = "Select an option",
  searchPlaceholder = "Search",
  emptyMessage = "Nothing matches that search.",
  disabled,
  className,
}: {
  /** value to label. Ignored when `groups` is given. */
  options?: Record<string, string>
  /** The section 4 rule 4 variant: several headed groups in one picker. */
  groups?: SearchableSelectGroup[]
  value?: string
  onValueChange?: (value: string) => void
  id?: string
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const resolved: SearchableSelectGroup[] = React.useMemo(
    () => groups ?? [{ heading: "", options: options ?? {} }],
    [groups, options]
  )
  // The chosen row's label and icon, wherever in the groups it sits.
  const selected = React.useMemo(() => {
    if (!value) return null
    for (const g of resolved) {
      const label = g.options[value]
      if (label !== undefined) return { label, icon: g.icon }
    }
    return null
  }, [resolved, value])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
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
        {selected?.icon ? (
          <span className="flex shrink-0 items-center text-text-secondary [&_svg]:size-4">
            {selected.icon}
          </span>
        ) : null}
        <span className="flex-1 truncate text-left">
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-text-secondary transition-transform data-popup-open:rotate-180" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--anchor-width) gap-0 p-0"
      >
        <Command>
          {/* Fixed at the top: it is a sibling of the list, not inside
              its scroll container. */}
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-menu-max overflow-y-auto">
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {resolved.map((group, gi) => (
              <CommandGroup key={group.heading || gi} heading={group.heading || undefined}>
                {Object.entries(group.options).map(([v, label]) => {
                  const isSelected = v === value
                  return (
                    <CommandItem
                      key={v}
                      // What cmdk filters on. The heading is folded in so
                      // that typing "contact" finds the people group, and
                      // so two identical names in different groups are not
                      // one row to the filter.
                      value={group.heading ? `${label} ${group.heading}` : label}
                      // Not aria-selected: cmdk owns that attribute for
                      // its own highlight, and section 16.2 needs the
                      // chosen row and the highlighted row to stay
                      // visually distinct. `data-chosen` carries ours.
                      data-chosen={isSelected || undefined}
                      // CommandItem already renders the tick, keyed to
                      // data-checked. Rule 4: do not build it twice.
                      data-checked={isSelected}
                      onSelect={() => {
                        onValueChange?.(v)
                        setOpen(false)
                      }}
                      className={cn(
                        "h-control rounded-lg px-3",
                        isSelected && "bg-primary-subtle text-primary-pressed"
                      )}
                    >
                      {group.icon ? (
                        <span className="flex shrink-0 items-center text-text-secondary [&_svg]:size-4">
                          {group.icon}
                        </span>
                      ) : null}
                      <span className="flex-1 truncate">{label}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { SearchableSelect }
export type { SearchableSelectGroup }
