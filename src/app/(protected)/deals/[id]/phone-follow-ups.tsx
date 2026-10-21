'use client'

/**
 * The phone's Follow-ups list: add, edit, mark done, re-open and delete — the
 * same five things the desktop section does (`components/deals/follow-ups-section.tsx`),
 * against the same routes:
 *
 *   POST   /api/deals/[id]/follow-ups        due_date + mode compulsory
 *   PATCH  /api/deals/[id]/follow-ups/[fid]  { due_date, mode, notes } or { status }
 *   DELETE /api/deals/[id]/follow-ups/[fid]
 *
 * The modes, the validation messages, the request body and the date handling
 * are the desktop's own (exported from that file), so the two cannot disagree.
 * As on desktop, marking one done commits the completion first and only then
 * offers to schedule the next — a prompt that can be dismissed, never a second
 * required step.
 */

import { useMemo, useState } from 'react'
import { CheckIcon, ClockIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react'

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
import { DatePicker } from '@/components/ui/date-picker'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Textarea } from '@/components/ui/textarea'
import { PhoneFormField } from '@/components/ui/phone-form'
import { useToast } from '@/contexts/ToastContext'
import { EMPTY, fmtDate, fmtDateTime } from '@/lib/format'
import { requestNotificationOffer } from '@/components/shell/notification-offer-host'
import {
  FOLLOW_UP_MODES,
  NEXT_FOLLOW_UP_SUGGESTION_DAYS,
  addDays,
  followUpBody,
  fromWireDate,
  isOverdue,
  startOfToday,
  validateFollowUpForm,
  type FollowUp,
  type FormState,
} from '@/components/deals/follow-ups-section'

const MODE_OPTIONS = Object.fromEntries(FOLLOW_UP_MODES.map(m => [m, m]))
const BLANK: FormState = { due: undefined, mode: '', notes: '' }

/** What the form is doing right now: nothing, a new one, one being edited, or the "next one?" prompt. */
type FormMode = { kind: 'closed' } | { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'next'; after: FollowUp }

export function PhoneFollowUps({
  dealId,
  rows,
  onRows,
  canEdit,
  canDelete,
  editReason,
  deleteReason,
}: {
  dealId: string
  rows: FollowUp[]
  onRows: (next: FollowUp[]) => void
  /** `null` while permissions are still loading: disabled, with no reason given yet. */
  canEdit: boolean | null
  canDelete: boolean | null
  editReason: string
  deleteReason: string
}) {
  const { toast } = useToast()
  const [mode, setMode] = useState<FormMode>({ kind: 'closed' })
  const [form, setForm] = useState<FormState>(BLANK)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<FollowUp | null>(null)

  // Open first and by due date, then the done ones as history (as desktop).
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
  const nextOpenId = sorted.find(f => f.status !== 'done')?.id ?? null

  function openAdd() {
    setForm({ due: addDays(startOfToday(), 1), mode: '', notes: '' })
    setErrors({})
    setMode({ kind: 'new' })
  }

  function openEdit(f: FollowUp) {
    setForm({ due: fromWireDate(f.due_date), mode: f.mode ?? '', notes: f.notes ?? '' })
    setErrors({})
    setMode({ kind: 'edit', id: f.id })
  }

  async function submit() {
    if (saving || mode.kind === 'closed') return
    const found = validateFollowUpForm(form)
    if (Object.keys(found).length > 0) return setErrors(found)

    const editing = mode.kind === 'edit' ? mode.id : null
    setSaving(true)
    try {
      const res = await fetch(
        editing ? `/api/deals/${dealId}/follow-ups/${editing}` : `/api/deals/${dealId}/follow-ups`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(followUpBody(form)),
        }
      )
      const data = (await res.json().catch(() => ({}))) as FollowUp & { error?: string }
      if (!res.ok) {
        setErrors({
          form:
            data.error ??
            (mode.kind === 'next' ? 'Could not schedule the next follow-up.' : 'Could not save this follow-up.'),
        })
        return
      }
      onRows(editing ? rows.map(r => (r.id === data.id ? data : r)) : [...rows, data])
      toast(
        mode.kind === 'next' ? 'Next follow-up scheduled.' : editing ? 'Follow-up updated.' : 'Follow-up added.',
        'success'
      )
      setMode({ kind: 'closed' })
      requestNotificationOffer()
    } catch {
      setErrors({ form: 'The connection dropped. Nothing has been saved.' })
    } finally {
      setSaving(false)
    }
  }

  async function toggleDone(f: FollowUp) {
    if (busyId) return
    const wasDone = f.status === 'done'
    setBusyId(f.id)
    try {
      const res = await fetch(`/api/deals/${dealId}/follow-ups/${f.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: wasDone ? 'not_done' : 'done' }),
      })
      const data = (await res.json().catch(() => ({}))) as FollowUp & { error?: string }
      if (!res.ok) {
        toast(data.error ?? 'Could not update this follow-up.', 'error')
        return
      }
      onRows(rows.map(r => (r.id === data.id ? data : r)))
      if (wasDone) {
        toast('Follow-up re-opened.', 'success')
        return
      }
      toast('Follow-up completed.', 'success')
      // Committed first; the prompt is dismissible and cannot undo it.
      setForm({
        due: addDays(startOfToday(), NEXT_FOLLOW_UP_SUGGESTION_DAYS),
        mode: data.mode ?? f.mode ?? '',
        notes: '',
      })
      setErrors({})
      setMode({ kind: 'next', after: data })
    } catch {
      toast('The connection dropped. Nothing has changed.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete() {
    const target = deleting
    if (!target) return
    setDeleting(null)
    setBusyId(target.id)
    try {
      const res = await fetch(`/api/deals/${dealId}/follow-ups/${target.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast(data.error ?? 'Could not delete this follow-up.', 'error')
        return
      }
      onRows(rows.filter(r => r.id !== target.id))
      if (mode.kind === 'edit' && mode.id === target.id) setMode({ kind: 'closed' })
      toast('Follow-up deleted.', 'success')
    } catch {
      toast('The connection dropped. Nothing has been deleted.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const formOpen = mode.kind !== 'closed'
  const formTitle =
    mode.kind === 'new' ? 'Add a follow-up' : mode.kind === 'edit' ? 'Edit follow-up' : 'Schedule the next follow-up?'
  const submitLabel =
    mode.kind === 'new' ? 'Add follow-up' : mode.kind === 'edit' ? 'Save changes' : 'Schedule it'

  return (
    <div className="flex flex-col gap-3 px-1">
      {sorted.length === 0 ? (
        <p className="px-2 py-1 text-body text-text-secondary">
          No follow-ups yet. A follow-up records what is due next — a meeting, a call, an email.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map(f => {
            const done = f.status === 'done'
            const overdue = !done && isOverdue(f.due_date)
            const busy = busyId === f.id
            return (
              <li
                key={f.id}
                className={[
                  'flex flex-col gap-2 rounded-lg border border-border-light px-3 py-2 transition-opacity duration-200',
                  done ? 'opacity-70' : '',
                  busy ? 'pointer-events-none opacity-50' : '',
                ].join(' ')}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-body font-medium text-text-primary">{fmtDate(f.due_date)}</span>
                  <span className="text-body text-text-secondary">{f.mode || EMPTY}</span>
                  {done ? (
                    <Badge variant="success"><CheckIcon />Done</Badge>
                  ) : overdue ? (
                    <Badge variant="warning"><TriangleAlertIcon />Overdue</Badge>
                  ) : (
                    <Badge><ClockIcon />Not done</Badge>
                  )}
                  {f.id === nextOpenId ? <Badge variant="neutral">Next up</Badge> : null}
                </div>
                {done && f.completed_at ? (
                  <span className="text-meta text-text-muted">Completed {fmtDateTime(f.completed_at)}</span>
                ) : null}
                {f.notes ? <p className="whitespace-pre-wrap text-label text-text-secondary">{f.notes}</p> : null}

                <div className="flex items-center gap-2">
                  <PermissionTooltip allowed={canEdit !== false} reason={editReason}>
                    <Button
                      variant={done ? 'ghost' : 'secondary'}
                      className="min-h-11 flex-1"
                      disabled={canEdit !== true || busy}
                      onClick={() => void toggleDone(f)}
                    >
                      {done ? <RotateCcwIcon /> : <CheckIcon />}
                      {done ? 'Re-open' : 'Mark done'}
                    </Button>
                  </PermissionTooltip>
                  <PermissionTooltip allowed={canEdit !== false} reason={editReason}>
                    <Button
                      variant="secondary"
                      size="icon-lg"
                      aria-label="Edit follow-up"
                      disabled={canEdit !== true || busy}
                      onClick={() => openEdit(f)}
                    >
                      <PencilIcon />
                    </Button>
                  </PermissionTooltip>
                  <PermissionTooltip allowed={canDelete !== false} reason={deleteReason}>
                    <Button
                      variant="secondary"
                      size="icon-lg"
                      aria-label="Delete follow-up"
                      disabled={canDelete !== true || busy}
                      onClick={() => setDeleting(f)}
                    >
                      <Trash2Icon />
                    </Button>
                  </PermissionTooltip>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {formOpen ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border-light p-3">
          <p className="text-body font-medium text-text-primary">{formTitle}</p>
          {mode.kind === 'next' ? (
            <p className="text-label text-text-secondary">
              {`The ${(mode.after.mode ?? 'follow-up').toLowerCase()} due ${fmtDate(
                mode.after.due_date
              )} is marked done. Line up the next one now, or leave it.`}
            </p>
          ) : null}
          <PhoneFormField label="Due date" required hint={errors.due_date}>
            <DatePicker
              value={form.due}
              invalid={Boolean(errors.due_date)}
              onValueChange={due => {
                setForm(f => ({ ...f, due }))
                setErrors({})
              }}
            />
          </PhoneFormField>
          <PhoneFormField label="Mode" required hint={errors.mode}>
            <SearchableSelect
              options={MODE_OPTIONS}
              value={form.mode}
              onValueChange={m => {
                setForm(f => ({ ...f, mode: m }))
                setErrors({})
              }}
              placeholder="How will you follow up?"
            />
          </PhoneFormField>
          <PhoneFormField label="Notes">
            <Textarea
              rows={3}
              value={form.notes}
              placeholder="What needs to happen, and anything the next person should know."
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </PhoneFormField>
          {errors.form ? <InlineFieldError>{errors.form}</InlineFieldError> : null}
          <div className="flex gap-2">
            <Button variant="secondary" className="min-h-11 flex-1" onClick={() => setMode({ kind: 'closed' })}>
              {mode.kind === 'next' ? 'Not now' : 'Cancel'}
            </Button>
            <Button className="min-h-11 flex-1" disabled={saving} onClick={() => void submit()}>
              {saving ? 'Saving…' : submitLabel}
            </Button>
          </div>
        </div>
      ) : (
        <PermissionTooltip allowed={canEdit !== false} reason={editReason}>
          <Button variant="secondary" className="min-h-11 w-full" disabled={canEdit !== true} onClick={openAdd}>
            <PlusIcon className="size-4" /> Add follow-up
          </Button>
        </PermissionTooltip>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={o => { if (!o) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the follow-up due {fmtDate(deleting?.due_date ?? null)}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it permanently. If it happened, mark it done instead — that keeps the record and takes it
              off the list of what is due.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete follow-up</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
