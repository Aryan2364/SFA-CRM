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
import { PermissionTooltip } from "@/components/ui/permission-tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useSearchPicker } from "@/components/ui/searchable-select"
import { selectTriggerClassName } from "@/components/ui/select"
import { Truncate } from "@/components/ui/truncate"

/**
 * Section 16.3: choosing several values from a searchable list.
 *
 * The same parts as SearchableSelect, not a second design: the trigger
 * is the select trigger (36px, chevron on the right, turning up while
 * open, grey placeholder, faded when disabled, danger border when
 * invalid - a class, as aria-invalid is not allowed on a button), and
 * the menu is the SearchableSelect menu - as wide as the trigger, search fixed above a list capped at seven rows, a chosen row
 * primary-subtle with the tick on the right, the highlighted row
 * neutral grey (16.1 to 16.3). The one difference is that choosing a
 * row does not close the menu, so several can be ticked in one go;
 * Escape or a click outside closes it and focus returns to the trigger
 * (16.4).
 *
 * The trigger lists the chosen labels in the options' own order, and
 * truncates with the full list in a tooltip when they do not fit (8).
 *
 * `locked` holds the options that cannot be changed, each with its
 * reason: "Rakesh Mehta is the only person who can manage access. Give
 * that to someone else first." (section 40.11). A locked option keeps
 * its current state, ticked or not, and is disabled, so it never fails
 * after being clicked (section 26 rule 3). A disabled row cannot show
 * its own tooltip, so the reason comes through PermissionTooltip, as on
 * a board card's Move to (section 35.6).
 *
 * ON PHONE (41.7 rule 7, 41.8 rule 8) it is SearchableSelect's phone
 * form: a full-height bottom sheet titled by the field's label, the
 * search box fixed at the top and never focused by itself (41.8 rule
 * 19), the rows below. A tap ticks a row and the sheet stays open; the
 * close button, a swipe down, the backdrop or Android back close it, and
 * focus returns to the trigger. Inside another bottom sheet the list
 * opens as a full-height step of it (41.8 rules 8 and 9). The sheet and
 * the step are SearchableSelect's (useSearchPicker), not a copy.
 *
 * A locked row on phone stays disabled and carries its reason itself,
 * shown on a tap (41.8 rule 17) - see LockedReason. A screen reader hears
 * each row's tick as checked or not checked (41.20 check 24).
 */
function MultiSelect({
  options,
  value,
  onValueChange,
  id,
  placeholder = "Choose",
  searchPlaceholder = "Search",
  emptyMessage = "Nothing matches that search.",
  disabled,
  invalid,
  locked,
  className,
  describedBy,
}: {
  /** value to label, in display order. */
  options: Record<string, string>
  value: string[]
  onValueChange: (value: string[]) => void
  id?: string
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  /** Draws the danger border; pair it with an InlineFieldError. */
  invalid?: boolean
  /** value to the reason it cannot be changed. */
  locked?: Record<string, string>
  className?: string
  /** id of the helper or error text under the field. */
  describedBy?: string
}) {
  const labels = value.map((v) => options[v]).filter(Boolean)

  // The rows tick and stay open, so `close` is not used: the sheet's own
  // close button, a swipe, the backdrop or Android back shut it.
  const { phone, open, onOpenChange, trigger, sheet } = useSearchPicker((_close, asStep) =>
    asStep ? (
      // A step keeps its own ticks, as each tap changes them.
      <MultiOptionsStep
        options={options}
        initial={value}
        onValueChange={onValueChange}
        locked={locked}
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage}
      />
    ) : (
      <MultiOptions
        options={options}
        value={value}
        onValueChange={onValueChange}
        locked={locked}
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage}
      />
    )
  )

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
            data-invalid={invalid || undefined}
            aria-describedby={describedBy}
            data-slot="multi-select-trigger"
            data-placeholder={labels.length ? undefined : ""}
            className={cn("group", selectTriggerClassName, invalid && "border-danger", className)}
          />
        }
      >
        {labels.length ? (
          <Truncate className="flex-1 text-left">{labels.join(", ")}</Truncate>
        ) : (
          <span className="flex-1 truncate text-left">{placeholder}</span>
        )}
        {/* The trigger carries data-popup-open, so the chevron reads it
            through the group (16.1: up while open). */}
        <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-text-secondary transition-transform group-data-popup-open:rotate-180" />
      </PopoverTrigger>
      {phone ? (
        sheet
      ) : (
        <PopoverContent align="start" className="w-(--anchor-width) gap-0 p-0">
          <MultiOptions
            options={options}
            value={value}
            onValueChange={onValueChange}
            locked={locked}
            searchPlaceholder={searchPlaceholder}
            emptyMessage={emptyMessage}
          />
        </PopoverContent>
      )}
    </Popover>
  )
}

type MultiOptionsProps = {
  options: Record<string, string>
  value: string[]
  onValueChange: (value: string[]) => void
  locked?: Record<string, string>
  searchPlaceholder: string
  emptyMessage: string
}

/**
 * The list as a step of a sheet (41.8 rule 9). A step is drawn as it
 * was given when it opened, so the ticks it shows are held here and
 * change with each tap; each tap still reaches the caller.
 */
function MultiOptionsStep({
  initial,
  onValueChange,
  ...props
}: Omit<MultiOptionsProps, "value"> & { initial: string[] }) {
  const [value, setValue] = React.useState(initial)
  return (
    <MultiOptions
      {...props}
      value={value}
      onValueChange={(next) => {
        setValue(next)
        onValueChange(next)
      }}
    />
  )
}

/** The search box and the tick rows: the popover's content, and the sheet's. */
function MultiOptions({
  options,
  value,
  onValueChange,
  locked,
  searchPlaceholder,
  emptyMessage,
}: MultiOptionsProps) {
  const phone = useLayout().layout === "phone"
  const ids = React.useId()
  const chosen = new Set(value)

  function toggle(v: string) {
    if (locked?.[v]) return
    const next = new Set(chosen)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    // Keep the options' own order, so the trigger text is stable.
    onValueChange(Object.keys(options).filter((key) => next.has(key)))
  }

  return (
    <Command>
      {/* Fixed at the top: a sibling of the list, not inside its
          scroll container. */}
      <CommandInput placeholder={searchPlaceholder} />
      <CommandList className="max-h-menu-max overflow-y-auto" aria-multiselectable>
        <CommandEmpty>{emptyMessage}</CommandEmpty>
        <CommandGroup>
          {Object.entries(options).map(([v, label], index) => {
            const isSelected = chosen.has(v)
            const reason = locked?.[v]
            // Phone: a locked row carries its reason itself (LockedReason).
            const lockedOnPhone = phone && Boolean(reason)
            const labelId = `${ids}-${index}-label`
            const reasonId = `${ids}-${index}-reason`
            const item = (
              <CommandItem
                key={v}
                value={label}
                disabled={Boolean(reason)}
                // cmdk owns aria-selected for its highlight; ours is
                // data-chosen, and data-checked draws CommandItem's tick.
                data-chosen={isSelected || undefined}
                data-checked={isSelected}
                // Phone: the tick, for TalkBack and VoiceOver (41.20 check
                // 24). cmdk's aria-selected is its highlight, which on
                // phone rests on no row (command.tsx). Phone only, so
                // desktop's markup is unchanged.
                {...(phone ? { "aria-checked": isSelected } : {})}
                // The row is named by its label alone, and described by
                // its reason, which it shows inside itself on a tap.
                {...(lockedOnPhone
                  ? { "aria-labelledby": labelId, "aria-describedby": reasonId }
                  : {})}
                onSelect={() => toggle(v)}
                className={cn(
                  "h-control w-full rounded-lg px-3",
                  isSelected &&
                    "bg-primary-subtle text-primary-text data-selected:bg-primary-subtle data-selected:text-primary-text",
                )}
              >
                {lockedOnPhone ? (
                  <LockedReason labelId={labelId} reasonId={reasonId} reason={reason ?? ""}>
                    {label}
                  </LockedReason>
                ) : (
                  // Phone: the label wraps rather than truncating (41.9 rule 7).
                  <span className="flex-1 truncate phone:break-words phone:whitespace-normal">
                    {label}
                  </span>
                )}
              </CommandItem>
            )
            if (!reason || lockedOnPhone) return item
            // Desktop: the reason through PermissionTooltip (26). A
            // column, so the wrapper stretches to the menu's width.
            return (
              <div key={v} className="flex flex-col">
                <PermissionTooltip allowed={false} reason={reason}>
                  {item}
                </PermissionTooltip>
              </div>
            )
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/**
 * A locked row's label and reason, on phone (sections 26 and 40.11, 41.8
 * rule 17).
 *
 * Desktop wraps the row in PermissionTooltip. In a phone sheet that
 * wrapper's role="note" would sit between the listbox and the option,
 * breaking the roles a listbox must own, and a screen reader would meet
 * a note it cannot act on in the middle of the list. So on phone the row
 * stays an option, disabled, and carries the reason itself:
 *
 *   - the row is named by its label and described by the reason
 *     (aria-labelledby, aria-describedby): "Rakesh Mehta, dimmed, Rakesh
 *     Mehta is the only person who can manage access...";
 *   - a tap on the row shows the reason in the row, under the label, in
 *     text-secondary (it is an instruction, so never text-muted, 2.3),
 *     and the next tap on the row hides it. The row is disabled and takes
 *     no pointer, so the tap lands on a layer over it, which is hidden
 *     from screen readers: they have the description.
 *
 * The reason stays a fact on screen, not a tooltip: a phone shows no
 * tooltip but permission-tooltip.tsx's (41.8 rules 16 and 17), and a
 * second tooltip wrapper is not written (26).
 */
function LockedReason({
  labelId,
  reasonId,
  reason,
  children,
}: {
  labelId: string
  reasonId: string
  reason: string
  children: React.ReactNode
}) {
  const [shown, setShown] = React.useState(false)
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={labelId} className="break-words">
          {children}
        </span>
        {/* Hidden until tapped; aria-describedby still reads it. */}
        <span id={reasonId} hidden={!shown} className="text-label break-words text-text-secondary">
          {reason}
        </span>
      </span>
      <span
        aria-hidden="true"
        data-slot="multi-select-locked-tap"
        className="pointer-events-auto absolute inset-0"
        onClick={() => setShown((was) => !was)}
      />
    </>
  )
}

export { MultiSelect }
