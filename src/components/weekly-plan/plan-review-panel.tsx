'use client'

import { useEffect, useState } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge, WEEKLY_PLAN_STATUS } from '@/components/status-badge'
import { fmtAmount, fmtDate, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { DECISIONS, EDIT_ALLOWED_FROM, type PlanItem } from './approval-types'
import { DecisionDialog } from './decision-dialog'
import { SaveEditDialog } from './save-edit-dialog'
import { ManagerChanges, changeCountLabel } from './manager-changes'
import { PartyCombobox } from './party-combobox'
import { dayLabel, usePlanReview } from './use-plan-review'

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

export function NumberCell({
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
export function ReadLine({ item }: { item: PlanItem }) {
  const parts = [
    `New ${item.new_dealers_goal ?? 0}`,
    `Existing ${item.existing_dealers_goal ?? 0}`,
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
  const [tab, setTab] = useState('plan')
  const {
    plan, failed, load, editing, setEditing, lines, setLines, decision, setDecision,
    saveOpen, setSaveOpen, editNote, setEditNote, busy, parties, dates, verbLock,
    byDay, draftsByDay, lastEdit, patch, addLine, runDecision, saveEdit, discardEdit,
  } = usePlanReview({ planId, onClose, onChanged })

  // Closing the panel puts it back on the Plan tab for the next opening.
  useEffect(() => {
    if (!planId) setTab('plan')
  }, [planId])

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
                <StatusBadge vocabulary={WEEKLY_PLAN_STATUS} status={plan.status} />
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
                                        label="New"
                                        value={line.dealer}
                                        onChange={n => patch(line.key, { dealer: n })}
                                      />
                                      <NumberCell
                                        label="Existing"
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
            {/*
              Each verb is also gated on WHO (the server's `canReview` — a
              Self-scope manager can read a report's plan but not act on it)
              and on the plan's STATUS, from the same allowed-from table the
              routes enforce — so every button that would 403 or 409 is shown
              disabled with the reason instead.
            */}
            {plan && canDecide && !editing && (
              <>
                <PermissionTooltip
                  allowed={verbLock(EDIT_ALLOWED_FROM) === null}
                  reason={verbLock(EDIT_ALLOWED_FROM) ?? ''}
                >
                  <Button
                    variant="secondary"
                    disabled={verbLock(EDIT_ALLOWED_FROM) !== null}
                    onClick={() => setEditing(true)}
                  >
                    <PencilIcon />
                    Edit plan
                  </Button>
                </PermissionTooltip>
                {(['hold', 'suggest', 'reject', 'approve'] as const).map(key => {
                  const lock = verbLock(DECISIONS[key].allowedFrom)
                  const allowed = lock === null
                  return (
                    <PermissionTooltip key={key} allowed={allowed} reason={lock ?? ''}>
                      <Button
                        variant={key === 'approve' ? 'primary' : key === 'reject' ? 'danger' : 'secondary'}
                        disabled={!allowed}
                        onClick={() => setDecision(key)}
                      >
                        {DECISIONS[key].label}
                      </Button>
                    </PermissionTooltip>
                  )
                })}
              </>
            )}
            {plan && canDecide && editing && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={discardEdit}
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

      {/* The edit's own confirmation — see SaveEditDialog. */}
      <SaveEditDialog
        open={saveOpen}
        ownerName={ownerName}
        note={editNote}
        busy={busy}
        onNoteChange={setEditNote}
        onClose={() => setSaveOpen(false)}
        onSave={saveEdit}
      />
    </>
  )
}
