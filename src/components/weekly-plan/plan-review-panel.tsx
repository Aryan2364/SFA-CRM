'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import StatusBadge from '@/components/ui/StatusBadge'
import { useToast } from '@/contexts/ToastContext'
import { fmtAmount, fmtDate, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DECISIONS, type DecisionKey, type PlanDetail, type PlanItem } from './approval-types'
import { DecisionDialog } from './decision-dialog'
import { ManagerChanges, changeCountLabel } from './manager-changes'
import { PartyCombobox, usePartyOptions, type PartyOption } from './party-combobox'

/**
 * §5.2's reviewer surface: one plan, everything needed to decide on it, and the
 * five things a manager may do to it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE EDITOR LIVES HERE RATHER THAN ON ITS OWN ROUTE
 *
 * `edit-by-manager` REPLACES the plan's whole item list, so the payload it
 * needs is every line — including the ones the manager did not touch. A screen
 * that edited one line in isolation would post a one-line plan and silently
 * delete the rest. Holding the entire week in this component's state is what
 * makes the replace safe, and it is why the editor cannot be a per-row inline
 * control.
 *
 * ---------------------------------------------------------------------------
 * PERMISSION
 *
 * `canDecide` comes from the SERVER — `GET /api/weekly-plans/approval` answers
 * it from `checkPermission(user, 'weekly_plan', 'edit')`. It is never inferred
 * from a role name here. An executive reaching this panel sees the plan and no
 * action, which matches what the five routes would actually allow.
 */

/** A line being edited. `key` is local and never sent. */
type DraftLine = {
  key: string
  plan_date: string
  party_id: string | null
  party_type: string | null
  party_label: string | null
  dealer: number
  distributor: number
  others: number
  expected: string
  notes: string
}

let _key = 0
function draftKey() {
  _key += 1
  return `d${_key}`
}

function toDraft(item: PlanItem): DraftLine {
  return {
    key: draftKey(),
    plan_date: item.plan_date,
    party_id: item.party_id,
    party_type: item.party_type,
    party_label: item.party_label,
    dealer: item.new_dealers_goal ?? 0,
    distributor: item.existing_dealers_goal ?? 0,
    others: item.others_goal ?? 0,
    // '' is "did not say", which the API distinguishes from 0.
    expected: item.expected_order_value != null ? String(item.expected_order_value) : '',
    notes: item.notes ?? '',
  }
}

/** The shape `POST /edit-by-manager` feeds to `toItemRows`. */
function toPayload(lines: DraftLine[]) {
  return lines.map(l => ({
    plan_date: l.plan_date,
    party_id: l.party_id,
    party_type: l.party_type,
    new_dealers_goal: l.dealer,
    existing_dealers_goal: l.distributor,
    others_goal: l.others,
    expected_order_value: l.expected.trim() === '' ? null : Number(l.expected),
    notes: l.notes,
  }))
}

/** The seven dates of the plan's week, from its own start date. */
function weekDates(weekStart: string): string[] {
  const [y, m, d] = weekStart.split('-').map(Number)
  if (!y || !m || !d) return []
  const out: string[] = []
  for (let i = 0; i < 7; i += 1) {
    // Built from parts and stepped by date: `new Date(weekStart)` reads a bare
    // YYYY-MM-DD as UTC midnight and lands on the previous day west of
    // Greenwich, which shifts the whole week by one weekday.
    const day = new Date(y, m - 1, d + i)
    out.push(
      `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(
        day.getDate(),
      ).padStart(2, '0')}`,
    )
  }
  return out
}

function dayLabel(planDate: string): string {
  const [y, m, d] = planDate.split('-').map(Number)
  if (!y || !m || !d) return planDate
  const local = new Date(y, m - 1, d)
  return `${local.toLocaleDateString(undefined, { weekday: 'long' })} · ${fmtDate(planDate)}`
}

function NumberCell({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-[11px] font-medium text-text-muted">{label}</span>
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        value={String(value)}
        onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="text-[16px] sm:text-sm"
      />
    </label>
  )
}

/** One line, read-only — what a reviewer sees before touching anything. */
function ReadLine({ item }: { item: PlanItem }) {
  const parts = [
    `Dealer ${item.new_dealers_goal ?? 0}`,
    `Dist. ${item.existing_dealers_goal ?? 0}`,
    `Others ${item.others_goal ?? 0}`,
  ]
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
      <span className="text-body font-medium text-text-primary">
        {item.party_label ?? 'No party'}
      </span>
      <span className="text-label text-text-secondary">{parts.join(' · ')}</span>
      {item.expected_order_value != null && (
        <span className="text-label text-text-secondary">
          Expected {fmtAmount(item.expected_order_value)}
        </span>
      )}
      {item.notes?.trim() && (
        <span className="w-full text-label text-text-secondary">{item.notes}</span>
      )}
    </li>
  )
}

export function PlanReviewPanel({
  planId,
  canDecide,
  onClose,
  onChanged,
}: {
  /** `null` closes the panel. */
  planId: string | null
  canDecide: boolean
  onClose: () => void
  /** Called after any write, so the queue behind refetches its counts. */
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [plan, setPlan] = useState<PlanDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState('plan')
  const [editing, setEditing] = useState(false)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [decision, setDecision] = useState<DecisionKey | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [editNote, setEditNote] = useState('')
  const [busy, setBusy] = useState(false)

  // The party list is only fetched once the manager actually starts editing —
  // a reviewer who only approves never pays for two master reads.
  const parties = usePartyOptions(editing)

  const load = useCallback(async () => {
    if (!planId) return
    setFailed(false)
    try {
      const r = await fetch(`/api/weekly-plans/${planId}`)
      if (!r.ok) {
        setFailed(true)
        return
      }
      const data: PlanDetail = await r.json()
      setPlan(data)
      setLines(data.weekly_plan_items.map(toDraft))
    } catch {
      setFailed(true)
    }
  }, [planId])

  useEffect(() => {
    if (!planId) {
      setPlan(null)
      setEditing(false)
      setTab('plan')
      return
    }
    setPlan(null)
    void load()
  }, [planId, load])

  const dates = useMemo(() => (plan ? weekDates(plan.week_start_date) : []), [plan])

  const byDay = useMemo(() => {
    const map = new Map<string, PlanItem[]>()
    for (const item of plan?.weekly_plan_items ?? []) {
      const bucket = map.get(item.plan_date)
      if (bucket) bucket.push(item)
      else map.set(item.plan_date, [item])
    }
    return map
  }, [plan])

  const draftsByDay = useMemo(() => {
    const map = new Map<string, DraftLine[]>()
    for (const line of lines) {
      const bucket = map.get(line.plan_date)
      if (bucket) bucket.push(line)
      else map.set(line.plan_date, [line])
    }
    return map
  }, [lines])

  /** The most recent manager edit that recorded a before/after. */
  const lastEdit = useMemo(
    () => plan?.logs.find(l => l.action_type === 'EditByManager' && l.changes)?.changes ?? null,
    [plan],
  )

  function patch(key: string, change: Partial<DraftLine>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...change } : l)))
  }

  function addLine(date: string) {
    setLines(prev => [
      ...prev,
      {
        key: draftKey(),
        plan_date: date,
        party_id: null,
        party_type: null,
        party_label: null,
        dealer: 0,
        distributor: 0,
        others: 0,
        expected: '',
        notes: '',
      },
    ])
  }

  async function runDecision(comment: string) {
    if (!plan || !decision) return
    setBusy(true)
    try {
      const spec = DECISIONS[decision]
      const r = await fetch(`/api/weekly-plans/${plan.id}/${spec.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        // The API's own message, rendered in-app. Never an alert().
        toast(body?.error ?? `Could not ${spec.label.toLowerCase()} the plan`, 'error')
        return
      }
      toast(`Plan ${spec.resultStatus.toLowerCase()}`, 'success')
      setDecision(null)
      onChanged()
      onClose()
    } catch {
      toast('Network error — the plan was not changed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    if (!plan) return
    setBusy(true)
    try {
      const r = await fetch(`/api/weekly-plans/${plan.id}/edit-by-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: toPayload(lines), comment: editNote.trim() || undefined }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast(body?.error ?? 'Could not save the plan', 'error')
        return
      }
      // The route answers with the diff it froze, so the count reported here is
      // the same one the owner will see — not a client-side recount.
      const changed = body?.changes
      toast(
        changed && (changed.added?.length || changed.removed?.length || changed.changed?.length)
          ? `Saved — ${changeCountLabel(changed)} sent to ${plan.owner?.name ?? 'the owner'}`
          : 'Saved — no lines changed',
        'success',
      )
      setSaveOpen(false)
      setEditNote('')
      setEditing(false)
      onChanged()
      await load()
    } catch {
      toast('Network error — the plan was not changed', 'error')
    } finally {
      setBusy(false)
    }
  }

  const ownerName = plan?.owner?.name ?? 'this plan'

  return (
    <>
      <Dialog
        open={planId !== null}
        onOpenChange={open => {
          if (!open && !busy) onClose()
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {plan ? plan.owner?.name ?? 'Weekly plan' : 'Weekly plan'}
            </DialogTitle>
            <DialogDescription>
              {plan
                ? `Week of ${fmtDate(plan.week_start_date)} — ${fmtDate(plan.week_end_date)}`
                : 'Loading…'}
            </DialogDescription>
            {plan && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={plan.status} />
                <span className="text-label text-text-secondary">
                  {plan.weekly_plan_items.length} line
                  {plan.weekly_plan_items.length === 1 ? '' : 's'}
                </span>
                {plan.reopen_requested && <Badge variant="warning">Reopen requested</Badge>}
              </div>
            )}
          </DialogHeader>

          <DialogBody className="min-h-0">
            {failed ? (
              <div className="py-8 text-center">
                <p className="text-body text-text-secondary">This plan could not be loaded.</p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            ) : !plan ? (
              <div className="space-y-3 py-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <Tabs value={tab} onValueChange={v => setTab(String(v))}>
                <TabsList>
                  <TabsTrigger value="plan">Plan</TabsTrigger>
                  <TabsTrigger value="history">History ({plan.logs.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="plan" className="pt-4">
                  {plan.manager_comment && (
                    <div className="mb-4 rounded-xl border border-border-light bg-surface-sunken px-4 py-3">
                      <p className="text-label font-medium text-text-secondary">
                        Last note to {ownerName}
                      </p>
                      <p className="mt-0.5 text-body text-text-primary">{plan.manager_comment}</p>
                    </div>
                  )}

                  {plan.reopen_requested && plan.reopen_request_message && (
                    <div className="mb-4 rounded-xl border border-warning-border bg-warning-bg px-4 py-3">
                      <p className="text-label font-medium text-warning">Reopen request</p>
                      <p className="mt-0.5 text-body text-text-primary">
                        {plan.reopen_request_message}
                      </p>
                    </div>
                  )}

                  {/* The manager's own last edit, so a reviewer returning to a
                      plan sees what they changed without opening History. */}
                  {lastEdit && !editing && (
                    <div className="mb-4 rounded-xl border border-border-light px-4 py-3">
                      <p className="text-label font-medium text-text-secondary">
                        Your last edit — {changeCountLabel(lastEdit)}
                      </p>
                      <ManagerChanges changes={lastEdit} className="mt-1" />
                    </div>
                  )}

                  {plan.weekly_goals.length > 0 && (
                    <div className="mb-4">
                      <p className="text-label font-medium text-text-secondary">Goals this week</p>
                      <ul className="mt-1 space-y-1">
                        {plan.weekly_goals.map(g => (
                          <li key={g.id} className="text-body text-text-primary">
                            <span
                              className={cn(
                                'mr-2 text-label',
                                g.is_done ? 'text-success' : 'text-text-muted',
                              )}
                            >
                              {g.is_done ? '✓' : '○'}
                            </span>
                            {g.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="divide-y divide-border-light">
                    {dates.map(date => {
                      const readItems = byDay.get(date) ?? []
                      const drafts = draftsByDay.get(date) ?? []
                      return (
                        <section key={date} className="py-3">
                          <div className="flex items-center justify-between gap-3">
                            <h4 className="text-body font-medium text-text-primary">
                              {dayLabel(date)}
                            </h4>
                            {editing && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => addLine(date)}
                              >
                                <PlusIcon />
                                Add line
                              </Button>
                            )}
                          </div>

                          {editing ? (
                            drafts.length === 0 ? (
                              <p className="mt-1 text-label text-text-muted">No lines this day.</p>
                            ) : (
                              <ul className="mt-2 space-y-3">
                                {drafts.map(line => (
                                  <li
                                    key={line.key}
                                    className="rounded-xl border border-border-light p-3"
                                  >
                                    <div className="flex items-start gap-2">
                                      <div className="min-w-0 flex-1">
                                        <span className="mb-1 block text-[11px] font-medium text-text-muted">
                                          Party
                                        </span>
                                        <PartyCombobox
                                          value={line.party_id}
                                          label={line.party_label}
                                          options={parties}
                                          onChange={option =>
                                            patch(line.key, {
                                              party_id: option?.id ?? null,
                                              party_type: option?.type ?? null,
                                              party_label: option?.name ?? null,
                                            })
                                          }
                                        />
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Remove line"
                                        className="mt-5 text-danger"
                                        onClick={() =>
                                          setLines(prev =>
                                            prev.filter(l => l.key !== line.key),
                                          )
                                        }
                                      >
                                        <Trash2Icon />
                                      </Button>
                                    </div>
                                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                      <NumberCell
                                        label="Dealer"
                                        value={line.dealer}
                                        onChange={n => patch(line.key, { dealer: n })}
                                      />
                                      <NumberCell
                                        label="Dist."
                                        value={line.distributor}
                                        onChange={n => patch(line.key, { distributor: n })}
                                      />
                                      <NumberCell
                                        label="Others"
                                        value={line.others}
                                        onChange={n => patch(line.key, { others: n })}
                                      />
                                      <label className="min-w-0">
                                        <span className="mb-1 block text-[11px] font-medium text-text-muted">
                                          Expected order
                                        </span>
                                        <Input
                                          type="number"
                                          min={0}
                                          inputMode="decimal"
                                          value={line.expected}
                                          onChange={e =>
                                            patch(line.key, { expected: e.target.value })
                                          }
                                          className="text-[16px] sm:text-sm"
                                        />
                                      </label>
                                    </div>
                                    <label className="mt-2 block">
                                      <span className="mb-1 block text-[11px] font-medium text-text-muted">
                                        Notes
                                      </span>
                                      <Input
                                        value={line.notes}
                                        onChange={e => patch(line.key, { notes: e.target.value })}
                                        className="text-[16px] sm:text-sm"
                                      />
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            )
                          ) : readItems.length === 0 ? (
                            <p className="mt-1 text-label text-text-muted">No lines this day.</p>
                          ) : (
                            <ul className="mt-1 divide-y divide-border-light">
                              {readItems.map(item => (
                                <ReadLine key={item.id} item={item} />
                              ))}
                            </ul>
                          )}

                          {plan.day_notes?.[date] && !editing && (
                            <p className="mt-1 text-label text-text-secondary italic">
                              {plan.day_notes[date]}
                            </p>
                          )}
                        </section>
                      )
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="history" className="pt-4">
                  {plan.logs.length === 0 ? (
                    <p className="text-body text-text-muted">Nothing has happened yet.</p>
                  ) : (
                    <ul className="space-y-4">
                      {plan.logs.map(log => (
                        <li key={log.id} className="border-l-2 border-border-light pl-3">
                          <p className="text-body font-medium text-text-primary">
                            {log.action_type}
                            <span className="ml-2 text-label font-normal text-text-muted">
                              by {log.users?.name ?? log.actor_role}
                            </span>
                          </p>
                          {(log.previous_status || log.new_status) && (
                            <p className="text-label text-text-secondary">
                              {log.previous_status ?? '—'} &rarr; {log.new_status ?? '—'}
                            </p>
                          )}
                          {log.comment && (
                            <p className="mt-0.5 text-label text-text-primary">
                              &ldquo;{log.comment}&rdquo;
                            </p>
                          )}
                          {log.changes && <ManagerChanges changes={log.changes} className="mt-1" />}
                          <p className="mt-0.5 text-label text-text-muted">
                            {fmtDateTime(log.timestamp)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </DialogBody>

          {/*
            Zone 4. Every action a manager may take sits on one row, pinned
            below the scrolling body — never inside it, where deciding on a
            long plan would mean scrolling back.

            `canDecide` is the server's answer for `weekly_plan` EDIT. When it
            is false the footer holds only Close: an executive gets a readable
            plan and no button that would 403.
          */}
          <DialogFooter className="flex-wrap">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Close
            </Button>
            {plan && canDecide && !editing && (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <PencilIcon />
                  Edit plan
                </Button>
                <Button variant="secondary" onClick={() => setDecision('hold')}>
                  Hold
                </Button>
                <Button variant="secondary" onClick={() => setDecision('suggest')}>
                  Suggest changes
                </Button>
                <Button variant="danger" onClick={() => setDecision('reject')}>
                  Reject
                </Button>
                <Button variant="primary" onClick={() => setDecision('approve')}>
                  Approve
                </Button>
              </>
            )}
            {plan && canDecide && editing && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    // Discard: the drafts go back to what the plan actually
                    // holds, so leaving edit mode never half-applies anything.
                    setLines(plan.weekly_plan_items.map(toDraft))
                    setEditing(false)
                  }}
                >
                  Discard changes
                </Button>
                <Button variant="primary" disabled={busy} onClick={() => setSaveOpen(true)}>
                  Save changes
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DecisionDialog
        decision={decision}
        ownerName={ownerName}
        busy={busy}
        onConfirm={runDecision}
        onClose={() => setDecision(null)}
      />

      {/*
        The edit's own confirmation. Separate from `DecisionDialog` because this
        one states what is about to happen to the LINES — the four decisions
        change a status, this rewrites the owner's week.
      */}
      <Dialog
        open={saveOpen}
        onOpenChange={open => {
          if (!open && !busy) setSaveOpen(false)
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Save changes to this plan</DialogTitle>
            <DialogDescription>
              {`The plan moves to Edited by Manager and ${ownerName} is notified. They will see exactly which lines you changed.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="edit-note">Note to {ownerName} (optional)</Label>
            <Textarea
              id="edit-note"
              value={editNote}
              onChange={e => setEditNote(e.target.value)}
              rows={3}
              autoFocus
              className="mt-1.5 text-[16px] sm:text-body"
              placeholder="Why you changed the plan."
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSaveOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveEdit} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
