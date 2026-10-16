'use client'

import { useEffect, useState } from 'react'

import { useToast } from '@/contexts/ToastContext'
import { useLayout } from '@/lib/layout'
import { Button } from '@/components/ui/button'
import { BottomSheet } from '@/components/ui/bottom-sheet'
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
import { toDateStr } from './types'

type OpenDeal = { id: string; name: string }
type CurrentNextMeeting = { source: 'deal' | 'company'; due_date: string; deal_id: string | null; deal_name: string | null }

/**
 * "Set next meeting" — one dialog for both places it is opened from:
 *
 *   - `prompt` — right after Stop: quick choices plus Skip, closing with
 *     nothing saved on Skip.
 *   - `manage` — the "Set next meeting" button, always available later
 *     (meeting page, Completed card): shows what is currently set, if
 *     anything, with Change (the same form) and Remove.
 *
 * All reading and writing goes through `GET`/`PUT`/`DELETE
 * /api/daily-activity/[visitId]/next-meeting` — see that route for how the
 * date is stored (an Opportunity's `deal_follow_ups` row, or
 * `companies.next_follow_up_date` when none is picked).
 *
 * On phone the same content and the same calls sit in a bottom sheet
 * (FRONTEND_RULES_PHONE §41.8 rule 10: a small dialog becomes a sheet), so
 * callers never choose between two components.
 */
export function NextMeetingDialog({
  visitId,
  mode,
  onClose,
  onSaved,
}: {
  visitId: string
  mode: 'prompt' | 'manage'
  onClose: () => void
  onSaved?: () => void
}) {
  const { toast } = useToast()
  const { layout } = useLayout()
  const phone = layout === 'phone'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [accountRequired, setAccountRequired] = useState(false)
  const [openDeals, setOpenDeals] = useState<OpenDeal[]>([])
  const [current, setCurrent] = useState<CurrentNextMeeting | null>(null)
  const [editing, setEditing] = useState(mode === 'prompt')
  const [date, setDate] = useState('')
  const [dealId, setDealId] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetch(`/api/daily-activity/${visitId}/next-meeting`)
      if (cancelled) return
      if (!r.ok) { setLoading(false); return }
      const d = await r.json()
      setAccountRequired(!!d.account_required)
      setOpenDeals(Array.isArray(d.open_deals) ? d.open_deals : [])
      setCurrent(d.next_meeting ?? null)
      if (d.next_meeting) {
        setDate(d.next_meeting.due_date)
        setDealId(d.next_meeting.deal_id ?? '')
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [visitId])

  async function save(dueDate: string, deal: string) {
    setSaving(true)
    try {
      const r = await fetch(`/api/daily-activity/${visitId}/next-meeting`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: dueDate, deal_id: deal || null }),
      })
      if (!r.ok) {
        toast((await r.json()).error ?? 'Could not set the next meeting', 'error')
        return
      }
      toast('Next meeting set', 'success')
      onSaved?.()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setSaving(true)
    try {
      const r = await fetch(`/api/daily-activity/${visitId}/next-meeting`, { method: 'DELETE' })
      if (!r.ok) {
        toast((await r.json()).error ?? 'Could not remove the next meeting', 'error')
        return
      }
      toast('Next meeting removed', 'success')
      onSaved?.()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  function quick(days: number) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    void save(toDateStr(d), dealId)
  }

  const title = mode === 'prompt' ? 'Next meeting?' : 'Set next meeting'
  const description = mode === 'prompt' ? 'When should this account be met again?' : undefined

  const body = loading ? null : accountRequired ? (
    <p className="text-body text-text-secondary">
      This meeting has no account attached, so there is nothing to attach a next meeting
      to.
    </p>
  ) : (
    <>
      {!editing && current && (
        <div className="flex flex-col gap-1 rounded-lg border border-border-light bg-surface-secondary px-3 py-2">
          <p className="text-body text-text-primary">
            Next meeting: {fmtShort(current.due_date)}
            {current.deal_name ? ` · ${current.deal_name}` : ''}
          </p>
        </div>
      )}

      {!editing && !current && mode === 'manage' && (
        <p className="text-body text-text-secondary">No next meeting is set.</p>
      )}

      {editing && (
        <>
          {mode === 'prompt' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className={phone ? 'flex-1' : undefined} disabled={saving} onClick={() => quick(1)}>
                Tomorrow
              </Button>
              <Button variant="secondary" className={phone ? 'flex-1' : undefined} disabled={saving} onClick={() => quick(7)}>
                Next week
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="next-meeting-date">Date</Label>
            <Input
              id="next-meeting-date"
              type="date"
              value={date}
              min={toDateStr(new Date())}
              onChange={e => setDate(e.target.value)}
            />
          </div>

          {openDeals.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="next-meeting-deal">About opportunity (optional)</Label>
              <select
                id="next-meeting-deal"
                value={dealId}
                onChange={e => setDealId(e.target.value)}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-body sm:h-9"
              >
                <option value="">Not linked to an opportunity</option>
                {openDeals.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </>
  )

  const change = !accountRequired && !editing && (
    <Button variant="secondary" onClick={() => setEditing(true)}>Change</Button>
  )
  const removeButton = !accountRequired && !editing && current && (
    <Button variant="secondary" disabled={saving} onClick={remove}>Remove</Button>
  )
  const saveButton = !accountRequired && editing && (
    <Button disabled={saving || !date} onClick={() => void save(date, dealId)}>
      Save
    </Button>
  )
  const dismiss = (
    <Button variant={phone ? 'secondary' : 'ghost'} onClick={onClose}>
      {mode === 'prompt' ? 'Skip' : 'Close'}
    </Button>
  )

  if (phone) {
    // §41.8 rule 6: footer buttons share its width, secondary first,
    // primary on the right.
    return (
      <BottomSheet
        open
        onOpenChange={o => { if (!o) onClose() }}
        title={title}
        description={description}
        bodyClassName="flex flex-col gap-4"
        footer={<>{dismiss}{change}{removeButton}{saveButton}</>}
      >
        {body}
      </BottomSheet>
    )
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {body}
        </DialogBody>
        <DialogFooter>
          {change}
          {removeButton}
          {saveButton}
          {dismiss}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function fmtShort(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
