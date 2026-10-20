'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon, ArrowUpDownIcon, ArrowUpIcon, ArrowDownIcon } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { LoadError } from '@/components/ui/load-error'
import { loadJson } from '@/lib/load-list'
import { CategoryBarChart } from '@/components/ui/bar-chart'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import { StatusBadge, WEEKLY_PLAN_STATUS } from '@/components/status-badge'

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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function formatWeekRange(monday: Date) {
  const sun = addDays(monday, 6)
  const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })} ${d.getFullYear()}`
  return `${fmt(monday)} – ${fmt(sun)}`
}
function fmtCurrency(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`
  return `₹${n.toLocaleString('en-IN')}`
}
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ---- Types ----
type DailyActivity = { date: string; meetingsCompleted: number; meetingsTotal: number; orderValue: number; expenseAmount: number }
type MemberPerf = {
  userId: string; userName: string; level: string
  planStatus: string | null; planId: string | null
  dailyActivity: DailyActivity[]; weekTotals: { meetingsCompleted: number; meetingsTotal: number; orderValue: number; expenseAmount: number }
  /** null when the caller cannot see this person's meetings at all. */
  missedCount: number | null
  outcomeCounts: { met: number; metLate: number; couldntMeet: number; missed: number } | null
  repeatedCouldntMeet: { party_id: string; party_name: string | null }[] | null
}
type PendingPlan = { id: string; userId: string; userName: string; weekStartDate: string; status: string; reopen_requested: boolean; reopen_request_message: string | null }
type ManagerData = {
  isManager: true; weekStart: string; weekEnd: string; teamSize: number
  planStats: { approved: number; submitted: number; rejected: number; draft: number; onHold: number; notSubmitted: number }
  pendingPlans: PendingPlan[]; teamPerformance: MemberPerf[]
  /** Sections the caller cannot read for any report; their figures are not zeros. */
  denied?: DeniedSection[]
}
type DeniedSection = 'weekly_plan' | 'meetings' | 'orders' | 'expenses'
type PersonalData = { isManager: false }
type DashData = ManagerData | PersonalData | null

// ---- Sub-components ----

/** An absent figure (kit §31.2): muted words, never a 0 that reads as data. */
function NotAvailable({ className = '' }: { className?: string }) {
  return <span className={`text-text-muted ${className}`}>Not available</span>
}

function KPICard({ label, value, sub, color = 'text-text-primary', subColor = 'text-text-secondary' }: { label: string; value: string | number; sub?: string; color?: string; subColor?: string }) {
  return (
    <div className="rounded-2xl border border-border-light bg-surface p-5 shadow-sm">
      <p className={`text-2xl font-medium ${color}`}>{value}</p>
      <p className="text-xs font-medium text-text-muted mt-0.5 uppercase tracking-wide">{label}</p>
      {sub && <p className={`text-xs mt-1 ${subColor}`}>{sub}</p>}
    </div>
  )
}

/**
 * kit gap: section 21's bar-chart component has no sparkline form (it is
 * category rows with labelled bars, not a dense per-cell trend). A plain
 * `<svg>` stays here, but its fill now reads the chart ramp token instead
 * of a literal hex — see docs/kit-audit/kit-gaps.md.
 */
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  const W = 5, H = 24, GAP = 2
  return (
    <svg width={(W + GAP) * 7 - GAP} height={H} className="inline-block">
      {data.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * H))
        return (
          <rect key={i} x={i * (W + GAP)} y={H - h} width={W} height={h}
            rx={1} fill={v > 0 ? 'var(--color-chart-ramp-5)' : 'var(--color-chart-ramp-1)'} />
        )
      })}
    </svg>
  )
}

/** The dashboard's own Plan status badge, now the shared section 11.1
 *  vocabulary (status-badge.tsx's WEEKLY_PLAN_STATUS) instead of a second,
 *  hand-rolled colour map — see that file for why "Edited by Manager" is
 *  neutral rather than purple. */
function PlanBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-text-secondary">—</span>
  return <StatusBadge vocabulary={WEEKLY_PLAN_STATUS} status={status} />
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ---- Main Page ----
export default function DashboardPage() {
  const router = useRouter()
  const { toast } = useToast()

  const [weekMonday, setWeekMonday] = useState(() => getMondayOf(new Date()))
  const [data, setData] = useState<DashData>(null)
  const [loading, setLoading] = useState(true)
  // Without this the dashboard had no failure state at all: no res.ok
  // check, no try/catch, and a 403 left "Loading dashboard…" on screen
  // for ever because nothing ever cleared the flag.
  const [error, setError] = useState<{ forbidden: boolean } | null>(null)
  const [me, setMe] = useState<{ name: string } | null>(null)
  const [acting, setActing] = useState(false)
  const [commentModal, setCommentModal] = useState<{ planId: string; action: 'reject' } | null>(null)
  const [comment, setComment] = useState('')
  const [sortCol, setSortCol] = useState<'name' | 'meetings' | 'orders' | 'expenses'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const weekStart = toDateStr(weekMonday)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    const res = await loadJson<unknown>(`/api/dashboard/manager?weekStart=${weekStart}`, signal)
    if (res.ok) {
      setData(res.data && typeof res.data === 'object' ? (res.data as DashData) : null)
    } else {
      // Stepping through weeks quickly aborts the older request; its
      // answer is stale, so it must not land on top of the newer one.
      if (res.aborted) return
      setData(null)
      setError({ forbidden: res.forbidden })
    }
    setLoading(false)
  }, [weekStart])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    loadJson<{ name?: string }>('/api/auth/me').then(r => {
      if (r.ok && typeof r.data?.name === 'string') setMe({ name: r.data.name })
    })
  }, [])

  /**
   * The three handlers below all used to read `(await r.json()).error`
   * on the failure path. A response with no JSON body - a proxy error
   * page, a dropped connection - rejects there, inside an async
   * function with no catch, so `setActing(false)` never ran and every
   * Approve and Reject button on the panel stayed disabled until a
   * reload.
   */
  async function failureMessage(r: Response) {
    try {
      const body = await r.json()
      if (body && typeof body.error === 'string') return body.error
    } catch { /* no JSON body; fall through to the generic wording */ }
    return 'That did not go through. Try again in a moment.'
  }

  async function approvePlan(planId: string) {
    setActing(true)
    try {
      const r = await fetch(`/api/weekly-plans/${planId}/approve`, { method: 'POST' })
      if (!r.ok) toast(await failureMessage(r), 'error')
      else { toast('Plan approved'); load() }
    } catch {
      toast('That did not go through. Check your connection and try again.', 'error')
    } finally {
      setActing(false)
    }
  }

  async function rejectPlan(planId: string, msg: string) {
    setActing(true)
    try {
      const r = await fetch(`/api/weekly-plans/${planId}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: msg })
      })
      if (!r.ok) toast(await failureMessage(r), 'error')
      else { toast('Plan rejected'); setCommentModal(null); setComment(''); load() }
    } catch {
      toast('That did not go through. Check your connection and try again.', 'error')
    } finally {
      setActing(false)
    }
  }

  async function handleReopen(planId: string, action: 'accept-reopen' | 'decline-reopen') {
    setActing(true)
    try {
      const r = await fetch(`/api/weekly-plans/${planId}/${action}`, { method: 'POST' })
      if (!r.ok) toast(await failureMessage(r), 'error')
      else { toast(action === 'accept-reopen' ? 'Reopen accepted' : 'Reopen declined'); load() }
    } catch {
      toast('That did not go through. Check your connection and try again.', 'error')
    } finally {
      setActing(false)
    }
  }

  // Sorted team performance
  const sorted = useMemo(() => {
    if (!data || !('teamPerformance' in data)) return []
    return [...data.teamPerformance].sort((a, b) => {
      let va: number | string, vb: number | string
      if (sortCol === 'name') { va = a.userName; vb = b.userName }
      else if (sortCol === 'meetings') { va = a.weekTotals.meetingsCompleted; vb = b.weekTotals.meetingsCompleted }
      else if (sortCol === 'orders') { va = a.weekTotals.orderValue; vb = b.weekTotals.orderValue }
      else { va = a.weekTotals.expenseAmount; vb = b.weekTotals.expenseAmount }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [data, sortCol, sortDir])

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function SortIcon({ col }: { col: typeof sortCol }) {
    if (sortCol !== col) return <ArrowUpDownIcon className="size-3.5 text-text-muted ml-1" />
    return sortDir === 'asc'
      ? <ArrowUpIcon className="size-3.5 text-primary ml-1" />
      : <ArrowDownIcon className="size-3.5 text-primary ml-1" />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-muted text-sm">Loading dashboard...</div>
      </div>
    )
  }

  if (error) {
    return <LoadError forbidden={error.forbidden} what="the team dashboard" onRetry={() => load()} />
  }

  // ---- Non-manager view ----
  if (!data || !('isManager' in data) || !data.isManager) {
    return (
      <div>
        <h2 className="text-page-title font-medium text-text-primary mb-6">Dashboard</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link href="/weekly-plan" className="rounded-2xl border border-border-light bg-surface p-5 shadow-sm hover:border-primary-border transition outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring">
            <p className="text-sm font-medium text-text-muted uppercase tracking-wide mb-1">Weekly Plan</p>
            <p className="text-sm text-text-secondary">View and submit your weekly plan</p>
          </Link>
          <Link href="/daily-activity" className="rounded-2xl border border-border-light bg-surface p-5 shadow-sm hover:border-primary-border transition outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring">
            <p className="text-sm font-medium text-text-muted uppercase tracking-wide mb-1">Daily Activity</p>
            <p className="text-sm text-text-secondary">Log meetings and expenses</p>
          </Link>
          <Link href="/orders" className="rounded-2xl border border-border-light bg-surface p-5 shadow-sm hover:border-primary-border transition outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring">
            <p className="text-sm font-medium text-text-muted uppercase tracking-wide mb-1">Orders</p>
            <p className="text-sm text-text-secondary">View and create orders</p>
          </Link>
        </div>
      </div>
    )
  }

  // ---- Manager dashboard ----
  const { teamSize, planStats, pendingPlans, teamPerformance, denied = [] } = data as ManagerData
  const plansDenied = denied.includes('weekly_plan')
  const meetingsDenied = denied.includes('meetings')
  const ordersDenied = denied.includes('orders')
  const expensesDenied = denied.includes('expenses')

  const totalMeetingsCompleted = teamPerformance.reduce((s, m) => s + m.weekTotals.meetingsCompleted, 0)
  const totalMeetingsAll = teamPerformance.reduce((s, m) => s + m.weekTotals.meetingsTotal, 0)
  const totalOrders = teamPerformance.reduce((s, m) => s + m.weekTotals.orderValue, 0)
  const totalExpenses = teamPerformance.reduce((s, m) => s + m.weekTotals.expenseAmount, 0)

  // Chart data: meetings per day across team
  const chartData = DAY_LABELS.map((day, i) => {
    const dateStr = toDateStr(addDays(weekMonday, i))
    const completed = teamPerformance.reduce((s, m) => s + (m.dailyActivity[i]?.meetingsCompleted ?? 0), 0)
    const pending = teamPerformance.reduce((s, m) => {
      const d = m.dailyActivity[i]
      return s + ((d?.meetingsTotal ?? 0) - (d?.meetingsCompleted ?? 0))
    }, 0)
    return { day, date: dateStr, completed, pending }
  })

  // Plan compliance percentages. Colour comes from the same section-11.1
  // status vocabulary as PlanBadge (status-badge.tsx's WEEKLY_PLAN_STATUS)
  // rather than a second, independent hex map — a status gets one colour
  // everywhere it appears. "Not Submitted" is not a real weekly_plans
  // status (it is this count's own absence bucket), so it takes the
  // vocabulary's neutral fallback directly.
  const complianceSegments = [
    { label: 'Approved', count: planStats.approved, role: WEEKLY_PLAN_STATUS.Approved.role },
    { label: 'Submitted', count: planStats.submitted, role: WEEKLY_PLAN_STATUS.Submitted.role },
    { label: 'On Hold', count: planStats.onHold, role: WEEKLY_PLAN_STATUS['On Hold'].role },
    { label: 'Rejected', count: planStats.rejected, role: WEEKLY_PLAN_STATUS.Rejected.role },
    { label: 'Draft', count: planStats.draft, role: WEEKLY_PLAN_STATUS.Draft.role },
    { label: 'Not Submitted', count: planStats.notSubmitted, role: 'neutral' as const },
  ]
  const ROLE_FILL: Record<string, string> = {
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    danger: 'var(--color-danger)',
    neutral: 'var(--color-border-strong)',
  }
  // The plans the counts cover, not the team size: a caller outside some
  // reports' plans must not see them as a share of the whole team.
  const planTotal = complianceSegments.reduce((s, seg) => s + seg.count, 0)

  const pendingCount = pendingPlans.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-page-title font-medium text-text-primary">{greeting()}{me?.name ? `, ${me.name}` : ''}</h2>
          <p className="text-sm text-text-muted mt-0.5">Team performance overview</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setWeekMonday(d => addDays(d, -7))} aria-label="Previous week">
            <ChevronLeftIcon />
          </Button>
          <span className="text-sm font-medium text-text-secondary px-2 min-w-[180px] text-center">{formatWeekRange(weekMonday)}</span>
          <Button variant="ghost" size="icon" onClick={() => setWeekMonday(d => addDays(d, 7))} aria-label="Next week">
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Team Members" value={teamSize} sub="Everyone under you" />
        {plansDenied ? (
          <KPICard label="Plan Compliance" value="Not available" color="text-text-muted" />
        ) : (
          <KPICard
            label="Plan Compliance"
            value={`${planStats.approved}/${planTotal} approved`}
            sub={pendingCount > 0 ? `${pendingCount} need${pendingCount === 1 ? 's' : ''} attention` : 'All reviewed'}
            subColor={pendingCount > 0 ? 'text-warning font-medium' : 'text-success'}
          />
        )}
        {meetingsDenied ? (
          <KPICard label="Meetings This Week" value="Not available" color="text-text-muted" />
        ) : (
          <KPICard
            label="Meetings This Week"
            value={`${totalMeetingsCompleted}/${totalMeetingsAll}`}
            sub="completed / total"
          />
        )}
        <KPICard
          label="Orders This Week"
          value={ordersDenied ? 'Not available' : fmtCurrency(totalOrders)}
          color={ordersDenied ? 'text-text-muted' : undefined}
          sub={`Expenses: ${expensesDenied ? 'Not available' : fmtCurrency(totalExpenses)}`}
        />
      </div>

      {/* Chart + Pending Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bar Chart */}
        <div className="lg:col-span-2 rounded-2xl border border-border-light bg-surface p-5 shadow-sm">
          <h3 className="text-sm font-medium text-text-primary mb-4">Daily Meeting Activity — Team Total</h3>
          {meetingsDenied ? (
            <div className="flex h-[220px] items-center justify-center text-sm">
              <NotAvailable />
            </div>
          ) : (
          <CategoryBarChart
            data={chartData}
            category={d => d.day}
            series={[
              { label: 'Completed', value: d => d.completed, format: d => String(d.completed) },
              { label: 'Pending', value: d => d.pending, format: d => String(d.pending) },
            ]}
          />
          )}
        </div>

        {/* Pending Actions */}
        <div className="rounded-2xl border border-border-light bg-surface p-5 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-sm font-medium text-text-primary">Needs Attention</h3>
            {pendingCount > 0 && (
              <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-warning-bg text-warning">{pendingCount}</span>
            )}
          </div>
          {plansDenied ? (
            <div className="flex-1 flex items-center justify-center py-6 text-sm">
              <NotAvailable />
            </div>
          ) : pendingCount === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
              <svg className="w-10 h-10 text-success mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-text-secondary">All clear!</p>
              <p className="text-xs text-text-secondary mt-0.5">No actions pending this week</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-3">
              {pendingPlans.map(pp => (
                <div key={pp.id} className={`rounded-xl p-3 border ${pp.reopen_requested ? 'bg-warning-bg border-warning-border' : 'bg-primary-subtle border-primary-border'}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-sm font-medium text-text-primary">{pp.userName}</p>
                      <p className="text-xs text-text-muted">
                        {pp.reopen_requested ? 'Reopen request' : 'Awaiting approval'} · {new Date(pp.weekStartDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <button onClick={() => router.push(`/review/${pp.userId}?tab=plans`)}
                      className="text-[11px] text-text-muted hover:text-text-secondary shrink-0">
                      View →
                    </button>
                  </div>
                  {pp.reopen_requested && pp.reopen_request_message && (
                    <p className="text-xs text-warning bg-surface rounded px-2 py-1 mb-2 border border-warning-border italic">
                      &ldquo;{pp.reopen_request_message}&rdquo;
                    </p>
                  )}
                  <div className="flex gap-2">
                    {pp.reopen_requested ? (
                      <>
                        <Button size="sm" className="flex-1" disabled={acting} onClick={() => handleReopen(pp.id, 'accept-reopen')}>
                          Accept
                        </Button>
                        <Button size="sm" variant="danger" className="flex-1" disabled={acting} onClick={() => handleReopen(pp.id, 'decline-reopen')}>
                          Decline
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" className="flex-1" disabled={acting} onClick={() => approvePlan(pp.id)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="danger" className="flex-1" disabled={acting} onClick={() => { setCommentModal({ planId: pp.id, action: 'reject' }); setComment('') }}>
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Plan Compliance Bar */}
      <div className="rounded-2xl border border-border-light bg-surface p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary">Plan Compliance This Week</h3>
          {!plansDenied && (
            <span className="text-sm font-medium text-text-secondary">
              {planTotal > 0 ? Math.round(((planStats.approved) / planTotal) * 100) : 0}% approved
            </span>
          )}
        </div>
        {plansDenied ? (
          <p className="text-sm"><NotAvailable /></p>
        ) : (
        <>
        <div className="flex h-4 rounded-full overflow-hidden bg-surface-control mb-3">
          {complianceSegments.map(seg => seg.count > 0 && (
            <div key={seg.label} title={`${seg.label}: ${seg.count}`}
              style={{ width: `${(seg.count / planTotal) * 100}%`, backgroundColor: ROLE_FILL[seg.role] }}
              className="transition-all" />
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {complianceSegments.map(seg => (
            <div key={seg.label} className="flex items-center gap-1.5 text-xs text-text-secondary">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ROLE_FILL[seg.role] }} />
              {seg.label} ({seg.count})
            </div>
          ))}
        </div>
        </>
        )}
      </div>

      {/* Team Performance Table */}
      <div className="rounded-2xl border border-border-light bg-surface shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border-light">
          <h3 className="text-sm font-medium text-text-primary">Team Performance</h3>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button onClick={() => toggleSort('name')} className="text-xs font-medium uppercase tracking-wide flex items-center">
                    Member <SortIcon col="name" />
                  </button>
                </TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-center">Activity</TableHead>
                {DAY_LABELS.map(d => (
                  <TableHead key={d} className="text-center w-8">{d}</TableHead>
                ))}
                <TableHead numeric>
                  <button onClick={() => toggleSort('meetings')} className="text-xs font-medium uppercase tracking-wide flex items-center ml-auto">
                    Meetings <SortIcon col="meetings" />
                  </button>
                </TableHead>
                <TableHead numeric>Met</TableHead>
                <TableHead numeric>Met late</TableHead>
                <TableHead numeric>Couldn&apos;t meet</TableHead>
                <TableHead numeric>Missed</TableHead>
                <TableHead numeric>
                  <button onClick={() => toggleSort('orders')} className="text-xs font-medium uppercase tracking-wide flex items-center ml-auto">
                    Orders <SortIcon col="orders" />
                  </button>
                </TableHead>
                <TableHead numeric>
                  <button onClick={() => toggleSort('expenses')} className="text-xs font-medium uppercase tracking-wide flex items-center ml-auto">
                    Expenses <SortIcon col="expenses" />
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map(m => (
                <TableRow key={m.userId}
                  onClick={() => router.push(`/review/${m.userId}`)}
                  className="cursor-pointer hover:bg-primary-subtle/50 transition">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary-subtle text-primary text-xs font-medium flex items-center justify-center shrink-0">
                        {m.userName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-text-primary text-sm leading-tight">{m.userName}</p>
                        {m.level && <p className="text-[11px] text-text-muted">{m.level}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell onClick={e => { e.stopPropagation(); router.push(`/review/${m.userId}?tab=plans`) }}>
                    {plansDenied ? <NotAvailable className="text-xs" /> : <PlanBadge status={m.planStatus} />}
                  </TableCell>
                  <TableCell className="text-center">
                    {meetingsDenied
                      ? <NotAvailable className="text-xs" />
                      : <Sparkline data={m.dailyActivity.map(d => d.meetingsCompleted)} />}
                  </TableCell>
                  {m.dailyActivity.map((d, i) => (
                    <TableCell key={i} className="text-center"
                      onClick={e => { e.stopPropagation(); router.push(`/review/${m.userId}?tab=daily&date=${d.date}`) }}>
                      {meetingsDenied ? (
                        <span className="text-xs text-text-muted">—</span>
                      ) : (
                        <span className={`text-xs font-medium ${d.meetingsCompleted > 0 ? 'text-primary' : 'text-text-secondary'}`}>
                          {d.meetingsTotal > 0 ? `${d.meetingsCompleted}/${d.meetingsTotal}` : '—'}
                        </span>
                      )}
                    </TableCell>
                  ))}
                  <TableCell numeric
                    onClick={e => { e.stopPropagation(); router.push(`/review/${m.userId}?tab=daily`) }}>
                    {meetingsDenied ? <NotAvailable className="text-sm" /> : (
                      <span className="text-sm font-medium text-text-secondary">
                        {m.weekTotals.meetingsCompleted}/{m.weekTotals.meetingsTotal}
                      </span>
                    )}
                  </TableCell>
                  <TableCell numeric>
                    {m.outcomeCounts === null ? <NotAvailable className="text-sm" /> : (
                      <span className="text-sm font-medium text-text-secondary">{m.outcomeCounts.met}</span>
                    )}
                  </TableCell>
                  <TableCell numeric>
                    {m.outcomeCounts === null ? <NotAvailable className="text-sm" /> : (
                      <span className="text-sm font-medium text-text-secondary">{m.outcomeCounts.metLate}</span>
                    )}
                  </TableCell>
                  <TableCell numeric>
                    {m.outcomeCounts === null ? <NotAvailable className="text-sm" /> : (
                      <span className="inline-flex items-center justify-end gap-1.5 text-sm font-medium text-text-secondary">
                        {m.outcomeCounts.couldntMeet}
                        {m.repeatedCouldntMeet && m.repeatedCouldntMeet.length > 0 && (
                          <span
                            className="inline-flex size-4 items-center justify-center rounded-full bg-warning-bg text-[10px] font-semibold text-warning"
                            title={`Couldn't meet 3+ times with: ${m.repeatedCouldntMeet.map(p => p.party_name ?? 'Unknown').join(', ')}`}
                          >
                            !
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell numeric>
                    {m.missedCount === null ? <NotAvailable className="text-sm" /> : (
                      <span className={`text-sm font-medium ${m.missedCount > 0 ? 'text-warning' : 'text-text-secondary'}`}>
                        {m.missedCount}
                      </span>
                    )}
                  </TableCell>
                  <TableCell numeric
                    onClick={e => { e.stopPropagation(); router.push(`/orders?userId=${m.userId}`) }}>
                    {ordersDenied
                      ? <NotAvailable className="text-sm" />
                      : <span className="text-sm font-medium text-text-secondary">{fmtCurrency(m.weekTotals.orderValue)}</span>}
                  </TableCell>
                  <TableCell numeric
                    onClick={e => { e.stopPropagation(); router.push(`/review/${m.userId}?tab=expenses`) }}>
                    {expensesDenied
                      ? <NotAvailable className="text-sm" />
                      : <span className="text-sm font-medium text-text-secondary">{fmtCurrency(m.weekTotals.expenseAmount)}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {sorted.length === 0 && (
            <p className="text-center py-8 text-sm text-text-muted">No team members found</p>
          )}
        </div>
      </div>

      {/* Reject Comment dialog — alert-dialog has no form body in the kit
          (section 24), so a Textarea sits inside its header zone, which is
          the one part of the dialog that scrolls (see alert-dialog.tsx). */}
      <AlertDialog open={!!commentModal} onOpenChange={open => { if (!open) setCommentModal(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Plan</AlertDialogTitle>
            <AlertDialogDescription>State why this plan is being rejected; the owner sees this reason.</AlertDialogDescription>
            <Textarea value={comment} onChange={e => setComment(e.target.value)}
              rows={4} placeholder="Reason for rejection (required)…"
              className="mt-2" />
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={acting || !comment.trim()}
              loading={acting}
              loadingLabel="Rejecting…"
              onClick={() => commentModal && rejectPlan(commentModal.planId, comment)}
            >
              Reject Plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
