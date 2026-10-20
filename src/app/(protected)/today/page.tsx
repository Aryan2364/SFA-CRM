'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, ChevronDownIcon, MapPinCheckIcon, MapPinIcon, ReceiptIcon } from 'lucide-react'

import { useLayout } from '@/lib/layout'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { setPhoneTabBadge } from '@/components/shell/phone-tab-badges'
import { PhoneList, PhoneListRow } from '@/components/ui/phone-list'
import { BottomSheet, BottomSheetOption } from '@/components/ui/bottom-sheet'
import { whenLayersSettled } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { fmtAmount, fmtDate } from '@/lib/format'
import { loadJson, loadList } from '@/lib/load-list'
import {
  formatTime,
  reverseGeocode,
  toDateStr,
  type AttendanceRecord,
  type Expense,
  type FollowUpItem,
  type MissedTodo,
  type NextMeetingItem,
  type Visit,
} from '@/components/daily-activity/types'

/**
 * Activity â phone home (owner decision, Â§41.15), rebuilt on the Opportunities
 * phone list (`phone-deals-page.tsx`) per the owner's "make it like the
 * opportunity page" feedback: a searchable, filterable list of meetings and
 * expenses for one day at a time, with a floating "+" to log either, rather
 * than a page of fixed sections.
 *
 * Still carries: the slim check-in/out line (owner: attendance needs no big
 * card), and the tab badge (approvals waiting + overdue follow-ups).
 */

type ApprovalRow = { id: string; user_id: string; user_name?: string; week_start?: string; status: string }

type DayVisit = Visit & { visit_date?: string }
type DayExpense = Expense

type Chip = 'all' | 'meetings' | 'expenses' | 'followups' | 'upcoming' | 'approvals'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Pure calendar-day arithmetic on a "YYYY-MM-DD" string â no timezone, no
 *  reading the process clock (that is `toDateStr(new Date())`, done once by
 *  the caller for "today"). Mirrors `src/lib/business-date.ts`'s `addDays`. */
function addDaysStr(dateOnly: string, days: number): string {
  const t = Date.parse(`${dateOnly}T00:00:00.000Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

function dayLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today'
  if (dateStr === addDaysStr(todayStr, -1)) return 'Yesterday'
  if (dateStr === addDaysStr(todayStr, 1)) return 'Tomorrow'
  return fmtDate(dateStr)
}

/** "today" / "yesterday" / "tomorrow", else "on 19 Oct 2026" — for "Nothing …" sentences. */
function onDay(dateStr: string, todayStr: string): string {
  const label = dayLabel(dateStr, todayStr)
  return label === fmtDate(dateStr) ? `on ${label}` : label.toLowerCase()
}

export default function TodayPage() {
  const { layout } = useLayout()
  const router = useRouter()

  useEffect(() => {
    if (layout === 'desktop') router.replace('/')
  }, [layout, router])

  if (layout === 'desktop') return null
  return (
    <Suspense fallback={null}>
      <ActivityPhone />
    </Suspense>
  )
}

function ActivityPhone() {
  const me = useMe()
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const todayStr = toDateStr(new Date())

  const dateParam = searchParams.get('date')
  const date = dateParam && DATE_ONLY.test(dateParam) ? dateParam : todayStr

  function goToDate(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === todayStr) params.delete('date')
    else params.set('date', next)
    const qs = params.toString()
    router.replace(qs ? `/today?${qs}` : '/today')
  }

  // ---- Attendance (always "today", regardless of the day being browsed) --
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null)
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  // A failed load is "unknown", never "not checked in".
  const [attendanceFailed, setAttendanceFailed] = useState(false)
  const [marking, setMarking] = useState(false)

  const perms = me?.permissions
  const canMarkAttendance = !!perms?.meetings?.view
  const canLogMeeting = !!perms?.meetings?.create
  const canAddExpense = !!perms?.expenses?.create
  const canViewApprovals = !!perms?.weekly_plan?.view

  const loadAttendance = useCallback(async () => {
    setAttendanceLoading(true)
    const res = await loadJson<AttendanceRecord | null>(`/api/attendance?date=${todayStr}`)
    if (res.ok) {
      setAttendance(res.data)
      setAttendanceFailed(false)
    } else {
      setAttendance(null)
      setAttendanceFailed(true)
    }
    setAttendanceLoading(false)
  }, [todayStr])

  useEffect(() => { void loadAttendance() }, [loadAttendance])

  /*
   * Asks the phone for its location at the moment of the tap (Â§41.16 rules
   * 1â3). The browser shows its own "allow location?" question the first
   * time; when the answer is no, or the phone's location is switched off,
   * the person is told which of the two it is and how to fix it.
   */
  function readLocation(): Promise<
    { position: { latitude: number; longitude: number } | null } | { problem: string }
  > {
    return new Promise(resolve => {
      // Browsers only give location to https pages. Production is https;
      // a plain-http test address checks in without a location.
      if (!window.isSecureContext || !navigator.geolocation) {
        resolve({ position: null })
        return
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ position: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } }),
        err => {
          if (err.code === err.PERMISSION_DENIED) {
            resolve({ problem: "Location is blocked for this app. Allow it in your browser's site settings, then tap again." })
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            resolve({ problem: "Your phone's location is turned off. Turn on Location, then tap again." })
          } else {
            resolve({ problem: 'Could not find your location in time. Move to an open spot and tap again.' })
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      )
    })
  }

  async function markAttendance(action: 'check-in' | 'check-out'): Promise<boolean> {
    if (marking) return false
    setMarking(true)
    const reading = await readLocation()
    if ('problem' in reading) {
      toast(reading.problem, 'error')
      setMarking(false)
      return false
    }
    const pos = reading.position
    let address: string | null = null
    let latitude: number | null = null
    let longitude: number | null = null
    if (pos) {
      latitude = pos.latitude
      longitude = pos.longitude
      address = await reverseGeocode(pos.latitude, pos.longitude)
    }
    let ok = false
    try {
      const r = await fetch(`/api/attendance/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude, longitude, address }),
      })
      if (!r.ok) {
        toast((await r.json().catch(() => ({}))).error ?? 'Could not record attendance', 'error')
      } else {
        toast(address ? `${action === 'check-in' ? 'Checked in' : 'Checked out'} at ${address}` : (action === 'check-in' ? 'Checked in' : 'Checked out'), 'success')
        await loadAttendance()
        ok = true
      }
    } catch {
      toast('The connection dropped. Check your connection and try again.', 'error')
    } finally {
      setMarking(false)
    }
    return ok
  }

  // ---- Attendance: app-bar icon + sheet ------------------------------------
  const [attendanceOpen, setAttendanceOpen] = useState(false)
  const checkedInAt = attendance?.check_in_time ?? null
  const checkedOutAt = attendance?.check_out_time ?? null
  const checkInAddress = attendance?.check_in_address ?? null

  // Built from primitives only, so the node is stable between renders â the
  // app bar stores it in context, and a fresh node every render loops.
  const appBarActions = useMemo(() => {
    if (!canMarkAttendance) return undefined
    const ended = !!checkedInAt && !!checkedOutAt
    const checkedIn = !!checkedInAt && !checkedOutAt
    const label = attendanceLoading
      ? 'Attendance'
      : attendanceFailed
        ? 'Attendance: could not load'
      : ended
        ? 'Attendance: day ended'
        : checkedIn
          ? `Attendance: checked in at ${formatTime(checkedInAt)}`
          : 'Attendance: not checked in'
    return (
      <button
        type="button"
        aria-label={label}
        disabled={attendanceLoading}
        onClick={() => setAttendanceOpen(true)}
        className={`relative flex size-11 shrink-0 items-center justify-center rounded-lg active:bg-white/10 disabled:opacity-60 ${attendanceFailed ? 'opacity-60' : ''}`}
      >
        {!attendanceLoading && !attendanceFailed && (checkedIn || ended) ? (
          <MapPinCheckIcon aria-hidden className={ended ? 'size-[22px] opacity-60' : 'size-[22px]'} />
        ) : (
          <MapPinIcon aria-hidden className="size-[22px]" />
        )}
        {!attendanceLoading && !attendanceFailed && !checkedIn && !ended ? (
          <span aria-hidden className="absolute top-2.5 right-2.5 size-2.5 rounded-full border border-primary bg-warning" />
        ) : null}
      </button>
    )
  }, [canMarkAttendance, attendanceLoading, attendanceFailed, checkedInAt, checkedOutAt])
  usePhoneAppBar({ title: 'Activity', actions: appBarActions })

  // ---- Day data: meetings, expenses, follow-ups/next-meetings for `date` --
  const [state, setState] = useState<'loading' | 'failed' | 'ready'>('loading')
  const [visits, setVisits] = useState<DayVisit[]>([])
  const [expenses, setExpenses] = useState<DayExpense[]>([])
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([])
  const [nextMeetings, setNextMeetings] = useState<NextMeetingItem[]>([])
  const [missed, setMissed] = useState<MissedTodo[]>([])

  const load = useCallback(async () => {
    setState('loading')
    const [visitsRes, expensesRes, todosRes] = await Promise.all([
      loadList<DayVisit>(`/api/daily-activity?date=${date}`),
      loadList<DayExpense>(`/api/expenses?date=${date}`),
      loadJson<{ followups?: FollowUpItem[]; nextMeetings?: NextMeetingItem[]; missed?: MissedTodo[] }>(
        `/api/daily-activity/todos?date=${date}`
      ),
    ])
    // Any failed piece is a failed day: a half-loaded list would read as "nothing".
    if (!visitsRes.ok || !expensesRes.ok || !todosRes.ok) {
      setState('failed')
      return
    }
    const todos = todosRes.data ?? {}
    setVisits(visitsRes.data)
    setExpenses(expensesRes.data)
    setFollowUps(Array.isArray(todos.followups) ? todos.followups : [])
    setNextMeetings(Array.isArray(todos.nextMeetings) ? todos.nextMeetings : [])
    setMissed(Array.isArray(todos.missed) ? todos.missed : [])
    setState('ready')
  }, [date])

  useEffect(() => { void load() }, [load])

  // ---- Upcoming chip: ignores `date`, all future follow-ups/next-meetings -
  const [upcoming, setUpcoming] = useState<{ followUps: FollowUpItem[]; nextMeetings: NextMeetingItem[] } | null>(null)
  const [upcomingLoading, setUpcomingLoading] = useState(false)
  const [upcomingFailed, setUpcomingFailed] = useState(false)
  const loadUpcoming = useCallback(async () => {
    setUpcomingLoading(true)
    setUpcomingFailed(false)
    const res = await loadJson<{ followups?: FollowUpItem[]; nextMeetings?: NextMeetingItem[] }>(
      '/api/daily-activity/todos?upcoming=1'
    )
    if (res.ok) {
      const d = res.data ?? {}
      setUpcoming({
        followUps: Array.isArray(d.followups) ? d.followups : [],
        nextMeetings: Array.isArray(d.nextMeetings) ? d.nextMeetings : [],
      })
    } else {
      setUpcomingFailed(true)
    }
    setUpcomingLoading(false)
  }, [])

  // ---- Approvals (weekly-plan queue) â unchanged from the old Today -------
  const [approvals, setApprovals] = useState<ApprovalRow[]>([])
  const [approvalsLoading, setApprovalsLoading] = useState(true)
  const [approvalsLoadedFor, setApprovalsLoadedFor] = useState<boolean | null>(null)
  const [approvalsFailed, setApprovalsFailed] = useState(false)

  const loadApprovals = useCallback(async () => {
    if (!canViewApprovals) { setApprovals([]); setApprovalsLoading(false); setApprovalsLoadedFor(false); return }
    setApprovalsLoading(true)
    const res = await loadJson<{ rows?: ApprovalRow[] }>('/api/weekly-plans/approval?queue=awaiting')
    if (res.ok) {
      setApprovals(Array.isArray(res.data?.rows) ? res.data.rows : [])
      setApprovalsFailed(false)
    } else {
      setApprovals([])
      setApprovalsFailed(true)
    }
    setApprovalsLoading(false)
    setApprovalsLoadedFor(true)
  }, [canViewApprovals])

  useEffect(() => { void loadApprovals() }, [loadApprovals])

  // ---- Tab badge: approvals waiting + overdue follow-ups ------------------
  const waitingCount = approvals.length + missed.length
  const countSettled = !!me && !approvalsLoading && approvalsLoadedFor === canViewApprovals && state === 'ready'
  useEffect(() => {
    if (!countSettled || !me) return
    setPhoneTabBadge('/today', me.userId, waitingCount)
  }, [countSettled, me, waitingCount])

  // ---- Search: free text across EVERY date (meetings + expenses) ----------
  const [search, setSearch] = useState('')
  const [searchRows, setSearchRows] = useState<{ visits: DayVisit[]; expenses: DayExpense[] } | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  const [searchNonce, setSearchNonce] = useState(0)
  const searchAbort = useRef<AbortController | null>(null)
  const searching = search.trim() !== ''

  useEffect(() => {
    const q = search.trim()
    if (!q) { setSearchRows(null); setSearchFailed(false); return }
    searchAbort.current?.abort()
    const abort = new AbortController()
    searchAbort.current = abort
    setSearchLoading(true)
    setSearchFailed(false)
    void Promise.all([
      loadList<DayVisit>(`/api/daily-activity?q=${encodeURIComponent(q)}`, abort.signal),
      loadList<DayExpense>(`/api/expenses?q=${encodeURIComponent(q)}`, abort.signal),
    ]).then(([v, e]) => {
      if (abort.signal.aborted) return
      if (v.ok && e.ok) setSearchRows({ visits: v.data, expenses: e.data })
      else setSearchFailed(true)
      setSearchLoading(false)
    })
    return () => abort.abort()
  }, [search, searchNonce])

  // ---- Chip ----
  const [chip, setChip] = useState<Chip>('all')
  useEffect(() => {
    if (chip === 'upcoming' && !upcoming && !upcomingLoading && !upcomingFailed) void loadUpcoming()
  }, [chip, upcoming, upcomingLoading, upcomingFailed, loadUpcoming])

  type Row =
    | { kind: 'meeting'; key: string; data: DayVisit }
    | { kind: 'expense'; key: string; data: DayExpense }
    | { kind: 'followup'; key: string; data: FollowUpItem }
    | { kind: 'nextMeeting'; key: string; data: NextMeetingItem }
    | { kind: 'missed'; key: string; data: MissedTodo }
    | { kind: 'approval'; key: string; data: ApprovalRow }

  const rows: Row[] = useMemo(() => {
    if (searching) {
      return [
        ...(searchRows?.visits ?? []).map(v => ({ kind: 'meeting' as const, key: `m-${v.id}`, data: v })),
        ...(searchRows?.expenses ?? []).map(e => ({ kind: 'expense' as const, key: `e-${e.id}`, data: e })),
      ]
    }
    if (chip === 'approvals') return approvals.map(a => ({ kind: 'approval' as const, key: a.id, data: a }))
    if (chip === 'upcoming') {
      return [
        ...(upcoming?.followUps ?? []).map(f => ({ kind: 'followup' as const, key: `fu-${f.id}`, data: f })),
        ...(upcoming?.nextMeetings ?? []).map(n => ({ kind: 'nextMeeting' as const, key: `nm-${n.id}`, data: n })),
      ]
    }
    const meetingRows = visits.map(v => ({ kind: 'meeting' as const, key: `m-${v.id}`, data: v }))
    const expenseRows = expenses.map(e => ({ kind: 'expense' as const, key: `e-${e.id}`, data: e }))
    const followupRows: Row[] = [
      ...missed.map(m => ({ kind: 'missed' as const, key: `miss-${m.kind}-${m.id}`, data: m })),
      ...followUps.map(f => ({ kind: 'followup' as const, key: `fu-${f.id}`, data: f })),
      ...nextMeetings.map(n => ({ kind: 'nextMeeting' as const, key: `nm-${n.id}`, data: n })),
    ]
    if (chip === 'meetings') return meetingRows
    if (chip === 'expenses') return expenseRows
    if (chip === 'followups') return followupRows
    return [...meetingRows, ...expenseRows, ...followupRows]
  }, [searching, searchRows, chip, approvals, upcoming, visits, expenses, missed, followUps, nextMeetings])

  function renderRow(row: Row) {
    switch (row.kind) {
      case 'meeting': {
        const v = row.data
        const noteLine = v.notes?.split('\n').map(s => s.trim()).find(Boolean)
        const facts = [
          v.start_time ? formatTime(v.start_time) : null,
          v.visit_type,
          noteLine,
        ].filter((x): x is string => !!x)
        return (
          <PhoneListRow
            href={`/daily-activity/meeting/${v.id}`}
            name={v.entity_name}
            status={
              <Badge variant={v.status === 'Completed' ? 'success' : 'neutral'}>
                {v.status === 'Completed' ? 'Done' : 'Planned'}
              </Badge>
            }
            facts={facts}
            meta={searching && v.visit_date ? fmtDate(v.visit_date) : undefined}
          />
        )
      }
      case 'expense': {
        const e = row.data
        return (
          <Link
            href={`/expenses/${e.id}`}
            className="flex min-h-16 flex-col gap-1 px-4 py-3 active:bg-surface-control"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-body font-medium text-text-primary">
                {e.category}
                {e.photo_url ? <ReceiptIcon aria-label="Has a receipt photo" className="size-3.5 shrink-0 text-text-muted" /> : null}
              </span>
              <span className="shrink-0 text-body font-medium text-text-primary">{fmtAmount(e.amount)}</span>
            </div>
            {e.notes ? <span className="text-label text-text-secondary">{e.notes}</span> : null}
            {searching ? <span className="text-meta text-text-muted">{fmtDate(e.expense_date)}</span> : null}
          </Link>
        )
      }
      case 'followup': {
        const f = row.data
        return (
          <PhoneListRow
            href={f.company_id ? `/parties/companies/${f.company_id}` : `/deals/${f.deal_id}`}
            name={f.company_name ?? f.deal_name}
            facts={[`Due ${fmtDate(f.due_date)} Â· ${f.deal_name}`]}
          />
        )
      }
      case 'nextMeeting': {
        const n = row.data
        return (
          <PhoneListRow
            href={`/parties/companies/${n.id}`}
            name={n.name}
            facts={[`Due ${fmtDate(n.next_follow_up_date)}`]}
          />
        )
      }
      case 'missed': {
        const m = row.data
        return (
          <PhoneListRow
            href={
              m.party_id
                ? `/parties/companies/${m.party_id}`
                : m.deal_id
                  ? `/deals/${m.deal_id}`
                  : `/daily-activity/new?date=${m.original_date}`
            }
            name={m.party_name}
            facts={[`Overdue Â· was due ${fmtDate(m.original_date)}`]}
            meta={m.label}
          />
        )
      }
      case 'approval': {
        const a = row.data
        return (
          <PhoneListRow
            href="/weekly-plan/approval"
            name={a.user_name ?? 'Weekly plan'}
            facts={[a.status]}
            meta={a.week_start}
          />
        )
      }
    }
  }

  const counts = {
    all: visits.length + expenses.length + followUps.length + nextMeetings.length + missed.length,
    meetings: visits.length,
    expenses: expenses.length,
    followups: followUps.length + nextMeetings.length + missed.length,
    upcoming: (upcoming?.followUps.length ?? 0) + (upcoming?.nextMeetings.length ?? 0),
    approvals: approvals.length,
  }

  // ---- "+" sheet: Log meeting / Add expense --------------------------------
  const [addOpen, setAddOpen] = useState(false)
  // A sheet option closes the sheet and opens a form. The sheet's close is
  // a step back in history; a router.push started in the same tap races it
  // and is discarded. So: close, let the sheet's step land, then navigate.
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  function openAfterSheet(href: string) {
    setPendingHref(href)
    setAddOpen(false)
  }
  useEffect(() => {
    if (addOpen || !pendingHref) return
    let cancelled = false
    void whenLayersSettled().then(() => {
      if (!cancelled) router.push(pendingHref)
    })
    return () => {
      cancelled = true
    }
  }, [addOpen, pendingHref, router])
  const canAdd = canLogMeeting || canAddExpense

  // ---- Day picker: presets in a sheet, custom through the phone's picker ---
  const [dayOpen, setDayOpen] = useState(false)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  function pickDay(next: string) {
    // Closing the sheet pops its history entry, which would undo a replace
    // made now â so the date changes only once the sheet has settled, as
    // openAfterSheet does for the Add sheet.
    setDayOpen(false)
    void whenLayersSettled().then(() => goToDate(next))
  }
  function openNativePicker() {
    // showPicker() needs the tap's user gesture, so it runs synchronously here.
    const input = dateInputRef.current
    if (input?.showPicker) input.showPicker()
    else input?.click()
    setDayOpen(false)
  }

  // A failed chip or search is "failed" with Retry, never an empty list.
  const listState: 'loading' | 'failed' | 'ready' = searching
    ? searchLoading ? 'loading' : searchFailed ? 'failed' : 'ready'
    : chip === 'upcoming' && !upcoming
      ? upcomingFailed ? 'failed' : 'loading'
      : chip === 'approvals' && approvalsFailed
        ? 'failed'
        : chip === 'approvals' && approvalsLoading
          ? 'loading'
          : state
  function retryList() {
    if (searching) setSearchNonce(n => n + 1)
    else if (chip === 'upcoming') void loadUpcoming()
    else if (chip === 'approvals') void loadApprovals()
    else void load()
  }

  return (
    <div className="flex flex-col gap-3 pb-20">
      <PhoneList
        state={listState}
        onRetry={retryList}
        onRefresh={searching ? undefined : load}
        noun={{ one: 'item', many: 'items' }}
        rows={rows}
        total={rows.length}
        rowKey={r => r.key}
        renderRow={renderRow}
        search={{ value: search, onChange: setSearch }}
        listKey="today:activity"
        countLineAction={
          searching ? undefined : (
            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setDayOpen(true)}>
              <CalendarIcon />
              {dayLabel(date, todayStr)}
              <ChevronDownIcon />
            </Button>
          )
        }
        filters={
          searching
            ? undefined
            : {
                label: 'Show',
                value: chip,
                onChange: v => setChip((v ?? 'all') as Chip),
                allLabel: 'All',
                allCount: counts.all,
                chips: [
                  { value: 'meetings', label: 'Meetings', count: counts.meetings },
                  { value: 'expenses', label: 'Expenses', count: counts.expenses },
                  { value: 'followups', label: 'Follow-ups', count: counts.followups },
                  { value: 'upcoming', label: 'Upcoming', count: upcoming ? counts.upcoming : 0 },
                  ...(canViewApprovals ? [{ value: 'approvals', label: 'Approvals', count: counts.approvals }] : []),
                ],
              }
        }
        empty={
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <p className="text-body font-medium text-text-primary">
              {chip === 'meetings' ? `No meetings ${onDay(date, todayStr)}`
                : chip === 'expenses' ? `No expenses ${onDay(date, todayStr)}`
                : chip === 'followups' ? 'Nothing due or overdue'
                : chip === 'upcoming' ? 'Nothing coming up'
                : chip === 'approvals' ? 'Nothing waiting for your approval'
                : `Nothing ${onDay(date, todayStr)}`}
            </p>
            <p className="text-body text-text-muted">Check in and log a meeting when you&apos;re ready.</p>
          </div>
        }
      />

      {/* Mounted outside the sheet so the picker outlives the sheet closing. */}
      <input
        ref={dateInputRef}
        type="date"
        aria-label="Jump to date"
        value={date}
        onChange={e => { if (DATE_ONLY.test(e.target.value)) goToDate(e.target.value) }}
        className="sr-only"
      />

      {!searching && canAdd && (
        <div className="fixed right-[calc(var(--safe-right)+16px)] bottom-[calc(var(--h-tab-bar)+var(--safe-bottom)+16px)] z-(--z-shell)">
          <button
            type="button"
            aria-label="Log meeting or add expense"
            onClick={() => setAddOpen(true)}
            className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
          >
            <span aria-hidden className="text-2xl leading-none">+</span>
          </button>
        </div>
      )}

      <BottomSheet open={addOpen} onOpenChange={setAddOpen} title="Add">
        <PermissionTooltip allowed={!me || canLogMeeting} reason="Only someone who can create meetings can log one">
          <BottomSheetOption
            disabled={!canLogMeeting}
            onSelect={() => openAfterSheet(`/daily-activity/new?date=${date}`)}
          >
            Log meeting
          </BottomSheetOption>
        </PermissionTooltip>
        <PermissionTooltip allowed={!me || canAddExpense} reason="Only someone who can create expenses can add one">
          <BottomSheetOption
            disabled={!canAddExpense}
            onSelect={() => openAfterSheet(`/expenses/new?date=${date}`)}
          >
            Add expense
          </BottomSheetOption>
        </PermissionTooltip>
      </BottomSheet>

      <BottomSheet open={dayOpen} onOpenChange={setDayOpen} title="Show day">
        <BottomSheetOption selected={date === addDaysStr(todayStr, -1)} onSelect={() => pickDay(addDaysStr(todayStr, -1))}>
          Yesterday
        </BottomSheetOption>
        <BottomSheetOption selected={date === todayStr} onSelect={() => pickDay(todayStr)}>
          Today
        </BottomSheetOption>
        <BottomSheetOption selected={date === addDaysStr(todayStr, 1)} onSelect={() => pickDay(addDaysStr(todayStr, 1))}>
          Tomorrow
        </BottomSheetOption>
        <BottomSheetOption onSelect={openNativePicker}>Pick a dateâ¦</BottomSheetOption>
      </BottomSheet>

      {/* Attendance is always about today, whichever day is being browsed. */}
      <BottomSheet
        open={attendanceOpen}
        onOpenChange={setAttendanceOpen}
        title="Attendance"
        description={fmtDate(todayStr)}
        footer={
          attendanceFailed ? undefined : !checkedInAt ? (
            <Button
              className="w-full"
              disabled={marking}
              onClick={async () => { if (await markAttendance('check-in')) setAttendanceOpen(false) }}
            >
              <MapPinIcon />
              {marking ? 'Checking inâ¦' : 'Check in'}
            </Button>
          ) : !checkedOutAt ? (
            <Button
              className="w-full"
              disabled={marking}
              onClick={async () => { if (await markAttendance('check-out')) setAttendanceOpen(false) }}
            >
              {marking ? 'Checking outâ¦' : 'Check out'}
            </Button>
          ) : undefined
        }
      >
        {attendanceFailed ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-body text-text-secondary">Couldn&apos;t load your attendance. Check your connection and try again.</p>
            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => void loadAttendance()}>
              Retry
            </Button>
          </div>
        ) : !checkedInAt ? (
          <p className="text-body text-text-secondary">You haven&apos;t checked in today.</p>
        ) : !checkedOutAt ? (
          <div className="flex flex-col gap-1">
            <p className="text-body text-text-primary">Checked in at {formatTime(checkedInAt)}</p>
            {checkInAddress ? <p className="text-label text-text-secondary">{checkInAddress}</p> : null}
          </div>
        ) : (
          <p className="text-body text-text-primary">
            Checked in {formatTime(checkedInAt)} Â· Checked out {formatTime(checkedOutAt)}
          </p>
        )}
      </BottomSheet>
    </div>
  )
}
