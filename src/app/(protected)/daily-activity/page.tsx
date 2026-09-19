'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PlusIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'
import RemarksPanel from '@/components/ui/RemarksPanel'
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
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AddMeetingDialog, type MeetingDraft } from '@/components/daily-activity/add-meeting-dialog'
import { AttendanceCard } from '@/components/daily-activity/attendance-card'
import { ExpensesTab } from '@/components/daily-activity/expenses-tab'
import { OrderEntryDialog } from '@/components/daily-activity/order-entry-dialog'
import { PlannedCard } from '@/components/daily-activity/planned-card'
import { SummaryTab } from '@/components/daily-activity/summary-tab'
import { VisitCard } from '@/components/daily-activity/visit-card'
import { WeekStrip } from '@/components/daily-activity/week-strip'
import {
  Expense,
  getPosition,
  PlannedItem,
  reverseGeocode,
  toDateStr,
  Visit,
} from '@/components/daily-activity/types'

/**
 * Daily Activity — P3-T5, §5.3.
 *
 * WHAT CHANGED, against the four rules:
 *
 *  1. **Approved plan items appear automatically.** The Meetings list is
 *     the union of the day's meetings and the day's APPROVED weekly-plan
 *     lines, from `/api/daily-activity/plan`. A line that names a party
 *     starts a meeting with that party directly; nothing is selected
 *     from a dropdown that the plan already decided.
 *  2. **The Plan tab is gone.** Three tabs remain — Meetings, Expenses,
 *     Summary. The plan is not a place to visit; it is the top of the
 *     list of what to do, and the target the Summary compares against.
 *  3. **Check-in reads as Present.** See `attendance-card.tsx`.
 *  4. **Nothing locks after check-out.** There is no `checkedOut` in
 *     this file. Every disable on the screen is either a permission
 *     (`role_permissions`, never a role name) or the future-date guard
 *     the server enforces anyway. A day that is closed for attendance is
 *     still open for meetings, orders and expenses.
 *
 * DELIBERATELY NOT BUILT HERE — P3-T7 (the single start/stop toggle),
 * P3-T9 (inside-a-meeting), P3-T10 (past / manual entry) and P3-T11
 * (cross-links) are separate tasks. The screen was split into
 * `src/components/daily-activity/*` so each of them has one small file
 * to attach to; start and stop are still two buttons, on purpose.
 *
 * LAYOUT — the header row, the week strip and the tab bar are pinned;
 * only the list under them scrolls, so the primary action is reachable
 * at any scroll position. The old screen was a `max-w-2xl` column with a
 * floating action button that overlapped the last card.
 *
 * F4/F5 — the attendance PANEL that used to sit between the header and
 * the week strip is gone. It is a chip on the header row now
 * (`attendance-card.tsx`), check-in/check-out sit beside it, and the two
 * meeting buttons became one dialog with a toggle. Nothing was dropped:
 * every sentence the panel carried lives in the chip's popover.
 */
function DailyActivityInner() {
  const { toast } = useToast()
  const me = useMe()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [selectedDate, setSelectedDate] = useState(() => searchParams.get('date') ?? toDateStr(new Date()))
  const [activeTab, setActiveTab] = useState<string>(searchParams.get('tab') ?? 'meetings')

  const [visits, setVisits] = useState<Visit[]>([])
  const [visitsLoading, setVisitsLoading] = useState(true)
  const [planned, setPlanned] = useState<PlannedItem[]>([])
  const [plannedLoading, setPlannedLoading] = useState(true)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [expensesLoading, setExpensesLoading] = useState(true)

  const [acting, setActing] = useState(false)
  const [startingPlanItem, setStartingPlanItem] = useState<string | null>(null)
  const [meetingDialog, setMeetingDialog] = useState<{ open: boolean; planItem: PlannedItem | null }>({ open: false, planItem: null })
  const [orderEntry, setOrderEntry] = useState<Visit | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Visit | null>(null)
  const [locationDenied, setLocationDenied] = useState<{ visitId: string; action: 'start' | 'stop' } | null>(null)
  const [userNames, setUserNames] = useState<Record<string, string>>({})

  const [remarksPanel, setRemarksPanel] = useState<{ contextType: 'meeting' | 'expense'; contextId: string; title: string } | null>(null)
  const initialRemarks = searchParams.get('remarks')
  useEffect(() => {
    if (initialRemarks) setRemarksPanel({ contextType: 'meeting', contextId: initialRemarks, title: 'Remarks' })
  }, [initialRemarks])

  // Permissions come from role_permissions through /api/auth/me. Never a
  // role name: `users.profile` reads "Standard" for everyone in this
  // database, and the effective role lives in `roles.name`.
  const perms = me?.permissions
  const canLogMeeting = !!perms?.meetings?.edit
  const canDeleteMeeting = !!perms?.meetings?.delete
  const canAddExpense = !!perms?.expenses?.edit
  const canDeleteExpense = !!perms?.expenses?.delete

  const isFuture = selectedDate > toDateStr(new Date())

  const loadVisits = useCallback(async () => {
    setVisitsLoading(true)
    try {
      const r = await fetch(`/api/daily-activity?date=${selectedDate}`)
      setVisits(r.ok ? await r.json() : [])
    } catch {
      setVisits([])
    }
    setVisitsLoading(false)
  }, [selectedDate])

  const loadPlanned = useCallback(async () => {
    setPlannedLoading(true)
    try {
      const r = await fetch(`/api/daily-activity/plan?date=${selectedDate}`)
      const d = r.ok ? await r.json() : { items: [] }
      setPlanned(Array.isArray(d.items) ? d.items : [])
    } catch {
      setPlanned([])
    }
    setPlannedLoading(false)
  }, [selectedDate])

  const loadExpenses = useCallback(async () => {
    setExpensesLoading(true)
    try {
      const r = await fetch(`/api/expenses?date=${selectedDate}`)
      const d = r.ok ? await r.json() : []
      setExpenses(Array.isArray(d) ? d : [])
    } catch {
      setExpenses([])
    }
    setExpensesLoading(false)
  }, [selectedDate])

  useEffect(() => { void loadVisits() }, [loadVisits])
  useEffect(() => { void loadPlanned() }, [loadPlanned])
  useEffect(() => { void loadExpenses() }, [loadExpenses])

  /*
   * Whose day is on screen. `/api/daily-activity` is Self/Team/Company
   * since P4-T1, so a Team-scoped manager's list spans several people and
   * a row without a name on it is unattributable. The names are fetched
   * ONLY when the list actually spans more than one person — a Self-scoped
   * executive never makes this request.
   */
  const ownerIds = useMemo(
    () => Array.from(new Set([...visits.map(v => v.user_id), ...planned.map(p => p.user_id)].filter(Boolean) as string[])),
    [visits, planned]
  )
  const multiUser = ownerIds.length > 1
  useEffect(() => {
    if (!multiUser || Object.keys(userNames).length > 0) return
    fetch('/api/masters/users')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: { id: string; name: string }[]) => {
        if (Array.isArray(rows)) setUserNames(Object.fromEntries(rows.map(u => [u.id, u.name])))
      })
      .catch(() => {})
  }, [multiUser, userNames])

  // Week navigation, relative to the week currently in view rather than to
  // "today", so paging back twice lands two weeks back.
  const shiftWeek = useCallback((weeks: number) => {
    setSelectedDate(prev => {
      const d = new Date(prev + 'T00:00:00')
      d.setDate(d.getDate() + weeks * 7)
      return toDateStr(d)
    })
  }, [])

  /**
   * F5 — ONE handler, because there is now one form.
   *
   * `handleAddManual` used to sit beside this, differing only in its
   * error copy and which dialog it closed. The merged dialog owns both
   * modes, so the only thing left that varies is the noun in the toast.
   * The provenance fields (`is_manual_entry`, `manual_start_time`,
   * `manual_end_time`) ride through untouched and the server decides
   * what they mean; nothing here can turn a typed time into a captured
   * one.
   */
  async function handleAdd(partial: MeetingDraft) {
    if (isFuture) { toast('Meetings cannot be logged for a future date', 'error'); return }
    const past = partial.is_manual_entry === true
    const r = await fetch('/api/daily-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...partial, visit_date: selectedDate }),
    })
    if (!r.ok) {
      toast((await r.json()).error ?? `Failed to log the ${past ? 'past ' : ''}meeting`, 'error')
      return
    }
    setMeetingDialog({ open: false, planItem: null })
    await loadVisits()
  }

  /**
   * §5.3 rule 1, the whole point: a planned line that names a party
   * becomes a started meeting in one press. The visit is created with the
   * party the plan chose and stamped with the plan line, then started
   * through the same path as any other meeting.
   */
  async function handleStartPlanned(item: PlannedItem) {
    if (!item.party_id || !item.party_name) return
    setStartingPlanItem(item.id)
    const r = await fetch('/api/daily-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visit_date: selectedDate,
        visit_type: item.party_visit_type ?? item.party_type ?? 'Dealer',
        entity_id: item.party_id,
        entity_name: item.party_name,
        is_new_entity: false,
        weekly_plan_item_id: item.id,
      }),
    })
    if (!r.ok) {
      toast((await r.json()).error ?? 'Could not start the planned meeting', 'error')
      setStartingPlanItem(null)
      return
    }
    const created: Visit = await r.json()
    await loadVisits()
    setStartingPlanItem(null)
    await handleStart(created.id)
  }

  async function handleStart(id: string) {
    if (acting) return
    setActing(true)
    const pos = await getPosition()
    if (pos && 'denied' in pos) {
      setActing(false)
      setLocationDenied({ visitId: id, action: 'start' })
      return
    }
    const body: Record<string, unknown> = { action: 'start', latitude: null, longitude: null, address: null }
    if (pos) {
      body.latitude = pos.latitude
      body.longitude = pos.longitude
      body.address = await reverseGeocode(pos.latitude, pos.longitude)
    }
    const r = await fetch(`/api/daily-activity/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      const err = await r.json()
      toast(err.error ?? 'Could not start the meeting', 'error')
      if (typeof err.error === 'string' && err.error.includes('active')) await loadVisits()
    } else {
      await loadVisits()
    }
    setActing(false)
  }

  async function handleStop(id: string) {
    if (acting) return
    setActing(true)
    const pos = await getPosition()
    if (pos && 'denied' in pos) {
      setActing(false)
      setLocationDenied({ visitId: id, action: 'stop' })
      return
    }
    const body: Record<string, unknown> = { action: 'stop', end_latitude: null, end_longitude: null, end_address: null }
    if (pos) {
      body.end_latitude = pos.latitude
      body.end_longitude = pos.longitude
      body.end_address = await reverseGeocode(pos.latitude, pos.longitude)
    }
    const r = await fetch(`/api/daily-activity/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) toast((await r.json()).error ?? 'Could not stop the meeting', 'error')
    else await loadVisits()
    setActing(false)
  }

  async function confirmDeleteVisit() {
    const target = pendingDelete
    setPendingDelete(null)
    if (!target) return
    const r = await fetch(`/api/daily-activity/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    })
    if (!r.ok) toast((await r.json()).error ?? 'Failed to delete the meeting', 'error')
    else await loadVisits()
  }

  async function handleNotesUpdate(id: string, notes: string) {
    const r = await fetch(`/api/daily-activity/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_notes', notes }),
    })
    if (r.ok) {
      const updated = await r.json()
      // In place, same key — the card the user is typing in is not
      // destroyed and rebuilt.
      setVisits(prev => prev.map(v => (v.id === id ? { ...v, notes: updated.notes } : v)))
    }
  }

  /**
   * A planned line stops standing on its own once a meeting carries its
   * id — from then on the meeting IS the line, and showing both would be
   * the same work listed twice.
   */
  const openPlanned = useMemo(() => {
    const claimed = new Set(visits.map(v => v.weekly_plan_item_id).filter(Boolean) as string[])
    return planned.filter(p => !claimed.has(p.id))
  }, [planned, visits])

  const displayDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const activeCount = visits.filter(v => v.status === 'Active').length
  const doneCount = visits.filter(v => v.status === 'Completed').length
  const manualCount = visits.filter(v => v.is_manual_entry).length

  return (
    <Tabs value={activeTab} onValueChange={v => setActiveTab(String(v))} className="h-full">
      <div className="flex h-full flex-col gap-3">
        {/*
          ZONE 1 — pinned, and F4's whole point: as short as it can be.

          It used to be three stacked blocks — a title row, a full-width
          attendance panel, then the week strip — above a tab bar, on a
          screen whose only scrolling region is the list underneath. The
          attendance panel alone was ~72px plus its 12px gap of permanent
          chrome saying things that are true all day and change twice.

          Now: one header row carrying the title, the attendance chip,
          check-in/check-out and the single meeting button; then the week
          strip, promoted to just under it as Aryan asked; then the tabs.
          Everything the panel said is still reachable, one press away in
          the chip's popover, including the load-bearing sentence that
          check-out locks nothing.
        */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-section font-medium text-text-primary">Daily Activity</h1>
            <p className="text-body text-text-secondary">{displayDate}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {/* Attendance and its buttons sit next to the day they
                describe, not in a panel of their own. */}
            <AttendanceCard selectedDate={selectedDate} canMark={canLogMeeting} />
            {canLogMeeting && !isFuture && (
              <Button
                onClick={() => setMeetingDialog({ open: true, planItem: null })}
                className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
                size="sm"
              >
                <PlusIcon />
                Log a meeting
              </Button>
            )}
          </div>
        </div>

        <div className="shrink-0">
          <WeekStrip
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onPrevWeek={() => shiftWeek(-1)}
            onNextWeek={() => shiftWeek(1)}
            calendarApiBase="/api/daily-activity/calendar"
          />
        </div>

        <TabsList className="shrink-0">
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        {/* ZONE 2 — the only scrolling zone. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="meetings" className="pt-4">
            {visitsLoading || plannedLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}
              </div>
            ) : visits.length === 0 && openPlanned.length === 0 ? (
              <EmptyState
                variant="nothing-yet"
                heading="Nothing on this day"
                actionLabel="Log a meeting"
                onAction={canLogMeeting && !isFuture ? () => setMeetingDialog({ open: true, planItem: null }) : undefined}
              >
                {isFuture
                  ? 'Meetings cannot be logged for a future date.'
                  : 'Approved weekly-plan lines appear here on their own. Anything unplanned is logged by hand.'}
              </EmptyState>
            ) : (
              <div className="space-y-4">
                <p className="text-body text-text-secondary">
                  {openPlanned.length > 0 && <>{openPlanned.length} planned · </>}
                  {visits.length} logged
                  {activeCount > 0 && <> · {activeCount} active</>}
                  {doneCount > 0 && <> · {doneCount} done</>}
                  {manualCount > 0 && <> · {manualCount} manually entered</>}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {openPlanned.map(item => (
                    <PlannedCard
                      key={item.id}
                      item={item}
                      showOwner={multiUser}
                      canStart={canLogMeeting && !isFuture && item.user_id === me?.userId}
                      starting={startingPlanItem === item.id}
                      onStart={handleStartPlanned}
                      onAddMeeting={p => setMeetingDialog({ open: true, planItem: p })}
                    />
                  ))}
                  {/*
                    P3-T11 removed the ribbon that used to wrap each card
                    here. `is_manual_entry` is on `Visit` now and
                    `visit-card.tsx` marks it beside the card's own badges,
                    so the wrapper was a second copy of one fact — and a copy
                    that only existed on this one screen, which meant any
                    other list of meetings silently lost the distinction.
                  */}
                  {visits.map(visit => (
                    <VisitCard
                      key={visit.id}
                      visit={visit}
                      showOwner={multiUser}
                      ownerName={visit.user_id ? userNames[visit.user_id] : null}
                      /* A manager may read the team's meetings and may not
                         drive someone else's stopwatch. */
                      canEdit={canLogMeeting && (!visit.user_id || visit.user_id === me?.userId)}
                      canDelete={canDeleteMeeting && (!visit.user_id || visit.user_id === me?.userId)}
                      onStart={handleStart}
                      onStop={handleStop}
                      onDelete={setPendingDelete}
                      onOrderEntry={setOrderEntry}
                      onRemarks={v => setRemarksPanel({ contextType: 'meeting', contextId: v.id, title: v.entity_name })}
                      onNotesUpdate={handleNotesUpdate}
                    />
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="expenses" className="pt-4">
            <ExpensesTab
              selectedDate={selectedDate}
              isFuture={isFuture}
              canAdd={canAddExpense}
              canDelete={canDeleteExpense}
              expenses={expenses}
              loading={expensesLoading}
              onReload={loadExpenses}
              onOpenRemarks={id => setRemarksPanel({ contextType: 'expense', contextId: id, title: 'Expense' })}
            />
          </TabsContent>

          <TabsContent value="summary" className="pt-4">
            <SummaryTab visits={visits} expenses={expenses} planned={planned} plannedLoading={plannedLoading} />
          </TabsContent>
        </div>
      </div>

      <AddMeetingDialog
        open={meetingDialog.open}
        onOpenChange={v => setMeetingDialog(s => ({ open: v, planItem: v ? s.planItem : null }))}
        planItem={meetingDialog.planItem}
        visitDate={selectedDate}
        onAdd={handleAdd}
      />

      {orderEntry && (
        <OrderEntryDialog visit={orderEntry} onClose={() => setOrderEntry(null)} onSaved={loadVisits} />
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={v => { if (!v) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `${pendingDelete.entity_name} will be removed from this day. This cannot be undone.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteVisit}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Location is refused by the BROWSER, not by this app, so the way
          out is an instruction plus a retry — never a dead end. */}
      <Dialog open={!!locationDenied} onOpenChange={v => { if (!v) setLocationDenied(null) }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Location is blocked</DialogTitle>
            <DialogDescription>
              Your browser is refusing location access, which this meeting&apos;s start and end positions need.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-1 text-body text-text-secondary">
            <p>Open the lock or info icon in the address bar.</p>
            <p>Set Location to Allow.</p>
            <p>Then try again.</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setLocationDenied(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const pending = locationDenied
                setLocationDenied(null)
                if (!pending) return
                if (pending.action === 'start') void handleStart(pending.visitId)
                else void handleStop(pending.visitId)
              }}
            >
              Try again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {remarksPanel && (
        <RemarksPanel
          isOpen={!!remarksPanel}
          onClose={() => {
            setRemarksPanel(null)
            if (searchParams.get('remarks')) router.replace('/daily-activity')
          }}
          contextType={remarksPanel.contextType}
          contextId={remarksPanel.contextId}
          contextTitle={remarksPanel.title}
        />
      )}
    </Tabs>
  )
}

export default function DailyActivityPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
      <DailyActivityInner />
    </Suspense>
  )
}
