"use client"

import * as React from "react"
import { TriangleAlertIcon, XIcon } from "lucide-react"

import { useLayout } from "@/lib/layout"
import { useAppBarOverride } from "@/components/shell/app-bar"
import { ActionBar } from "@/components/ui/action-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InlineFieldError } from "@/components/ui/inline-field-error"
import { Label } from "@/components/ui/label"
import { type Noun, type PhoneListSelection } from "@/components/ui/phone-list"
import { formatCount, formatNumber } from "@/lib/format"
import { useLayerHistory } from "@/components/ui/sheet"
import { toast } from "@/components/ui/sonner"
import { Textarea } from "@/components/ui/textarea"
import { useUnsavedChanges } from "@/components/ui/unsaved-changes"

/**
 * Section 41.6 rules 14 to 19 - approving several at once, on phone.
 *
 * A list of items waiting for approval (My work's approvals included,
 * 41.15) offers **Select** in the app bar. Select mode puts a tick box on
 * every row, and tapping a row then ticks it instead of opening it
 * (PhoneList draws the ticks from `selection`). The tab bar hides, the
 * app bar shows "5 selected" with a close button (x) on the left, and the
 * action bar shows "Reject" and "Approve 5". Select mode is for approve
 * and reject only (rule 19); every other bulk action is section 22's, on
 * the computer.
 *
 *   const approvals = useApprovalSelection({
 *     rows, rowKey: (r) => r.id,
 *     reasonFor: (r) => (r.can.approve === true ? null : r.can.approve),
 *     onApprove, onReject, undoApprove,
 *     noun: { one: "request", many: "requests" },
 *     reasonRequired: true,
 *   })
 *   <PageHeader title="Approvals" appBarActions={approvals.selectButton} />
 *   <PhoneList ... selection={approvals.selection}
 *     renderRow={(r) => <PhoneListRow ... warning={approvals.skippedBadge(r.id)} />}
 *     onRefresh={async () => { await reload(); approvals.clearSkipped() }} />
 *   {approvals.elements}
 *
 * WHAT THE CALLER OWNS
 *
 *   - When Select shows (41.6 rule 14): pass `selectButton` as the app
 *     bar's actions only while the list is one of items waiting for
 *     approval - on My work, only while its Approvals chip is chosen,
 *     where it takes search's place (41.4 rule 4). It is one text button,
 *     the app bar's whole right slot.
 *   - Whether each row can be approved: `reasonFor(row)` is the record's
 *     own answer from the server (26.5), null when it can be; never
 *     worked out in the browser (41.3 rule 3).
 *   - The list itself: onApprove and onReject take the items done out of
 *     `rows` (41.6 rule 12: the item gone), and undoApprove puts them
 *     back. Each settles once the server has answered. Give each request
 *     a deadline (14 rule 4). How each answer is read:
 *       - It resolves with what was done. An item someone else acted on
 *         first is not a failure: it comes back in `skipped`, with the
 *         server's plain words for what happened, "Approved by Suresh
 *         Patel" (26.5 rule 5).
 *       - THE SERVER REFUSED THE WHOLE REQUEST and said why - a 403, now
 *         not allowed (26.4 rule 4), or a 409, a workflow rule (26.5 rule
 *         5): either resolve with `refused` set to the server's plain
 *         sentence, or reject with a RefusedError (exported here; a
 *         product's own error class may extend it) whose message is that
 *         sentence. The error toast then shows that sentence, never
 *         "check your connection": trying again will not change the
 *         answer. Nothing was done, so there is no Undo; select mode and
 *         the ticks stay (a tick whose row's answer has turned to no drops
 *         by itself once the list reloads), and the reject sheet closes.
 *       - ANY OTHER REJECTION is read as the request failing - no
 *         connection, a timeout - and gets the connection words: "... could
 *         not be approved. Check your connection and try again." Nothing is
 *         lost: select mode, the ticks and a typed reason stay (41.14 rule
 *         7). An Error's own message is never shown, because it is not
 *         known to be plain words (7.2 rule 3): only a RefusedError's is.
 *   - `elements`, rendered once, last in the page (39.1): the select-mode
 *     app bar, the action bar, the reject sheet and its unsaved-changes
 *     warning.
 *   - clearSkipped() when the list reloads (rule 18): until then a
 *     skipped item stays in the list, marked.
 *
 * WHAT THIS DOES
 *
 *   - At most 50 ticked (rule 16). A row that cannot be approved cannot
 *     be ticked: its tick is disabled, with the reason on tap
 *     (permission-tooltip.tsx through PhoneListRow, 41.8 rule 17). Once
 *     50 are ticked, every other tick disables with "50 is the most at
 *     once". A skipped row cannot be ticked again either: its reason is
 *     what happened to it.
 *   - Ticks persist (22.1, on phone too). A tick on a row that a search
 *     or a chip has hidden stays ticked - it is not in `rows` now, but it
 *     was ticked where the person could see it - and "5 selected",
 *     "Approve 5" and the 50 limit count every tick, shown or not. A
 *     shown row whose answer turns to no (a reload) loses its tick. A row
 *     hidden because a reload dropped it is the server's to report: it
 *     comes back in `skipped` like any item acted on first.
 *   - Approve applies to every ticked item at once, with ONE Undo toast
 *     for all (rule 17, 38.1): "5 requests approved", or with some
 *     skipped, "4 approved. 1 skipped, marked in the list." (rule 18).
 *     The toast never carries what the list does not show (25): the
 *     skipped items stay in the list with a warning badge naming what
 *     happened (skippedBadge). Undo calls undoApprove with the items
 *     approved, never the skipped ones (41.20 check 15).
 *   - Reject asks once for a reason in RejectReasonSheet (below), which
 *     applies to all (rules 11 and 17). Its primary button names the
 *     action, "Reject 5 requests". With `undoReject`, the reject toast
 *     carries Undo too (41.6 rule 12); without it, a plain confirmation.
 *   - ANDROID BACK LEAVES SELECT MODE FIRST (decision 17, 41.4 rule 9):
 *     select mode holds one history entry, through sheet.tsx's layer
 *     machinery (useLayerHistory) like any open sheet. Back removes it and
 *     leaves select mode, the ticks cleared; only the next back leaves the
 *     page. Leaving select mode any other way - the x, after approving or
 *     rejecting, the caller's leave() - removes the entry quietly. While a
 *     request runs, back keeps select mode (the entry is put back), as
 *     the ticks do not change then.
 *   - Leaving select mode (the x) clears the ticks. After approving or
 *     rejecting, select mode ends.
 *   - While a request runs, its button shows the loading state and both
 *     buttons are disabled (14 rule 2); ticks do not change.
 *   - Focus (39.3): entering puts it on the close button, leaving on
 *     Select - only where the button the person used has vanished with
 *     the mode, never pulled from where they put it.
 *   - Not built: the store app's light vibration on approve and reject
 *     (41.9 rule 13) - Capacitor is not in the kit yet (41.19).
 *
 * PHONE ONLY. On desktop it returns no button, no selection and no
 * elements, and `active` is false: bulk selection on the computer is
 * section 22's, not this. A foldable opened mid-way leaves select mode
 * there; the ticks are not carried over.
 */

/** 41.6 rule 16: at most 50 at once. */
const MAX_AT_ONCE = 50

/**
 * The server refused the whole request and said why, in plain words (26.4
 * rule 4, 26.5 rule 5). Throw it - or a product's own error class that
 * extends it - from onApprove, onReject or RejectReasonSheet's onSubmit
 * with the server's sentence as the message: "You can no longer approve
 * orders. Ask an administrator if you need it." The error toast shows that
 * sentence. Any other error reads as a failed request (no connection),
 * whose message is never shown.
 */
class RefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RefusedError"
  }
}

/** The server's plain reason, when this is a refusal it explained; otherwise null. */
function refusalOf(error: unknown): string | null {
  return error instanceof RefusedError && error.message.trim() !== "" ? error.message : null
}

/** What onApprove and onReject settle with. */
type ApprovalResult = {
  /** The keys acted on. */
  done: string[]
  /** Keys someone else acted on first, each with what happened: "Approved by Suresh Patel". */
  skipped: { key: string; reason: string }[]
  /**
   * The server refused the whole request, in its plain words (26.4 rule 4,
   * 26.5 rule 5). Nothing was done; `done` and `skipped` are not read.
   */
  refused?: string
}

type ApprovalSelectionOptions<Row> = {
  /** The rows in the list now: PhoneList's rows. */
  rows: Row[]
  /** The same key PhoneList's rowKey gives: the record's id. */
  rowKey: (row: Row) => string
  /**
   * Why this row cannot be approved, from the record's own answer (26.5);
   * null when it can be.
   */
  reasonFor: (row: Row) => string | null
  /** Approves these keys, all at once. */
  onApprove: (keys: string[]) => Promise<ApprovalResult>
  /** Rejects these keys, all at once, with the one reason ("" when none was asked for). */
  onReject: (keys: string[], reason: string) => Promise<ApprovalResult>
  /** Undo (38.1): restores exactly what was approved. */
  undoApprove: (keys: string[]) => Promise<void>
  /** Optional: Undo for a reject (41.6 rule 12). Without it the reject toast has no Undo. */
  undoReject?: (keys: string[]) => Promise<void>
  /** "request", "requests". */
  noun: Noun
  /** The product requires a reason to reject (41.6 rule 11). */
  reasonRequired?: boolean
}

type ApprovalSelection = {
  /** Select mode is on. Always false on desktop. */
  active: boolean
  /** The app bar's "Select" (41.4 rule 4). undefined on desktop and in select mode. */
  selectButton: React.ReactNode
  /** PhoneList's `selection` while select mode is on; undefined otherwise. */
  selection: PhoneListSelection | undefined
  /** Render once, last in the page: select mode's app bar, action bar and reject sheet. */
  elements: React.ReactNode
  /** What happened to a skipped item (41.6 rule 18), or null. */
  skippedReason: (key: string) => string | null
  /** The warning badge for PhoneListRow's `warning` slot, or undefined. */
  skippedBadge: (key: string) => React.ReactNode
  /** Forget the skipped marks: call it when the list reloads (41.6 rule 18). */
  clearSkipped: () => void
  /** Leave select mode, clearing the ticks. */
  leave: () => void
}

/* ------------------------------------------------------------------
   Words (section 37), in one place for the product's strings file
   (37.6 rule 2, not built yet).
   ------------------------------------------------------------------ */

function counted(n: number, noun: Noun) {
  return formatCount(n, noun)
}

/** "the request is" or "the 4 requests are". */
function theCounted(n: number, noun: Noun, verb: { one: string; many: string }) {
  return n === 1 ? `the ${noun.one} ${verb.one}` : `the ${formatNumber(n)} ${noun.many} ${verb.many}`
}

const WORDS = {
  select: "Select",
  leave: "Leave select mode",
  selected: (n: number) => `${formatNumber(n)} selected`,
  bar: "Approve or reject",
  approve: (n: number) => (n > 0 ? `Approve ${formatNumber(n)}` : "Approve"),
  approving: "Approving",
  reject: "Reject",
  rejectSome: (n: number, noun: Noun) => `Reject ${counted(n, noun)}`,
  rejecting: "Rejecting",
  cancel: "Cancel",
  reason: "Reason",
  reasonMissing: "A reason is needed to reject. Enter what needs to change.",
  limit: `${MAX_AT_ONCE} is the most at once`,
  /** 41.6 rules 17 and 18. */
  outcome: (verb: "approved" | "rejected", done: number, skipped: number, noun: Noun) =>
    skipped === 0
      ? `${counted(done, noun)} ${verb}`
      : `${formatNumber(done)} ${verb}. ${formatNumber(skipped)} skipped, marked in the list.`,
  undone: (what: "Approval" | "Rejection", n: number, noun: Noun) =>
    `${what} undone for ${counted(n, noun)}`,
  undoFailed: (state: "approved" | "rejected", n: number, noun: Noun) =>
    `Undo did not go through, so ${theCounted(n, noun, { one: "is", many: "are" })} still ${state}. Check your connection, then reopen ${n === 1 ? "it from its own page" : "them from their own pages"}.`,
  failed: (action: "approved" | "rejected", n: number, noun: Noun) =>
    `${capitalise(theCounted(n, noun, { one: "could", many: "could" }))} not be ${action}. Check your connection and try again.`,
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/* ------------------------------------------------------------------
   The reject sheet - 41.6 rules 11 and 17, for a list and for one record.
   ------------------------------------------------------------------ */

type RejectReasonSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs once it has finished opening or closing (Base UI's onOpenChangeComplete). */
  onOpenChangeComplete?: (open: boolean) => void
  /** The sheet's title: "Reject 5 requests", "Reject order ORD-2140". */
  title: string
  /** Its primary button, naming the action (41.6 rule 11): "Reject 5 requests", "Reject order". */
  actionLabel: string
  /** The product requires a reason to reject (41.6 rule 11). */
  reasonRequired?: boolean
  /**
   * Rejects with this reason (trimmed; "" when none was given).
   *
   *   - Resolve once it is done - or once the caller has shown a refusal
   *     the server explained, after which trying again would not help:
   *     the sheet clears its reason and closes.
   *   - Reject when it failed and pressing again may work (no connection,
   *     a timeout), after showing the error toast yourself: the sheet
   *     stays open with the reason exactly as typed (41.14 rule 7).
   */
  onSubmit: (reason: string) => Promise<void>
  /** The field's label. "Reason" unless given. */
  label?: string
  /** The primary button's words while it works (14 rule 2). "Rejecting" unless given. */
  busyLabel?: string
}

/**
 * The reason to reject, asked for once (41.6 rules 11 and 17): the one
 * reject sheet, used by useApprovalSelection for several items and by a
 * single record's Reject.
 *
 *   - A small dialog, so a bottom sheet on phone (41.8 rule 10) and the
 *     small centred dialog on desktop (24). Cancel on the left, the
 *     primary on the right, named for the action (11.3 rule 7, 37.2).
 *   - The reason is required when `reasonRequired`: checked on leaving
 *     the field and on pressing the primary (11.3 rule 6), with the error
 *     below the field, and focus moved to it on a failed press (39.3).
 *   - While onSubmit runs, the primary shows its loading state and is
 *     disabled (14 rule 2); a second press does nothing.
 *   - Closing it with a reason typed asks first (11.3 rule 10: a dialog
 *     recording an action is a create form, "Leave this form?"), and
 *     Leave discards the reason. It opens empty every time.
 *   - On phone the sheet takes focus itself, never the field (41.8 rule
 *     19), so the keyboard opens only when the person taps the field.
 */
function RejectReasonSheet({
  open,
  onOpenChange,
  onOpenChangeComplete,
  title,
  actionLabel,
  reasonRequired = false,
  onSubmit,
  label = WORDS.reason,
  busyLabel = WORDS.rejecting,
}: RejectReasonSheetProps) {
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  // A second press in the same frame, before `busy` has rendered.
  const busyRef = React.useRef(false)
  const fieldRef = React.useRef<HTMLTextAreaElement | null>(null)
  const formId = React.useId()
  const fieldId = React.useId()
  const errorId = React.useId()

  // Opens empty, every time. Reset while rendering the open, not when
  // closing: the exit animation keeps what it showed.
  const [wasOpen, setWasOpen] = React.useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setReason("")
      setError(null)
    }
  }

  const discard = () => {
    setReason("")
    setError(null)
  }

  const unsaved = useUnsavedChanges({ changed: reason.trim() !== "", noun: "form", mode: "create" })

  /** 11.3 rule 6: checked on leaving the field, and on pressing the primary. */
  const missing = () => reasonRequired && reason.trim() === ""

  const submit = async () => {
    if (busyRef.current) return
    if (missing()) {
      setError(WORDS.reasonMissing)
      // 39.3: a failed save puts focus on the field with the error.
      fieldRef.current?.focus()
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      await onSubmit(reason.trim())
      discard()
      onOpenChange(false)
    } catch {
      // The caller has said why; the sheet and the reason stay (41.14 rule 7).
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={unsaved.guard(onOpenChange, discard)}
        onOpenChangeComplete={onOpenChangeComplete}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <form
            id={formId}
            noValidate
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <Label htmlFor={fieldId} required={reasonRequired}>
              {label}
            </Label>
            <div>
              <Textarea
                ref={fieldRef}
                id={fieldId}
                value={reason}
                aria-required={reasonRequired || undefined}
                aria-invalid={error !== null || undefined}
                aria-describedby={error !== null ? errorId : undefined}
                onChange={(event) => {
                  setReason(event.target.value)
                  // Raised on leaving the field (11.3 rule 6); taken away
                  // as soon as it no longer holds.
                  if (error !== null && event.target.value.trim() !== "") setError(null)
                }}
                onBlur={() => {
                  if (missing()) setError(WORDS.reasonMissing)
                }}
              />
              <InlineFieldError id={errorId}>{error}</InlineFieldError>
            </div>
          </form>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>{WORDS.cancel}</DialogClose>
            <Button type="submit" form={formId} loading={busy} loadingLabel={busyLabel}>
              {actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {unsaved.warning}
    </>
  )
}

/* ------------------------------------------------------------------
   Select mode's app bar - 41.4 rules 2 and 4, 41.6 rule 15.
   ------------------------------------------------------------------ */

/**
 * Puts "5 selected" and the close button over the page's app bar, with no
 * actions, and hides the tab bar, while mounted. Its own component, so
 * the override is written from here and not from the page (app-bar.tsx:
 * writer and reader kept apart). `leading` is memoised by the hook, so an
 * unchanged count writes nothing.
 */
function SelectModeAppBar({ title, leading }: { title: string; leading: React.ReactNode }) {
  useAppBarOverride({ leading, title, actions: null, hideTabBar: true })
  return null
}

/**
 * Where focus goes once a mode change has drawn its buttons (39.3), and
 * when that was asked: a button that turns up much later (Select coming
 * back with the Pending chip) must not take focus for a change long past.
 */
type FocusAfter = { to: "close" | "select"; at: number }

/** The app bar's buttons are drawn within a frame or two of the change. */
const FOCUS_AFTER_MS = 1000

/** Focus is nowhere: the element that held it has gone. */
function focusLost() {
  const at = document.activeElement
  return at === null || at === document.body
}

/* ------------------------------------------------------------------
   The hook.
   ------------------------------------------------------------------ */

function useApprovalSelection<Row>({
  rows,
  rowKey,
  reasonFor,
  onApprove,
  onReject,
  undoApprove,
  undoReject,
  noun,
  reasonRequired = false,
}: ApprovalSelectionOptions<Row>): ApprovalSelection {
  const phone = useLayout().layout === "phone"

  const [on, setOn] = React.useState(false)
  const [ticked, setTicked] = React.useState<string[]>([])
  const [skipped, setSkipped] = React.useState<ReadonlyMap<string, string>>(() => new Map())
  const [busy, setBusy] = React.useState<"approve" | "reject" | null>(null)
  // A second press in the same frame, before `busy` has rendered.
  const busyRef = React.useRef(false)

  const [rejectOpen, setRejectOpen] = React.useState(false)
  // The keys the open reject sheet is for, kept while it slides out after
  // select mode has ended, so its title does not change under the person.
  const [rejectKeys, setRejectKeys] = React.useState<string[]>([])

  const active = phone && on
  // Read by leave(), which is stable and runs outside render.
  const activeRef = React.useRef(active)
  React.useLayoutEffect(() => {
    activeRef.current = active
  })

  /* -- What can be ticked (41.6 rule 16) ---------------------------- */

  const byKey = React.useMemo(() => new Map(rows.map((row) => [rowKey(row), row])), [rows, rowKey])

  /**
   * Why this row cannot be ticked, whatever the count: skipped, or the
   * record's answer. null for a row not in the list now (hidden by a
   * search or a chip): it was tickable when ticked, and the server
   * answers for it when the batch is sent.
   */
  const blocked = (key: string): string | null => {
    const row = byKey.get(key)
    if (row === undefined) return null
    return skipped.get(key) ?? reasonFor(row)
  }

  // Every tick counts, shown or hidden (22.1): only a shown row whose
  // answer has turned to no (a reload) drops its tick.
  const chosen = ticked.filter((key) => blocked(key) === null)
  const chosenSet = new Set(chosen)
  const count = chosen.length

  /* -- Focus (39.3) -------------------------------------------------- */

  // The button tapped disappears as the mode changes, which leaves focus
  // on nothing. The buttons of the new mode reach the app bar a commit
  // later (through useAppBarOverride), so each takes focus from its own
  // ref callback as it is drawn - never from an effect, which runs before
  // the override has drawn them.
  const focusAfter = React.useRef<FocusAfter | null>(null)
  const selectNode = React.useRef<HTMLButtonElement | null>(null)

  const takeFocus = React.useCallback((to: FocusAfter["to"], node: HTMLButtonElement | null) => {
    const wanted = focusAfter.current
    if (!node || wanted?.to !== to) return
    if (performance.now() - wanted.at > FOCUS_AFTER_MS) {
      focusAfter.current = null
      return
    }
    // The override draws the same button in the page's app bar and in the
    // shell's fallback bar, which CSS hides: only the one shown takes it.
    if (node.getClientRects().length === 0) return
    focusAfter.current = null
    if (focusLost()) node.focus()
  }, [])

  const setCloseNode = React.useCallback(
    (node: HTMLButtonElement | null) => takeFocus("close", node),
    [takeFocus]
  )
  const setSelectNode = React.useCallback(
    (node: HTMLButtonElement | null) => {
      selectNode.current = node
      takeFocus("select", node)
    },
    [takeFocus]
  )

  /* -- Entering and leaving ----------------------------------------- */

  const enter = React.useCallback(() => {
    // Focus on Select (or nowhere, a tap that focuses nothing): Select
    // vanishes as the mode starts, so the close button takes it.
    const from = document.activeElement
    focusAfter.current =
      focusLost() || from === selectNode.current ? { to: "close", at: performance.now() } : null
    setTicked([])
    setOn(true)
  }, [])

  const leave = React.useCallback(() => {
    // Only a real leaving: a caller's leave() outside select mode (a chip
    // change) leaves focus alone.
    if (activeRef.current) focusAfter.current = { to: "select", at: performance.now() }
    setOn(false)
    setTicked([])
  }, [])

  const toggle = (key: string) => {
    if (busyRef.current) return
    if (chosenSet.has(key)) {
      setTicked(chosen.filter((k) => k !== key))
      return
    }
    if (blocked(key) !== null || count >= MAX_AT_ONCE) return
    setTicked([...chosen, key])
  }

  /*
   * Android back (decision 17, 41.4 rule 9): select mode is a layer, with
   * one history entry while on. Back removes it and leaves select mode;
   * while a request runs it keeps select mode, and the entry is put back.
   * Leaving any other way removes the entry through the layer queue.
   */
  useLayerHistory(active, () => {
    if (busyRef.current) return "canceled"
    leave()
    return "accepted"
  })

  /* -- Skipped items (41.6 rule 18) ---------------------------------- */

  const markSkipped = (list: ApprovalResult["skipped"]) => {
    if (list.length === 0) return
    setSkipped((prev) => {
      const next = new Map(prev)
      for (const item of list) next.set(item.key, item.reason)
      return next
    })
  }

  const skippedReason = (key: string) => (byKey.has(key) ? (skipped.get(key) ?? null) : null)

  const skippedBadge = (key: string) => {
    const what = skippedReason(key)
    if (what === null) return undefined
    return (
      <Badge variant="warning" className="max-w-full">
        <TriangleAlertIcon aria-hidden />
        <span className="min-w-0 truncate">{what}</span>
      </Badge>
    )
  }

  const clearSkipped = React.useCallback(() => setSkipped(new Map()), [])

  /* -- The toasts (38.1, 41.6 rules 17 and 18) ----------------------- */

  const announce = (
    verb: "approved" | "rejected",
    result: ApprovalResult,
    undo: ((keys: string[]) => Promise<void>) | undefined
  ) => {
    const done = result.done
    const message = WORDS.outcome(verb, done.length, result.skipped.length, noun)
    if (done.length === 0) {
      // Every one was acted on first by someone else: nothing to undo.
      toast.warning(message)
      return
    }
    if (!undo) {
      toast.success(message)
      return
    }
    // One Undo for all of them; it restores only what this press did.
    toast.undo(message, () => {
      undo(done).then(
        () => toast.success(WORDS.undone(verb === "approved" ? "Approval" : "Rejection", done.length, noun)),
        () => toast.error(WORDS.undoFailed(verb, done.length, noun))
      )
    })
  }

  /**
   * Sends one batch and reads its answer (WHAT THE CALLER OWNS): done,
   * refused with the server's reason, or failed. Resolves true when it
   * went through, false when the server refused it; rejects when it
   * failed, after the error toast. `alsoClose` runs with the leaving of
   * select mode, in the same update: the reject sheet closing with it, so
   * the layer queue takes both history entries in one step.
   */
  const send = async (
    verb: "approved" | "rejected",
    keys: string[],
    request: () => Promise<ApprovalResult>,
    undo: ((keys: string[]) => Promise<void>) | undefined,
    alsoClose?: () => void
  ): Promise<boolean> => {
    let result: ApprovalResult
    try {
      result = await request()
    } catch (error) {
      const refused = refusalOf(error)
      if (refused !== null) {
        toast.error(refused)
        return false
      }
      // 41.14 rule 7: nothing is lost - the ticks stay, press again.
      toast.error(WORDS.failed(verb, keys.length, noun))
      throw error
    }
    if (result.refused !== undefined && result.refused.trim() !== "") {
      toast.error(result.refused)
      return false
    }
    markSkipped(result.skipped)
    leave()
    alsoClose?.()
    announce(verb, result, undo)
    return true
  }

  /* -- Approve (41.6 rules 10, 17 and 18) ----------------------------- */

  const approve = async () => {
    if (busyRef.current || count === 0) return
    const keys = chosen
    busyRef.current = true
    setBusy("approve")
    try {
      await send("approved", keys, () => onApprove(keys), undoApprove)
    } catch {
      // Already told (send). Select mode and the ticks stay.
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  /* -- Reject (41.6 rules 11 and 17) ---------------------------------- */

  const openReject = () => {
    if (busyRef.current || count === 0) return
    setRejectKeys(chosen)
    setRejectOpen(true)
  }

  /** RejectReasonSheet's onSubmit: resolves to close the sheet, rejects to keep it. */
  const reject = async (reason: string) => {
    const keys = rejectKeys
    busyRef.current = true
    setBusy("reject")
    try {
      // Done or refused, the sheet closes; failed, it stays (send rejects).
      await send("rejected", keys, () => onReject(keys, reason), undoReject, () =>
        setRejectOpen(false)
      )
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  /* -- What the caller renders ---------------------------------------- */

  const selectButton = React.useMemo(
    () => (
      // 41.4 rule 4: one text button, on the band - the on-brand text
      // button draws its 1px on-brand-muted border (6.1 rule 5). The app
      // bar pins it to its fixed height and type (41.4 rule 1).
      <Button ref={setSelectNode} variant="on-brand" onClick={enter}>
        {WORDS.select}
      </Button>
    ),
    [enter, setSelectNode]
  )

  const closeButton = React.useMemo(
    () => (
      // 41.4 rule 2 and 41.6 rule 15: the close (x) on the left, the bar's
      // fixed 44px, on-brand (6.3.2). No tooltip: x is in the phone icon
      // set (41.9 rule 9), and a phone has none (41.8 rule 16).
      <Button
        ref={setCloseNode}
        variant="on-brand"
        size="icon"
        className="size-bar-button!"
        aria-label={WORDS.leave}
        onClick={leave}
      >
        <XIcon aria-hidden className="size-icon-empty" />
      </Button>
    ),
    [leave, setCloseNode]
  )

  const selection: PhoneListSelection | undefined = active
    ? {
        isSelected: (key) => chosenSet.has(key),
        toggle,
        reasonFor: (key) =>
          blocked(key) ?? (!chosenSet.has(key) && count >= MAX_AT_ONCE ? WORDS.limit : null),
      }
    : undefined

  const approving = busy === "approve"

  const elements = phone ? (
    <>
      {active ? (
        <>
          <SelectModeAppBar title={WORDS.selected(count)} leading={closeButton} />
          {/* 41.6 rules 8 and 15: Reject secondary on the left, Approve
              primary on the right, sharing the width. */}
          <ActionBar label={WORDS.bar}>
            <Button variant="secondary" disabled={count === 0 || busy !== null} onClick={openReject}>
              {WORDS.reject}
            </Button>
            <Button
              disabled={count === 0 || busy !== null}
              loading={approving}
              loadingLabel={WORDS.approving}
              onClick={approve}
            >
              {WORDS.approve(count)}
            </Button>
          </ActionBar>
        </>
      ) : null}

      {/* Mounted for as long as the phone layout, so it closes the way a
          sheet closes - its history entry and its slide out - even as
          select mode ends under it (decision 10). */}
      <RejectReasonSheet
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={WORDS.rejectSome(rejectKeys.length, noun)}
        actionLabel={WORDS.rejectSome(rejectKeys.length, noun)}
        reasonRequired={reasonRequired}
        onSubmit={reject}
      />
    </>
  ) : null

  return {
    active,
    selectButton: phone && !active ? selectButton : undefined,
    selection,
    elements,
    skippedReason,
    skippedBadge,
    clearSkipped,
    leave,
  }
}

export { useApprovalSelection, RejectReasonSheet, RefusedError, MAX_AT_ONCE }
export type {
  ApprovalResult,
  ApprovalSelection,
  ApprovalSelectionOptions,
  RejectReasonSheetProps,
}
