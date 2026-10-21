'use client'

import { useState, useEffect, useCallback, useMemo, Suspense, type CSSProperties, type ComponentProps } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { StatusBadge, WEEKLY_PLAN_STATUS } from '@/components/status-badge'
import { useToast } from '@/contexts/ToastContext'
import { useLayout } from '@/lib/layout'
import { Calendar, CalendarDayButton } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import RemarksPanel from '@/components/ui/RemarksPanel'
import { RemarkThread } from '@/components/remark-thread'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  DECISIONS,
  NOT_REVIEWER_REASON,
  notActionableReason,
  type DecisionKey,
} from '@/components/weekly-plan/approval-types'

// ---- Helpers ----
function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}
function toDateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function formatDayHeader(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}
function formatWeekRange(monday: Date) {
  const sun = addDays(monday, 6)
  const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })}`
  return `${fmt(monday)} – ${fmt(sun)}`
}
function formatDuration(secs: number) {
  const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); const s = secs % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
function getWeekDates(baseDate: Date): Date[] {
  const d = getMondayOf(baseDate)
  return Array.from({ length: 7 }, (_, i) => { const r = new Date(d); r.setDate(d.getDate() + i); return r })
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ---- Types ----
type Plan = {
  id: string; status: string; submitted_at: string | null; manager_comment: string | null
  reopen_requested: boolean; reopen_request_message: string | null
  week_start_date: string; week_end_date: string;
  weekly_plan_items: { plan_date: string; from_place: string; existing_dealers_goal: number; new_dealers_goal: number; others_goal: number; notes: string | null }[]
  day_notes?: Record<string, string>
  users: { id: string; name: string; contact: string }
  /** Server-derived: the `weekly_plan` EDIT every manager verb checks first. */
  canDecide: boolean
  /** Server-derived: whether the caller may act on this owner's plan (`canReview`). */
  canReview: boolean
  /**
   * The version the plan was read at. A decision sends it back as
   * `expected_version`, so one made on a plan that has moved on since this
   * list loaded (an owner save, another manager) is refused with a 409.
   */
  version: string | null
}

/** `canDecide` is the server's own answer to weekly_plan EDIT, which every decision route checks first. */
const NO_DECIDE_REASON = 'Only someone who can edit weekly plans can decide on one.'

/** The order the four decisions sit in, as on the approval panel. */
const DECISION_ORDER: DecisionKey[] = ['approve', 'reject', 'hold', 'suggest']

/**
 * Why a manager verb is unavailable on `plan`, or null when it is available —
 * the same two gates the routes apply: who (`canReview`, a 403) and the plan's
 * status (the allowed-from table in `approval-types.ts`, a 409).
 */
function verbLock(plan: Plan, allowedFrom: readonly string[]): string | null {
  if (!plan.canDecide) return NO_DECIDE_REASON
  if (!plan.canReview) return NOT_REVIEWER_REASON
  return allowedFrom.includes(plan.status) ? null : notActionableReason(plan.status)
}

type Visit = {
  id: string; visit_type: string; entity_name: string; is_new_entity: boolean
  status: string; start_time: string | null; end_time: string | null; duration_secs: number | null
  notes: string | null
  latitude: number | null; longitude: number | null; address: string | null
  end_latitude: number | null; end_longitude: number | null; end_address: string | null
  /* §5.4: computed server-side when the visit is stopped, against the tenant's
     configured threshold in metres. Not recomputed here — see ReviewVisitCard. */
  location_flagged: boolean
}

type Expense = {
  id: string; category: string; amount: number; notes: string | null; expense_date: string; photo_url: string | null
}

type RemarksState = { contextType: 'meeting' | 'expense' | 'weekly_plan'; contextId: string; title: string; earlierNote?: string | null } | null

/*
 * Expense categories are tenant-editable text, not a fixed enum, so they
 * cannot each own a semantic (success/warning/danger) badge colour — those
 * are reserved for actual status meaning (section 2.4). Instead each
 * category is assigned one of the six chart tokens by a stable hash, so the
 * same category always reads the same colour without hardcoding raw
 * Tailwind colours anywhere on this screen.
 */
const CHART_VARS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'] as const
function categoryStyle(category: string): CSSProperties {
  let hash = 0
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0
  const v = CHART_VARS[hash % CHART_VARS.length]
  return {
    backgroundColor: `color-mix(in srgb, var(${v}) 16%, transparent)`,
    color: `var(${v})`,
  }
}

// ---- Week Strip (read-only variant) ----
function WeekStrip({ selectedDate, onSelectDate, onPrevWeek, onNextWeek, calendarApiBase }: {
  selectedDate: string; onSelectDate: (d: string) => void; onPrevWeek: () => void; onNextWeek: () => void
  calendarApiBase?: string
}) {
  const todayStr = toDateStr(new Date())
  const selDate = new Date(selectedDate + 'T00:00:00')
  const weekDates = getWeekDates(selDate)
  const [showCalendar, setShowCalendar] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => new Date(selectedDate + 'T00:00:00'))
  const [filledDates, setFilledDates] = useState<Set<string>>(new Set())

  const loadFilled = useCallback(async () => {
    if (!calendarApiBase) return
    const monthKey = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}`
    try {
      const url = `${calendarApiBase}${calendarApiBase.includes('?') ? '&' : '?'}month=${monthKey}`
      const r = await fetch(url)
      if (r.ok) {
        const { filledDates: arr } = await r.json()
        if (Array.isArray(arr)) setFilledDates(new Set(arr))
      }
    } catch { /* ignore */ }
  }, [calendarApiBase, viewMonth])

  useEffect(() => { if (showCalendar) loadFilled() }, [showCalendar, loadFilled])

  function FilledDayButton(dayProps: ComponentProps<typeof CalendarDayButton>) {
    const dateStr = toDateStr(dayProps.day.date)
    const isFilled = filledDates.has(dateStr)
    return (
      <CalendarDayButton {...dayProps}>
        {dayProps.children}
        {isFilled && (
          <span
            className={`pointer-events-none absolute bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full ${
              dayProps.modifiers.selected ? 'bg-primary-foreground/60' : 'bg-success'
            }`}
          />
        )}
      </CalendarDayButton>
    )
  }

  return (
    <div className="relative mb-4">
      <div className="flex items-center gap-1 bg-surface rounded-2xl border border-border-light px-2 py-2 shadow-sm">
        <button onClick={onPrevWeek} className="p-1.5 rounded-lg hover:bg-surface-control text-text-muted transition shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        </button>
        <div className="flex-1 flex items-center justify-between gap-0.5">
          {weekDates.map((d, i) => {
            const ds = toDateStr(d); const isSelected = ds === selectedDate; const isToday = ds === todayStr
            return (
              <button key={ds} onClick={() => onSelectDate(ds)}
                className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-xl flex-1 transition relative ${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-surface-sunken text-text-secondary'}`}>
                <span className={`text-[10px] font-normal uppercase tracking-wide ${isSelected ? 'text-primary-foreground' : 'text-text-muted'}`}>{DAY_LABELS[i]}</span>
                <span className={`text-sm font-medium ${isSelected ? 'text-primary-foreground' : isToday ? 'text-primary' : 'text-text-secondary'}`}>{d.getDate()}</span>
                {isToday && <span className={`w-1.5 h-1.5 rounded-full absolute bottom-1 ${isSelected ? 'bg-primary-subtle' : 'bg-primary'}`} />}
              </button>
            )
          })}
        </div>
        <button onClick={onNextWeek} className="p-1.5 rounded-lg hover:bg-surface-control text-text-muted transition shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        </button>
        <Popover open={showCalendar} onOpenChange={setShowCalendar}>
          <PopoverTrigger
            render={
              <button
                className={`p-1.5 rounded-lg transition shrink-0 ${showCalendar ? 'bg-primary-subtle text-primary' : 'hover:bg-surface-control text-text-muted'}`}
                title="Open calendar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
              </button>
            }
          />
          <PopoverContent align="end" className="w-auto p-2">
            <Calendar
              mode="single"
              month={viewMonth}
              onMonthChange={setViewMonth}
              selected={selDate}
              onSelect={d => { if (d) { onSelectDate(toDateStr(d)); setShowCalendar(false) } }}
              components={calendarApiBase ? { DayButton: FilledDayButton } : undefined}
            />
            {calendarApiBase && (
              <div className="flex items-center gap-1.5 border-t border-border-light px-1 pt-2">
                <span className="size-2 rounded-full bg-success" />
                <span className="text-meta text-text-muted">Has activity</span>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

// ---- Weekly Plans Tab ----
function WeeklyPlansTab({ userId, onOpenRemarks }: { userId: string; onOpenRemarks: (ctx: { contextType: 'weekly_plan'; contextId: string; title: string }) => void }) {
  const { toast } = useToast()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterWeek, setFilterWeek] = useState('')
  const [selected, setSelected] = useState<Plan | null>(null)
  const [commentModal, setCommentModal] = useState<{ action: string; planId: string; version: string | null } | null>(null)
  const [comment, setComment] = useState('')
  const [acting, setActing] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const weekOptions = useMemo(() => {
    const opts: string[] = []
    const cur = getMondayOf(new Date())
    for (let i = 11; i >= 0; i--) opts.push(toDateStr(addDays(cur, -7 * i)))
    return opts
  }, [])

  const loadPlans = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    const p = new URLSearchParams({ userId })
    if (filterStatus) p.set('status', filterStatus)
    if (filterWeek) p.set('weekStart', filterWeek)
    let list: Plan[] = []
    try {
      const r = await fetch(`/api/weekly-plans/review?${p}`, { signal: AbortSignal.timeout(20000) })
      if (!r.ok) throw new Error('load failed')
      const d = await r.json()
      if (!Array.isArray(d)) throw new Error('unexpected shape')
      list = d
      setPlans(list)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
    return list
  }, [userId, filterStatus, filterWeek])

  useEffect(() => { loadPlans() }, [loadPlans])

  async function action(planId: string, type: string, body: Record<string, unknown> = {}) {
    setActing(true)
    try {
    const r = await fetch(`/api/weekly-plans/${planId}/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) {
      toast(d?.error ?? 'Could not complete that action. Please try again.', 'error')
      // 409: the plan moved on since this list loaded. Reload it and show the
      // plan as it is now (or close it if the filters no longer match it),
      // rather than leave the stale copy up to be decided on again.
      if (r.status === 409) {
        setCommentModal(null)
        const fresh = await loadPlans()
        setSelected(fresh.find(p => p.id === planId) ?? null)
      }
    } else { toast(`Done`); loadPlans(); setSelected(null); setCommentModal(null) }
    } catch {
      toast('Could not reach the server. Check your connection and try again.', 'error')
    } finally {
      setActing(false)
    }
  }

  const STATUS_OPTS = ['', 'Submitted', 'Approved', 'Rejected', 'On Hold', 'Edited by Manager', 'Resubmitted']

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring">
          {STATUS_OPTS.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
        <select value={filterWeek} onChange={e => setFilterWeek(e.target.value)}
          className="border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring">
          <option value="">All weeks</option>
          {weekOptions.map(w => <option key={w} value={w}>{formatWeekRange(new Date(w + 'T00:00:00'))}</option>)}
        </select>
      </div>

      {loading ? <div className="text-center py-12 text-text-muted">Loading...</div> : loadError ? (
        <div className="rounded-2xl border border-border-light bg-surface p-6 text-center">
          <p className="text-sm text-text-primary">Couldn&apos;t load the weekly plans. Check your connection and try again.</p>
          <button onClick={() => { void loadPlans() }} className="mt-3 text-sm font-medium text-primary hover:text-primary-hover">Try again</button>
        </div>
      ) : plans.length === 0 ? (
        <div className="text-center py-12 text-text-muted">No plans found.</div>
      ) : (
        <div className="bg-surface rounded-xl border border-border-light overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken border-b border-border-light">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Week</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Status</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Submitted</th>
                <th className="px-4 py-3 text-right font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.id} className="border-t border-border-light hover:bg-surface-sunken">
                  <td className="px-4 py-3 text-xs text-text-secondary">{formatWeekRange(new Date(p.week_start_date + 'T00:00:00'))}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge vocabulary={WEEKLY_PLAN_STATUS} status={p.status} />
                      {p.reopen_requested && (
                        <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-warning-bg text-warning">Reopen Req.</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-text-secondary">{p.submitted_at ? new Date(p.submitted_at).toLocaleString('en-IN') : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setSelected(p)} className="text-primary hover:underline text-xs font-medium">View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Plan Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-(--backdrop)" onClick={() => setSelected(null)} />
          <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
              <div>
                <h3 className="font-medium text-text-primary">Week of {selected.week_start_date}</h3>
                <div className="flex items-center gap-2 mt-1"><StatusBadge vocabulary={WEEKLY_PLAN_STATUS} status={selected.status} /></div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setSelected(null); onOpenRemarks({ contextType: 'weekly_plan', contextId: selected.id, title: `Weekly Plan — Week of ${selected.week_start_date}` }) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-primary-subtle hover:bg-primary-subtle-hover rounded-lg transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                  Chat
                </button>
                <button onClick={() => setSelected(null)} className="text-text-muted hover:text-text-secondary text-xl">&times;</button>
              </div>
            </div>
            {selected.manager_comment && (
              <div className="mx-6 mt-4 bg-warning-bg border border-warning-border rounded-lg px-3 py-2 text-sm text-warning">
                Comment: {selected.manager_comment}
              </div>
            )}
            <div className="overflow-x-auto px-6 py-4 flex-1 overflow-y-auto space-y-4">
              <table className="w-full text-xs">
                <thead className="bg-surface-sunken"><tr>{['Date', 'Place', 'Existing', 'New', 'Others'].map(h => <th key={h} className="px-3 py-2 text-left font-medium text-text-secondary">{h}</th>)}</tr></thead>
                <tbody>
                  {selected.weekly_plan_items.sort((a, b) => a.plan_date.localeCompare(b.plan_date)).map((item, i) => (
                    <tr key={i} className="border-t border-border-light">
                      <td className="px-3 py-2 font-medium">{formatDayHeader(item.plan_date)}</td>
                      <td className="px-3 py-2">
                        {item.from_place || '—'}
                        {item.notes?.trim() && <p className="mt-0.5 text-text-secondary whitespace-pre-line">{item.notes}</p>}
                      </td>
                      <td className="px-3 py-2">{item.existing_dealers_goal ?? 0}</td>
                      <td className="px-3 py-2">{item.new_dealers_goal ?? 0}</td>
                      <td className="px-3 py-2">{item.others_goal ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Day Focus / Remarks */}
              {selected.day_notes && Object.entries(selected.day_notes).filter(([, v]) => v?.trim()).length > 0 && (
                <div className="border border-border-light rounded-lg overflow-hidden">
                  <div className="bg-surface-sunken px-3 py-2 text-xs font-normal text-text-secondary uppercase tracking-wide">Day Focus / Remarks</div>
                  {Object.entries(selected.day_notes)
                    .filter(([, v]) => v?.trim())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([date, note]) => (
                      <div key={date} className="px-3 py-2 border-t border-border-light flex gap-3 text-xs">
                        <span className="font-medium text-text-secondary whitespace-nowrap">{formatDayHeader(date)}</span>
                        <span className="text-text-secondary">{note}</span>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
            {/*
              The decision row appears for every plan, but only for a caller
              holding `weekly_plan` EDIT (as on the approval panel): without it
              no decision exists for them, so the row is an area they cannot
              use and is hidden. Each button is then gated on the same who and
              status rules the route enforces, and shown disabled with the
              reason — an Approved plan shows all four, each saying why —
              rather than hidden, or offered to fail with a 403 or 409.
            */}
            {(
              <div className="px-6 py-4 border-t border-border-light flex flex-wrap gap-2">
                {DECISION_ORDER.map(key => {
                  const lock = verbLock(selected, DECISIONS[key].allowedFrom)
                  return (
                    <PermissionTooltip key={key} allowed={lock === null} reason={lock ?? ''}>
                      <Button
                        size="sm"
                        variant={key === 'approve' ? 'primary' : key === 'reject' ? 'danger' : 'secondary'}
                        disabled={acting || lock !== null}
                        onClick={() => { setCommentModal({ action: key, planId: selected.id, version: selected.version }); setComment('') }}
                      >
                        {DECISIONS[key].label}
                      </Button>
                    </PermissionTooltip>
                  )
                })}
              </div>
            )}
            {/* Item 8: Accept / Decline reopen request */}
            {selected.reopen_requested && (
              <div className="px-6 py-4 border-t border-border-light bg-warning-bg">
                <p className="text-xs font-medium text-warning mb-1">Reopen Request</p>
                {selected.reopen_request_message && (
                  <p className="text-xs text-warning mb-3 bg-surface rounded-lg px-3 py-2 border border-warning-border">{selected.reopen_request_message}</p>
                )}
                {/* Both routes gate on `weekly_plan` EDIT and `canReview`, as the decisions do. */}
                {(
                  <div className="flex gap-2">
                    <PermissionTooltip allowed={selected.canDecide && selected.canReview} reason={selected.canDecide ? NOT_REVIEWER_REASON : NO_DECIDE_REASON}>
                      <Button size="sm" variant="primary" disabled={acting || !selected.canDecide || !selected.canReview}
                        onClick={() => action(selected.id, 'accept-reopen')}>
                        Accept (Allow Edit)
                      </Button>
                    </PermissionTooltip>
                    <PermissionTooltip allowed={selected.canDecide && selected.canReview} reason={selected.canDecide ? NOT_REVIEWER_REASON : NO_DECIDE_REASON}>
                      <Button size="sm" variant="danger" disabled={acting || !selected.canDecide || !selected.canReview}
                        onClick={() => action(selected.id, 'decline-reopen')}>
                        Decline
                      </Button>
                    </PermissionTooltip>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={!!commentModal}
        onOpenChange={open => {
          if (!open && !acting) setCommentModal(null)
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {commentModal?.action === 'approve' ? 'Approve Plan' : commentModal?.action === 'reject' ? 'Reject Plan' : commentModal?.action === 'hold' ? 'Put On Hold' : 'Suggest Changes'}
            </DialogTitle>
            <DialogDescription>
              Comment {commentModal?.action === 'reject' || commentModal?.action === 'suggest' ? '(required)' : '(optional)'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="review-comment">Comment</Label>
            <Textarea
              id="review-comment"
              name="comment"
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              autoFocus
              className="mt-1.5 text-[16px] sm:text-body"
              placeholder={commentModal?.action === 'approve' ? 'Add an optional note for approval…' : 'Enter your comment…'}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCommentModal(null)} disabled={acting}>
              Cancel
            </Button>
            <Button
              variant={commentModal?.action === 'reject' ? 'danger' : 'primary'}
              disabled={acting || ((commentModal?.action === 'reject' || commentModal?.action === 'suggest') && !comment.trim())}
              onClick={() => {
                if (commentModal) {
                  action(commentModal.planId, commentModal.action, {
                    comment, expected_version: commentModal.version ?? undefined,
                  })
                }
              }}
            >
              {acting ? 'Working…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---- Review Visit Card (read-only) ----
function ReviewVisitCard({ v, onOpenRemarks }: {
  v: Visit; onOpenRemarks: (ctx: { contextType: 'meeting'; contextId: string; title: string; earlierNote?: string | null }) => void
}) {
  const [locationOpen, setLocationOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)

  const statusColor = (s: string) => s === 'Active' ? 'bg-warning-bg text-warning' : s === 'Completed' ? 'bg-success-bg text-success' : 'bg-surface-control text-text-secondary'

  const hasLocation = v.latitude != null
  /*
   * §5.4, P3-T8. This was a hardcoded distance check computed here in the
   * browser:
   *
   *   Math.abs(lat - end_lat) > 0.001 || Math.abs(lng - end_lng) > 0.001
   *
   * which was degrees rather than metres, a square rather than a circle, and a
   * different real distance at every latitude — and it was not the tenant's
   * configured threshold, because it could not be: the setting did not exist.
   * It is now a real Haversine in metres, computed server-side against
   * `getTenantSettings().location_flag_threshold_m` and stored on the row when
   * the visit is stopped, so the rep's screen and the reviewer's screen cannot
   * disagree and an older flag stays as it was judged at the time.
   *
   * A visit whose start or end location is missing is NOT flagged — unknown is
   * not the same as clean, but it is not evidence of anything either.
   *
   * ⚠️ Display only. §5.4 triggers no action from this.
   */
  const endMismatch = v.location_flagged

  return (
    <div className={`bg-surface rounded-2xl border overflow-hidden ${v.status === 'Active' ? 'border-warning-border' : 'border-border-light'}`}>
      {v.status === 'Active' && <div className="h-1 bg-warning animate-pulse" />}
      {v.status === 'Completed' && <div className="h-1 bg-success-border" />}
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={`text-[11px] font-normal px-2 py-0.5 rounded-full bg-surface-control text-text-secondary`}>{v.visit_type}</span>
          {v.is_new_entity && <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-primary-subtle text-primary">New</span>}
          <span className={`text-[11px] font-normal px-2 py-0.5 rounded-full ${statusColor(v.status)}`}>{v.status}</span>
        </div>
        <p className="font-medium text-text-primary">{v.entity_name}</p>
        <div className="flex gap-4 mt-2 text-xs text-text-muted">
          {v.start_time && <span>Started {new Date(v.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>}
          {v.end_time && <span>Ended {new Date(v.end_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>}
          {v.status === 'Completed' && v.duration_secs != null && <span className="text-success font-medium">{formatDuration(v.duration_secs)}</span>}
        </div>

        {/* Action row */}
        <div className="mt-2 pt-2 border-t border-border-light flex items-center gap-2">
          {hasLocation && (
            <button onClick={() => setLocationOpen(o => !o)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition ${locationOpen ? 'bg-primary-subtle text-primary' : 'text-text-muted hover:text-primary hover:bg-primary-subtle'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              Location
            </button>
          )}
          {/* Minutes of the meeting: the one record of what was discussed,
              the same thread the rep's card and the meeting page show. Any
              older `daily_visits.notes` text rides along read-only — it used
              to sit behind a separate Notes toggle here. */}
          <button onClick={() => onOpenRemarks({ contextType: 'meeting', contextId: v.id, title: v.entity_name, earlierNote: v.notes })}
            className="ml-auto p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary-subtle transition" title="Minutes" aria-label="Minutes">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
          </button>
        </div>

        {/* Location (read-only) */}
        {locationOpen && hasLocation && (
          <div className="mt-3 pt-3 border-t border-border-light">
            <p className="text-xs font-normal text-text-muted uppercase tracking-wide mb-2">Location Details</p>
            <div className="space-y-2">
              <div className="bg-primary-subtle rounded-lg px-3 py-2">
                <p className="text-[10px] font-normal text-primary uppercase mb-0.5">Start Location</p>
                <p className="text-xs text-text-secondary">{v.address ?? `${v.latitude}, ${v.longitude}`}</p>
              </div>
              {v.end_latitude != null && (
                <div className={`rounded-lg px-3 py-2 ${endMismatch ? 'bg-danger-bg border border-danger-border' : 'bg-primary-subtle'}`}>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] font-normal text-primary uppercase mb-0.5">End Location</p>
                    {endMismatch && <span className="text-[10px] font-normal text-danger bg-danger-bg px-1.5 py-0.5 rounded-full">Mismatch</span>}
                  </div>
                  <p className="text-xs text-text-secondary">{v.end_address ?? `${v.end_latitude}, ${v.end_longitude}`}</p>
                </div>
              )}
              <button onClick={() => setMapOpen(o => !o)}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-hover bg-primary-subtle hover:bg-primary-subtle-hover px-3 py-1.5 rounded-lg transition">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
                </svg>
                {mapOpen ? 'Hide Map' : 'View on Google Maps'}
              </button>
              {mapOpen && (
                <div className="rounded-xl overflow-hidden border border-border-light">
                  <iframe
                    src={`https://www.google.com/maps?q=${v.latitude},${v.longitude}&z=15&output=embed`}
                    className="w-full h-48" loading="lazy" referrerPolicy="no-referrer-when-downgrade" title="Meeting start location" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Daily Activity Tab ----
function DailyActivityTab({ userId, onOpenRemarks }: { userId: string; onOpenRemarks: (ctx: { contextType: 'meeting'; contextId: string; title: string; earlierNote?: string | null }) => void }) {
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()))
  const [weekOffset, setWeekOffset] = useState(0)
  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  function getWeekStart(offset: number) {
    const today = new Date()
    const day = today.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(today)
    monday.setDate(today.getDate() + diff + offset * 7)
    monday.setHours(0, 0, 0, 0)
    return monday
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetch(`/api/review/daily-activity?userId=${userId}&date=${selectedDate}`, { signal: AbortSignal.timeout(20000) })
      .then(async r => {
        if (!r.ok) throw new Error('load failed')
        const d = await r.json()
        if (!Array.isArray(d)) throw new Error('unexpected shape')
        return d as Visit[]
      })
      .then(d => { if (!cancelled) { setVisits(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setFailed(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [userId, selectedDate, attempt])

  return (
    <div>
      <WeekStrip
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onPrevWeek={() => { const o = weekOffset - 1; setWeekOffset(o); setSelectedDate(toDateStr(getWeekStart(o))) }}
        onNextWeek={() => { const o = weekOffset + 1; setWeekOffset(o); setSelectedDate(toDateStr(getWeekStart(o))) }}
        calendarApiBase={`/api/daily-activity/calendar?userId=${userId}`}
      />

      {loading ? <div className="text-center py-12 text-text-muted">Loading...</div> : failed ? (
        <div className="rounded-2xl border border-border-light bg-surface p-6 text-center">
          <p className="text-sm text-text-primary">Couldn&apos;t load this day&apos;s meetings. Check your connection and try again.</p>
          <button onClick={() => setAttempt(a => a + 1)} className="mt-3 text-sm font-medium text-primary hover:text-primary-hover">Try again</button>
        </div>
      ) : visits.length === 0 ? (
        <div className="text-center py-12 text-text-muted">No meetings on this day.</div>
      ) : (
        <div className="space-y-3">
          {visits.map(v => <ReviewVisitCard key={v.id} v={v} onOpenRemarks={onOpenRemarks} />)}
        </div>
      )}
    </div>
  )
}

// ---- Daily Summary Tab (§6.1, P4-T3) ----

type DailySummary = {
  date: string
  user: { id: string; name: string }
  plan: {
    goals: { newParties: number; existingParties: number; others: number; total: number } | null
    route: { from: string | null; to: string | null } | null
    notes: string | null
    actualMeetings: number
    missedParties: { id: string; name: string }[] | null
    extraParties: { id: string | null; name: string }[] | null
    partyMatching: 'by_party' | 'counts_only'
  }
  meetings: {
    total: number; manualEntryCount: number; systemCapturedCount: number
    systemCapturedSeconds: number; manualEntrySeconds: number; totalSeconds: number
    withoutDuration: number; locationFlaggedCount: number; locationsCovered: string[]
  }
  workingTime: {
    checkIn: string | null; checkOut: string | null
    workingSeconds: number | null; meetingSeconds: number
    nonMeetingSeconds: number | null; note: string | null
  }
  expenses: { total: number; count: number; byCategory: { category: string; amount: number; count: number }[] }
  orders: { count: number; totalValue: number; byStatus: { status: string; count: number; value: number }[] }
  deals: {
    stagesMoved: number; won: number; lost: number
    movements: { dealId: string; dealName: string; fromStage: string | null; toStage: string }[]
  }
  followUps: { dueToday: number; notDone: { id: string; dealId: string; dealName: string; mode: string; notes: string | null }[] }
  nextDay: {
    date: string
    goals: { newParties: number; existingParties: number; others: number; total: number } | null
    route: { from: string | null; to: string | null } | null
    notes: string | null
  }
}

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A figure that may legitimately be unknown. Never prints 0 for "we don't know". */
function Figure({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="rounded-xl border border-border-light bg-surface px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-medium text-text-primary">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-text-secondary">{hint}</p>}
    </div>
  )
}

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border-light bg-surface p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">{title}</p>
      {children}
    </div>
  )
}

/**
 * §6.1's sheet for one day.
 *
 * Three things are deliberately ABSENT and must stay absent:
 *   - Travelling Time (dropped in §12);
 *   - any expense-to-order-value ratio — §6.1 says it looks poor on a normal
 *     prospecting day and demoralises the rep, and belongs in the Weekly
 *     Review only. Both numbers are shown; the division is not;
 *   - anything that assumes a meeting happened (§5.6).
 *
 * "Non-Meeting Time" is the required wording. Never "Idle Time".
 */
/**
 * How many whole weeks separate the Monday of `day` from the Monday of today.
 * Negative for a past week, 0 when there is no deep link. Both Mondays are
 * computed the same way `getWeekStart` does, so the two cannot disagree.
 */
function weekOffsetOf(day?: string | null): number {
  if (!day) return 0
  const mondayOf = (d: Date) => {
    const wd = d.getDay()
    const m = new Date(d)
    m.setDate(d.getDate() + (wd === 0 ? -6 : 1 - wd))
    m.setHours(0, 0, 0, 0)
    return m
  }
  const target = new Date(`${day}T00:00:00`)
  if (Number.isNaN(target.getTime())) return 0
  const diffMs = mondayOf(target).getTime() - mondayOf(new Date()).getTime()
  return Math.round(diffMs / (7 * 86_400_000))
}

function SummaryTab({ userId, initialDate }: { userId: string; initialDate?: string | null }) {
  /*
   * `initialDate` is the day a deep link asked for — Conversations' Source
   * link on a Daily Summary comment carries one. Without it the tab always
   * opened on today, so a link to a comment on the 17th landed on a sheet
   * with nothing on it (F32). Today remains the default when no link says
   * otherwise, and the WeekStrip still owns the date after the first render.
   */
  const [selectedDate, setSelectedDate] = useState(initialDate || toDateStr(new Date()))
  /* The strip has to open on the week the deep-linked day is IN, or the day
     the sheet is showing is not one of the days the strip offers. */
  const [weekOffset, setWeekOffset] = useState(() => weekOffsetOf(initialDate))
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  function getWeekStart(offset: number) {
    const today = new Date()
    const day = today.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(today)
    monday.setDate(today.getDate() + diff + offset * 7)
    monday.setHours(0, 0, 0, 0)
    return monday
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/review/daily-summary?userId=${userId}&date=${selectedDate}`, { signal: AbortSignal.timeout(20000) })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error ?? 'Could not load the summary.')
        }
        return r.json() as Promise<DailySummary>
      })
      .then(d => { if (!cancelled) { setSummary(d); setLoading(false) } })
      .catch((e: Error) => { if (!cancelled) { setError(e.name === 'TimeoutError' || e.name === 'TypeError' ? 'Couldn’t load this day’s summary. Check your connection and try again.' : e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [userId, selectedDate, attempt])

  return (
    <div>
      <WeekStrip
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onPrevWeek={() => { const o = weekOffset - 1; setWeekOffset(o); setSelectedDate(toDateStr(getWeekStart(o))) }}
        onNextWeek={() => { const o = weekOffset + 1; setWeekOffset(o); setSelectedDate(toDateStr(getWeekStart(o))) }}
        calendarApiBase={`/api/daily-activity/calendar?userId=${userId}`}
      />

      {loading ? (
        <div className="py-12 text-center text-text-muted">Loading…</div>
      ) : error ? (
        /* No dead ends: say what happened and offer the way forward. */
        <div className="rounded-2xl border border-border-light bg-surface p-6 text-center">
          <p className="text-sm text-text-primary">{error}</p>
          <button onClick={() => setAttempt(a => a + 1)} className="mt-3 text-sm font-medium text-primary hover:text-primary-hover">
            Try again
          </button>
        </div>
      ) : !summary ? null : (
        <div className="space-y-3">
          {/* Plan vs Actual */}
          <SummarySection title="Plan vs Actual">
            {summary.plan.goals ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Figure label="Planned" value={String(summary.plan.goals.total)}
                    hint={`${summary.plan.goals.newParties} new · ${summary.plan.goals.existingParties} existing · ${summary.plan.goals.others} other`} />
                  <Figure label="Meetings held" value={String(summary.plan.actualMeetings)} />
                </div>
                {summary.plan.route && (summary.plan.route.from || summary.plan.route.to) && (
                  <p className="mt-2 text-xs text-text-secondary">
                    Route: {summary.plan.route.from ?? '—'} → {summary.plan.route.to ?? '—'}
                  </p>
                )}
                {summary.plan.notes && <p className="mt-1 text-xs text-text-secondary">{summary.plan.notes}</p>}
              </>
            ) : (
              <p className="text-sm text-text-secondary">No plan was filed for this day.</p>
            )}

            {/* §6.1 asks what was missed and what extra was done. That is only
                answerable per-party when the plan names a party; saying so is
                the honest alternative to rendering an empty "nothing missed",
                which would read as a clean day. */}
            {summary.plan.partyMatching === 'counts_only' ? (
              <p className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-text-secondary">
                This plan sets target counts but does not name the parties to visit, so missed and
                extra visits can only be compared as numbers, not listed by party.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                <div>
                  <p className="text-xs font-medium text-text-secondary">Missed</p>
                  {summary.plan.missedParties?.length
                    ? <ul className="mt-1 space-y-0.5">{summary.plan.missedParties.map(p => (
                        <li key={p.id} className="text-xs text-text-primary">• {p.name}</li>))}</ul>
                    : <p className="text-xs text-text-muted">Nothing planned was missed.</p>}
                </div>
                <div>
                  <p className="text-xs font-medium text-text-secondary">Extra</p>
                  {summary.plan.extraParties?.length
                    ? <ul className="mt-1 space-y-0.5">{summary.plan.extraParties.map((p, i) => (
                        <li key={p.id ?? `x${i}`} className="text-xs text-text-primary">• {p.name}</li>))}</ul>
                    : <p className="text-xs text-text-muted">Nothing outside the plan.</p>}
                </div>
              </div>
            )}
          </SummarySection>

          {/* Time */}
          <SummarySection title="Time">
            <div className="grid grid-cols-2 gap-2">
              <Figure label="Total meeting time" value={formatDuration(summary.meetings.totalSeconds)}
                hint={`${summary.meetings.total} meeting${summary.meetings.total === 1 ? '' : 's'}`} />
              <Figure
                label="Non-Meeting Time"
                value={summary.workingTime.nonMeetingSeconds === null ? 'Unknown' : formatDuration(summary.workingTime.nonMeetingSeconds)}
                hint={summary.workingTime.workingSeconds === null ? null : `of ${formatDuration(summary.workingTime.workingSeconds)} worked`}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Figure label="System-captured" value={formatDuration(summary.meetings.systemCapturedSeconds)}
                hint={`${summary.meetings.systemCapturedCount} timed`} />
              <Figure label="Entered manually" value={formatDuration(summary.meetings.manualEntrySeconds)}
                hint={`${summary.meetings.manualEntryCount} past meeting${summary.meetings.manualEntryCount === 1 ? '' : 's'}`} />
            </div>
            {summary.workingTime.note && (
              <p className="mt-2 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-text-secondary">
                {summary.workingTime.note}
              </p>
            )}
            {summary.meetings.withoutDuration > 0 && (
              <p className="mt-2 text-xs text-text-secondary">
                {summary.meetings.withoutDuration} meeting{summary.meetings.withoutDuration === 1 ? '' : 's'} had no
                recorded duration and {summary.meetings.withoutDuration === 1 ? 'is' : 'are'} not counted in the totals above.
              </p>
            )}
          </SummarySection>

          {/* Money — both figures, deliberately no ratio between them */}
          <SummarySection title="Expense and Orders">
            <div className="grid grid-cols-2 gap-2">
              <Figure label="Total expense" value={money(summary.expenses.total)}
                hint={`${summary.expenses.count} claim${summary.expenses.count === 1 ? '' : 's'}`} />
              <Figure label="Order value brought" value={money(summary.orders.totalValue)}
                hint={`${summary.orders.count} order${summary.orders.count === 1 ? '' : 's'}`} />
            </div>
            {summary.expenses.byCategory.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-text-secondary">By category</p>
                <ul className="space-y-1">
                  {summary.expenses.byCategory.map(c => (
                    <li key={c.category} className="flex items-center justify-between text-xs">
                      <span className="text-text-primary">{c.category}</span>
                      <span className="text-text-secondary">{money(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.orders.byStatus.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-text-secondary">Orders by status</p>
                <ul className="space-y-1">
                  {summary.orders.byStatus.map(s => (
                    <li key={s.status} className="flex items-center justify-between text-xs">
                      <span className="text-text-primary">{s.status} ({s.count})</span>
                      <span className="text-text-secondary">{money(s.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SummarySection>

          {/* Locations and flags */}
          <SummarySection title="Locations covered">
            {summary.meetings.locationsCovered.length === 0 ? (
              <p className="text-sm text-text-secondary">No locations were captured on this day.</p>
            ) : (
              <ul className="space-y-1">
                {summary.meetings.locationsCovered.map(l => (
                  <li key={l} className="text-xs text-text-primary">• {l}</li>
                ))}
              </ul>
            )}
            {summary.meetings.locationFlaggedCount > 0 && (
              <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">
                {summary.meetings.locationFlaggedCount} meeting{summary.meetings.locationFlaggedCount === 1 ? '' : 's'} flagged
                for a location difference. This is for review only — nothing was blocked.
              </p>
            )}
          </SummarySection>

          {/* Deal movement */}
          <SummarySection title="Opportunity movement">
            <div className="grid grid-cols-3 gap-2">
              <Figure label="Stages moved" value={String(summary.deals.stagesMoved)} />
              <Figure label="Won" value={String(summary.deals.won)} />
              <Figure label="Lost" value={String(summary.deals.lost)} />
            </div>
            {summary.deals.movements.length > 0 && (
              <ul className="mt-3 space-y-1">
                {summary.deals.movements.map((m, i) => (
                  <li key={`${m.dealId}-${i}`} className="text-xs text-text-primary">
                    • {m.dealName}: {m.fromStage ?? 'New'} → {m.toStage}
                  </li>
                ))}
              </ul>
            )}
          </SummarySection>

          {/* Follow-ups */}
          <SummarySection title="Follow-ups due today, not done">
            {summary.followUps.notDone.length === 0 ? (
              <p className="text-sm text-text-secondary">
                {summary.followUps.dueToday === 0
                  ? 'No follow-ups were due on this day.'
                  : 'All follow-ups due on this day were done.'}
              </p>
            ) : (
              <ul className="space-y-1">
                {summary.followUps.notDone.map(f => (
                  <li key={f.id} className="text-xs text-text-primary">
                    • {f.dealName} — {f.mode}{f.notes ? `: ${f.notes}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </SummarySection>

          {/* Next-day preview strip */}
          <div className="rounded-2xl border border-border-light bg-surface-sunken p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              Next day · {formatDayHeader(summary.nextDay.date)}
            </p>
            {summary.nextDay.goals ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-primary">
                <span>{summary.nextDay.goals.total} planned</span>
                <span className="text-text-secondary">
                  {summary.nextDay.goals.newParties} new · {summary.nextDay.goals.existingParties} existing · {summary.nextDay.goals.others} other
                </span>
                {summary.nextDay.route && (summary.nextDay.route.from || summary.nextDay.route.to) && (
                  <span className="text-text-secondary">
                    {summary.nextDay.route.from ?? '—'} → {summary.nextDay.route.to ?? '—'}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-xs text-text-secondary">Nothing planned for the next day yet.</p>
            )}
          </div>
        </div>
      )}

      {/*
        REBUILD-PLAN §6.5 — the manager's comment on the Daily Summary.

        It sits at the BOTTOM of the sheet and is keyed on the whole sheet
        (`userId` + `selectedDate`), not on any section of it, because §6.5 puts
        one comment against the summary rather than against a meeting or an
        expense inside it. Changing the day in the WeekStrip above changes
        `selectedDate`, which re-keys the thread — each day carries its own
        comment, which is what `summaryContextId()` derives server-side.

        Rendered only once the sheet has actually loaded. A comment box under a
        summary that failed to load would invite a remark about figures nobody
        can see, and under the loading state it would flash in and out.

        The panel decides for itself whether to show a composer: the reviewer
        gets one until they have left their comment, the owner gets one until
        they have used their single reply, and everyone else gets none. Those
        are the same rules `/api/remarks` enforces (see `_access.ts`), so a
        control that would be refused is never drawn — rather than drawn and
        then failing.
      */}
      {!loading && !error && summary && (
        <div className="mt-6 max-w-3xl">
          <RemarkThread
            contextType="daily_summary"
            userId={userId}
            date={selectedDate}
            title="Manager comment"
            emptyHint="No comment on this day’s summary yet."
          />
        </div>
      )}
    </div>
  )
}

// ---- Expenses Tab ----
function ExpensesTab({ userId, onOpenRemarks }: { userId: string; onOpenRemarks: (ctx: { contextType: 'expense'; contextId: string; title: string }) => void }) {
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()))
  const [weekOffset, setWeekOffset] = useState(0)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  function getWeekStart(offset: number) {
    const today = new Date()
    const day = today.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(today)
    monday.setDate(today.getDate() + diff + offset * 7)
    monday.setHours(0, 0, 0, 0)
    return monday
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetch(`/api/review/expenses?userId=${userId}&date=${selectedDate}`, { signal: AbortSignal.timeout(20000) })
      .then(async r => {
        if (!r.ok) throw new Error('load failed')
        const d = await r.json()
        if (!Array.isArray(d)) throw new Error('unexpected shape')
        return d as Expense[]
      })
      .then(d => { if (!cancelled) { setExpenses(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setFailed(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [userId, selectedDate, attempt])

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div>
      <WeekStrip
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onPrevWeek={() => { const o = weekOffset - 1; setWeekOffset(o); setSelectedDate(toDateStr(getWeekStart(o))) }}
        onNextWeek={() => { const o = weekOffset + 1; setWeekOffset(o); setSelectedDate(toDateStr(getWeekStart(o))) }}
        calendarApiBase={`/api/expenses/calendar?userId=${userId}`}
      />

      {loading ? <div className="text-center py-12 text-text-muted">Loading...</div> : failed ? (
        <div className="rounded-2xl border border-border-light bg-surface p-6 text-center">
          <p className="text-sm text-text-primary">Couldn&apos;t load this day&apos;s expenses. Check your connection and try again.</p>
          <button onClick={() => setAttempt(a => a + 1)} className="mt-3 text-sm font-medium text-primary hover:text-primary-hover">Try again</button>
        </div>
      ) : expenses.length === 0 ? (
        <div className="text-center py-12 text-text-muted">No expenses on this day.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-4 py-3 bg-surface-sunken rounded-xl text-sm">
            <span className="text-text-secondary">{expenses.length} expense{expenses.length !== 1 ? 's' : ''}</span>
            <span className="font-medium text-text-primary">Total: ₹{total.toFixed(0)}</span>
          </div>
          {expenses.map(exp => (
            <div key={exp.id} className="bg-surface rounded-2xl border border-border-light px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full" style={categoryStyle(exp.category)}>{exp.category}</span>
                <span className="text-base font-medium text-text-primary ml-auto">₹{Number(exp.amount).toFixed(0)}</span>
              </div>
              {exp.notes && <p className="text-sm text-text-muted mt-1.5">{exp.notes}</p>}
              {exp.photo_url && (
                <a href={exp.photo_url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                  <img src={exp.photo_url} alt="Receipt" className="h-20 w-auto rounded-lg border border-border-light object-cover hover:opacity-90 transition" />
                </a>
              )}
              <div className="mt-2 pt-2 border-t border-border-light flex justify-end">
                <button onClick={() => onOpenRemarks({ contextType: 'expense', contextId: exp.id, title: `${exp.category} — ₹${Number(exp.amount).toFixed(0)}` })}
                  className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary-subtle transition" title="Remarks">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Main Page (inner — uses useSearchParams) ----
function ReviewUserInner() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const userId = params.userId as string

  const [userName, setUserName] = useState('')
  const [userLevel, setUserLevel] = useState('')
  const initialTab = (searchParams.get('tab') as 'plans' | 'activity' | 'summary' | 'expenses') ?? 'plans'
  /*
   * A reopen request notifies the manager with a link to this person's plans
   * tab. The review screens are not a phone screen, but the plans are: on a
   * phone that link opens the plan approvals list narrowed to this person.
   */
  const { layout } = useLayout()
  useEffect(() => {
    if (layout === 'phone' && initialTab === 'plans') {
      router.replace(`/weekly-plan/approval?view=all&owner=${encodeURIComponent(userId)}`)
    }
  }, [layout, initialTab, userId, router])
  const [tab, setTab] = useState<'plans' | 'activity' | 'summary' | 'expenses'>(initialTab)
  const [meLoaded, setMeLoaded] = useState(false)

  // Remarks panel state
  const [remarksPanel, setRemarksPanel] = useState<RemarksState>(null)

  // Deep link: auto-open remarks from URL
  const initialRemarks = searchParams.get('remarks')
  /* `?date=` — which day a deep link into the Summary tab means. */
  const initialDate = searchParams.get('date')
  useEffect(() => {
    if (initialRemarks) {
      const ctxType = tab === 'expenses' ? 'expense' : 'meeting'
      setRemarksPanel({ contextType: ctxType as 'meeting' | 'expense', contextId: initialRemarks, title: 'Remarks' })
    }
  }, [initialRemarks, tab])

  useEffect(() => {
    fetch('/api/review/summary-cards').then(r => r.ok ? r.json() : []).then((cards: { id: string; name: string; level: string }[]) => {
      const found = Array.isArray(cards) ? cards.find((c) => c.id === userId) : undefined
      if (found) { setUserName(found.name); setUserLevel(found.level) }
      setMeLoaded(true)
    }).catch(() => setMeLoaded(true))
  }, [userId])

  const TABS = [
    { id: 'plans', label: 'Weekly Plans' },
    { id: 'activity', label: 'Daily Activity' },
    { id: 'summary', label: 'Summary' },
    { id: 'expenses', label: 'Expenses' },
  ] as const

  return (
    <div className="max-w-2xl mx-auto pb-24">
      {/* Back + Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push('/review')} className="p-2 rounded-lg hover:bg-surface-control text-text-muted transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div>
          <h2 className="text-xl font-medium text-text-primary">{userName || 'Team Member'}</h2>
          {userLevel && <p className="text-xs text-text-muted">{userLevel}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-border-light">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`pb-3 px-3 text-sm font-medium border-b-2 transition ${tab === t.id ? 'border-primary-border text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {meLoaded && (
        <>
          {tab === 'plans' && <WeeklyPlansTab userId={userId} onOpenRemarks={setRemarksPanel} />}
          {tab === 'activity' && <DailyActivityTab userId={userId} onOpenRemarks={setRemarksPanel} />}
          {tab === 'summary' && <SummaryTab userId={userId} initialDate={initialDate} />}
          {tab === 'expenses' && <ExpensesTab userId={userId} onOpenRemarks={setRemarksPanel} />}
        </>
      )}

      {/* Remarks Panel */}
      {remarksPanel && (
        <RemarksPanel
          isOpen={!!remarksPanel}
          onClose={() => setRemarksPanel(null)}
          contextType={remarksPanel.contextType}
          contextId={remarksPanel.contextId}
          contextTitle={remarksPanel.title}
          heading={remarksPanel.contextType === 'meeting' ? 'Minutes of the meeting' : undefined}
          earlierNote={remarksPanel.earlierNote}
        />
      )}
    </div>
  )
}

export default function ReviewUserPage() {
  return (
    <Suspense fallback={<div className="text-center py-16 text-text-muted">Loading...</div>}>
      <ReviewUserInner />
    </Suspense>
  )
}
