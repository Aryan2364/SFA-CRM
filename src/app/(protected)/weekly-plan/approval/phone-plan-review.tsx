'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRightIcon, HistoryIcon, MessageSquareIcon, PlusIcon } from 'lucide-react'

import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { StatusBadge, WEEKLY_PLAN_STATUS } from '@/components/status-badge'
import { ActionBar } from '@/components/ui/action-bar'
import { Badge } from '@/components/ui/badge'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { StaticPickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import RemarksPanel from '@/components/ui/RemarksPanel'
import { whenLayersSettled } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { usePhoneFormGuard } from '@/components/ui/phone-form'
import { useMe } from '@/hooks/useMe'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  DECISIONS,
  EDIT_ALLOWED_FROM,
  NOT_REVIEWER_REASON,
  NO_DECIDE_REASON,
  type DecisionKey,
} from '@/components/weekly-plan/approval-types'
import { DecisionDialog } from '@/components/weekly-plan/decision-dialog'
import { ManagerChanges, changeCountLabel } from '@/components/weekly-plan/manager-changes'
import { NumberCell, ReadLine } from '@/components/weekly-plan/plan-review-panel'
import { DayPicker } from '@/components/weekly-plan/plan-line-dialog'
import { PlanHistoryLayer } from '@/components/weekly-plan/plan-history'
import { SaveEditDialog } from '@/components/weekly-plan/save-edit-dialog'
import {
  dayLabel,
  draftKey,
  toDraft,
  toPayload,
  usePlanReview,
  type DraftLine,
} from '@/components/weekly-plan/use-plan-review'

/**
 * Phone plan review: one plan, everything a manager needs to decide on it,
 * and the five things a manager may do to it, on a screen of its own.
 *
 * The logic is the desktop panel's own (`usePlanReview`, moved out of
 * `PlanReviewPanel` unchanged): the same GET of the plan with its
 * `canReview`, the same four decision routes with `{ comment,
 * expected_version }`, the same edit-by-manager payload, the same 409
 * handling. Authorisation is read the same way too: whether the caller may act
 * at all is `weekly_plan` EDIT (from /api/auth/me, mirroring the routes'
 * `checkPermission`), who the plan's owner is comes back from the server as
 * `canReview`, and which status each verb starts from is the one
 * `allowedFrom` table in approval-types.ts. Nothing here looks at a role name.
 *
 * The phone's arrangement (FRONTEND_RULES_PHONE 41.6): Approve and Reject
 * in the action bar; the other verbs one tap away under "More actions", each
 * disabled with its reason shown when it cannot be used. Reject, Hold and
 * Suggest changes ask for their note in a bottom sheet, as the desktop does.
 */

const DECISION_VARIANT = 'secondary' as const

/** The action bar's button must fill its half, tooltip wrapper included. */
function Full({ children }: { children: ReactNode }) {
  return <div className="[&>span]:flex [&>span]:w-full">{children}</div>
}

export function PhonePlanReview({ planId }: { planId: string }) {
  const router = useRouter()
  const me = useMe()
  // The route-level check every manager verb makes first. `undefined` while
  // the answer has not arrived: disabled, but no reason is given yet.
  const canDecide: boolean | undefined = me ? Boolean(me.permissions?.weekly_plan?.edit) : undefined

  const review = usePlanReview({
    planId,
    // A decision lands: back to the list, where the plan is gone from this view.
    onClose: () => router.replace('/weekly-plan/approval'),
    onChanged: () => {},
  })
  const {
    plan, failed, load, editing, setEditing, lines, setLines, decision, setDecision,
    saveOpen, setSaveOpen, editNote, setEditNote, busy, parties, dates, verbLock,
    byDay, draftsByDay, lastEdit, runDecision, saveEdit, discardEdit, answerReopen,
  } = review

  const ownerName = plan?.owner?.name ?? 'this plan'
  usePhoneAppBar({ title: plan?.owner?.name ?? 'Weekly plan', back: '/weekly-plan/approval' })

  const [historyOpen, setHistoryOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [editDay, setEditDay] = useState<string | null>(null)
  const [lineEdit, setLineEdit] = useState<{ mode: 'add' | 'edit'; line: DraftLine } | null>(null)

  useEffect(() => {
    if (dates.length > 0 && (!editDay || !dates.includes(editDay))) setEditDay(dates[0])
  }, [dates, editDay])

  /* Unsaved edits to the lines: the kit's leave warning (41.7 rule 3). */
  const changed = useMemo(
    () => Boolean(plan) && editing
      && JSON.stringify(toPayload(lines)) !== JSON.stringify(toPayload(plan!.weekly_plan_items.map(toDraft))),
    [plan, editing, lines],
  )
  const { warning } = usePhoneFormGuard(changed)

  const partyOptions: PickerOption[] = useMemo(
    () => (parties ?? []).map(p => ({
      id: p.id,
      label: p.name,
      sublabel: [p.type === 'company' ? 'Account' : 'Contact', p.subtitle].filter(Boolean).join(' · '),
    })),
    [parties],
  )

  /** Why a verb is unavailable: who may not, then which status it cannot start from. */
  function lockOf(allowedFrom: readonly string[]): string | null {
    if (canDecide === false) return NO_DECIDE_REASON
    return verbLock(allowedFrom)
  }
  const canAnswerReopen = canDecide === true && plan?.canReview === true
  const reopenReason = canDecide === false ? NO_DECIDE_REASON : NOT_REVIEWER_REASON

  function afterSheet(run: () => void) {
    setMoreOpen(false)
    void whenLayersSettled().then(run)
  }

  const approveLock = lockOf(DECISIONS.approve.allowedFrom)
  const rejectLock = lockOf(DECISIONS.reject.allowedFrom)
  const editLock = lockOf(EDIT_ALLOWED_FROM)

  if (failed) {
    return (
      <EmptyState variant="failed" heading="This plan could not be loaded" onAction={() => void load()}>
        Check your connection and try again.
      </EmptyState>
    )
  }
  if (!plan) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  const editDrafts = editDay ? draftsByDay.get(editDay) ?? [] : []
  const counts: Record<string, number> = {}
  for (const d of dates) counts[d] = draftsByDay.get(d)?.length ?? 0

  return (
    <div className="flex flex-col gap-3">
      {/* The record's heading: who, which week, where it stands. */}
      <div className="rounded-xl border border-border-light bg-surface p-4">
        <h2 className="text-card-heading font-medium text-text-primary">{plan.owner?.name ?? 'Weekly plan'}</h2>
        <p className="mt-0.5 text-label text-text-secondary">
          Week of {fmtDate(plan.week_start_date)} — {fmtDate(plan.week_end_date)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge vocabulary={WEEKLY_PLAN_STATUS} status={plan.status} />
          <span className="text-label text-text-secondary">
            {plan.weekly_plan_items.length} line{plan.weekly_plan_items.length === 1 ? '' : 's'}
          </span>
          {plan.reopen_requested && <Badge variant="warning">Reopen requested</Badge>}
        </div>
      </div>

      {plan.manager_comment && (
        <div className="rounded-xl border border-border-light bg-surface-sunken px-4 py-3">
          <p className="text-label font-medium text-text-secondary">Last note to {ownerName}</p>
          <p className="mt-0.5 text-body text-text-primary">{plan.manager_comment}</p>
        </div>
      )}

      {plan.reopen_requested && (
        <div className="rounded-xl border border-warning-border bg-warning-bg px-4 py-3">
          <p className="text-label font-medium text-warning">Reopen request</p>
          {plan.reopen_request_message && (
            <p className="mt-0.5 text-body text-text-primary">{plan.reopen_request_message}</p>
          )}
          {canDecide !== undefined && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <PermissionTooltip allowed={canAnswerReopen} reason={reopenReason}>
                <Button variant="primary" disabled={busy || !canAnswerReopen} onClick={() => void answerReopen('accept-reopen')}>
                  Allow edit
                </Button>
              </PermissionTooltip>
              <PermissionTooltip allowed={canAnswerReopen} reason={reopenReason}>
                <Button variant="secondary" disabled={busy || !canAnswerReopen} onClick={() => void answerReopen('decline-reopen')}>
                  Decline
                </Button>
              </PermissionTooltip>
            </div>
          )}
        </div>
      )}

      {lastEdit && !editing && (
        <div className="rounded-xl border border-border-light bg-surface px-4 py-3">
          <p className="text-label font-medium text-text-secondary">
            Your last edit — {changeCountLabel(lastEdit)}
          </p>
          <ManagerChanges changes={lastEdit} className="mt-1" />
        </div>
      )}

      {plan.weekly_goals.length > 0 && (
        <div className="rounded-xl border border-border-light bg-surface px-4 py-3">
          <p className="text-label font-medium text-text-secondary">Goals this week</p>
          <ul className="mt-1 space-y-1">
            {plan.weekly_goals.map(g => (
              <li key={g.id} className="text-body text-text-primary">
                <span className={cn('mr-2 text-label', g.is_done ? 'text-success' : 'text-text-muted')}>
                  {g.is_done ? '✓' : '○'}
                </span>
                {g.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing ? (
        /* Editing: one day at a time, as the owner's own phone editor does. */
        <>
          <DayPicker
            days={dates}
            counts={counts}
            selected={editDay ?? dates[0]}
            today={null}
            onSelect={setEditDay}
          />
          {editDrafts.length === 0 ? (
            <p className="rounded-xl border border-border-light bg-surface px-4 py-6 text-center text-label text-text-muted">
              No lines this day.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {editDrafts.map(line => (
                <li key={line.key}>
                  <button
                    type="button"
                    onClick={() => setLineEdit({ mode: 'edit', line: { ...line } })}
                    className="flex min-h-11 w-full flex-col gap-1 rounded-xl border border-border-light bg-surface p-3 text-left active:bg-surface-control"
                  >
                    <span className="text-body font-medium text-text-primary">{line.party_label ?? 'No party'}</span>
                    <span className="text-label text-text-secondary">
                      New {line.dealer} · Existing {line.distributor} · Others {line.others}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => editDay && setLineEdit({
              mode: 'add',
              line: {
                key: draftKey(), plan_date: editDay, party_id: null, party_type: null, party_label: null,
                dealer: 0, distributor: 0, others: 0, expected: '', notes: '',
              },
            })}
          >
            <PlusIcon />
            Add a line
          </Button>
        </>
      ) : (
        <div className="divide-y divide-border-light rounded-xl border border-border-light bg-surface px-4">
          {dates.map(date => {
            const items = byDay.get(date) ?? []
            return (
              <section key={date} className="py-3">
                <h3 className="text-body font-medium text-text-primary">{dayLabel(date)}</h3>
                {items.length === 0 ? (
                  <p className="mt-1 text-label text-text-muted">No lines this day.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-border-light">
                    {items.map(item => <ReadLine key={item.id} item={item} />)}
                  </ul>
                )}
                {plan.day_notes?.[date] && (
                  <p className="mt-1 text-label italic text-text-secondary">{plan.day_notes[date]}</p>
                )}
              </section>
            )
          })}
        </div>
      )}

      {!editing && (
        <ul className="flex flex-col divide-y divide-border-light rounded-xl border border-border-light bg-surface">
          <li>
            <Row icon={<HistoryIcon className="size-5 text-text-secondary" aria-hidden />} onClick={() => setHistoryOpen(true)}>
              History · {plan.logs.length}
            </Row>
          </li>
          <li>
            <Row icon={<MessageSquareIcon className="size-5 text-text-secondary" aria-hidden />} onClick={() => setChatOpen(true)}>
              Chat
            </Row>
          </li>
          {canDecide === true && (
            <li>
              <Row icon={null} onClick={() => setMoreOpen(true)}>
                More actions
              </Row>
            </li>
          )}
        </ul>
      )}

      {/* The action bar. Without `weekly_plan` EDIT there is no decision to
          take, so a reader gets the plan and no bar. */}
      {canDecide !== false && !editing && (
        <ActionBar label="Decision">
          <Full>
            <PermissionTooltip allowed={canDecide === undefined ? undefined : rejectLock === null} reason={rejectLock ?? ''}>
              <Button
                variant={DECISION_VARIANT}
                className="w-full"
                disabled={canDecide === undefined || rejectLock !== null}
                onClick={() => setDecision('reject')}
              >
                {DECISIONS.reject.label}
              </Button>
            </PermissionTooltip>
          </Full>
          <Full>
            <PermissionTooltip allowed={canDecide === undefined ? undefined : approveLock === null} reason={approveLock ?? ''}>
              <Button
                variant="primary"
                className="w-full"
                disabled={canDecide === undefined || approveLock !== null}
                onClick={() => setDecision('approve')}
              >
                {DECISIONS.approve.label}
              </Button>
            </PermissionTooltip>
          </Full>
        </ActionBar>
      )}
      {canDecide === true && editing && (
        <ActionBar label="Edit">
          <Button variant="secondary" className="w-full" disabled={busy} onClick={discardEdit}>
            Discard changes
          </Button>
          <Button variant="primary" className="w-full" disabled={busy} onClick={() => setSaveOpen(true)}>
            Save changes
          </Button>
        </ActionBar>
      )}

      {/* The verbs that are not the two main ones, each saying why it is off. */}
      <BottomSheet open={moreOpen} onOpenChange={setMoreOpen} title="More actions">
        <ActionRow
          label="Edit plan"
          hint="Change the lines yourself. The owner sees what you changed."
          lock={editLock}
          onSelect={() => afterSheet(() => setEditing(true))}
        />
        {(['hold', 'suggest'] as DecisionKey[]).map(key => (
          <ActionRow
            key={key}
            label={DECISIONS[key].label}
            hint={DECISIONS[key].outcome}
            lock={lockOf(DECISIONS[key].allowedFrom)}
            onSelect={() => afterSheet(() => setDecision(key))}
          />
        ))}
      </BottomSheet>

      <DecisionDialog
        decision={decision}
        ownerName={ownerName}
        busy={busy}
        onConfirm={runDecision}
        onClose={() => setDecision(null)}
      />

      <SaveEditDialog
        open={saveOpen}
        ownerName={ownerName}
        note={editNote}
        busy={busy}
        onNoteChange={setEditNote}
        onClose={() => setSaveOpen(false)}
        onSave={saveEdit}
      />

      <ManagerLineDialog
        edit={lineEdit}
        options={partyOptions}
        partiesReady={parties !== null}
        onChange={line => setLineEdit(prev => (prev ? { ...prev, line } : prev))}
        onClose={() => setLineEdit(null)}
        onSave={() => {
          if (!lineEdit) return
          const { mode, line } = lineEdit
          setLines(prev => (mode === 'add' ? [...prev, line] : prev.map(l => (l.key === line.key ? line : l))))
          setLineEdit(null)
        }}
        onRemove={() => {
          if (!lineEdit) return
          const key = lineEdit.line.key
          setLines(prev => prev.filter(l => l.key !== key))
          setLineEdit(null)
        }}
        parties={parties ?? []}
      />

      <PlanHistoryLayer
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        logs={plan.logs}
        description={`${ownerName} · week of ${fmtDate(plan.week_start_date)}`}
      />

      <RemarksPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        contextType="weekly_plan"
        contextId={plan.id}
        contextTitle={`Weekly Plan — ${ownerName}`}
      />

      {warning}
    </div>
  )
}

function Row({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-body text-text-primary active:bg-surface-control"
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRightIcon className="size-4 text-text-secondary" aria-hidden />
    </button>
  )
}

/** A sheet row that, when it cannot be used, says why in plain sight. */
function ActionRow({
  label,
  hint,
  lock,
  onSelect,
}: {
  label: string
  hint: string
  lock: string | null
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={lock !== null}
      onClick={onSelect}
      className="flex min-h-12 w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left active:bg-surface-control disabled:opacity-60"
    >
      <span className="text-body font-medium text-text-primary">{label}</span>
      <span className="text-label text-text-secondary">{lock ?? hint}</span>
    </button>
  )
}

/**
 * One line of the plan, edited as its own screen (41.7 rule 16): the same
 * fields as the desktop editor's row — party, New, Existing, Others, expected
 * order, notes — in one column. Changes stay in memory until "Save changes"
 * on the plan, exactly as the desktop's drafts do.
 */
function ManagerLineDialog({
  edit,
  options,
  parties,
  partiesReady,
  onChange,
  onClose,
  onSave,
  onRemove,
}: {
  edit: { mode: 'add' | 'edit'; line: DraftLine } | null
  options: PickerOption[]
  parties: { id: string; type: 'company' | 'contact'; name: string }[]
  partiesReady: boolean
  onChange: (line: DraftLine) => void
  onClose: () => void
  onSave: () => void
  onRemove: () => void
}) {
  const line = edit?.line ?? null
  const value: PickerOption | null = line?.party_id
    ? options.find(o => o.id === line.party_id) ?? { id: line.party_id, label: line.party_label ?? 'No party' }
    : null

  return (
    <Dialog open={edit !== null} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{edit?.mode === 'add' ? 'Add a line' : 'Edit line'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {line && (
            <div className="flex flex-col gap-4">
              <div>
                <span className="mb-1 block text-label font-medium text-text-secondary">
                  {dayLabel(line.plan_date)}
                </span>
                <span className="mb-1 mt-3 block text-[11px] font-medium text-text-muted">Party</span>
                <StaticPickerSheetField
                  value={value}
                  options={options}
                  label="Account or contact"
                  placeholder={partiesReady ? 'Choose an account or contact' : 'Loading…'}
                  onChange={option => {
                    const found = parties.find(p => p.id === option.id)
                    onChange({
                      ...line,
                      party_id: option.id,
                      party_type: found?.type ?? null,
                      party_label: option.label,
                    })
                  }}
                />
              </div>
              <NumberCell label="New" value={line.dealer} onChange={n => onChange({ ...line, dealer: n })} />
              <NumberCell label="Existing" value={line.distributor} onChange={n => onChange({ ...line, distributor: n })} />
              <NumberCell label="Others" value={line.others} onChange={n => onChange({ ...line, others: n })} />
              <label className="min-w-0">
                <span className="mb-1 block text-[11px] font-medium text-text-muted">Expected order</span>
                <Input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={line.expected}
                  onChange={e => onChange({ ...line, expected: e.target.value })}
                  className="text-[16px] sm:text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-text-muted">Notes</span>
                <Input
                  value={line.notes}
                  onChange={e => onChange({ ...line, notes: e.target.value })}
                  className="text-[16px] sm:text-sm"
                />
              </label>
              {edit?.mode === 'edit' && (
                <Button variant="danger" className="w-full" onClick={onRemove}>
                  Remove line
                </Button>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
          <Button onClick={onSave}>{edit?.mode === 'add' ? 'Add line' : 'Save line'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
