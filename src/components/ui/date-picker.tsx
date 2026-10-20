"use client"

import * as React from "react"
import { format, isValid, parse } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { formatDate as formatPlainDate, parseDate as parsePlainDate } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Sections 18 and 20.1.
 *
 * Displays and accepts DD Mon YYYY. The field is typeable as well as
 * selectable - forcing someone to click through a calendar for a date
 * they already know is slow, and section 20.1 forbids calendar-only.
 *
 * The calendar opens in a popover aligned to the left edge of the
 * field, starts the week on Monday, outlines today and fills the
 * selected day with primary.
 *
 * Field width: 4 columns (section 17).
 *
 * ON PHONE (41.9 rule 10, 41.7 rule 8) the field opens the phone's own
 * date picker instead - the wheel on iPhone, the calendar on Android -
 * through NativePickerField below. The field still shows DD Mon YYYY;
 * only the picker follows the phone's language. There is no typed entry
 * on phone (41.9 rule 10 lifts section 20.1's there).
 */
const DATE_FORMAT = "dd MMM yyyy"

/** The one format a native date field reads and writes, whatever the phone shows. */
const NATIVE_DATE_FORMAT = "yyyy-MM-dd"

/**
 * DD Mon YYYY, through lib/format.ts's formatDate (section 4 rule 2: one
 * implementation). `value` here is always a calendar day the person
 * picked or typed - a local-midnight Date, never a moment from a server
 * - so it is passed through as its own yyyy-MM-dd calendar string (via
 * date-fns's local getters, unchanged from before) rather than as a Date
 * instance: lib/format.ts reads a bare Date as an instant in the
 * product's time zone, which would shift a local-midnight Date created
 * in a browser running in another zone. Going through the plain-date
 * form keeps the digits typed or clicked exactly the digits shown, with
 * no time zone involved, as section 20.1 and 18 both require.
 */
function formatDate(date: Date | undefined) {
  return date && isValid(date) ? formatPlainDate(format(date, NATIVE_DATE_FORMAT)) : ""
}

/** Reads DD Mon YYYY back into a local-midnight Date, via lib/format.ts's parseDate. */
function parseDate(text: string) {
  return parsePlainDate(text.trim()) ?? undefined
}

/**
 * The same value, compared by time rather than by object: two Date
 * objects for one moment are the same date, and two missing values are
 * the same. Object.is, so two Invalid Dates (NaN) count as the same too
 * and a parent passing a fresh one each render cannot loop.
 */
function sameDate(a: Date | undefined, b: Date | undefined) {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return Object.is(a.getTime(), b.getTime())
}

/**
 * Section 41.9 rule 10: the product's field, with the phone's own picker
 * behind it. Shared by DatePicker and TimePicker, so the two phone fields
 * are one piece of code (section 4 rule 2).
 *
 * WHY THE NATIVE FIELD SITS ON TOP, TRANSPARENT. The rule wants the
 * phone's picker opened from a hidden native field. Hidden for real
 * (display: none, visibility: hidden, or behind the product's field) it
 * can only be opened from script, with input.showPicker(), which older
 * iPhones do not have and which some Android browsers ignore for these
 * types. A native field the finger actually lands on opens its picker on
 * every phone browser with no script at all. So it covers the product's
 * field exactly, at opacity 0: the person sees only the product's field
 * and its DD Mon YYYY or h:mm A, and the tap reaches the native one.
 * opacity, never visibility: an invisible element still takes taps.
 *
 * THE NATIVE FIELD IS THE REAL ONE for everything but looks: it takes the
 * caller's `id` (so <Label htmlFor> names it for screen readers and a tap
 * on the label reaches it), `disabled` and aria-invalid. The product's
 * field underneath is drawing only - aria-hidden, out of the tab order,
 * read-only - and takes the native field's focus through `peer`, so a
 * keyboard attached to the phone still sees the primary-ring outline
 * (section 6.4).
 *
 * Its text is 16px (text-body is 16px on phone) although it is never
 * seen: iPhone decides whether to zoom from the size of the focused
 * field, not from what is visible (41.9 rule 5).
 *
 * Nothing here takes focus by itself (41.7 rule 17, 41.8 rule 19), and
 * there is no gesture, so the phone's edge swipe stays its own (41.4
 * rule 10).
 */
function NativePickerField({
  type,
  slot,
  icon,
  id,
  shown,
  nativeValue,
  onNativeChange,
  disabled,
  invalid,
  placeholder,
  className,
}: {
  type: "date" | "time"
  slot: "date-picker" | "time-picker"
  /** Decoration only; see the comment where it is drawn. */
  icon: React.ReactNode
  id?: string
  /** The value in the product's format (section 18), or "" for none. */
  shown: string
  /** The value in the native field's own format, or "" for none. */
  nativeValue: string
  /** The native field's raw value; "" when the phone's picker clears it. */
  onNativeChange: (raw: string) => void
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  className?: string
}) {
  return (
    <div
      data-slot={slot}
      className={cn("relative flex w-full max-w-field-max items-center", className)}
    >
      {/* First, so the product's field can follow its focus through
          `peer`. Positioned, so it paints over the static field below
          whatever the order, with no z-index. */}
      <input
        id={id}
        type={type}
        value={nativeValue}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onNativeChange(e.target.value)}
        className="peer absolute inset-0 block size-full min-w-0 appearance-none text-body opacity-0"
      />
      <Input
        value={shown}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        className={cn(
          "pr-11",
          // The native field's keyboard focus, drawn on the field the
          // person sees: the same ring Input draws on its own focus.
          "peer-focus-visible:border-primary-ring peer-focus-visible:outline-2 peer-focus-visible:[outline-style:solid] peer-focus-visible:outline-offset-0 peer-focus-visible:outline-primary-ring",
          "aria-invalid:peer-focus-visible:outline-danger"
        )}
      />
      {/*
       * The calendar or clock, where desktop's in-field button shows it,
       * so the field still reads as a date or a time and not as text to
       * type into. It is NOT a button (41.9 rule 9 allows no calendar or
       * clock icon button on phone; the whole field opens the picker), it
       * takes no taps, and it is aria-hidden: the field is named by its
       * label, so the icon carries nothing a screen reader misses
       * (section 23: an icon never appears without a visible label).
       */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute right-1 flex size-icon-in-field items-center justify-center",
          disabled ? "text-text-muted" : "text-text-secondary"
        )}
      >
        {icon}
      </span>
    </div>
  )
}

function DatePicker({
  value,
  onValueChange,
  id,
  disabled,
  invalid,
  onInvalidEntry,
  placeholder = "12 Aug 2026",
  className,
}: {
  value?: Date
  onValueChange?: (date: Date | undefined) => void
  id?: string
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  className?: string
  /**
   * Called on leaving the field when what was typed cannot be read as a
   * date. The field keeps the text and marks itself invalid; the caller
   * shows the section 11.3 rule 6 inline error and does not save.
   */
  onInvalidEntry?: (typed: string) => void
}) {
  const phone = useLayout().layout === "phone"
  const [open, setOpen] = React.useState(false)
  const [unreadable, setUnreadable] = React.useState(false)
  const [text, setText] = React.useState(() => formatDate(value))

  // A foldable folded while the calendar was open (41.2 rule 3): the
  // popover is gone on phone, and must not spring back open on unfolding.
  if (phone && open) setOpen(false)

  // The typed text is the source of truth while the user edits; when the
  // value itself changes it follows. Adjusted during render rather than
  // in an effect, so there is no extra render with stale text.
  //
  // "Changes" means a different moment, not a different Date object
  // (sameDate): a parent that re-renders and passes a new Date for the
  // same day must not wipe a typed entry that could not be read (20.1:
  // the field keeps what was typed).
  const [shownValue, setShownValue] = React.useState(value)
  if (!sameDate(value, shownValue)) {
    setShownValue(value)
    setText(formatDate(value))
    setUnreadable(false)
  }

  // Section 11.3 rule 6: validation runs when the user leaves the
  // field, not on every keystroke.
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
    const parsed = parseDate(text)
    if (parsed) {
      setUnreadable(false)
      onValueChange?.(parsed)
      setText(formatDate(parsed))
    } else {
      setUnreadable(true)
      onInvalidEntry?.(text)
    }
  }

  /*
   * PHONE (41.9 rule 10). Same state as desktop, so a layout switch mid-
   * use (a foldable, 41.2 rule 3) keeps the value and anything typed: the
   * component re-renders in place and only the branch changes. Text typed
   * on desktop and not yet committed shows as typed, marked invalid if it
   * cannot be read, exactly as leaving the field would have marked it.
   * Typed entry and onInvalidEntry do not apply here: the phone's picker
   * can only give a real date or nothing.
   */
  if (phone) {
    const read = parseDate(text)
    return (
      <NativePickerField
        type="date"
        slot="date-picker"
        icon={<CalendarIcon className="size-4" />}
        id={id}
        shown={text}
        nativeValue={read ? format(read, NATIVE_DATE_FORMAT) : ""}
        onNativeChange={(raw) => {
          // Local midnight, as the calendar gives on desktop. "" is the
          // phone picker's Clear or Reset.
          const picked = raw ? parse(raw, NATIVE_DATE_FORMAT, new Date()) : undefined
          const date = picked && isValid(picked) ? picked : undefined
          setUnreadable(false)
          setText(formatDate(date))
          onValueChange?.(date)
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
      data-slot="date-picker"
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
              aria-label="Choose a date"
              className="absolute right-1"
            />
          }
        >
          <CalendarIcon />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <Calendar
            mode="single"
            selected={value}
            defaultMonth={value}
            onSelect={(date) => {
              onValueChange?.(date)
              setText(formatDate(date))
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export { DatePicker, DATE_FORMAT, formatDate, parseDate, NativePickerField }
