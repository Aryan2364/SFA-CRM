'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryBarChart } from '@/components/ui/bar-chart'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TeamMemberTable, type TeamMemberRow } from '@/components/review/team-member-table'
import { fmtAmount, fmtNumber } from '@/lib/format'

/**
 * Team / Company Summary — §6.4, P4-T6.
 *
 * One level ABOVE the per-person screens, never a replacement for them: every
 * row drills into `/review/<userId>`, which is the existing individual screen
 * and is not modified by this task. A manager with twenty reports reads this
 * page to decide which one to open.
 *
 * The tier switch appears only for a viewer whose `meetings` data scope is
 * `all` — the server decides that and says so in `canSeeCompany`, so the
 * control is gated on the real permission system rather than on a role name,
 * and a viewer who cannot reach the company tier never sees a control that
 * would 403.
 */

type TeamSummary = {
  weekStart: string
  weekEnd: string
  tier: 'team' | 'company'
  scope: 'own' | 'team' | 'all'
  canSeeCompany: boolean
  viewer: { id: string | null; name: string }
  totals: {
    people: number; toMeet: number; met: number; notMet: number; plannedGoal: number
    meetings: number; ticked: number; open: number; extraMeetings: number; newParties: number
    expenseTotal: number; orderCount: number; orderValue: number; draftOrderCount: number
    dealsMovedForward: number; unmatchedPlanRows: number
  }
  byDay: { date: string; plannedGoal: number; achievedMeetings: number; ordersCount: number; ordersValue: number; expenseTotal: number }[]
  members: (TeamMemberRow & { managerUserId: string | null })[]
  byManager: { managerUserId: string | null; managerName: string; people: number; meetings: number; orderValue: number; expenseTotal: number }[]
  notMetParties: { id: string; name: string; owners: string[] }[]
}

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
function fmtRange(start: string, end: string): string {
  const f = (d: string) => new Date(`${d}T00:00:00.000Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return `${f(start)} – ${f(end)}`
}

/** Same tile as the individual Weekly Review, so the two pages read as one system. */
function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border-light bg-surface px-4 py-3">
      <span className="truncate text-caption text-text-secondary">{label}</span>
      <span className="break-words text-2xl font-semibold leading-tight text-text-primary">{value}</span>
      {sub && <span className="truncate text-caption text-text-secondary">{sub}</span>}
    </div>
  )
}

export default function TeamSummaryPage() {
  const router = useRouter()
  const { toast: showToast } = useToast()
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date().toISOString().slice(0, 10)))
  const [tier, setTier] = useState<'team' | 'company' | null>(null)
  const [data, setData] = useState<TeamSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ weekStart })
    if (tier) params.set('tier', tier)
    fetch(`/api/review/team?${params.toString()}`)
      .then(async r => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error || 'Failed to load the team summary')
        return body as TeamSummary
      })
      .then(body => {
        setData(body)
        setTier(body.tier)
      })
      .catch(err => {
        setError(err.message)
        setData(null)
        showToast(err.message, 'error')
      })
      .finally(() => setLoading(false))
  }, [weekStart, tier, showToast])

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border-light bg-surface px-4 py-3 sm:px-6">
        <div className="flex flex-col">
          <h1 className="text-page-heading font-semibold text-text-primary">
            {data?.tier === 'company' ? 'Company Summary' : 'Team Summary'}
          </h1>
          <span className="text-caption text-text-secondary">
            {data
              ? `${fmtNumber(data.totals.people)} people · ${fmtRange(data.weekStart, data.weekEnd)}`
              : 'Loading…'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.canSeeCompany && (
            <Tabs value={data.tier} onValueChange={v => setTier(v as 'team' | 'company')}>
              <TabsList>
                <TabsTrigger value="team">My team</TabsTrigger>
                <TabsTrigger value="company">Company</TabsTrigger>
              </TabsList>
            </Tabs>
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
          <Card>
            <CardContent className="flex flex-col items-start gap-3 py-6">
              <p className="text-body text-text-primary">{error}</p>
              <Button variant="secondary" onClick={() => router.push('/review')}>Back to Review</Button>
            </CardContent>
          </Card>
        )}

        {!loading && data && (
          <div className="flex w-full flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="People" value={fmtNumber(data.totals.people)} />
              <StatTile label="Parties to meet" value={fmtNumber(data.totals.toMeet)} sub={`${fmtNumber(data.totals.notMet)} not met`} />
              <StatTile label="Meetings held" value={fmtNumber(data.totals.meetings)} sub={`${fmtNumber(data.totals.extraMeetings)} outside the plan`} />
              <StatTile label="Planned goal" value={fmtNumber(data.totals.plannedGoal)} sub={`${fmtNumber(data.totals.ticked)} ticked · ${fmtNumber(data.totals.open)} open`} />
              <StatTile label="Total spent" value={fmtAmount(data.totals.expenseTotal)} />
              <StatTile label="Order value" value={fmtAmount(data.totals.orderValue)} sub={`${fmtNumber(data.totals.orderCount)} orders`} />
            </div>

            {data.totals.unmatchedPlanRows > 0 && (
              <p className="text-caption text-text-secondary">
                {fmtNumber(data.totals.unmatchedPlanRows)} plan rows this week name no party, so they cannot be ticked or checked for
                &ldquo;not met&rdquo;. They still count toward the planned goal.
              </p>
            )}

            <Card>
              <CardHeader><CardTitle>Everyone, this week</CardTitle></CardHeader>
              <CardContent className="py-2">
                {data.members.length === 0 ? (
                  <p className="py-4 text-body text-text-secondary">Nobody is visible to you for this week.</p>
                ) : (
                  <TeamMemberTable rows={data.members} showManager={data.tier === 'company'} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Day-wise, across {data.tier === 'company' ? 'the company' : 'the team'}</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto py-4">
                <table className="w-full min-w-[640px] text-body">
                  <thead>
                    <tr className="border-b border-border-light text-left text-caption text-text-secondary">
                      <th className="py-2 pr-3">Day</th>
                      <th className="py-2 pr-3 text-right">Planned</th>
                      <th className="py-2 pr-3 text-right">Meetings</th>
                      <th className="py-2 pr-3 text-right">Orders</th>
                      <th className="py-2 pr-3 text-right">Order value</th>
                      <th className="py-2 pr-3 text-right">Expenses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byDay.map(d => (
                      <tr key={d.date} className="border-b border-border-light last:border-0">
                        <td className="py-2 pr-3 font-medium">{fmtDayLabel(d.date)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtNumber(d.plannedGoal)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtNumber(d.achievedMeetings)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtNumber(d.ordersCount)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtAmount(d.ordersValue)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtAmount(d.expenseTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Meetings by person</CardTitle></CardHeader>
                <CardContent className="py-4">
                  {data.members.length === 0 ? (
                    <p className="text-body text-text-secondary">No people in this view.</p>
                  ) : (
                    <CategoryBarChart
                      data={data.members.slice(0, 12)}
                      category={m => m.name}
                      series={[{ label: 'Meetings', value: m => m.meetings, format: m => fmtNumber(m.meetings) }]}
                    />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Spend by person</CardTitle></CardHeader>
                <CardContent className="py-4">
                  {data.totals.expenseTotal === 0 ? (
                    <p className="text-body text-text-secondary">No expenses logged this week.</p>
                  ) : (
                    <CategoryBarChart
                      data={[...data.members].sort((a, b) => b.expenseTotal - a.expenseTotal).slice(0, 12)}
                      category={m => m.name}
                      series={[{ label: 'Spent', value: m => m.expenseTotal, format: m => fmtAmount(m.expenseTotal) }]}
                    />
                  )}
                </CardContent>
              </Card>
            </div>

            {data.tier === 'company' && data.byManager.length > 0 && (
              <Card>
                <CardHeader><CardTitle>By manager</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto py-4">
                  <table className="w-full min-w-[560px] text-body">
                    <thead>
                      <tr className="border-b border-border-light text-left text-caption text-text-secondary">
                        <th className="py-2 pr-3">Reports to</th>
                        <th className="py-2 pr-3 text-right">People</th>
                        <th className="py-2 pr-3 text-right">Meetings</th>
                        <th className="py-2 pr-3 text-right">Order value</th>
                        <th className="py-2 pr-3 text-right">Expenses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byManager.map(m => (
                        <tr key={m.managerUserId ?? 'none'} className="border-b border-border-light last:border-0">
                          <td className="py-2 pr-3 font-medium">{m.managerName}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{fmtNumber(m.people)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{fmtNumber(m.meetings)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{fmtAmount(m.orderValue)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{fmtAmount(m.expenseTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle>Not met — planned parties with no meeting ever started</CardTitle></CardHeader>
              <CardContent className="py-4">
                {data.notMetParties.length === 0 ? (
                  <p className="text-body text-text-secondary">
                    Every party planned this week has been met at least once, historically.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {data.notMetParties.map(p => (
                      <li key={p.id} className="flex flex-wrap justify-between gap-2 text-body">
                        <span>{p.name}</span>
                        <span className="text-text-secondary">{p.owners.join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
