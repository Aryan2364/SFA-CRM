'use client'

import { useEffect, useState } from 'react'
import { HistoryIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Entity, Visit } from './types'

/**
 * P3-T10 — the PAST / MANUAL entry path (§5.4).
 *
 * This is deliberately a separate dialog from `add-meeting-dialog.tsx`
 * rather than a mode flag on it: a manual entry asks for two fields
 * (Start, End) that a live-logged meeting never asks for, and mixing
 * them would blur the one thing this form has to be honest about —
 * these times are TYPED, not measured, and the spec calls them
 * "tentative" for exactly that reason.
 *
 * What this form does NOT do, on purpose:
 *  - It never calls `getPosition()`. A manual entry carries no GPS fix
 *    at all — `latitude`/`longitude`/`address` are left null server-side
 *    — because inventing a "current location" for a meeting that may
 *    not have happened near here would fabricate exactly the kind of
 *    evidence §5.4 exists to be honest about.
 *  - It never defaults Start/End to "now". An empty time field is a
 *    validation error, not a silent measurement.
 */
export function ManualMeetingDialog({
  open,
  onOpenChange,
  visitDate,
  onAdd,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** "YYYY-MM-DD" — the day already selected on the screen. */
  visitDate: string
  onAdd: (v: Partial<Visit> & {
    is_manual_entry: true
    manual_start_time: string
    manual_end_time: string
  }) => Promise<void> | void
}) {
  const { toast } = useToast()
  const [leadTypes, setLeadTypes] = useState<{ id: string; name: string }[]>([])
  const [visitType, setVisitType] = useState('')
  const [mode, setMode] = useState<'existing' | 'lead'>('existing')
  const [entityId, setEntityId] = useState('')
  const [entities, setEntities] = useState<Entity[]>([])
  const [entLoading, setEntLoading] = useState(false)

  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [fieldError, setFieldError] = useState<{ start?: string; end?: string }>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setStartTime('')
    setEndTime('')
    setFieldError({})
    setEntityId('')
    fetch('/api/masters/lead-types')
      .then(r => r.json())
      .then((d: { id: string; name: string }[]) => {
        setLeadTypes(Array.isArray(d) ? d : [])
        if (Array.isArray(d) && d.length > 0) setVisitType(v => v || d[0].name)
      })
      .catch(() => toast('Failed to load visit types', 'error'))
  }, [open])

  useEffect(() => {
    if (!open || !visitType) return
    setEntityId('')
    setEntLoading(true)
    fetch(`/api/business-partners?type=${encodeURIComponent(visitType)}&status=${mode === 'lead' ? 'lead' : 'existing'}`)
      .then(r => r.json())
      .then(d => { setEntities(Array.isArray(d) ? d : []); setEntLoading(false) })
      .catch(() => setEntLoading(false))
  }, [open, visitType, mode])

  const entityOptions: Record<string, string> = Object.fromEntries(entities.map(e => [e.id, e.name]))
  const canAdd = !!visitType && !!entityId && !!startTime && !!endTime

  function toIso(time: string): string | null {
    if (!time) return null
    const d = new Date(`${visitDate}T${time}:00`)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  async function handleAdd() {
    const startIso = toIso(startTime)
    const endIso = toIso(endTime)
    const errs: { start?: string; end?: string } = {}
    if (!startIso) errs.start = 'Enter a start time'
    if (!endIso) errs.end = 'Enter an end time'
    if (startIso && endIso && endIso <= startIso) errs.end = 'End time must be after start time'
    setFieldError(errs)
    if (Object.keys(errs).length > 0 || !startIso || !endIso || !canAdd) return

    const selected = entities.find(e => e.id === entityId)
    setSaving(true)
    await onAdd({
      visit_type: visitType,
      entity_id: entityId,
      entity_name: selected?.name ?? '',
      is_new_entity: false,
      is_manual_entry: true,
      manual_start_time: startIso,
      manual_end_time: endIso,
    })
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HistoryIcon className="size-4 text-warning" />
            Log a past meeting
          </DialogTitle>
          <DialogDescription>
            For a meeting that already happened but was not logged live. Its start and end
            times are typed by hand, so it is marked Manually Entered · Tentative — no
            location is recorded.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="da-manual-lead-type">Type</Label>
            <Select value={visitType} onValueChange={v => setVisitType(String(v))}>
              <SelectTrigger id="da-manual-lead-type" className="w-full">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                {leadTypes.map(t => (
                  <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Record</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['existing', 'lead'] as const).map(m => (
                <Button
                  key={m}
                  type="button"
                  variant={mode === m ? 'primary' : 'secondary'}
                  onClick={() => setMode(m)}
                >
                  {m === 'existing' ? 'Existing' : 'Lead'}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="da-manual-entity">{mode === 'lead' ? 'Lead' : visitType || 'Record'}</Label>
            <SearchableSelect
              id="da-manual-entity"
              options={entityOptions}
              value={entityId}
              onValueChange={setEntityId}
              disabled={entLoading}
              placeholder={entLoading ? 'Loading…' : 'Search by name'}
              emptyMessage="No records of this type and status."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="da-manual-start">Start time</Label>
              <Input
                id="da-manual-start"
                type="time"
                value={startTime}
                onChange={e => { setStartTime(e.target.value); setFieldError(f => ({ ...f, start: undefined })) }}
                aria-invalid={!!fieldError.start}
              />
              {fieldError.start && <p className="text-meta text-danger">{fieldError.start}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="da-manual-end">End time</Label>
              <Input
                id="da-manual-end"
                type="time"
                value={endTime}
                onChange={e => { setEndTime(e.target.value); setFieldError(f => ({ ...f, end: undefined })) }}
                aria-invalid={!!fieldError.end}
              />
              {fieldError.end && <p className="text-meta text-danger">{fieldError.end}</p>}
            </div>
          </div>
          <p className="text-meta text-text-muted">
            These times are tentative — typed from memory, not captured live.
          </p>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={!canAdd || saving}>
            {saving ? 'Saving…' : 'Add past meeting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
