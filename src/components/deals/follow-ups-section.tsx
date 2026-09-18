'use client'

/**
 * P2-T9 — the Deal's Follow-ups section (REBUILD-PLAN.md §4.5).
 *
 * The Deal detail page carried a read-only list of follow-ups; this replaces it
 * with the working section: add, edit, mark Done, re-open and delete, all
 * against the routes P2-T5 already built —
 *
 *   GET    /api/deals/[id]/follow-ups        bare array, earliest due first
 *   POST   /api/deals/[id]/follow-ups        due_date + mode compulsory
 *   PATCH  /api/deals/[id]/follow-ups/[fid]  allow-listed keys
 *   DELETE /api/deals/[id]/follow-ups/[fid]
 *
 * Three things the routes decide and this file must not second-guess:
 *
 *   1. `completed_at` is DERIVED from `status` server-side. This never sends
 *      it, and never renders an editable "Completed On" field — §4.5 lists it
 *      as a field, but it is a fact about when Done was pressed, and a form
 *      that can set the two apart produces rows that are Done with no
 *      completion time.
 *   2. `due_date` is `@db.Date` on the wire as "YYYY-MM-DD". A `Date` put
 *      through `toISOString()` shifts a day backwards for anyone east of UTC,
 *      so the wire string is built from the LOCAL date parts (`toWireDate`).
 *   3. `visit_id` is left alone. The Meeting→Minutes auto-pull is Phase 3.
 *
 * ---------------------------------------------------------------------------
 * "THE EARLIEST OPEN FOLLOW-UP IS WHAT SHOWS ON THE CARD"
 *
 * The list/Kanban gets that from `next_follow_up`, computed server-side in
 * `shapeDeal()`. This section must agree with it or the two screens disagree
 * about the same deal, so `nextOpenId` applies the identical rule — earliest
 * `due_date` among rows whose status is not `done` — and marks that one row
 * "Next up". It is derived from the rendered list, never stored, so it moves
 * the moment a row is completed or a nearer one is added.
 *
 * ---------------------------------------------------------------------------
 * "ON MARKING ONE DONE, PROMPT FOR THE NEXT DATE — PROMPT ONLY"
 *
 * The completion is committed FIRST and on its own. Only then does the
 * scheduling dialog open, pre-filled and dismissible: Escape, the backdrop,
 * the close button and "Not now" all leave the deal with the follow-up done
 * and no successor. Nothing about the prompt can fail the completion, which is
 * what makes it a prompt rather than a two-step form.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckIcon,
  ClockIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Label } from '@/components/ui/label'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'
import { EMPTY, fmtDate, fmtDateTime, parseApiDate } from '@/lib/format'

/** The row as the API returns it (`serialize(rows, 'deal_follow_ups')`). */
export type FollowUp = {
  id: string
  due_date: string | null
  mode: string | null
  status: string
  notes: string | null
  completed_at: string | null
}

/**
 * §4.5's five modes. Mirrors `FOLLOW_UP_MODES` in `api/deals/_shape.ts`, which
 * is the validator — a value not in that list is a 400, so the two lists must
 * not drift. Five options, one under the six past which section 16.3 wants a
 * SearchableSelect instead.
 */
const MODES = ['Meeting', 'Call', 'Email', 'WhatsApp', 'Other'] as const

/** How far ahead the "schedule the next one" prompt suggests. A suggestion. */
const NEXT_FOLLOW_UP_SUGGESTION_DAYS = 7

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** Date-only on both sides: a follow-up due TODAY is not yet overdue (§10). */
function isOverdue(dueDate: string | null | undefined): boolean {
  const due = parseApiDate(dueDate ?? null)
  if (!due) return false
  return due.getTime() < startOfToday().getTime()
}

/**
 * A `Date` picked in the browser → the "YYYY-MM-DD" the `@db.Date` column
 * wants.
 *
 * NOT `toISOString().slice(0, 10)`: that converts to UTC first, so a date
 * picked as the 5th in IST (UTC+5:30) is sent as the 4th. The local parts are
 * exactly what the user chose in the calendar.
 */
function toWireDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

/** "YYYY-MM-DD" → a local midnight `Date` for the picker. */
function fromWireDate(value: string | null): Date | undefined {
  return parseApiDate(value) ?? undefined
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** `—` for absent, never a blank line and never "null". */
function orEmpty(value: string | null | undefined) {
  return value && value.trim() !== '' ? value : EMPTY
}

// ─────────────────────────────────────────────────────────────
// The form, shared by three dialogs
//
// Add, Edit and "schedule the next one" ask for the same three things, so they
// are one form rather than three that drift apart. The dialogs differ only in
// their title, their wording and what pressing the primary button does.
// ─────────────────────────────────────────────────────────────

type FormState = { due: Date | undefined; mode: string; notes: string }

const BLANK_FORM: FormState = { due: undefined, mode: '', notes: '' }

function FollowUpFields({
  idPrefix,
  form,
  onChange,
  errors,
}: {
  idPrefix: string
  form: FormState
  onChange: (next: FormState) => void
  errors: Record<string, string>
}) {
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 sm:col-span-6">
        <Label htmlFor={`${idPrefix}-due`}>Due date</Label>
        <div className="mt-1.5">
          <DatePicker
            id={`${idPrefix}-due`}
            value={form.due}
            invalid={Boolean(errors.due_date)}
            onValueChange={due => onChange({ ...form, due })}
          />
        </div>
        <InlineFieldError>{errors.due_date}</InlineFieldError>
      </div>

      <div className="col-span-12 sm:col-span-6">
        <Label htmlFor={`${idPrefix}-mode`}>Mode</Label>
        <div className="mt-1.5">
          <Select
            value={form.mode || null}
            onValueChange={(value: unknown) =>
              onChange({ ...form, mode: (value as string) ?? '' })
            }
          >
            <SelectTrigger id={`${idPrefix}-mode`} aria-invalid={errors.mode ? true : undefined}>
              <SelectValue placeholder="How will you follow up?" />
            </SelectTrigger>
            <SelectContent>
              {MODES.map(mode => (
                <SelectItem key={mode} value={mode}>
                  {mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <InlineFieldError>{errors.mode}</InlineFieldError>
      </div>

      <div className="col-span-12">
        <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
        <div className="mt-1.5">
          <Textarea
            id={`${idPrefix}-notes`}
            rows={3}
            value={form.notes}
            placeholder="What needs to happen, and anything the next person should know."
            onChange={e => onChange({ ...form, notes: e.target.value })}
          />
        </div>
      </div>

      {errors.form && <InlineFieldError className="col-span-12">{errors.form}</InlineFieldError>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// One row
// ─────────────────────────────────────────────────────────────

function FollowUpRow({
  followUp,
  isNext,
  canEdit,
  canDelete,
  busy,
  onToggleDone,
  onEdit,
  onDelete,
}: {
  followUp: FollowUp
  isNext: boolean
  canEdit: boolean
  canDelete: boolean
  busy: boolean
  onToggleDone: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const done = followUp.status === 'done'
  const overdue = !done && isOverdue(followUp.due_date)

  return (
    <li
      /*
       * Keyed by id upstream and never unmounted across an edit, so the row the
       * user is working with is UPDATED, not destroyed and rebuilt. The colour
       * and opacity changes that follow a completion therefore transition
       * rather than snap (global rule 5).
       */
      className={[
        'flex flex-col gap-1.5 py-3 transition-all duration-200 ease-out first:pt-0 last:pb-0',
        done ? 'opacity-70' : 'opacity-100',
        busy ? 'pointer-events-none opacity-50' : '',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {done ? (
          <Badge variant="success">
            <CheckIcon />
            Done
          </Badge>
        ) : overdue ? (
          <Badge variant="warning">
            <TriangleAlertIcon />
            Overdue
          </Badge>
        ) : (
          <Badge>
            <ClockIcon />
            Not done
          </Badge>
        )}

        <span className="text-body font-medium text-text-primary">
          {fmtDate(followUp.due_date)}
        </span>
        <span className="text-body text-text-secondary">{orEmpty(followUp.mode)}</span>

        {/* The one row the Deals list is showing for this deal, said here in
            the same words so the two screens visibly agree. */}
        {isNext && (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Badge variant="primary">Next up</Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              The earliest open follow-up — this is the one shown on the Deals list.
            </TooltipContent>
          </Tooltip>
        )}

        {done && followUp.completed_at && (
          <span className="text-meta text-text-muted">
            Completed {fmtDateTime(followUp.completed_at)}
          </span>
        )}

        {/* Global rule 4: the actions sit on the row they act on. */}
        <div className="ml-auto flex items-center gap-1">
          <PermissionTooltip
            allowed={canEdit}
            reason="Only someone who can edit deals can complete a follow-up."
          >
            <Button
              variant={done ? 'ghost' : 'secondary'}
              size="sm"
              disabled={!canEdit || busy}
              onClick={onToggleDone}
            >
              {done ? <RotateCcwIcon /> : <CheckIcon />}
              {done ? 'Re-open' : 'Mark done'}
            </Button>
          </PermissionTooltip>

          <PermissionTooltip
            allowed={canEdit}
            reason="Only someone who can edit deals can change a follow-up."
          >
            <Button
              variant="in-field"
              size="icon-sm"
              aria-label="Edit follow-up"
              disabled={!canEdit || busy}
              onClick={onEdit}
            >
              <PencilIcon />
            </Button>
          </PermissionTooltip>

          <PermissionTooltip
            allowed={canDelete}
            reason="Only someone who can delete deals can remove a follow-up."
          >
            <Button
              variant="in-field"
              size="icon-sm"
              aria-label="Delete follow-up"
              disabled={!canDelete || busy}
              onClick={onDelete}
            >
              <Trash2Icon />
            </Button>
          </PermissionTooltip>
        </div>
      </div>

      {followUp.notes && (
        <p className="whitespace-pre-wrap text-body text-text-secondary">{followUp.notes}</p>
      )}
    </li>
  )
}

// ─────────────────────────────────────────────────────────────
// The section
// ─────────────────────────────────────────────────────────────

export function FollowUpsSection({
  dealId,
  initialFollowUps,
  onChange,
}: {
  dealId: string
  /** What the Deal GET already returned — no second fetch on mount. */
  initialFollowUps: FollowUp[]
  /** Lets the page keep anything derived from follow-ups in step. Optional. */
  onChange?: (followUps: FollowUp[]) => void
}) {
  const { toast } = useToast()
  const me = useMe()

  /*
   * Permissions from the real system, never a role name (global rule 4).
   * `/api/auth/me` builds `permissions` from `role_permissions`, the same table
   * `checkPermission()` reads, so a control shown here is a control the routes
   * will accept. While `me` is still loading nothing is enabled — briefly
   * offering a button that is about to be disabled is worse than the reverse.
   */
  const canEdit = me?.permissions?.deals?.edit === true
  const canDelete = me?.permissions?.deals?.delete === true

  const [rows, setRows] = useState<FollowUp[]>(initialFollowUps)
  const [busyId, setBusyId] = useState<string | null>(null)

  // The Deal reloads (a stage move, a close) bring fresh follow-ups with them.
  useEffect(() => {
    setRows(initialFollowUps)
  }, [initialFollowUps])

  const publish = useCallback(
    (next: FollowUp[]) => {
      setRows(next)
      onChange?.(next)
    },
    [onChange]
  )

  /**
   * Open first and by due date, then the done ones as history.
   *
   * Sorted on "YYYY-MM-DD" strings with `localeCompare`, which is a correct
   * chronological sort for that format and, unlike comparing `Date` objects
   * pulled out of the rows, cannot be defeated by a timestamp that came back
   * with a time on it (PLAN.md §8.4).
   */
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const aDone = a.status === 'done'
        const bDone = b.status === 'done'
        if (aDone !== bDone) return aDone ? 1 : -1
        return (a.due_date ?? '').localeCompare(b.due_date ?? '')
      }),
    [rows]
  )

  /**
   * The earliest OPEN one — the row the Deals list surfaces as
   * `next_follow_up`. Same rule as `shapeDeal()`: filter to not-done, take the
   * earliest due date. `sorted` already puts open rows first in due order, so
   * it is the first of them.
   */
  const nextOpenId = useMemo(() => sorted.find(f => f.status !== 'done')?.id ?? null, [sorted])

  const openCount = rows.filter(f => f.status !== 'done').length

  // ── dialogs ──────────────────────────────────────────────

  /** `null` closed, `'new'` adding, otherwise the id being edited. */
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [form, setForm] = useState<FormState>(BLANK_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  /** The follow-up just completed, which the prompt offers to succeed. */
  const [promptAfter, setPromptAfter] = useState<FollowUp | null>(null)
  const [promptForm, setPromptForm] = useState<FormState>(BLANK_FORM)
  const [promptErrors, setPromptErrors] = useState<Record<string, string>>({})
  const [promptSaving, setPromptSaving] = useState(false)

  const [deleting, setDeleting] = useState<FollowUp | null>(null)

  function openAdd() {
    setForm({ due: addDays(startOfToday(), 1), mode: '', notes: '' })
    setErrors({})
    setSaving(false)
    setEditing('new')
  }

  function openEdit(followUp: FollowUp) {
    setForm({
      due: fromWireDate(followUp.due_date),
      mode: followUp.mode ?? '',
      notes: followUp.notes ?? '',
    })
    setErrors({})
    setSaving(false)
    setEditing(followUp.id)
  }

  /** The two compulsory fields the POST route enforces, checked before it does,
   *  so they land inline on the field rather than in a toast (§7.1). */
  function validate(state: FormState): Record<string, string> {
    const next: Record<string, string> = {}
    if (!state.due) next.due_date = 'Pick the date this follow-up is due.'
    if (!state.mode) next.mode = 'Choose how you will follow up.'
    return next
  }

  // ── writes ───────────────────────────────────────────────

  async function saveForm() {
    if (saving || editing === null) return
    const found = validate(form)
    if (Object.keys(found).length > 0) return setErrors(found)

    setSaving(true)
    const body = {
      due_date: toWireDate(form.due as Date),
      mode: form.mode,
      notes: form.notes.trim() || null,
    }
    const creating = editing === 'new'

    try {
      const res = await fetch(
        creating
          ? `/api/deals/${dealId}/follow-ups`
          : `/api/deals/${dealId}/follow-ups/${editing}`,
        {
          method: creating ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      const data = (await res.json().catch(() => ({}))) as FollowUp & { error?: string }
      if (!res.ok) {
        setErrors({ form: data.error ?? 'Could not save this follow-up.' })
        return
      }
      // The saved row REPLACES the one being edited by id — the element keeps
      // its key and its place, so it changes in view instead of blinking out.
      publish(creating ? [...rows, data] : rows.map(r => (r.id === data.id ? data : r)))
      setEditing(null)
      toast(creating ? 'Follow-up added.' : 'Follow-up updated.')
    } catch {
      setErrors({ form: 'The connection dropped. Nothing has been saved.' })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Mark Done, or re-open. One PATCH carrying `status` and nothing else — the
   * route derives `completed_at`, including the rule that re-saving an
   * already-done follow-up must not move the date it was completed.
   */
  async function toggleDone(followUp: FollowUp) {
    if (busyId) return
    const done = followUp.status === 'done'
    setBusyId(followUp.id)
    try {
      const res = await fetch(`/api/deals/${dealId}/follow-ups/${followUp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: done ? 'not_done' : 'done' }),
      })
      const data = (await res.json().catch(() => ({}))) as FollowUp & { error?: string }
      if (!res.ok) {
        toast(data.error ?? 'Could not update this follow-up.', 'error')
        return
      }
      publish(rows.map(r => (r.id === data.id ? data : r)))

      if (done) {
        toast('Follow-up re-opened.')
        return
      }

      toast('Follow-up completed.')
      /*
       * §4.5's prompt. It opens only AFTER the completion is committed, so
       * dismissing it — or a failure inside it — cannot undo what was done.
       * Pre-filled with the same mode and a week out, both editable.
       */
      setPromptForm({
        due: addDays(startOfToday(), NEXT_FOLLOW_UP_SUGGESTION_DAYS),
        mode: data.mode ?? followUp.mode ?? '',
        notes: '',
      })
      setPromptErrors({})
      setPromptSaving(false)
      setPromptAfter(data)
    } catch {
      toast('The connection dropped. Nothing has changed.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function scheduleNext() {
    if (promptSaving) return
    const found = validate(promptForm)
    if (Object.keys(found).length > 0) return setPromptErrors(found)

    setPromptSaving(true)
    try {
      const res = await fetch(`/api/deals/${dealId}/follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          due_date: toWireDate(promptForm.due as Date),
          mode: promptForm.mode,
          notes: promptForm.notes.trim() || null,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as FollowUp & { error?: string }
      if (!res.ok) {
        setPromptErrors({ form: data.error ?? 'Could not schedule the next follow-up.' })
        return
      }
      publish([...rows, data])
      setPromptAfter(null)
      toast('Next follow-up scheduled.')
    } catch {
      setPromptErrors({ form: 'The connection dropped. Nothing has been scheduled.' })
    } finally {
      setPromptSaving(false)
    }
  }

  async function confirmDelete() {
    const target = deleting
    if (!target) return
    setDeleting(null)
    setBusyId(target.id)
    try {
      const res = await fetch(`/api/deals/${dealId}/follow-ups/${target.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast(data.error ?? 'Could not delete this follow-up.', 'error')
        return
      }
      publish(rows.filter(r => r.id !== target.id))
      toast('Follow-up deleted.')
    } catch {
      toast('The connection dropped. Nothing has been deleted.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  // ── render ───────────────────────────────────────────────

  const editingRow = typeof editing === 'string' && editing !== 'new'
    ? rows.find(r => r.id === editing) ?? null
    : null

  return (
    <>
      <Card>
        {/* The Add button sits on the section's own header, next to the thing
            it adds to — not stranded on the page header (global rule 4). */}
        <CardHeader>
          <CardTitle>
            Follow-ups
            {openCount > 0 && (
              <span className="ml-2 text-label font-normal text-text-secondary">
                {openCount} open
              </span>
            )}
          </CardTitle>
          <PermissionTooltip
            allowed={canEdit}
            reason="Only someone who can edit deals can add a follow-up."
          >
            <Button size="sm" disabled={!canEdit} onClick={openAdd}>
              <PlusIcon />
              Add follow-up
            </Button>
          </PermissionTooltip>
        </CardHeader>

        <CardContent>
          {sorted.length === 0 ? (
            <p className="text-body text-text-secondary">
              No follow-ups yet. A follow-up records what is due next on this deal —
              a meeting, a call, an email — and the earliest open one is what shows
              on the Deals list.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-light">
              {sorted.map(followUp => (
                <FollowUpRow
                  key={followUp.id}
                  followUp={followUp}
                  isNext={followUp.id === nextOpenId}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  busy={busyId === followUp.id}
                  onToggleDone={() => void toggleDone(followUp)}
                  onEdit={() => openEdit(followUp)}
                  onDelete={() => setDeleting(followUp)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Add / edit. One dialog, because it is one form. */}
      <Dialog open={editing !== null} onOpenChange={o => { if (!o) setEditing(null) }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              {editing === 'new' ? 'Add a follow-up' : 'Edit follow-up'}
            </DialogTitle>
            <DialogDescription>
              {editing === 'new'
                ? 'The date and the mode are required. The earliest open follow-up is the one shown on the Deals list.'
                : `Due ${fmtDate(editingRow?.due_date ?? null)}. Changing the date can change which follow-up the Deals list shows.`}
            </DialogDescription>
          </DialogHeader>

          <FollowUpFields
            idPrefix="fu"
            form={form}
            errors={errors}
            onChange={next => {
              setForm(next)
              setErrors({})
            }}
          />

          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void saveForm()}>
              {saving ? 'Saving…' : editing === 'new' ? 'Add follow-up' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        §4.5's prompt on completion. A styled dialog, never `prompt()`, and
        dismissible four ways — Escape, the backdrop, the close button and
        "Not now". The completion it follows is already saved either way, which
        is the whole difference between a prompt and a required second step.
      */}
      <Dialog open={promptAfter !== null} onOpenChange={o => { if (!o) setPromptAfter(null) }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Schedule the next follow-up?</DialogTitle>
            <DialogDescription>
              {promptAfter
                ? `The ${(promptAfter.mode ?? 'follow-up').toLowerCase()} due ${fmtDate(
                    promptAfter.due_date
                  )} is marked done. You can line up the next one now, or leave it — nothing else is waiting on this.`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <FollowUpFields
            idPrefix="fu-next"
            form={promptForm}
            errors={promptErrors}
            onChange={next => {
              setPromptForm(next)
              setPromptErrors({})
            }}
          />

          <DialogFooter>
            <Button variant="secondary" onClick={() => setPromptAfter(null)}>
              Not now
            </Button>
            <Button disabled={promptSaving} onClick={() => void scheduleNext()}>
              {promptSaving ? 'Scheduling…' : 'Schedule it'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Section 15: deleting is irreversible, so it is confirmed — and an
          AlertDialog, which is what a native `confirm()` is not allowed to be. */}
      <AlertDialog open={deleting !== null} onOpenChange={o => { if (!o) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete the follow-up due {fmtDate(deleting?.due_date ?? null)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes it permanently; a follow-up keeps no history of its own.
              If it happened, mark it done instead — that keeps the record and takes
              it off the list of what is due.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              Delete follow-up
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
