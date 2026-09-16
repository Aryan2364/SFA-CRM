'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

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
}
type PendingPlan = { id: string; userId: string; userName: string; weekStartDate: string; status: string; reopen_requested: boolean; reopen_request_message: string | null }
type ManagerData = {
  isManager: true; weekStart: string; weekEnd: string; teamSize: number
  planStats: { approved: number; submitted: number; rejected: number; draft: number; onHold: number; notSubmitted: number }
  pendingPlans: PendingPlan[]; teamPerformance: MemberPerf[]
}
type PersonalData = { isManager: false }
type DashData = ManagerData | PersonalData | null

// ---- Sub-components ----

function KPICard({ label, value, sub, color = 'text-gray-900', subColor = 'text-gray-500' }: { label: string; value: string | number; sub?: string; color?: string; subColor?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className={`text-2xl font-medium ${color}`}>{value}</p>
      <p className="text-xs font-medium text-gray-500 mt-0.5 uppercase tracking-wide">{label}</p>
      {sub && <p className={`text-xs mt-1 ${subColor}`}>{sub}</p>}
    </div>
  )
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  const W = 5, H = 24, GAP = 2
  return (
    <svg width={(W + GAP) * 7 - GAP} height={H} className="inline-block">
      {data.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * H))
        return (
          <rect key={i} x={i * (W + GAP)} y={H - h} width={W} height={h}
            rx={1} fill={v > 0 ? '#3b82f6' : '#e5e7eb'} />
        )
      })}
    </svg>
  )
}

function PlanBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">—</span>
  const map: Record<string, string> = {
    'Approved': 'bg-green-100 text-green-700',
    'Submitted': 'bg-blue-100 text-blue-700',
    'Resubmitted': 'bg-blue-100 text-blue-700',
    'Rejected': 'bg-red-100 text-red-700',
    'On Hold': 'bg-yellow-100 text-yellow-700',
    'Draft': 'bg-gray-100 text-gray-600',
    'Edited by Manager': 'bg-purple-100 text-purple-700',
  }
  return <span className={`text-[11px] font-normal px-2 py-0.5 rounded-full ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>{status}</span>
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ---- Main Page ----
export default function DashboardPage() {
  const router = useRouter()
  const { toast } = useToast()

  const [weekMonday, setWeekMonday] = useState(() => getMondayOf(new Date()))
  const [data, setData] = useState<DashData>(null)
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<{ name: string } | null>(null)
  const [acting, setActing] = useState(false)
  const [commentModal, setCommentModal] = useState<{ planId: string; action: 'reject' } | null>(null)
  const [comment, setComment] = useState('')
  const [sortCol, setSortCol] = useState<'name' | 'meetings' | 'orders' | 'expenses'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const weekStart = toDateStr(weekMonday)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/dashboard/manager?weekStart=${weekStart}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
  }, [weekStart])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => setMe({ name: d.name })).catch(() => {})
  }, [])

  async function approvePlan(planId: string) {
    setActing(true)
    const r = await fetch(`/api/weekly-plans/${planId}/approve`, { method: 'POST' })
    if (!r.ok) toast((await r.json()).error ?? 'Failed', 'error')
    else { toast('Plan approved'); load() }
    setActing(false)
  }

  async function rejectPlan(planId: string, msg: string) {
    setActing(true)
    const r = await fetch(`/api/weekly-plans/${planId}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: msg })
    })
    if (!r.ok) toast((await r.json()).error ?? 'Failed', 'error')
    else { toast('Plan rejected'); setCommentModal(null); setComment(''); load() }
    setActing(false)
  }

  async function handleReopen(planId: string, action: 'accept-reopen' | 'decline-reopen') {
    setActing(true)
    const r = await fetch(`/api/weekly-plans/${planId}/${action}`, { method: 'POST' })
    if (!r.ok) toast((await r.json()).error ?? 'Failed', 'error')
    else { toast(action === 'accept-reopen' ? 'Reopen accepted' : 'Reopen declined'); load() }
    setActing(false)
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
    if (sortCol !== col) return <span className="text-gray-300 ml-1">↕</span>
    return <span className="text-blue-500 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">Loading dashboard...</div>
      </div>
    )
  }

  // ---- Non-manager view ----
  if (!data || !('isManager' in data) || !data.isManager) {
    return (
      <div>
        <h2 className="text-xl font-medium text-gray-900 mb-6">Dashboard</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div onClick={() => router.push('/weekly-plan')} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm cursor-pointer hover:border-blue-300 transition">
            <p className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">Weekly Plan</p>
            <p className="text-sm text-gray-700">View and submit your weekly plan</p>
          </div>
          <div onClick={() => router.push('/daily-activity')} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm cursor-pointer hover:border-blue-300 transition">
            <p className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">Daily Activity</p>
            <p className="text-sm text-gray-700">Log meetings and expenses</p>
          </div>
          <div onClick={() => router.push('/orders')} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm cursor-pointer hover:border-blue-300 transition">
            <p className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">Orders</p>
            <p className="text-sm text-gray-700">View and create orders</p>
          </div>
        </div>
      </div>
    )
  }

  // ---- Manager dashboard ----
  const { teamSize, planStats, pendingPlans, teamPerformance } = data as ManagerData

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

  // Plan compliance percentages
  const planTotal = teamSize
  const complianceSegments = [
    { label: 'Approved', count: planStats.approved, color: '#22c55e' },
    { label: 'Submitted', count: planStats.submitted, color: '#3b82f6' },
    { label: 'On Hold', count: planStats.onHold, color: '#eab308' },
    { label: 'Rejected', count: planStats.rejected, color: '#ef4444' },
    { label: 'Draft', count: planStats.draft, color: '#d1d5db' },
    { label: 'Not Submitted', count: planStats.notSubmitted, color: '#e5e7eb' },
  ]

  const pendingCount = pendingPlans.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium text-gray-900">{greeting()}{me?.name ? `, ${me.name}` : ''}</h2>
          <p className="text-sm text-gray-500 mt-0.5">Team performance overview</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekMonday(d => addDays(d, -7))}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="text-sm font-medium text-gray-700 px-2 min-w-[180px] text-center">{formatWeekRange(weekMonday)}</span>
          <button onClick={() => setWeekMonday(d => addDays(d, 7))}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Team Members" value={teamSize} sub="Direct reports" />
        <KPICard
          label="Plan Compliance"
          value={`${planStats.approved}/${teamSize} approved`}
          sub={pendingCount > 0 ? `${pendingCount} need${pendingCount === 1 ? 's' : ''} attention` : 'All reviewed'}
          subColor={pendingCount > 0 ? 'text-amber-600 font-medium' : 'text-green-600'}
        />
        <KPICard
          label="Meetings This Week"
          value={`${totalMeetingsCompleted}/${totalMeetingsAll}`}
          sub="completed / total"
        />
        <KPICard label="Orders This Week" value={fmtCurrency(totalOrders)} sub={`Expenses: ${fmtCurrency(totalExpenses)}`} />
      </div>

      {/* Chart + Pending Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bar Chart */}
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-medium text-gray-800 mb-4">Daily Meeting Activity — Team Total</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barCategoryGap="30%">
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                formatter={(value, name) => [value, name === 'completed' ? 'Completed' : 'Pending']}
              />
              <Legend formatter={v => v === 'completed' ? 'Completed' : 'Pending'} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="completed" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} name="completed" />
              <Bar dataKey="pending" stackId="a" fill="#dbeafe" radius={[4, 4, 0, 0]} name="pending" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pending Actions */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-sm font-medium text-gray-800">Needs Attention</h3>
            {pendingCount > 0 && (
              <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{pendingCount}</span>
            )}
          </div>
          {pendingCount === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
              <svg className="w-10 h-10 text-green-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-gray-600">All clear!</p>
              <p className="text-xs text-gray-400 mt-0.5">No actions pending this week</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-3">
              {pendingPlans.map(pp => (
                <div key={pp.id} className={`rounded-xl p-3 border ${pp.reopen_requested ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{pp.userName}</p>
                      <p className="text-xs text-gray-500">
                        {pp.reopen_requested ? 'Reopen request' : 'Awaiting approval'} · {new Date(pp.weekStartDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <button onClick={() => router.push(`/review/${pp.userId}?tab=plans`)}
                      className="text-[11px] text-gray-500 hover:text-gray-700 shrink-0">
                      View →
                    </button>
                  </div>
                  {pp.reopen_requested && pp.reopen_request_message && (
                    <p className="text-xs text-orange-700 bg-white rounded px-2 py-1 mb-2 border border-orange-100 italic">
                      &ldquo;{pp.reopen_request_message}&rdquo;
                    </p>
                  )}
                  <div className="flex gap-2">
                    {pp.reopen_requested ? (
                      <>
                        <button disabled={acting} onClick={() => handleReopen(pp.id, 'accept-reopen')}
                          className="flex-1 text-[11px] font-medium py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 transition">
                          Accept
                        </button>
                        <button disabled={acting} onClick={() => handleReopen(pp.id, 'decline-reopen')}
                          className="flex-1 text-[11px] font-normal py-1.5 bg-white hover:bg-gray-50 text-red-600 border border-red-200 rounded-lg disabled:opacity-50 transition">
                          Decline
                        </button>
                      </>
                    ) : (
                      <>
                        <button disabled={acting} onClick={() => approvePlan(pp.id)}
                          className="flex-1 text-[11px] font-medium py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 transition">
                          Approve
                        </button>
                        <button disabled={acting} onClick={() => { setCommentModal({ planId: pp.id, action: 'reject' }); setComment('') }}
                          className="flex-1 text-[11px] font-normal py-1.5 bg-white hover:bg-gray-50 text-red-600 border border-red-200 rounded-lg disabled:opacity-50 transition">
                          Reject
                        </button>
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
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-800">Plan Compliance This Week</h3>
          <span className="text-sm font-medium text-gray-700">
            {planTotal > 0 ? Math.round(((planStats.approved) / planTotal) * 100) : 0}% approved
          </span>
        </div>
        <div className="flex h-4 rounded-full overflow-hidden bg-gray-100 mb-3">
          {complianceSegments.map(seg => seg.count > 0 && (
            <div key={seg.label} title={`${seg.label}: ${seg.count}`}
              style={{ width: `${(seg.count / planTotal) * 100}%`, backgroundColor: seg.color }}
              className="transition-all" />
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {complianceSegments.map(seg => (
            <div key={seg.label} className="flex items-center gap-1.5 text-xs text-gray-600">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
              {seg.label} ({seg.count})
            </div>
          ))}
        </div>
      </div>

      {/* Team Performance Table */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-800">Team Performance</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left">
                  <button onClick={() => toggleSort('name')} className="text-xs font-medium text-gray-500 uppercase tracking-wide hover:text-gray-700 flex items-center">
                    Member <SortIcon col="name" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-normal text-gray-500 uppercase tracking-wide">Plan</th>
                <th className="px-4 py-3 text-center text-xs font-normal text-gray-500 uppercase tracking-wide">Activity</th>
                {DAY_LABELS.map(d => (
                  <th key={d} className="px-2 py-3 text-center text-xs font-normal text-gray-400 w-8">{d}</th>
                ))}
                <th className="px-4 py-3 text-right">
                  <button onClick={() => toggleSort('meetings')} className="text-xs font-medium text-gray-500 uppercase tracking-wide hover:text-gray-700 flex items-center ml-auto">
                    Meetings <SortIcon col="meetings" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right">
                  <button onClick={() => toggleSort('orders')} className="text-xs font-medium text-gray-500 uppercase tracking-wide hover:text-gray-700 flex items-center ml-auto">
                    Orders <SortIcon col="orders" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right">
                  <button onClick={() => toggleSort('expenses')} className="text-xs font-medium text-gray-500 uppercase tracking-wide hover:text-gray-700 flex items-center ml-auto">
                    Expenses <SortIcon col="expenses" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m, idx) => (
                <tr key={m.userId}
                  onClick={() => router.push(`/review/${m.userId}`)}
                  className={`border-b border-gray-50 cursor-pointer hover:bg-blue-50/50 transition ${idx % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-medium flex items-center justify-center shrink-0">
                        {m.userName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-800 text-sm leading-tight">{m.userName}</p>
                        {m.level && <p className="text-[11px] text-gray-400">{m.level}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3" onClick={e => { e.stopPropagation(); router.push(`/review/${m.userId}?tab=plans`) }}>
                    <PlanBadge status={m.planStatus} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Sparkline data={m.dailyActivity.map(d => d.meetingsCompleted)} />
                  </td>
                  {m.dailyActivity.map((d, i) => (
                    <td key={i} className="px-2 py-3 text-center"
                      onClick={e => { e.stopPropagation(); router.push(`/review/${m.userId}?tab=daily&date=${d.date}`) }}>
                      <span className={`text-xs font-medium ${d.meetingsCompleted > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                        {d.meetingsTotal > 0 ? `${d.meetingsCompleted}/${d.meetingsTotal}` : '—'}
                      </span>
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right"
                    onClick={e => { e.stopPropagation(); router.push(`/review/${m.userId}?tab=daily`) }}>
                    <span className="text-sm font-medium text-gray-700">
                      {m.weekTotals.meetingsCompleted}/{m.weekTotals.meetingsTotal}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right"
                    onClick={e => { e.stopPropagation(); router.push(`/orders?userId=${m.userId}`) }}>
                    <span className="text-sm font-medium text-gray-700">{fmtCurrency(m.weekTotals.orderValue)}</span>
                  </td>
                  <td className="px-4 py-3 text-right"
                    onClick={e => { e.stopPropagation(); router.push(`/review/${m.userId}?tab=expenses`) }}>
                    <span className="text-sm font-medium text-gray-700">{fmtCurrency(m.weekTotals.expenseAmount)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <p className="text-center py-8 text-sm text-gray-400">No team members found</p>
          )}
        </div>
      </div>

      {/* Reject Comment Modal */}
      {commentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCommentModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-medium text-gray-800 mb-4">Reject Plan</h3>
            <textarea value={comment} onChange={e => setComment(e.target.value)}
              rows={4} placeholder="Reason for rejection (required)…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400 mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCommentModal(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button disabled={acting || !comment.trim()} onClick={() => rejectPlan(commentModal.planId, comment)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
                {acting ? 'Rejecting…' : 'Reject Plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
