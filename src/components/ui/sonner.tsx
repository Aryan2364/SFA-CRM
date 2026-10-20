"use client"

import * as React from "react"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import {
  Toaster as Sonner,
  toast as sonnerToast,
  type ExternalToast,
  type ToasterProps,
} from "sonner"

import { useLayout } from "@/lib/layout"

/**
 * Section 25.
 * Bottom right. Fixed 360px, never full width. Four seconds for a
 * simple confirmation, ten when it carries an Undo link (section
 * 38.1), and error toasts never auto-dismiss - they stay until closed.
 * Maximum three stacked. Every toast has a close button. Toasts sit
 * above dialogs (section 5.5 rule 2), on --z-toast.
 *
 * A toast never carries information available nowhere else. If the
 * user misses it, nothing is lost. A toast is a whisper, not a record.
 * General notifications ("Rakesh assigned you a task") belong in the
 * notification centre, not here (section 7.3). On phone the same holds
 * for a bulk result: "4 approved. 1 skipped, marked in the list" only
 * because the list marks it (41.6 rule 18).
 *
 * Type (section 3, and 41.9 on phone) is set in globals.css, in the
 * Toasts block: the kit's font, a toast's line in Body (a title over a
 * description in Body strong, the description in Label, text-secondary),
 * the Undo label in Label at weight 500. Sonner's own stylesheet is
 * unlayered, so a class passed from here (a layered utility) could not
 * beat its system font and 13px.
 *
 * Theme is pinned to light: section 28 says do not build a dark theme
 * until asked, and "system" would let the operating system produce a
 * half-built one.
 *
 * ON PHONE (41.8 rules 12 to 14), chosen through useLayout() and never
 * through sonner's own max-width: 600px breakpoint, which is a window
 * width and would reach a narrow desktop window:
 *   - at the bottom, centred, the screen width minus 16px each side plus
 *     the side safe areas, 16px above the tab bar or action bar and the
 *     keyboard (the bottom-bar contract in globals.css);
 *   - one at a time: a new toast replaces the one showing, unless that
 *     one is an error or an Undo. Errors stay until closed, and an Undo
 *     for its 10 seconds (38.1); the new toast shows with them, two at
 *     most, both readable (expanded, not stacked behind each other). A
 *     newer Undo replaces an older one. The replacing, and what happens
 *     when three would have to show, is done in raise() below;
 *   - a sideways swipe dismisses it, as well as its close button;
 *   - durations unchanged.
 * A foldable that changes layout mid-use re-renders this with the other
 * set of props; toasts already showing stay.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const phone = useLayout().layout === "phone"

  // 41.4 rule 10: a swipe that starts within 24px of a side edge belongs
  // to the phone's own back gesture. Sonner has no option for this, so
  // a press there that lands on a toast is stopped before React - and so
  // sonner's swipe tracking - sees it. React listens on the document; a
  // capture listener on the window runs first. A click still follows, so
  // the close button keeps working wherever it is tapped.
  React.useEffect(() => {
    if (!phone) return
    const ignoreEdgeSwipe = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return
      const x = event.clientX
      if (x > SYSTEM_EDGE && x < window.innerWidth - SYSTEM_EDGE) return
      if (!(event.target instanceof Element)) return
      if (!event.target.closest("[data-sonner-toast]")) return
      event.stopPropagation()
    }
    window.addEventListener("pointerdown", ignoreEdgeSwipe, true)
    return () => window.removeEventListener("pointerdown", ignoreEdgeSwipe, true)
  }, [phone])

  return (
    <Sonner
      theme="light"
      position={phone ? "bottom-center" : "bottom-right"}
      visibleToasts={phone ? 2 : 3}
      {...(phone ? PHONE_PROPS : null)}
      closeButton
      duration={4000}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--text-primary)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--success-bg)",
          "--success-text": "var(--success)",
          "--success-border": "var(--success-border)",
          "--warning-bg": "var(--warning-bg)",
          "--warning-text": "var(--warning)",
          "--warning-border": "var(--warning-border)",
          "--error-bg": "var(--danger-bg)",
          "--error-text": "var(--danger)",
          "--error-border": "var(--danger-border)",
          "--border-radius": "var(--radius-control)",
          // Section 25: 360px. Sonner writes its own 356px default into
          // this same inline style, so a stylesheet rule never reaches it.
          "--width": "var(--spacing-toast)",
          // Sonner's own stylesheet pins the toaster at 999999999. The
          // layer comes from the token instead (section 5.5 rule 5), and
          // inline because sonner injects its CSS unlayered.
          zIndex: "var(--z-toast)",
          ...(phone ? PHONE_STYLE : null),
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

/** 41.4 rule 10: the strip along each side edge that belongs to the phone's back gesture. */
const SYSTEM_EDGE = 24

/*
 * 41.8 rule 12 and the bottom-bar contract: 16px (space-4) above
 *   var(--bottom-bar) + var(--safe-bottom) + var(--keyboard-inset).
 * The 16px matches the side margin and the add button's 16px above the
 * tab bar (41.5 rule 7), so a toast never sits flush on a bar.
 */
const PHONE_BOTTOM =
  "calc(var(--bottom-bar) + var(--safe-bottom) + var(--keyboard-inset) + var(--spacing) * 4)"

const PHONE_PROPS = {
  // Both toasts readable when an error or an Undo and a newer toast show
  // together (41.8 rule 13). One at a time otherwise, so nothing else
  // stacks.
  expand: true,
  // space-4 between the two. Sonner's default is 14px, off the 5.1
  // scale; the desktop stack keeps it, unchanged.
  gap: 16,
  // 41.8 rule 14: sideways only. Sonner's default for a bottom position
  // is a swipe down.
  swipeDirections: ["left", "right"],
  // Sonner writes these as inline variables. Below 600px wide its own
  // stylesheet switches to the --mobile-offset-* ones and sizes each
  // toast as 100% minus twice --mobile-offset-left, so that one is 0:
  // the toast is then the toaster's full width, whatever the window.
  offset: { bottom: PHONE_BOTTOM },
  mobileOffset: { bottom: PHONE_BOTTOM, left: 0, right: 0 },
} satisfies Partial<ToasterProps>

/*
 * Each toast is 100% of the toaster on phone. --width is the one value
 * that must be inline, because sonner writes its own 356px into the same
 * inline style. The toaster's edges (16px plus the side safe areas, and
 * the 600px column held sideways, 41.13 rule 10) are in globals.css, in
 * the TOASTS ON PHONE block: sonner sets those in its unlayered
 * stylesheet, which a more specific unlayered rule beats.
 */
const PHONE_STYLE = {
  "--width": "100%",
}

/*
 * What each toast showing is, oldest first, so the phone rules in raise()
 * can decide what a new toast replaces (41.8 rule 13):
 *   - plain: a confirmation or warning. A new toast replaces it.
 *   - undo: toast.undo. Kept for its 10 seconds (38.1); only a newer
 *     Undo replaces it, because only the newest change can be undone from
 *     a toast.
 *   - error: kept until closed (25); nothing replaces it.
 * An entry leaves when its toast closes (dismissed, swiped or timed
 * out). A toast closed by its own action button skips sonner's
 * callbacks; prune() drops it once sonner has let it go.
 *
 * The bookkeeping runs on desktop too, but only the phone acts on it.
 */
type Kind = "plain" | "undo" | "error"
type Slot = {
  id: string | number
  kind: Kind
  /** Set while the toast waits to be shown (see raise); cancels the wait. */
  cancel?: () => void
}
const showing: Slot[] = []

/** Ids for toasts this file shows later, or never (see raise). */
let made = 0
const newId = () => `kit-toast-${++made}`

/*
 * The longest a new phone toast waits for a replaced one to leave
 * sonner's list. Sonner keeps a closing toast for 200ms, after two frames.
 */
const SETTLE_MAX = 500

function isPhone() {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset.layout === "phone"
  )
}

function forget(slot: Slot) {
  const i = showing.indexOf(slot)
  if (i !== -1) showing.splice(i, 1)
}

/** Drops toasts sonner has already let go of. Only reads from sonner. */
function prune() {
  const active = new Set(sonnerToast.getToasts().map((t) => t.id))
  for (const slot of [...showing]) {
    if (!slot.cancel && !active.has(slot.id)) forget(slot)
  }
  for (const entry of [...showingUndos]) {
    if (!showing.some((slot) => slot.id === entry.id)) forgetUndo(entry.id)
  }
}

/** Toast elements sonner still has in the page, closing ones included. */
function inPage() {
  return document.querySelectorAll("[data-sonner-toast]").length
}

/** Toasts showing, or waiting in sonner's stack, that are not closing. */
function live(except: Slot) {
  return showing.filter((slot) => slot !== except && !slot.cancel).length
}

/** Closes one toast, or every toast, and forgets it at once. */
function dismiss(id?: string | number) {
  if (id === undefined) {
    for (const slot of showing) slot.cancel?.()
    showing.length = 0
    showingUndos.length = 0
    return sonnerToast.dismiss()
  }
  forgetUndo(id)
  const slot = showing.find((s) => s.id === id)
  if (slot) {
    forget(slot)
    // Still waiting to be shown: it never reached sonner.
    if (slot.cancel) {
      slot.cancel()
      return id
    }
  }
  return sonnerToast.dismiss(id)
}

/**
 * Every toast goes through here. On desktop only the bookkeeping runs,
 * and sonner stacks as before, three at most.
 *
 * On phone (41.8 rule 13), a new toast (not one updated in place through
 * `options.id`):
 *   1. closes every plain toast showing: one at a time;
 *   2. if it is an Undo, also closes an older Undo: only the newest change
 *      can be undone from a toast;
 *   3. is not shown at all if it is plain while an Undo and an error both
 *      show. Both stay (38.1, 25), two is the most, and a plain toast
 *      never carries anything that is not elsewhere (25). The Undo stays
 *      reachable and the error stays in view;
 *   4. waits, when it replaced a toast beside one that stays, until the
 *      replaced one has left sonner's list (about 250ms). Sonner hides
 *      every toast past the second by its place in that list, and a
 *      closing toast keeps its place for 200ms, so without the wait the
 *      Undo or error that stays would blink out while its neighbour is
 *      replaced. The id is returned at once; dismissing it while it
 *      waits cancels it;
 *   5. once it shows, if an Undo has two newer toasts in front of it
 *      (only errors can do that: an Undo, then an error, then a second
 *      error), the Undo closes. Sonner would hide it behind the two, and
 *      its 10 seconds would run out unseen while Ctrl+Z still pressed it.
 *      An error past the second never closes: it waits in sonner's stack
 *      and comes back when one in front closes, as before.
 */
function raise(
  kind: Kind,
  show: (options: ExternalToast) => string | number,
  options: ExternalToast
): string | number {
  prune()
  const phone = isPhone()
  const updating =
    options.id !== undefined && showing.some((slot) => slot.id === options.id)

  if (phone && !updating) {
    for (const slot of [...showing]) {
      if (slot.kind === "plain" || (kind === "undo" && slot.kind === "undo")) {
        dismiss(slot.id)
      }
    }
    const has = (k: Kind) => showing.some((slot) => slot.kind === k)
    if (kind === "plain" && has("undo") && has("error")) {
      return options.id ?? newId()
    }
  }

  const slot: Slot = showing.find((s) => s.id === options.id) ?? {
    id: options.id ?? 0,
    kind,
  }
  slot.kind = kind
  if (!showing.includes(slot)) showing.push(slot)

  const withCallbacks = (o: ExternalToast): ExternalToast => ({
    ...o,
    onDismiss: (t) => {
      forget(slot)
      options.onDismiss?.(t)
    },
    onAutoClose: (t) => {
      forget(slot)
      options.onAutoClose?.(t)
    },
  })

  if (phone && !updating && live(slot) > 0 && inPage() > live(slot)) {
    slot.id = options.id ?? newId()
    const started = performance.now()
    let frame = 0
    const tick = () => {
      if (inPage() > live(slot) && performance.now() - started < SETTLE_MAX) {
        frame = requestAnimationFrame(tick)
        return
      }
      slot.cancel = undefined
      show(withCallbacks({ ...options, id: slot.id }))
    }
    slot.cancel = () => cancelAnimationFrame(frame)
    frame = requestAnimationFrame(tick)
  } else {
    slot.id = show(withCallbacks(options))
  }

  if (phone) {
    const undo = showing.findIndex((s) => s.kind === "undo")
    if (undo !== -1 && showing.length - 1 - undo >= 2) {
      dismiss(showing[undo].id)
    }
  }
  return slot.id
}

/**
 * The durations from section 25 live here rather than at every call
 * site, so no screen can raise an error toast that vanishes before it
 * has been read. They are the same on phone.
 */
function success(message: string, options?: ExternalToast) {
  return raise("plain", (o) => sonnerToast.success(message, o), {
    duration: 4000,
    ...options,
  })
}

const toast = {
  message: (message: string, options?: ExternalToast) =>
    raise("plain", (o) => sonnerToast(message, o), { duration: 4000, ...options }),

  success,

  warning: (message: string, options?: ExternalToast) =>
    raise("plain", (o) => sonnerToast.warning(message, o), {
      duration: 4000,
      ...options,
    }),

  /** Never auto-dismisses. Stays until the user closes it, on phone too. */
  error: (message: string, options?: ExternalToast) =>
    raise("error", (o) => sonnerToast.error(message, o), {
      duration: Infinity,
      ...options,
    }),

  /**
   * Sections 22.2 and 38.1: a reversible action happens at once and
   * confirms with an Undo that lasts ten seconds, the life of the toast.
   * Undo is kinder than a confirmation people click through anyway.
   *
   * `message` says what happened, in the past tense ("Client archived").
   * `onUndo` restores exactly the previous values. `undone`, when given,
   * is the confirmation shown once it has ("Client restored").
   *
   * While the toast is showing, Ctrl+Z outside a text field presses its
   * Undo (39.5) through pressShowingUndo(). Undo runs once however it is
   * pressed, and disappears with the toast. On phone a newer plain toast
   * does not replace it: the two show together for its 10 seconds (see
   * raise). A newer Undo does, and so, rarely, do two newer errors.
   */
  undo: (
    message: string,
    onUndo: () => void,
    { undone, ...options }: ExternalToast & { undone?: string } = {}
  ) => {
    const entry: UndoEntry = { id: 0, run: () => {} }
    let done = false
    entry.run = () => {
      if (done) return
      done = true
      dismiss(entry.id)
      onUndo()
      if (undone) success(undone)
    }
    entry.id = raise("undo", (o) => sonnerToast.success(message, o), {
      duration: 10000,
      action: { label: "Undo", onClick: entry.run },
      ...options,
      onDismiss: (t) => {
        forgetUndo(entry.id)
        options.onDismiss?.(t)
      },
      onAutoClose: (t) => {
        forgetUndo(entry.id)
        options.onAutoClose?.(t)
      },
    })
    showingUndos.push(entry)
    return entry.id
  },

  dismiss,
}

type UndoEntry = { id: string | number; run: () => void }

/** Undo toasts currently on screen, oldest first. On phone, one at most. */
const showingUndos: UndoEntry[] = []

function forgetUndo(id: string | number) {
  const i = showingUndos.findIndex((entry) => entry.id === id)
  if (i !== -1) showingUndos.splice(i, 1)
}

/**
 * Presses the Undo of the most recent Undo toast still showing (39.5,
 * Ctrl+Z). Returns false, and does nothing, when there is none. On phone
 * there is one Undo toast at most, and it is never hidden behind others,
 * so this is always the Undo on screen.
 */
function pressShowingUndo(): boolean {
  const entry = showingUndos.at(-1)
  if (!entry) return false
  entry.run()
  return true
}

export { Toaster, toast, pressShowingUndo }
