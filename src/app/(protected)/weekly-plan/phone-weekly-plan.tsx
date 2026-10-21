'use client'

import { useEffect, useMemo, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeftIcon, ChevronRightIcon, HistoryIcon, MessageSquareIcon } from 'lucide-react'

import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { StatusBadge, WEEKLY_PLAN_STATUS } from '@/components/status-badge'
import { ActionBar } from '@/components/ui/action-bar'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { StaticPickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import RemarksPanel from '@/components/ui/RemarksPanel'
import { Skeleton } from '@/components/ui/skeleton'
import { usePhoneFormGuard } from '@/components/ui/phone-form'
import { useMeStatus } from '@/hooks/useMe'
import { ManagerChanges, changeCountLabel } from '@/components/weekly-plan/manager-changes'
import { PlanDayList } from '@/components/weekly-plan/plan-board'
import { PartylessSaveDialog, RequestReopenDialog } from '@/components/weekly-plan/plan-dialogs'
import { PlanHistoryLayer } from '@/components/weekly-plan/plan-history'
import { PlanLineDialog, DayPicker } from '@/components/weekly-plan/plan-line-dialog'
import {
  PLAN_EDIT_REASON,
  dayDataToPlanItems,
  formatCountdown,
  formatDayLong,
  formatWeekRange,
  goalsFromPlan,
  planItemsToDayData,
  type PlanPartyOption,
} from '@/components/weekly-plan/plan-model'
import { usePlanEditor } from '@/components/weekly-plan/use-plan-editor'
import { WeeklyPriorities } from '@/components/weekly-plan/weekly-priorities'

/**
 * Phone Weekly plan, for the rep who plans the coming week on the road.
 *
 * It is the desktop editor's own logic (`usePlanEditor`, moved out of the
 * desktop page unchanged): the same load, the same save / submit / undo /
 * request-reopen calls with the same payloads and `expected_version`, the same
 * duplicate-party and no-party guards, and the same permission inputs
 * (`weekly_plan` create for a first draft, edit for everything after it). Only
 * the arrangement is different, as FRONTEND_RULES_PHONE 41.3 asks: one day at
 * a time with the day picker, the line as a full-screen form, Save draft and
 * Submit in the action bar.
 *
 * Same URL as the desktop editor (41.2 rule 4): `page.tsx` renders this when
 * `useLayout()` says phone.
 *
 * Deliberately NOT on the phone: the seven-column board and dragging a line
 * to another day (a line's Day field does the same job), which is the whole
 * of section 35.3's reason for there being no board below 768px.
 */

const SAVE_REASON_EXISTING = 'Only someone who can edit weekly plans can save changes to one.'
const SAVE_REASON_NEW = 'Only someone who can create weekly plans can save one.'

/** The action bar's button must fill its half, tooltip wrapper included. */
function Full({ children }: { children: ReactNode }) {
  return <div className="[&>span]:flex [&>span]:w-full">{children}</div>
}

export function PhoneWeeklyPlan() {
  const router = useRouter()
  const { me, error, retry } = useMeStatus()
  usePhoneAppBar({ title: 'Weekly plan', back: '/more' })

  if (!me) {
    return error ? (
      <EmptyState variant="failed" heading="Could not load your weekly plan" onAction={retry}>
        We could not check who you are signed in as, so the plan cannot be opened yet.
      </EmptyState>
    ) : (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (!me.userId) {
    /* The login exists but is not linked to a row in Masters, so there is
       nobody to hold a plan. Masters is computer-only, so no link to it here. */
    return (
      <EmptyState
        variant="nothing-yet"
        heading="Your login is not linked to a user"
        actionLabel="Go to home"
        onAction={() => router.push('/today')}
      >
        A weekly plan belongs to a user record, and this login has none yet. Ask an
        administrator to add you in Masters, then come back to this screen.
      </EmptyState>
    )
  }

  const wp = me.permissions?.weekly_plan
  return (
    <PhonePlanEditor
      canEditPlan={Boolean(wp?.edit)}
      // `create ?? edit` is the same expression /api/auth/me and permissions.ts use.
      canCreate={Boolean(wp?.create ?? wp?.edit)}
    />
  )
}

function PhonePlanEditor({ canCreate, canEditPlan }: { canCreate: boolean; canEditPlan: boolean }) {
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
    updateExpectedInDialog, saveLine, removeLine, dialogParty,
    updateGoalText, toggleGoal, addGoal, removeGoal, dayData,
  } = usePlanEditor({ canCreate, canEditPlan })

  /* The priorities are one tap away on a phone: collapsed until asked for. */
  useEffect(() => { setPrioritiesOpen(false) }, [setPrioritiesOpen])

  /*
   * Unsaved edits: what the screen holds against what the server holds, both
   * reduced to what a save would send. The desktop keeps edits per week in
   * memory (a week change loses nothing); the phone keeps that and adds the
   * kit's leave warning (41.7 rule 3) for the shell's back arrow and tabs.
   */
  const baseline = useMemo(() => {
    const dd = plan ? planItemsToDayData(plan.weekly_plan_items, weekDays) : {}
    const written = goalsFromPlan(plan).map(g => g.text.trim()).filter(Boolean)
    return JSON.stringify([dayDataToPlanItems(dd), written])
  }, [plan, weekDays])
  const current = JSON.stringify([
    dayDataToPlanItems(dayData),
    goals.map(g => g.text.trim()).filter(Boolean),
  ])
  const changed = !loading && !loadError && statusEditable && baseline !== current
  const { warning } = usePhoneFormGuard(changed)

  const partyOptions: PickerOption[] = useMemo(
    () => parties.map((p: PlanPartyOption) => ({
      id: p.id,
      label: p.name,
      sublabel: [p.type === 'company' ? 'Account' : 'Contact', p.subtitle].filter(Boolean).join(' · '),
    })),
    [parties],
  )
  const partyValue: PickerOption | null = editing?.entry.partyId
    ? partyOptions.find(o => o.id === editing.entry.partyId)
      ?? { id: editing.entry.partyId, label: 'Party not in your list' }
    : null

  const todayInWeek = weekDays.includes(todayStr) ? todayStr : null

  return (
    <div className="flex flex-col gap-3">
      {/* Week changer: the plan is per week, and Sunday evening plans the next one. */}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="icon" onClick={() => navigateWeek(-1)} aria-label="Previous week">
          <ChevronLeftIcon />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-body font-medium text-text-primary tabular-nums">{formatWeekRange(monday)}</p>
          {plan && (
            <div className="mt-1 flex justify-center">
              <StatusBadge vocabulary={WEEKLY_PLAN_STATUS} status={plan.status} />
            </div>
          )}
        </div>
        <Button variant="secondary" size="icon" onClick={() => navigateWeek(1)} aria-label="Next week">
          <ChevronRightIcon />
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : loadError ? (
        <EmptyState variant="failed" heading="Could not load this week" onAction={() => loadPlan(true)}>
          The plan for {formatWeekRange(monday)} did not load. Nothing you had typed has been
          sent, so it is safe to try again.
        </EmptyState>
      ) : (
        <>
          {plan?.status === 'Approved' && (
            <Note tone="success" title="Plan Approved">
              {plan.manager_comment && <p className="mt-1 text-label">{plan.manager_comment}</p>}
              {plan.reopen_requested && (
                <p className="mt-1 text-meta italic">Reopen request sent — awaiting manager response</p>
              )}
            </Note>
          )}
          {plan?.status === 'Rejected' && (
            <Note tone="danger" title="Plan Rejected — please revise and resubmit">
              {plan.manager_comment && <p className="mt-1 text-label">{plan.manager_comment}</p>}
            </Note>
          )}
          {plan?.status === 'Edited by Manager' && (
            <Note
              tone="primary"
              title={
                returnedAsSuggestion
                  ? 'Your manager suggested changes — update your plan and resubmit'
                  : 'Plan Edited by Manager — review the changes and resubmit'
              }
            >
              {plan.manager_comment && <p className="mt-1 text-label">{plan.manager_comment}</p>}
              {latestManagerEdit && (
                <div className="mt-2">
                  <p className="text-meta font-medium">{changeCountLabel(latestManagerEdit)} to your plan</p>
                  <ManagerChanges changes={latestManagerEdit} className="mt-1" />
                </div>
              )}
            </Note>
          )}
          {plan?.status === 'On Hold' && (
            <Note tone="warning" title="Plan On Hold">
              {plan.manager_comment && <p className="mt-1 text-label">{plan.manager_comment}</p>}
              {plan.reopen_requested && (
                <p className="mt-1 text-meta italic">Reopen request sent — awaiting manager response</p>
              )}
            </Note>
          )}
          {isSubmittedAwaitingReview && (
            <Note tone="primary" title="Awaiting manager review">
              {plan?.reopen_requested && <p className="mt-1 text-meta italic">Reopen request sent</p>}
            </Note>
          )}

          <DayPicker
            days={weekDays}
            counts={countsByDay}
            selected={mobileDay}
            today={todayInWeek}
            onSelect={setSelectedDay}
          />
          <PlanDayList
            day={mobileDay}
            lines={lines}
            canEdit={canEdit}
            onOpenLine={openEdit}
            onAdd={() => openAdd(mobileDay)}
          />

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

          {plan && (
            <ul className="flex flex-col divide-y divide-border-light rounded-xl border border-border-light bg-surface">
              <li>
                <RelatedRow icon={<HistoryIcon className="size-5 text-text-secondary" aria-hidden />} onClick={loadLogs}>
                  History
                </RelatedRow>
              </li>
              <li>
                <RelatedRow icon={<MessageSquareIcon className="size-5 text-text-secondary" aria-hidden />} onClick={() => setRemarksOpen(true)}>
                  Chat with your manager
                </RelatedRow>
              </li>
            </ul>
          )}
        </>
      )}

      {/* The action bar: what this plan's status lets the owner do next. */}
      {!loading && !loadError && statusEditable && (
        <ActionBar label="Plan actions">
          <Full>
            <PermissionTooltip allowed={canWrite} reason={plan ? SAVE_REASON_EXISTING : SAVE_REASON_NEW}>
              <Button variant="secondary" className="w-full" onClick={handleSaveDraft} disabled={saving || !canWrite}>
                Save draft
              </Button>
            </PermissionTooltip>
          </Full>
          <Full>
            <PermissionTooltip
              allowed={canSubmit}
              reason={canEditPlan
                ? 'Only someone who can create weekly plans can submit a new one.'
                : 'Only someone who can edit weekly plans can submit one.'}
            >
              <Button className="w-full" onClick={handleSubmit} disabled={saving || !canSubmit}>
                {saving ? 'Working…' : 'Submit plan'}
              </Button>
            </PermissionTooltip>
          </Full>
        </ActionBar>
      )}
      {!loading && !loadError && !statusEditable && isSubmittedAwaitingReview && undoSecondsLeft > 0 && (
        <ActionBar label="Plan actions">
          <Full>
            <PermissionTooltip allowed={canEditPlan} reason={PLAN_EDIT_REASON}>
              <Button variant="secondary" className="w-full" onClick={handleUndo} disabled={saving || !canEditPlan}>
                Undo submit ({formatCountdown(undoSecondsLeft)})
              </Button>
            </PermissionTooltip>
          </Full>
        </ActionBar>
      )}
      {!loading && !loadError && !statusEditable && canRequestReopen && (
        <ActionBar label="Plan actions">
          <Full>
            <PermissionTooltip allowed={canEditPlan} reason={PLAN_EDIT_REASON}>
              <Button variant="secondary" className="w-full" onClick={() => setReopenModal(true)} disabled={!canEditPlan}>
                Request reopen
              </Button>
            </PermissionTooltip>
          </Full>
        </ActionBar>
      )}

      {/* Add / edit one line: a full-screen form on a phone. */}
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
          <StaticPickerSheetField
            value={partyValue}
            options={partyOptions}
            label="Account or contact"
            placeholder="Choose an account or contact"
            disabled={!canEdit}
            onChange={option => {
              const found = parties.find(p => p.id === option.id)
              if (found) selectPartyInDialog(found)
            }}
          />
        }
        onExpectedValueChange={updateExpectedInDialog}
        onSave={saveLine}
        onRemove={removeLine}
        onClose={() => setEditing(null)}
      />

      <PartylessSaveDialog
        open={confirmDrop}
        count={partylessCount}
        onCancel={() => setConfirmDrop(false)}
        onConfirm={() => { setConfirmDrop(false); void saveDraft() }}
      />

      <PlanHistoryLayer open={logsOpen} onOpenChange={setLogsOpen} logs={logs} description={formatWeekRange(monday)} />

      <RequestReopenDialog
        size="sm"
        open={reopenModal}
        onOpenChange={next => { setReopenModal(next); if (!next) setReopenMessage('') }}
        message={reopenMessage}
        onMessageChange={setReopenMessage}
        sending={reopening}
        onSend={handleRequestReopen}
      />

      {plan && (
        <RemarksPanel
          isOpen={remarksOpen}
          onClose={() => setRemarksOpen(false)}
          contextType="weekly_plan"
          contextId={plan.id}
          contextTitle={`Weekly Plan — ${formatWeekRange(monday)}`}
        />
      )}

      {warning}
    </div>
  )
}

const NOTE_TONE = {
  success: 'border-success-border bg-success-bg text-success',
  danger: 'border-danger-border bg-danger-bg text-danger',
  warning: 'border-warning-border bg-warning-bg text-warning',
  primary: 'border-primary-border bg-primary-subtle text-primary',
} as const

/** A status note. Its words wrap in full: the manager's reason is the point. */
function Note({
  tone,
  title,
  children,
}: {
  tone: keyof typeof NOTE_TONE
  title: string
  children?: ReactNode
}) {
  return (
    <div className={`rounded-xl border px-4 py-2.5 ${NOTE_TONE[tone]}`}>
      <p className="text-label font-medium">{title}</p>
      {children}
    </div>
  )
}

function RelatedRow({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode
  onClick: () => void
  children: ReactNode
}) {
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
