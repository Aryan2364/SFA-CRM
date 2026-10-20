"use client"

import * as React from "react"
import { ClockIcon } from "lucide-react"

import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { formatTime as formatMoment } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { NativePickerField } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Section 20.2. There is no ready-made time picker in the component
 * library, so this is built to the rule:
 *
 *   - 12-hour format with AM and PM, matching the date and time format
 *     in section 18.
 *   - Separate hour and minute controls, both typeable and selectable.
 *   - Minutes step in 15-minute intervals.
 *   - No seconds.
 *   - Field width: 3 columns (section 17).
 *
 * "Typeable and selectable" is why each control is an input with a
 * list beside it rather than one or the other: data entry staff type,
 * everyone else picks.
 *
 * ON PHONE (41.9 rule 10, 41.7 rule 8) the field opens the phone's own
 * time picker instead, through NativePickerField in date-picker.tsx. The
 * field still shows h:mm A; the picker follows the phone's language and
 * its 12 or 24-hour clock. Neither typed entry nor the 15-minute step
 * applies there, so a phone may give any minute.
 */
const HOURS = ["12", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]
const MINUTES = ["00", "15", "30", "45"]
const MERIDIEMS = ["AM", "PM"] as const

type Meridiem = (typeof MERIDIEMS)[number]

export type TimeValue = {
  /** 1 to 12, as displayed. */
  hour: number
  /**
   * 0 to 59. The desktop picker only ever gives 0, 15, 30 or 45 (section
   * 20.2); the phone's own picker gives any minute (41.9 rule 10), so code
   * reading a TimeValue never assumes a 15-minute step.
   */
  minute: number
  meridiem: Meridiem
}

function formatTime(value: TimeValue | undefined) {
  if (!value) return ""
  return `${value.hour}:${String(value.minute).padStart(2, "0")} ${value.meridiem}`
}

/**
 * Section 18's time, h:mm A, of a moment: "4:05 PM". Delegates to
 * lib/format.ts's formatTime, the kit's one implementation (section 4
 * rule 2), so a time picked here and a time a screen reports ("a draft
 * from 3:45 PM", "try again after 4:05 PM") always read alike - and so
 * this reads the moment in the product's time zone explicitly, rather
 * than the browser's own, which is what server and client must agree on
 * for hydration to match.
 */
function formatClock(date: Date): string {
  return formatMoment(date)
}

/*
 * The native time field's own format, 24-hour "HH:mm", whatever clock
 * the phone shows. Phone only: these never snap, because the 15-minute
 * step does not apply there (41.9 rule 10).
 */
function toNativeTime(value: TimeValue) {
  const hour24 = (value.hour % 12) + (value.meridiem === "PM" ? 12 : 0)
  return `${String(hour24).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`
}

/** "HH:mm", or "HH:mm:ss" from a picker that adds seconds, which are dropped (20.2). */
function fromNativeTime(raw: string): TimeValue | undefined {
  const match = raw.match(/^(\d{2}):(\d{2})/)
  if (!match) return undefined
  const hour24 = Number(match[1])
  const minute = Number(match[2])
  if (hour24 > 23 || minute > 59) return undefined
  return {
    hour: hour24 % 12 || 12,
    minute,
    meridiem: hour24 >= 12 ? "PM" : "AM",
  }
}

/*
 * Reads the shown text back on phone. Text written by formatTime is read
 * exactly - parseTime would snap a phone's 9:20 to 9:15. Anything else is
 * text typed on desktop and not yet committed when a foldable switched
 * layout, and is read the way leaving the field would have read it.
 */
function readShownTime(text: string): TimeValue | undefined {
  const match = text.trim().match(/^(\d{1,2}):(\d{2}) (AM|PM)$/)
  if (match) {
    const hour = Number(match[1])
    const minute = Number(match[2])
    if (hour >= 1 && hour <= 12 && minute <= 59) {
      return { hour, minute, meridiem: match[3] as Meridiem }
    }
  }
  return parseTime(text)
}

/** Accepts 9, 9:30, 9:30 pm, 0930pm and similar. Returns undefined if it cannot. */
function parseTime(text: string): TimeValue | undefined {
  const cleaned = text.trim().toLowerCase().replace(/\s+/g, "")
  if (!cleaned) return undefined
  const match = cleaned.match(/^(\d{1,2})[:.]?(\d{2})?(am|pm)?$/)
  if (!match) return undefined

  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  let meridiem = match[3]?.toUpperCase() as Meridiem | undefined

  if (hour === 0 || hour > 24) return undefined
  if (minute > 59) return undefined

  // A 24-hour entry is folded into 12-hour, since that is what the
  // system displays everywhere.
  if (hour > 12) {
    hour -= 12
    meridiem = meridiem ?? "PM"
  } else if (hour === 12) {
    meridiem = meridiem ?? "PM"
  } else {
    meridiem = meridiem ?? "AM"
  }

  // Minutes step in 15s; anything typed is snapped to the nearest step
  // rather than rejected, which is kinder than an error for "9:20".
  const snapped = (Math.round(minute / 15) * 15) % 60
  const rolled = Math.round(minute / 15) === 4

  return {
    hour: rolled ? (hour === 12 ? 1 : hour + 1) : hour,
    minute: snapped,
    meridiem,
  }
}

function OptionList({
  options,
  selected,
  onSelect,
  label,
}: {
  options: readonly string[]
  selected: string
  onSelect: (value: string) => void
  label: string
}) {
  return (
    <div className="flex flex-col">
      <p className="px-3 py-1 text-meta text-text-muted">{label}</p>
      <div className="max-h-menu-max overflow-y-auto">
        {options.map((option) => {
          const isSelected = option === selected
          return (
            <button
              key={option}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(option)}
              className={cn(
                "flex h-control w-full cursor-pointer items-center rounded-lg px-3 text-body outline-none",
                "not-aria-pressed:hover:bg-surface-control not-aria-pressed:active:bg-surface-control-pressed",
                "focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring",
                isSelected && "bg-primary-subtle text-primary-text"
              )}
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TimePicker({
  value,
  onValueChange,
  id,
  disabled,
  invalid,
  onInvalidEntry,
  placeholder = "9:30 AM",
  className,
}: {
  value?: TimeValue
  onValueChange?: (value: TimeValue | undefined) => void
  id?: string
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  className?: string
  /**
   * Called on leaving the field when what was typed cannot be read as a
   * time. The field keeps the text and marks itself invalid; the caller
   * shows the section 11.3 rule 6 inline error and does not save.
   */
  onInvalidEntry?: (typed: string) => void
}) {
  const phone = useLayout().layout === "phone"
  const [open, setOpen] = React.useState(false)
  const [unreadable, setUnreadable] = React.useState(false)
  const [text, setText] = React.useState(() => formatTime(value))

  // A foldable folded while the lists were open (41.2 rule 3): the
  // popover is gone on phone, and must not spring back open on unfolding.
  if (phone && open) setOpen(false)

  // The typed text is the source of truth while the user edits; when the
  // value itself changes it follows. Adjusted during render rather than
  // in an effect, so there is no extra render with stale text.
  const [shownValue, setShownValue] = React.useState(value)
  if (value !== shownValue) {
    setShownValue(value)
    setText(formatTime(value))
    setUnreadable(false)
  }

  /*
   * Section 20.1: an entry that cannot be read keeps what was typed and
   * shows the inline error. It used to be replaced silently with the
   * previous value, so a mistyped entry vanished and the old one looked
   * as if it had been accepted.
   */
  function commit() {
    if (text.trim() === "") {
      setUnreadable(false)
      onValueChange?.(undefined)
      return
    }
    const parsed = parseTime(text)
    if (parsed) {
      setUnreadable(false)
      onValueChange?.(parsed)
      setText(formatTime(parsed))
    } else {
      setUnreadable(true)
      onInvalidEntry?.(text)
    }
  }

  const current: TimeValue = value ?? { hour: 9, minute: 0, meridiem: "AM" }

  function set(part: Partial<TimeValue>) {
    onValueChange?.({ ...current, ...part })
  }

  /*
   * PHONE (41.9 rule 10). Same state as desktop, so a layout switch mid-
   * use (a foldable, 41.2 rule 3) keeps the value and anything typed; see
   * the same branch in date-picker.tsx.
   */
  if (phone) {
    const read = readShownTime(text)
    return (
      <NativePickerField
        type="time"
        slot="time-picker"
        icon={<ClockIcon className="size-4" />}
        id={id}
        shown={text}
        nativeValue={read ? toNativeTime(read) : ""}
        onNativeChange={(raw) => {
          // "" is the phone picker's Clear or Reset.
          const picked = raw ? fromNativeTime(raw) : undefined
          setUnreadable(false)
          setText(formatTime(picked))
          onValueChange?.(picked)
        }}
        disabled={disabled}
        invalid={invalid || unreadable || (text.trim() !== "" && !read)}
        placeholder={placeholder}
        className={className}
      />
    )
  }

  return (
    <div
      data-slot="time-picker"
      className={cn("relative flex w-full max-w-field-max items-center", className)}
    >
      <Input
        id={id}
        value={text}
        disabled={disabled}
        aria-invalid={invalid || unreadable || undefined}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
        className="pr-11"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="in-field"
              size="icon-sm"
              disabled={disabled}
              aria-label="Choose a time"
              className="absolute right-1"
            />
          }
        >
          <ClockIcon />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto gap-0 p-1">
          <div className="flex gap-1">
            <OptionList
              label="Hour"
              options={HOURS}
              selected={String(current.hour)}
              onSelect={(h) => set({ hour: Number(h) })}
            />
            <OptionList
              label="Minute"
              options={MINUTES}
              selected={String(current.minute).padStart(2, "0")}
              onSelect={(m) => set({ minute: Number(m) })}
            />
            <OptionList
              label="AM/PM"
              options={MERIDIEMS}
              selected={current.meridiem}
              onSelect={(m) => set({ meridiem: m as Meridiem })}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export { TimePicker, formatTime, formatClock, parseTime, MINUTES, HOURS }
