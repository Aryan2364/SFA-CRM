"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The OTP field (section 11.7 rule 2, mobile number and OTP): ONE real
 * input, drawn as a row of boxes - never one input per box. Separate
 * inputs would break the phone's offer of the code from the SMS, pasting
 * the code, and how a screen reader announces the field.
 *
 * THE REAL CONTROL is a single <input>, numeric, autocomplete
 * "one-time-code", stretched transparently over the row of boxes so every
 * tap, the caret, selection and paste all land on it exactly as they
 * would on any other field. Its own text and caret are made invisible
 * (text-transparent, caret-transparent); what the person sees is the row
 * of boxes underneath, each showing one character of the input's value.
 * The box the next digit goes into carries the focus ring (section 6.4),
 * standing in for the caret the browser is actually drawing, invisibly,
 * inside the real input.
 *
 * BEHAVIOUR comes from the browser, not from key handling written here:
 * typing, Backspace, Delete, the arrow keys, select-all and paste all
 * work exactly as they do in any text field, because this is one. The
 * only thing this component adds on top is cleaning the value to digits
 * only, capped at `length` (so a pasted "48 21" or "4821-" becomes
 * "4821"), and reading the real input's selectionStart after every change
 * so the right box can show the ring.
 *
 * Sizing follows input.tsx: each box is the control height (--h-control:
 * 36px, 44px on phone, section 41.9 rule 2), 8px radius, 1px border,
 * digits at Body size, centred and tabular. The row never overflows: the
 * boxes shrink in width (never in height) to fit the container, so six
 * boxes fit at 320px wide.
 */

export type OtpFieldProps = {
  id?: string
  name?: string
  /** The digits typed so far, "" to `length` characters long. */
  value: string
  onChange: (value: string) => void
  /** Called once, the moment the last digit is entered. */
  onComplete?: (value: string) => void
  /** The product's OTP length (section 11.7 rule 2). Default 6. */
  length?: number
  disabled?: boolean
  readOnly?: boolean
  /** Danger border on every box (section 11.3 rule 6), like input.tsx. */
  invalid?: boolean
  autoFocus?: boolean
  enterKeyHint?: React.InputHTMLAttributes<HTMLInputElement>["enterKeyHint"]
  autoComplete?: string
  /** Section 11.3 rule 6: validation runs when the person leaves the field. */
  onBlur?: () => void
  className?: string
  "aria-labelledby"?: string
  "aria-label"?: string
  "aria-describedby"?: string
}

/*
 * forwardRef (section 4.2): the caller needs the real <input> itself -
 * to focus it (39.3) and to call select() on it after a wrong try - not
 * the wrapping div. React 18 passes no ref to a plain function component.
 */
const OtpField = React.forwardRef<HTMLInputElement, OtpFieldProps>(function OtpField(
  {
    id,
    name,
    value,
    onChange,
    onComplete,
    length = 6,
    disabled,
    readOnly,
    invalid,
    autoFocus,
    enterKeyHint,
    autoComplete = "one-time-code",
    onBlur,
    className,
    ...aria
  },
  forwardedRef
) {
  const ownRef = React.useRef<HTMLInputElement | null>(null)
  const inputRef = React.useCallback(
    (el: HTMLInputElement | null) => {
      ;(ownRef as React.MutableRefObject<HTMLInputElement | null>).current = el
      if (typeof forwardedRef === "function") forwardedRef(el)
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = el
    },
    [forwardedRef]
  )
  const [focused, setFocused] = React.useState(false)
  const [caret, setCaret] = React.useState(0)
  // Fires onComplete exactly once per completed code, not again on every
  // keystroke while the field stays full (e.g. after a failed verify the
  // person selects all and types over it, which should fire again).
  const firedFor = React.useRef<string | null>(null)

  const syncCaret = React.useCallback(() => {
    const el = ownRef.current
    if (!el) return
    const pos = el.selectionStart ?? el.value.length
    setCaret(Math.min(pos, length - 1))
  }, [length])

  // Keeps the ring box in step whenever the value changes from outside
  // (a parent clearing it after a wrong try, the SMS reader filling it).
  React.useEffect(() => {
    setCaret(Math.min(value.length, Math.max(length - 1, 0)))
  }, [value, length])

  // The real input's own glyphs sit at text pitch, not under the boxes,
  // so a tap would put the caret at the end whatever box it hit. Read
  // which box the tap landed on and select that digit, so typing replaces
  // it; a tap past the last digit puts the caret after it.
  const boxesRef = React.useRef<HTMLDivElement | null>(null)
  function placeCaretAtTap(event: React.MouseEvent<HTMLInputElement>) {
    const el = ownRef.current
    const boxes = boxesRef.current?.querySelectorAll<HTMLElement>("[data-slot=otp-box]")
    if (!el || !boxes || boxes.length === 0) return
    let index = boxes.length - 1
    for (let i = 0; i < boxes.length; i++) {
      if (event.clientX <= boxes[i].getBoundingClientRect().right) {
        index = i
        break
      }
    }
    const at = Math.min(index, el.value.length)
    el.setSelectionRange(at, Math.min(at + 1, el.value.length))
    setCaret(Math.min(at, length - 1))
  }

  function clean(raw: string) {
    return raw.replace(/\D/g, "").slice(0, length)
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const digits = clean(event.target.value)
    if (digits !== value) {
      onChange(digits)
      if (digits.length === length) {
        if (firedFor.current !== digits) {
          firedFor.current = digits
          onComplete?.(digits)
        }
      } else {
        firedFor.current = null
      }
    }
    // The cleaned value can differ from what the browser just put in the
    // field (a paste with a space or a dash); the caret position the
    // browser reports is for ITS value, so re-read it after React
    // re-renders the input with the cleaned one.
    requestAnimationFrame(syncCaret)
  }

  return (
    <div
      className={cn(
        "group/otp relative flex w-full max-w-field-max min-w-0 gap-2",
        className
      )}
    >
      <div ref={boxesRef} aria-hidden="true" className="flex w-full min-w-0 gap-2">
        {Array.from({ length }, (_, i) => {
          const digit = value[i] ?? ""
          const showRing = focused && !disabled && !readOnly && i === caret
          return (
            <div
              key={i}
              data-slot="otp-box"
              data-invalid={invalid ? "true" : undefined}
              data-disabled={disabled ? "true" : undefined}
              data-focus={showRing ? "true" : undefined}
              className={cn(
                "flex h-control min-w-0 flex-1 items-center justify-center rounded-lg border border-border bg-surface text-body text-text-primary tabular-nums transition-colors duration-(--duration-fast)",
                // 6.4: a text-entry control's hover moves the border only.
                // The real input sits on top and receives the pointer, so
                // the hover comes from the group it shares with that input.
                // Only where hover exists, as Tailwind's hover: does, so a
                // tap never leaves it behind on a phone (41.9).
                "[@media(hover:hover)]:group-has-[input:not(:disabled):not(:read-only):hover]/otp:border-border-strong",
                "data-[disabled=true]:border-border-light data-[disabled=true]:bg-surface-sunken data-[disabled=true]:text-text-muted",
                "data-[invalid=true]:border-danger",
                "data-[focus=true]:border-primary-ring data-[focus=true]:outline-2 data-[focus=true]:[outline-style:solid] data-[focus=true]:outline-offset-0 data-[focus=true]:outline-primary-ring"
              )}
            >
              {digit}
            </div>
          )
        })}
      </div>
      <input
        ref={inputRef}
        data-slot="otp-field-input"
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        pattern={`[0-9]{${length}}`}
        autoComplete={autoComplete}
        enterKeyHint={enterKeyHint}
        maxLength={length}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        spellCheck={false}
        aria-invalid={invalid ? true : undefined}
        value={value}
        onChange={handleChange}
        onFocus={() => {
          setFocused(true)
          syncCaret()
        }}
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
        onKeyUp={syncCaret}
        onKeyDown={syncCaret}
        onClick={placeCaretAtTap}
        onSelect={syncCaret}
        className={cn(
          "absolute inset-0 h-full w-full cursor-text appearance-none border-0 bg-transparent p-0 text-transparent caret-transparent outline-none selection:bg-primary-subtle",
          "[-webkit-text-fill-color:transparent]",
          "disabled:cursor-default"
        )}
        {...aria}
      />
    </div>
  )
})

export { OtpField }
