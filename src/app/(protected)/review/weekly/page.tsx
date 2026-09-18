'use client'

import { useEffect, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryBarChart } from '@/components/ui/bar-chart'
import { JournalBox } from '@/components/journal/JournalBox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fmtAmount, fmtNumber } from '@/lib/format'

type WeeklyReview = {
  weekStart: string
  weekEnd: string
  user: { id: string; name: string }
  headline: { toMeet: number; met: number; spent: number; orderValue: number }
  priorityPoints: {
    plannedGoals: { newParties: number; existingParties: number; others: number; total: number }
    achievedMeetings: number
    ticked: number
    open: number
    unmatched: number
    partyMatching: 'by_party' | 'none'
  }
  dayWise: {
    date: string; plannedGoal: number; achievedMeetings: number
    ordersCount: number; ordersValue: number
    meetingSeconds: number; workingSeconds: number | null; nonMeetingSeconds: number | null
    expenseTotal: number
  }[]
  extraMeetings: { count: number; list: { id: string; entityName: string; date: string }[] }
  newParties: { count: number; list: { id: string; name: string; date: string }[] }
  expenses: { byCategory: { category: string; amount: number; count: number }[]; byDay: { date: string; amount: number }[]; total: number }
  orders: {
    draft: { count: number; value: number }; placed: { count: number; value: number }
    byCategory: { name: string; count: number; value: number }[]
    bySubCategory: { name: string; count: number; value: number }[]
    byProduct: { name: string; count: number; value: number }[]
  }
  funnel: { movedForward: number; byStage: { stage: string; count: number }[] }
  notMet: { count: number; unmatchedCount: number; list: { id: string; name: string }[] }
  expenseVsOrder: { expenseTotal: number; orderValue: number; ratio: number | null }
}

type TeamMember = { id: string; name: string }

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  const dow = d.getUTCDay()
  const diff = dow === 0 ? -6 : 1 - dow
  return new Date(d.getTime() + diff * 86400000).toISOString().slice(0, 10)
}
function addDays(dateStr: string, n: number): string {
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + n * 86400000).toISOString().slice(0, 10)
}
function fmtDayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}
function fmtHours(secs: number | null): string {
  if (secs === null) return '—'
  const h = Math.floor(secs / 3600)
  const m = Math.round((secs % 3600) / 60)
  return `${h}h ${m}m`
}
function fmtRange(start: string, end: string): string {
  const f = (d: string) => new Date(`${d}T00:00:00.000Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return `${f(start)} – ${f(end)}`
}

/** Section 5.3-style KPI tile: label above, value large, no duplicated figures. */
function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border-light bg-surface px-4 py-3">
      <span className="text-caption text-text-secondary">{label}</span>
      <span className="text-2xl font-semibold text-text-primary">{value}</span>
      {sub && <span className="text-caption text-text-secondary">{sub}</span>}
    </div>
  )
}

export default function WeeklyReviewPage() {
  const { toast: showToast } = useToast()
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date().toISOString().slice(0, 10)))
  const [userId, setUserId] = useState<string | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [data, setData] = useState<WeeklyReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Team members this viewer can switch between — reuses the subordinate list
  // the review dashboard already computes from visibility, so this page adds
  // no new "who can I see" logic of its own.
  useEffect(() => {
    fetch('/api/review/summary-cards')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: { id: string; name: string }[]) => setMembers(rows.map(r => ({ id: r.id, name: r.name }))))
      .catch(() => setMembers([]))
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ weekStart })
    if (userId) params.set('userId', userId)
    fetch(`/api/review/weekly?${params.toString()}`)
      .then(async r => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error || 'Failed to load weekly review')
        return body as WeeklyReview
      })
      .then(setData)
      .catch(err => {
        setError(err.message)
        showToast(err.message, 'error')
      })
      .finally(() => setLoading(false))
  }, [weekStart, userId, showToast])

  return (
    <div className="flex h-full flex-col">
      {/* Pinned header + controls — only the content below scrolls. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border-light bg-surface px-4 py-3 sm:px-6">
        <div className="flex flex-col">
          <h1 className="text-page-heading font-semibold text-text-primary">Weekly Review</h1>
          <span className="text-caption text-text-secondary">
            {data ? `${data.user.name} · ${fmtRange(data.weekStart, data.weekEnd)}` : 'Loading…'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {members.length > 0 && (
            <Select value={userId ?? '__self'} onValueChange={v => setUserId(v === '__self' ? null : v)}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Team member" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__self">Me</SelectItem>
                {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="secondary" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={() => setWeekStart(mondayOf(new Date().toISOString().slice(0, 10)))}>
            This week
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {loading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        )}

        {!loading && error && (
          <Card><CardContent className="py-6 text-center text-text-secondary">{error}</CardContent></Card>
        )}

        {!loading && data && (
          <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
            {/* Headline numbers */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Parties to meet" value={fmtNumber(data.headline.toMeet)} />
              <StatTile label="Parties met" value={fmtNumber(data.headline.met)} sub={`${fmtNumber(data.notMet.count)} not met`} />
              <StatTile label="Total spent" value={fmtAmount(data.headline.spent)} />
              <StatTile label="Order value" value={fmtAmount(data.headline.orderValue)} />
            </div>

            {/* Priority points */}
            <Card>
              <CardHeader><CardTitle>Priority points — planned vs achieved</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-4">
                <StatTile label="Planned goal" value={fmtNumber(data.priorityPoints.plannedGoals.total)}
                  sub={`New ${data.priorityPoints.plannedGoals.newParties} · Existing ${data.priorityPoints.plannedGoals.existingParties} · Other ${data.priorityPoints.plannedGoals.others}`} />
                <StatTile label="Meetings held" value={fmtNumber(data.priorityPoints.achievedMeetings)} />
                <StatTile label="Ticked" value={fmtNumber(data.priorityPoints.ticked)} sub={data.priorityPoints.partyMatching === 'none' ? 'no party-linked plan rows this week' : undefined} />
                <StatTile label="Open" value={fmtNumber(data.priorityPoints.open)}
                  sub={data.priorityPoints.unmatched > 0 ? `${data.priorityPoints.unmatched} plan rows have no linked party` : undefined} />
              </CardContent>
            </Card>

            {/* Day-wise breakdown */}
            <Card>
              <CardHeader><CardTitle>Day-wise</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto py-4">
                <table className="w-full min-w-[720px] text-body">
                  <thead>
                    <tr className="border-b border-border-light text-left text-caption text-text-secondary">
                      <th className="py-2 pr-3">Day</th>
                      <th className="py-2 pr-3">Planned</th>
                      <th className="py-2 pr-3">Meetings</th>
                      <th className="py-2 pr-3">In meetings</th>
                      <th className="py-2 pr-3">Not in meetings</th>
                      <th className="py-2 pr-3">Orders</th>
                      <th className="py-2 pr-3">Order value</th>
                      <th className="py-2 pr-3">Expenses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dayWise.map(d => (
                      <tr key={d.date} className="border-b border-border-light last:border-0">
                        <td className="py-2 pr-3 font-medium">{fmtDayLabel(d.date)}</td>
                        <td className="py-2 pr-3">{fmtNumber(d.plannedGoal)}</td>
                        <td className="py-2 pr-3">{fmtNumber(d.achievedMeetings)}</td>
                        <td className="py-2 pr-3">{fmtHours(d.meetingSeconds)}</td>
                        <td className="py-2 pr-3">{fmtHours(d.nonMeetingSeconds)}</td>
                        <td className="py-2 pr-3">{fmtNumber(d.ordersCount)}</td>
                        <td className="py-2 pr-3">{fmtAmount(d.ordersValue)}</td>
                        <td className="py-2 pr-3">{fmtAmount(d.expenseTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Extra meetings + new parties */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Extra meetings (outside the plan)</CardTitle></CardHeader>
                <CardContent className="py-4">
                  <p className="mb-2 text-caption text-text-secondary">{fmtNumber(data.extraMeetings.count)} unplanned meetings this week</p>
                  {data.extraMeetings.list.length === 0 ? (
                    <p className="text-body text-text-secondary">No unplanned meetings.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {data.extraMeetings.list.map(m => (
                        <li key={m.id} className="flex justify-between text-body">
                          <span>{m.entityName}</span>
                          <span className="text-text-secondary">{fmtDayLabel(m.date)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>New parties created</CardTitle></CardHeader>
                <CardContent className="py-4">
                  <p className="mb-2 text-caption text-text-secondary">{fmtNumber(data.newParties.count)} new parties this week</p>
                  {data.newParties.list.length === 0 ? (
                    <p className="text-body text-text-secondary">None created this week.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {data.newParties.list.map(p => (
                        <li key={p.id} className="flex justify-between text-body">
                          <span>{p.name}</span>
                          <span className="text-text-secondary">{fmtDayLabel(p.date)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Expenses */}
            <Card>
              <CardHeader><CardTitle>Expenses — {fmtAmount(data.expenses.total)} total</CardTitle></CardHeader>
              <CardContent className="py-4">
                {data.expenses.byCategory.length === 0 ? (
                  <p className="text-body text-text-secondary">No expenses logged this week.</p>
                ) : (
                  <CategoryBarChart
                    data={data.expenses.byCategory}
                    category={c => c.category}
                    series={[{ label: 'Amount', value: c => c.amount, format: c => fmtAmount(c.amount) }]}
                  />
                )}
              </CardContent>
            </Card>

            {/* Orders: draft vs placed */}
            <Card>
              <CardHeader><CardTitle>Orders — Draft vs Placed</CardTitle></CardHeader>
              <CardContent className="py-4">
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <StatTile label="Draft" value={fmtNumber(data.orders.draft.count)} sub={fmtAmount(data.orders.draft.value)} />
                  <StatTile label="Placed" value={fmtNumber(data.orders.placed.count)} sub={fmtAmount(data.orders.placed.value)} />
                </div>
                {data.orders.draft.count === 0 && (
                  <p className="mb-3 text-caption text-text-secondary">
                    No Draft orders in this week&apos;s data — the Draft column is unverified against real data.
                  </p>
                )}
                {data.orders.byCategory.length > 0 && (
                  <>
                    <h3 className="mb-2 text-body font-medium">By product category</h3>
                    <CategoryBarChart
                      data={data.orders.byCategory}
                      category={c => c.name}
                      series={[{ label: 'Value', value: c => c.value, format: c => fmtAmount(c.value) }]}
                    />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Funnel movement */}
            <Card>
              <CardHeader><CardTitle>Funnel movement</CardTitle></CardHeader>
              <CardContent className="py-4">
                <p className="mb-3 text-caption text-text-secondary">{fmtNumber(data.funnel.movedForward)} deals moved forward this week</p>
                {data.funnel.byStage.length > 0 ? (
                  <CategoryBarChart
                    data={data.funnel.byStage}
                    category={s => s.stage}
                    series={[{ label: 'Deals', value: s => s.count, format: s => fmtNumber(s.count) }]}
                  />
                ) : (
                  <p className="text-body text-text-secondary">No active deals owned by this user.</p>
                )}
              </CardContent>
            </Card>

            {/* Not Met */}
            <Card>
              <CardHeader><CardTitle>Not Met — planned parties with no meeting ever started</CardTitle></CardHeader>
              <CardContent className="py-4">
                {data.notMet.unmatchedCount > 0 && (
                  <p className="mb-2 text-caption text-text-secondary">
                    {data.notMet.unmatchedCount} plan rows this week have no linked party and are excluded from this check.
                  </p>
                )}
                {data.notMet.list.length === 0 ? (
                  <p className="text-body text-text-secondary">Every planned party this week has been met at least once, historically.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {data.notMet.list.map(p => <li key={p.id} className="text-body">{p.name}</li>)}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Journaling — §6.3. Personal to the viewer, so only shown when
                looking at your own week, never a team member's. */}
            {userId === null && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <JournalBox kind="went_well" weekStart={data.weekStart} />
                <JournalBox kind="improve" weekStart={data.weekStart} />
              </div>
            )}

            {/* Expense vs Order value */}
            <Card>
              <CardHeader><CardTitle>Expense vs Order value</CardTitle></CardHeader>
              <CardContent className="py-4">
                <div className="grid grid-cols-3 gap-3">
                  <StatTile label="Expense" value={fmtAmount(data.expenseVsOrder.expenseTotal)} />
                  <StatTile label="Order value" value={fmtAmount(data.expenseVsOrder.orderValue)} />
                  <StatTile label="Ratio" value={data.expenseVsOrder.ratio === null ? '—' : `${(data.expenseVsOrder.ratio * 100).toFixed(1)}%`} />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
