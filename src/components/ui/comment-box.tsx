"use client"

import * as React from "react"

import { BLEED } from "@/components/shell/content-area"
import { Button } from "@/components/ui/button"
import { enterSends } from "@/components/ui/keyboard-shortcuts"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/sonner"
import { Textarea } from "@/components/ui/textarea"
import { fieldKeyboard } from "@/lib/field-keyboard"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/**
 * FRONTEND_RULES_PHONE.md 41.6 rule 5 and 41.7 rules 6 and 11: the message
 * box on a comments screen, fixed above the keyboard, with its send
 * button.
 *
 *   - "It grows with its text up to 5 lines, then scrolls inside itself":
 *     built on Textarea (which already grows with field-sizing-content),
 *     capped at 5lh on phone only, the same technique the kit's demo
 *     comments screen used, now owned by this one component.
 *   - "On phone Enter makes a new line and the send button sends" (rule
 *     6): plain textarea behaviour on phone (Enter is never intercepted
 *     there); on desktop Enter sends and Shift+Enter makes a new line
 *     (39.2), through enterSends, which already reads the layout at the
 *     moment of the key press.
 *   - "Sending uses Button's loading state... a failed send keeps the
 *     text and shows an error toast": `onSend` is awaited; a throw shows
 *     the thrown Error's message (the caller's cause-then-next-action
 *     text, 7.2 rule 2) as an error toast, and the text is left exactly
 *     as it was, because the component never clears it itself - clearing
 *     is the caller's job, done from its own onChange once the send
 *     really succeeded (as the kit's comments screen already does).
 *   - "It takes part in the bottom-bar contract so the page's content is
 *     padded above it": on phone, the box marks itself
 *     data-fixed-bottom="action-bar" and renders an identical invisible
 *     "ghost" copy in the page's own flow, pulled up by one action bar's
 *     height, so it adds only what the box has grown past that - exactly
 *     the globals.css --bottom-bar mechanism a page's real action bar
 *     uses (components/ui/action-bar.tsx, sheet.tsx's ActionBarFrame).
 *
 * On desktop this renders a plain, non-fixed row (comments are shown
 * inline on the record's Activity tab there, 41.6 rule 5), so a caller
 * that renders this component on both layouts never has to branch itself.
 */

/** 37.6: the box's own words, replaced by a product's strings file. */
const COMMENT_BOX_TEXT = {
  label: "Comment",
  send: "Send",
  sending: "Sending",
  /** 7.2 rule 2: cause, then the next action - used only when `onSend` throws without its own message. */
  failed: "Something went wrong, so the comment was not sent. Try again.",
} as const

function CommentBox({
  value,
  onChange,
  onSend,
  label = COMMENT_BOX_TEXT.label,
  placeholder,
  disabled = false,
  className,
}: {
  value: string
  onChange: (text: string) => void
  /** Sends `value`. Throw (or reject) with an Error to report a failed send; its message is the toast. */
  onSend: () => void | Promise<void>
  label?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const { layout } = useLayout()
  const phone = layout === "phone"
  const [sending, setSending] = React.useState(false)
  const id = React.useId()

  const canSend = value.trim().length > 0 && !sending && !disabled

  const send = React.useCallback(async () => {
    if (!canSend) return
    setSending(true)
    try {
      await onSend()
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : COMMENT_BOX_TEXT.failed)
    } finally {
      setSending(false)
    }
  }, [canSend, onSend])

  const field = (
    <Textarea
      id={id}
      {...fieldKeyboard("longText")}
      className={cn(
        "min-w-0 flex-1",
        phone &&
          "phone:max-h-[calc(5lh_+_var(--spacing)_*_4_+_2px)]! phone:overflow-y-auto! phone:overscroll-y-contain"
      )}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={enterSends(send)}
    />
  )

  const sendButton = (
    <Button
      type="submit"
      disabled={!canSend}
      loading={sending}
      loadingLabel={COMMENT_BOX_TEXT.sending}
    >
      {COMMENT_BOX_TEXT.send}
    </Button>
  )

  const form = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
      className={cn(
        "flex w-full flex-col gap-2",
        // The 600px column is the phone's (41.13 rule 10); on desktop the
        // row takes its container's width, as a textarea may (4.1).
        phone ? "mx-auto max-w-phone-column p-3" : "py-3"
      )}
    >
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-end gap-2">
        {field}
        {sendButton}
      </div>
    </form>
  )

  if (!phone) {
    return (
      <div className={cn("border-t border-border-light bg-surface", className)}>{form}</div>
    )
  }

  return (
    <>
      {/* The bottom-bar contract's ghost: invisible, out of the tab
          order, holding whatever height the real box has grown past one
          action bar's (globals.css derives --bottom-bar from the real
          box's data-fixed-bottom mark alone). */}
      <div
        aria-hidden
        // React 18 (this project; the kit targets React 19) does not have
        // `inert` in its boolean-attribute allowlist, so `inert={true}`
        // (the bare-word shorthand) warns "non-boolean attribute" even
        // though the DOM attribute itself is set correctly either way. A
        // string value sidesteps that check — HTML treats `inert`'s mere
        // presence, any value, as true — but @types/react 18 still types
        // the prop as `boolean`, hence the cast.
        {...({ inert: "" } as unknown as { inert?: boolean })}
        className={cn("invisible mt-[calc(var(--h-action-bar)_*_-1)] border-t border-border-light", BLEED)}
      >
        <GhostField value={value} />
      </div>
      <div
        data-fixed-bottom="action-bar"
        className={cn(
          "fixed inset-x-0 bottom-keyboard-inset z-(--z-shell) border-t border-border-light bg-surface pr-safe-right pb-safe-bottom pl-safe-left",
          className
        )}
      >
        {form}
      </div>
    </>
  )
}

/** The ghost copy: same text, so it grows line for line with the real box, but reachable by nobody. */
function GhostField({ value }: { value: string }) {
  const id = React.useId()
  return (
    <div className="mx-auto flex w-full max-w-phone-column flex-col gap-2 p-3">
      <Label htmlFor={id}>{COMMENT_BOX_TEXT.label}</Label>
      <div className="flex items-end gap-2">
        <Textarea
          id={id}
          tabIndex={-1}
          readOnly
          value={value}
          className="phone:max-h-[calc(5lh_+_var(--spacing)_*_4_+_2px)]! phone:overflow-y-auto! phone:overscroll-y-contain min-w-0 flex-1"
        />
        <Button type="button" tabIndex={-1}>
          {COMMENT_BOX_TEXT.send}
        </Button>
      </div>
    </div>
  )
}

export { CommentBox, COMMENT_BOX_TEXT }
