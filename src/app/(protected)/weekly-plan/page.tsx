'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, MessageSquareIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { StatusBadge, WEEKLY_PLAN_STATUS } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { useMeStatus } from '@/hooks/useMe'
import RemarksPanel from '@/components/ui/RemarksPanel'
import { ManagerChanges, changeCountLabel } from '@/components/weekly-plan/manager-changes'
import { PlanBoard, PlanDayList } from '@/components/weekly-plan/plan-board'
import { PlanBoardSkeleton, WeeklyPlanSkeleton } from '@/components/weekly-plan/plan-skeleton'
import { PlanLineDialog, DayPicker } from '@/components/weekly-plan/plan-line-dialog'
import { WeeklyPriorities } from '@/components/weekly-plan/weekly-priorities'
import { useLayout } from '@/lib/layout'
import { PhoneWeeklyPlan } from './phone-weekly-plan'
import { PartylessSaveDialog, RequestReopenDialog } from '@/components/weekly-plan/plan-dialogs'
import { usePlanEditor } from '@/components/weekly-plan/use-plan-editor'
import {
  PLAN_EDIT_REASON,
  formatCountdown,
  formatDayColumn,
  formatDayLong,
  formatWeekRange,
  type PlanPartyOption,
} from '@/components/weekly-plan/plan-model'

// ---- Searchable Party Combobox (§5.1 — replaces the Place picker) ----
function PartyCombobox({ value, onChange, options, disabled }: {
  value: string
  onChange: (option: PlanPartyOption | null) => void
  options: PlanPartyOption[]
  disabled: boolean
}) {
  const selected = options.find(o => o.id === value) ?? null
  const [query, setQuery] = useState(selected?.name ?? '')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(selected?.name ?? '') }, [selected?.name])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(selected?.name ?? '')
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [selected?.name])

  const filtered = query.trim() && query !== selected?.name
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : options

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        id="plan-line-party"
        type="text" disabled={disabled} value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search account or contact…"
        className="w-full border border-border-light rounded-lg px-3 py-2 text-[16px] sm:text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:bg-surface-sunken disabled:text-text-muted"
      />
      {!disabled && open && (
        <div className="absolute z-30 left-0 right-0 top-full mt-0.5 bg-surface border border-border-light rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-muted">No parties found</p>
          ) : (
            filtered.slice(0, 200).map(o => (
              <button key={`${o.type}:${o.id}`} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(o); setQuery(o.name); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-primary-subtle transition ${o.id === value ? 'bg-primary-subtle' : ''}`}>
                <span className="flex items-center gap-2">
                  <span className={`shrink-0 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    o.type === 'company' ? 'bg-primary-subtle text-primary' : 'bg-success-bg text-success'
                  }`}>
                    {o.type === 'company' ? 'Account' : 'Contact'}
                  </span>
                  <span className={`min-w-0 truncate ${o.id === value ? 'text-primary font-medium' : 'text-text-secondary'}`}>
                    {o.name}
                  </span>
                  {o.subtitle && <span className="ml-auto shrink-0 text-xs text-text-muted">{o.subtitle}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}


/** `userId` is never null here: the page renders this only once
 *  /api/auth/me has answered and the answer carries a user record.
 *  `canCreate` / `canEditPlan` mirror what the routes check: POST
 *  /api/weekly-plans needs weekly_plan.create; every write on an existing
 *  plan (PUT, submit, undo, request-reopen) needs weekly_plan.edit. */
function MyPlanTab({ canCreate, canEditPlan }: { userId: string; canCreate: boolean; canEditPlan: boolean }) {
  const {
    plan, loading, loadError, saving, logs, logsOpen, setLogsOpen, remarksOpen, setRemarksOpen,
    monday, weekDays, navigateWeek, loadPlan, loadLogs,
    parties, undoSecondsLeft, reopenModal, setReopenModal, reopenMessage, setReopenMessage,
    reopening, goals, editing, setEditing, prioritiesOpen, setPrioritiesOpen,
    confirmDrop, setConfirmDrop, setSelectedDay, todayStr, mobileDay,
    returnedAsSuggestion, latestManagerEdit, partylessCount,
    handleSaveDraft, saveDraft, handleSubmit, handleUndo, handleRequestReopen,
    statusEditable, canWrite, canEdit, canSubmit, isSubmittedAwaitingReview, canRequestReopen,
    lines, countsByDay, dayOptions, openAdd, openEdit, changeLineDay, selectPartyInDialog,
    updateExpectedInDialog, saveLine, removeLine, moveLine, dialogParty,
    updateGoalText, toggleGoal, addGoal, removeGoal,
  } = usePlanEditor({ canCreate, canEditPlan })

  const reopenLink = (colorClass: string) => (
    <PermissionTooltip allowed={canEditPlan} reason={PLAN_EDIT_REASON}>
      <button
        onClick={() => setReopenModal(true)}
        disabled={!canEditPlan}
        className={`text-meta underline disabled:cursor-not-allowed disabled:opacity-50 ${colorClass}`}
      >
        Request Reopen
      </button>
    </PermissionTooltip>
  )


  return (
    /*
      A fixed-height column, unlike the old page. The board is the one view on
      this screen that cannot live in normal flow: each of its seven columns
      scrolls vertically inside a host that must have a definite height, and it
      renders one screen tall with its columns cut off in anything that will
      not give it one. The shell's content wrapper is `h-full ... p-6` against
      an `h-dvh` root, so `h-full` here resolves to a real number and the
      shell's own scrollbar never appears.
    */
    <div className="flex h-full min-h-0 flex-col">
      {/* Pinned chrome: title, status, week changer. Only the columns scroll. */}
      <div className="shrink-0 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-medium text-text-primary">Weekly Plan</h2>
          {plan && <StatusBadge vocabulary={WEEKLY_PLAN_STATUS} status={plan.status} />}
          {/*
            No add button here. Adding a line is a per-DAY action and it lives
            on the day's own column heading, next to the count of what is
            already there. Below 768px, where there are no columns, the day
            list carries its own.
          */}
          {plan && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
              <Button variant="ghost" size="sm" onClick={() => setRemarksOpen(true)}>
                <MessageSquareIcon />
                Chat
              </Button>
              <Button variant="ghost" size="sm" onClick={loadLogs}>Audit Log</Button>
            </div>
          )}
        </div>

        {/* Week changer, above the day row exactly as F9 asks. */}
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" size="icon" onClick={() => navigateWeek(-1)} aria-label="Previous week">
            <ChevronLeftIcon />
          </Button>
          <span className="text-body font-medium text-text-primary tabular-nums">
            {formatWeekRange(monday)}
          </span>
          <Button variant="secondary" size="icon" onClick={() => navigateWeek(1)} aria-label="Next week">
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      {/* Status banners */}
      {plan && plan.status === 'Approved' && (
        <div className="mb-3 shrink-0 rounded-xl border border-success-border bg-success-bg px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-label font-medium text-success">Plan Approved</span>
            {canRequestReopen && (
              reopenLink('text-success')
            )}
          </div>
          {plan.manager_comment && <p className="mt-1 text-label text-success">{plan.manager_comment}</p>}
          {plan.reopen_requested && <p className="mt-1 text-meta text-success italic">Reopen request sent — awaiting manager response</p>}
        </div>
      )}
      {plan && plan.status === 'Rejected' && (
        <div className="mb-3 shrink-0 rounded-xl border border-danger-border bg-danger-bg px-4 py-2.5">
          <span className="text-label font-medium text-danger">Plan Rejected — please revise and resubmit</span>
          {plan.manager_comment && <p className="mt-1 text-label text-danger">{plan.manager_comment}</p>}
        </div>
      )}
      {plan && plan.status === 'Edited by Manager' && (
        <div className="mb-3 max-h-40 shrink-0 overflow-y-auto rounded-xl border border-primary-border bg-primary-subtle px-4 py-2.5">
          <span className="text-label font-medium text-primary">
            {returnedAsSuggestion
              ? 'Your manager suggested changes — update your plan and resubmit'
              : 'Plan Edited by Manager — review the changes and resubmit'}
          </span>
          {plan.manager_comment && <p className="mt-1 text-label text-primary">{plan.manager_comment}</p>}
          {/*
            §5.2: "The User must be able to see what changes his Manager made."
            The frozen before/after from the audit row — see
            src/lib/weekly-plan-diff.ts for why it is recorded at write time.
          */}
          {latestManagerEdit && (
            <div className="mt-2">
              <p className="text-meta font-medium text-primary">
                {changeCountLabel(latestManagerEdit)} to your plan
              </p>
              <ManagerChanges changes={latestManagerEdit} className="mt-1" />
            </div>
          )}
        </div>
      )}
      {plan && plan.status === 'On Hold' && (
        <div className="mb-3 shrink-0 rounded-xl border border-warning-border bg-warning-bg px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-label font-medium text-warning">Plan On Hold</span>
            {canRequestReopen && (
              reopenLink('text-warning')
            )}
          </div>
          {plan.manager_comment && <p className="mt-1 text-label text-warning">{plan.manager_comment}</p>}
          {plan.reopen_requested && <p className="mt-1 text-meta text-warning italic">Reopen request sent — awaiting manager response</p>}
        </div>
      )}
      {isSubmittedAwaitingReview && (
        <div className="mb-3 shrink-0 rounded-xl border border-primary-border bg-primary-subtle px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-label font-medium text-primary">Awaiting manager review</span>
            {undoSecondsLeft > 0 ? (
              <PermissionTooltip allowed={canEditPlan} reason={PLAN_EDIT_REASON}>
                <Button variant="secondary" size="sm" onClick={handleUndo} disabled={saving || !canEditPlan}>
                  Undo ({formatCountdown(undoSecondsLeft)})
                </Button>
              </PermissionTooltip>
            ) : canRequestReopen ? (
              reopenLink('text-primary')
            ) : plan?.reopen_requested ? (
              <span className="text-meta text-primary italic">Reopen request sent</span>
            ) : null}
          </div>
        </div>
      )}

      {loading ? (
        /* Section 14.1: the shape of the board that is coming, not a word. */
        <PlanBoardSkeleton />
      ) : loadError ? (
        <EmptyState
          variant="failed"
          heading="Could not load this week"
          onAction={() => loadPlan(true)}
        >
          The plan for {formatWeekRange(monday)} did not load. Nothing you had
          typed has been sent, so it is safe to try again.
        </EmptyState>
      ) : (
        <>
          {/*
            The board, at 768px and up. Below that it is not offered at all
            (section 35.3): seven 280px columns need about 2,000px and a phone
            has 390, so squeezing them would cost the week-at-a-glance
            comparison that is the whole point and give nothing back.

            Both views are in the markup and chosen by a media query rather
            than by `useBoardAvailable`, which reports false until the first
            effect runs — on a laptop that is a frame of the phone layout
            before the board appears.
          */}
          <div className="hidden min-h-0 flex-1 md:flex md:flex-col">
            <PlanBoard
              days={weekDays}
              lines={lines}
              dayLabel={formatDayColumn}
              canEdit={canEdit}
              onOpenLine={openEdit}
              onMoveLine={moveLine}
              onAddToDay={openAdd}
            />
          </div>

          {/* One day at a time, below 768px. */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 md:hidden">
            <DayPicker
              days={weekDays}
              counts={countsByDay}
              selected={mobileDay}
              today={weekDays.includes(todayStr) ? todayStr : null}
              onSelect={setSelectedDay}
            />
            <PlanDayList
              day={mobileDay}
              lines={lines}
              canEdit={canEdit}
              onOpenLine={openEdit}
              onAdd={() => openAdd(mobileDay)}
            />
          </div>

          {/* F14 — the weekly priorities, full width, its own scroll. */}
          <div className="mt-3 shrink-0">
            <WeeklyPriorities
              rows={goals}
              canEdit={canEdit}
              open={prioritiesOpen}
              onToggleOpen={() => setPrioritiesOpen(o => !o)}
              onChangeText={updateGoalText}
              onToggleDone={toggleGoal}
              onAdd={addGoal}
              onRemove={removeGoal}
            />
          </div>

          {statusEditable && (
            <div className="mt-3 flex shrink-0 items-center justify-end gap-2">
              <PermissionTooltip
                allowed={canWrite}
                reason={plan ? 'Only someone who can edit weekly plans can save changes to one.' : 'Only someone who can create weekly plans can save one.'}
              >
                <Button variant="secondary" onClick={handleSaveDraft} disabled={saving || !canWrite} className="min-h-11 flex-1 sm:flex-initial">
                  Save Draft
                </Button>
              </PermissionTooltip>
              <PermissionTooltip
                allowed={canSubmit}
                reason={canEditPlan ? 'Only someone who can create weekly plans can submit a new one.' : 'Only someone who can edit weekly plans can submit one.'}
              >
                <Button onClick={handleSubmit} disabled={saving || !canSubmit} className="min-h-11 flex-1 sm:flex-initial">
                  Submit Plan
                </Button>
              </PermissionTooltip>
            </div>
          )}
        </>
      )}

      {/* Add / edit one line */}
      <PlanLineDialog
        open={editing !== null}
        mode={editing?.mode ?? 'add'}
        dateLabel={editing ? formatDayLong(editing.date) : ''}
        date={editing?.date ?? weekDays[0]}
        dayOptions={dayOptions}
        onDateChange={changeLineDay}
        draft={editing?.entry ?? null}
        companyType={dialogParty?.companyType ?? null}
        canRemove={canEdit}
        partyField={
          <PartyCombobox
            value={editing?.entry.partyId ?? ''}
            onChange={selectPartyInDialog}
            options={parties}
            disabled={!canEdit}
          />
        }
        onExpectedValueChange={updateExpectedInDialog}
        onSave={saveLine}
        onRemove={removeLine}
        onClose={() => setEditing(null)}
      />

      {/* Saving would delete lines that have no party — say so first. */}
      <PartylessSaveDialog
        open={confirmDrop}
        count={partylessCount}
        onCancel={() => setConfirmDrop(false)}
        onConfirm={() => { setConfirmDrop(false); void saveDraft() }}
      />

      {/* Audit Log */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Audit Log</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 overflow-y-auto px-6 py-4">
            {logs.map(log => (
              <div key={log.id} className="flex gap-3 text-sm">
                <div className="w-1 shrink-0 rounded-full bg-primary-subtle" />
                <div>
                  <p className="font-medium text-text-primary">{log.action_type} <span className="text-xs font-normal text-text-muted">by {log.users?.name ?? log.actor_role}</span></p>
                  {(log.previous_status || log.new_status) && <p className="text-xs text-text-secondary">{log.previous_status} → {log.new_status}</p>}
                  {log.comment && <p className="mt-0.5 rounded bg-warning-bg px-2 py-0.5 text-xs text-warning">&ldquo;{log.comment}&rdquo;</p>}
                  {log.changes && <ManagerChanges changes={log.changes} className="mt-1" />}
                  <p className="text-xs text-text-secondary">{new Date(log.timestamp).toLocaleString('en-IN')}</p>
                </div>
              </div>
            ))}
            {logs.length === 0 && <p className="text-sm text-text-muted">No log entries yet.</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Item 7: Request Reopen */}
      <RequestReopenDialog
        open={reopenModal}
        onOpenChange={next => { setReopenModal(next); if (!next) setReopenMessage('') }}
        message={reopenMessage}
        onMessageChange={setReopenMessage}
        sending={reopening}
        onSend={handleRequestReopen}
      />

      {/* Remarks / Chat Panel */}
      {plan && (
        <RemarksPanel
          isOpen={remarksOpen}
          onClose={() => setRemarksOpen(false)}
          contextType="weekly_plan"
          contextId={plan.id}
          contextTitle={`Weekly Plan — ${formatWeekRange(monday)}`}
        />
      )}
    </div>
  )
}

// ---- Main Page ----
/*
 * Who the caller is has three answers, not two, and they are three branches
 * (section 14.3). `me === null` used to mean both "the request is still in
 * flight" and "there is no user record", so the first paint of this screen
 * asserted, falsely, that the person did not exist in Masters — and a failed
 * request left that same false claim on screen for good, with the real reason
 * spent on a toast that had already faded.
 *
 * `status` separates them: a skeleton while loading, a Retry while failed, and
 * the Masters message only once the answer has actually landed and says so.
 * The request carries its own deadline because `fetch` has none (section 14.4)
 * — without it a stalled response never settles and the skeleton is forever.
 */
function DesktopWeeklyPlanPage() {
  const router = useRouter()
  // One shared /me load (cached, with its own timeout and retry) instead of a
  // private fetch of the same endpoint.
  const { me: meData, error: meError, retry: retryMe } = useMeStatus()
  const me: { status: 'loading' } | { status: 'failed' } | { status: 'ready'; userId: string | null; canAddUsers: boolean } =
    meData
      ? {
          status: 'ready',
          userId: meData.userId ?? null,
          // `create ?? edit` is the same expression /api/auth/me and
          // permissions.ts use for the create question.
          canAddUsers: Boolean(meData.permissions?.users?.create ?? meData.permissions?.users?.edit),
        }
      : meError ? { status: 'failed' } : { status: 'loading' }
  const wp = meData?.permissions?.weekly_plan
  const canEditPlan = Boolean(wp?.edit)
  const canCreatePlan = Boolean(wp?.create ?? wp?.edit)
  const loadMe = retryMe

  // `h-full` so the board inside gets a definite height to fill.
  return (
    <div className="h-full min-h-0">
      {me.status === 'loading' ? (
        <WeeklyPlanSkeleton />
      ) : me.status === 'failed' ? (
        <EmptyState
          variant="failed"
          heading="Could not load your weekly plan"
          onAction={loadMe}
        >
          We could not check who you are signed in as, so the plan cannot be
          opened yet.
        </EmptyState>
      ) : me.userId === null ? (
        /*
          Genuinely no user record: the login exists but is not linked to a row
          in Masters → Users, so there is nobody to hold a plan. Both arms lead
          somewhere — the one who may create the record is sent to it, and the
          one who may not is not left staring at a button that would only 403.
        */
        <EmptyState
          variant="nothing-yet"
          heading="Your login is not linked to a user"
          actionLabel={me.canAddUsers ? 'Open Masters → Users' : 'Go to Dashboard'}
          onAction={() => router.push(me.canAddUsers ? '/masters/users' : '/')}
        >
          {me.canAddUsers
            ? 'A weekly plan belongs to a user record. Add yourself in Masters → Users, then come back to this screen.'
            : 'A weekly plan belongs to a user record, and this login has none yet. Ask an administrator to add you in Masters → Users.'}
        </EmptyState>
      ) : (
        <MyPlanTab userId={me.userId} canCreate={canCreatePlan} canEditPlan={canEditPlan} />
      )}
    </div>
  )
}

/**
 * One URL for both layouts (FRONTEND_RULES_PHONE §41.2 rule 4): the phone
 * gets the read-only week view, the desktop the full plan editor.
 */
export default function WeeklyPlanPage() {
  const { layout } = useLayout()
  if (layout === 'phone') return <PhoneWeeklyPlan />
  return <DesktopWeeklyPlanPage />
}
