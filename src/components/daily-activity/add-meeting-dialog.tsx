'use client'

import { useEffect, useState } from 'react'

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
import { Entity, PlannedItem, Visit } from './types'

/**
 * The AD-HOC path: a meeting that was not on the approved plan.
 *
 * §5.3 rule 1 removes the selection step for PLANNED work — an approved
 * line that names a party starts from its own card with nothing to pick.
 * It does not remove the ability to log a meeting that was not planned,
 * which is what this dialog is for, and what it was already for.
 *
 * When it is opened from a plan line that carries no party (every seeded
 * line), `planItem` comes with it and the meeting is stamped with that
 * line's id, so the day still reads as plan-versus-actual afterwards.
 */
export function AddMeetingDialog({
  open,
  onOpenChange,
  planItem,
  onAdd,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  planItem?: PlannedItem | null
  onAdd: (v: Partial<Visit> & { weekly_plan_item_id?: string | null }) => void
}) {
  const { toast } = useToast()
  const [leadTypes, setLeadTypes] = useState<{ id: string; name: string }[]>([])
  const [visitType, setVisitType] = useState('')
  const [mode, setMode] = useState<'existing' | 'lead' | 'new_prospect'>('existing')
  const [entityId, setEntityId] = useState('')
  const [entities, setEntities] = useState<Entity[]>([])
  const [entLoading, setEntLoading] = useState(false)

  const [npName, setNpName] = useState('')
  const [npMobile, setNpMobile] = useState('')
  const [npPlace, setNpPlace] = useState('')
  const [placeOptions, setPlaceOptions] = useState<Record<string, string>>({})
  const [placeMap, setPlaceMap] = useState<
    Map<string, { state_id: string; district_id: string; taluka_id: string; village_id: string | null }>
  >(new Map())

  useEffect(() => {
    if (!open) return
    fetch('/api/masters/lead-types')
      .then(r => r.json())
      .then((d: { id: string; name: string }[]) => {
        setLeadTypes(Array.isArray(d) ? d : [])
        if (Array.isArray(d) && d.length > 0) setVisitType(v => v || d[0].name)
      })
      .catch(() => toast('Failed to load visit types', 'error'))

    Promise.all([
      fetch('/api/masters/districts').then(r => r.json()),
      fetch('/api/masters/talukas').then(r => r.json()),
      fetch('/api/masters/villages').then(r => r.json()),
    ])
      .then(([districts, talukas, villages]) => {
        const distMap = new Map(districts.map((d: { id: string }) => [d.id, d]))
        const taluMap = new Map(talukas.map((t: { id: string }) => [t.id, t]))
        const opts: Record<string, string> = {}
        const pm = new Map<string, { state_id: string; district_id: string; taluka_id: string; village_id: string | null }>()
        for (const t of talukas as { id: string; name: string; district_id: string }[]) {
          const dist = distMap.get(t.district_id) as { id: string; name: string; state_id: string } | undefined
          if (!dist) continue
          opts[`t:${t.id}`] = `${dist.name} · ${t.name}`
          pm.set(`t:${t.id}`, { state_id: dist.state_id, district_id: t.district_id, taluka_id: t.id, village_id: null })
        }
        for (const v of villages as { id: string; name: string; taluka_id: string }[]) {
          const talu = taluMap.get(v.taluka_id) as { id: string; name: string; district_id: string } | undefined
          const dist = talu ? (distMap.get(talu.district_id) as { id: string; name: string; state_id: string } | undefined) : undefined
          if (!talu || !dist) continue
          opts[`v:${v.id}`] = `${dist.name} · ${talu.name} · ${v.name}`
          pm.set(`v:${v.id}`, { state_id: dist.state_id, district_id: talu.district_id, taluka_id: v.taluka_id, village_id: v.id })
        }
        setPlaceOptions(opts)
        setPlaceMap(pm)
      })
      .catch(() => toast('Failed to load location data', 'error'))
  }, [open])

  useEffect(() => {
    if (!open || !visitType || mode === 'new_prospect') return
    setEntityId('')
    setEntLoading(true)
    fetch(`/api/business-partners?type=${encodeURIComponent(visitType)}&status=${mode === 'lead' ? 'lead' : 'existing'}`)
      .then(r => r.json())
      .then(d => { setEntities(Array.isArray(d) ? d : []); setEntLoading(false) })
      .catch(() => setEntLoading(false))
  }, [open, visitType, mode])

  const canAdd = !!visitType && (mode === 'new_prospect' ? !!npName.trim() : !!entityId)

  function handleAdd() {
    if (!canAdd) return
    const planLink = planItem ? { weekly_plan_item_id: planItem.id } : {}
    if (mode === 'new_prospect') {
      const r = placeMap.get(npPlace)
      onAdd({
        ...planLink,
        visit_type: visitType,
        new_prospect: {
          name: npName.trim(),
          mobile_1: npMobile.trim() || null,
          state_id: r?.state_id ?? null,
          district_id: r?.district_id ?? null,
          taluka_id: r?.taluka_id ?? null,
          village_id: r?.village_id ?? null,
        },
      })
    } else {
      const selected = entities.find(e => e.id === entityId)
      onAdd({
        ...planLink,
        visit_type: visitType,
        entity_id: entityId,
        entity_name: selected?.name ?? '',
        is_new_entity: false,
      })
    }
  }

  const entityOptions: Record<string, string> = Object.fromEntries(entities.map(e => [e.id, e.name]))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Log a meeting</DialogTitle>
          <DialogDescription>
            {planItem
              ? `On the planned line ${[planItem.from_place, planItem.to_place].filter(Boolean).join(' → ') || 'for this day'}.`
              : 'For a visit that was not on the approved plan.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="da-lead-type">Type</Label>
            <Select value={visitType} onValueChange={v => setVisitType(String(v))}>
              <SelectTrigger id="da-lead-type" className="w-full">
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
            <div className="grid grid-cols-3 gap-2">
              {(['existing', 'lead', 'new_prospect'] as const).map(m => (
                <Button
                  key={m}
                  type="button"
                  variant={mode === m ? 'primary' : 'secondary'}
                  onClick={() => setMode(m)}
                >
                  {m === 'existing' ? 'Existing' : m === 'lead' ? 'Lead' : 'New'}
                </Button>
              ))}
            </div>
          </div>

          {mode !== 'new_prospect' ? (
            <div className="space-y-1.5">
              <Label htmlFor="da-entity">{mode === 'lead' ? 'Lead' : visitType || 'Record'}</Label>
              <SearchableSelect
                id="da-entity"
                options={entityOptions}
                value={entityId}
                onValueChange={setEntityId}
                disabled={entLoading}
                placeholder={entLoading ? 'Loading…' : 'Search by name'}
                emptyMessage="No records of this type and status."
              />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="da-np-name">Name</Label>
                <Input id="da-np-name" value={npName} onChange={e => setNpName(e.target.value)} placeholder="Prospect name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="da-np-mobile">Mobile</Label>
                <Input
                  id="da-np-mobile"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={npMobile}
                  onChange={e => setNpMobile(e.target.value)}
                  placeholder="10-digit number"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="da-np-place">Place</Label>
                <SearchableSelect
                  id="da-np-place"
                  options={placeOptions}
                  value={npPlace}
                  onValueChange={setNpPlace}
                  placeholder="District, taluka or village"
                  emptyMessage="No place matches that search."
                />
              </div>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={!canAdd}>Add meeting</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
