'use client'

import { useState } from 'react'

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { NamedRef } from './types'

/**
 * §5.5 — "A new Deal … can be created from the meeting page itself."
 *
 * It posts to `POST /api/deals`, which is the one place a Deal is created: it
 * checks `deals:create`, defaults the owner to the caller, validates
 * `probability` against the CHECK constraint so an invalid value is a sentence
 * rather than a 500, and stamps `stage_entered_at` so the §4.7 ageing clock
 * starts from creation.
 *
 * The company is FIXED to the meeting's party and is not a field. A picker here
 * would let somebody standing in one shop file a deal against another one by a
 * mis-tap, and the whole reason this dialog exists is that they are already at
 * the party in question.
 *
 * Deliberately four fields. The Deals screen is where a Deal is filled in
 * properly; this is what can honestly be captured across a table, and every
 * other column has a working default.
 */
export function NewDealDialog({
  companyId,
  companyName,
  stages,
  onClose,
  onCreated,
}: {
  companyId: string
  companyName: string
  stages: (NamedRef & { sort_order: number })[]
  onClose: () => void
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [stageId, setStageId] = useState(stages[0]?.id ?? '')
  const [closeDate, setCloseDate] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) {
      toast('Give the deal a name', 'error')
      return
    }
    setSaving(true)
    const r = await fetch('/api/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        company_id: companyId,
        deal_stage_id: stageId || null,
        expected_value: value === '' ? 0 : Number(value),
        expected_close_date: closeDate || null,
      }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      toast(err.error ?? 'Could not create the deal', 'error')
      setSaving(false)
      return
    }
    setSaving(false)
    toast('Deal created')
    onCreated()
    onClose()
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>New deal</DialogTitle>
          <DialogDescription>At {companyName}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-deal-name">Deal name</Label>
            <Input
              id="new-deal-name"
              className="text-base sm:text-body"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="What is being sold"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-deal-stage">Stage</Label>
            {/* `items` maps the uuid the Select holds back to the words the
                trigger shows; without it the field reads as a raw id. */}
            <Select
              value={stageId}
              items={Object.fromEntries(stages.map(s => [s.id, s.name]))}
              onValueChange={v => setStageId(String(v))}
            >
              <SelectTrigger id="new-deal-stage" className="w-full">
                <SelectValue placeholder="Pick a stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-deal-value">Expected value</Label>
              <Input
                id="new-deal-value"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="text-base sm:text-body"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-deal-close">Expected close</Label>
              <Input
                id="new-deal-close"
                type="date"
                className="text-base sm:text-body"
                value={closeDate}
                onChange={e => setCloseDate(e.target.value)}
              />
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create deal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
