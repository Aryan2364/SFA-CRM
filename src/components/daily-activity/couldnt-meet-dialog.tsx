'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'
import { useToast } from '@/contexts/ToastContext'
import { getPosition, reverseGeocode, toDateStr } from './types'

export type CouldntMeetTarget = {
  todo_kind: 'plan' | 'followup' | 'next_meeting'
  todo_ref: string
  party_id: string | null
  due_date: string
  heading: string
}

type Reason = { id: string; name: string }

/**
 * "Couldn't meet" — on every to-do card (today's and Missed). Reason is
 * required (from the `todo_unmet_reasons` master), note and a new date are
 * optional. No behaviour here branches on WHICH reason was picked — reasons
 * are free-form rows a tenant edits, never a hardcoded id or name.
 *
 * Location is captured unconditionally on save, for every reason, the same
 * way the meeting Start flow does (`getPosition`/`reverseGeocode`); a
 * denial or failure saves the outcome anyway with a null location.
 */
export function CouldntMeetDialog({
  target,
  onClose,
  onSaved,
}: {
  target: CouldntMeetTarget | null
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [reasons, setReasons] = useState<Reason[]>([])
  const [reasonId, setReasonId] = useState('')
  const [note, setNote] = useState('')
  const [dateChoice, setDateChoice] = useState<'none' | 'tomorrow' | 'nextweek' | 'pick'>('none')
  const [pickedDate, setPickedDate] = useState('')
  const [saving, setSaving] = useState(false)

  const canReschedule = target?.todo_kind !== 'plan' || !!target?.party_id

  const unsaved = useUnsavedChanges({
    changed: !!(reasonId || note.trim() || dateChoice !== 'none'),
    noun: "couldn't meet note",
    mode: 'create',
  })

  useEffect(() => {
    if (!target) return
    setReasonId(''); setNote(''); setDateChoice('none'); setPickedDate('')
    fetch('/api/masters/todo-unmet-reasons')
      .then(r => r.ok ? r.json() : [])
      .then(rows => setReasons(Array.isArray(rows) ? rows : []))
      .catch(() => setReasons([]))
  }, [target])

  const today = useMemo(() => toDateStr(new Date()), [])
  const tomorrow = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); return toDateStr(d) }, [])
  const nextWeek = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 7); return toDateStr(d) }, [])

  const newDate =
    dateChoice === 'tomorrow' ? tomorrow :
    dateChoice === 'nextweek' ? nextWeek :
    dateChoice === 'pick' ? (pickedDate || null) :
    null

  async function handleSave() {
    if (!target || !reasonId) return
    setSaving(true)
    let latitude: number | null = null, longitude: number | null = null, address: string | null = null
    try {
      const pos = await getPosition()
      if (pos && 'latitude' in pos) {
        latitude = pos.latitude; longitude = pos.longitude
        address = await reverseGeocode(pos.latitude, pos.longitude)
      }
    } catch { /* denied/unavailable — save with null location, per spec */ }

    try {
      const res = await fetch('/api/daily-activity/couldnt-meet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          todo_kind: target.todo_kind, todo_ref: target.todo_ref, party_id: target.party_id,
          due_date: target.due_date, reason_id: reasonId, note: note.trim() || null,
          new_date: newDate, latitude, longitude, address,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast(data.error || "Couldn't save", 'error'); setSaving(false); return }
      toast('Saved', 'success')
      onSaved()
    } catch {
      toast('Network error', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!target) return null

  return (
    <Dialog
      open={!!target}
      onOpenChange={unsaved.guard(open => {
        if (!open && !saving) onClose()
      })}
    >
      {unsaved.warning}
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Couldn&apos;t meet</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-secondary">{target.heading}</p>

            <div>
              <Label htmlFor="cm-reason">
                Reason <span className="text-danger">*</span>
              </Label>
              <Select value={reasonId} onValueChange={v => setReasonId(v ?? '')}>
                <SelectTrigger id="cm-reason" className="mt-1.5 w-full">
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  {reasons.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="cm-note">Note (optional)</Label>
              <Textarea
                id="cm-note" value={note} onChange={e => setNote(e.target.value)} rows={2}
                className="mt-1.5 text-[16px] sm:text-body"
              />
            </div>

            <div>
              <span className="mb-1 block text-sm font-medium text-text-secondary">New date (optional)</span>
              {!canReschedule && (
                <p className="mb-2 text-label text-text-muted">
                  This plan line has no account on file, so it cannot be rescheduled — it will simply close.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {(['none', 'tomorrow', 'nextweek', 'pick'] as const).map(choice => (
                  <button
                    key={choice}
                    type="button"
                    disabled={!canReschedule && choice !== 'none'}
                    onClick={() => setDateChoice(choice)}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors duration-200 disabled:opacity-40 ${
                      dateChoice === choice ? 'border-primary-border bg-primary-subtle text-primary' : 'border-border text-text-secondary'
                    }`}
                  >
                    {choice === 'none' ? 'None' : choice === 'tomorrow' ? 'Tomorrow' : choice === 'nextweek' ? 'Next week' : 'Pick a date'}
                  </button>
                ))}
              </div>
              {dateChoice === 'pick' && (
                <input
                  type="date" min={today} value={pickedDate} onChange={e => setPickedDate(e.target.value)}
                  className="mt-2 h-9 rounded-lg border border-border px-2 text-[16px] text-text-primary sm:text-body"
                />
              )}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !reasonId}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
