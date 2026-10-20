'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  TrophyIcon, TargetIcon, StarIcon, ClipboardListIcon, CheckIcon,
  LogInIcon, LogOutIcon, HandshakeIcon, ReceiptIcon, FlameIcon, AwardIcon,
  type LucideIcon,
} from 'lucide-react'
import { useMe } from '@/hooks/useMe'
import { LoadError } from '@/components/ui/load-error'
import { loadJson, loadList, type LoadResult } from '@/lib/load-list'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type PointEvent = {
  id: string; action_type: string; points: number; description: string | null; earned_at: string
}
type BreakdownEntry = { count: number; points: number; label: string }
type LeaderEntry = { user_id: string; name: string; designation: string; points: number; rank: number; is_self: boolean }

/**
 * Section 23.1's table has no entries for these product-specific action
 * types, so each is mapped by meaning to the nearest Lucide icon rather
 * than an emoji (kit gap — see docs/kit-audit/kit-gaps.md).
 */
const ACTION_ICONS: Record<string, LucideIcon> = {
  weekly_plan_submitted: ClipboardListIcon,
  weekly_plan_approved: CheckIcon,
  daily_checkin: LogInIcon,
  daily_checkout: LogOutIcon,
  meeting_logged: HandshakeIcon,
  expense_submitted: ReceiptIcon,
  weekly_streak: FlameIcon,
}
const DEFAULT_ACTION_ICON = StarIcon

const PERIODS = [
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'all', label: 'All Time' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getRankSuffix(rank: number) {
  if (rank === 1) return 'st'
  if (rank === 2) return 'nd'
  if (rank === 3) return 'rd'
  return 'th'
}

export default function PointsPage() {
  const me = useMe()
  const [period, setPeriod] = useState('month')
  const [total, setTotal] = useState(0)
  const [events, setEvents] = useState<PointEvent[]>([])
  const [breakdown, setBreakdown] = useState<Record<string, BreakdownEntry>>({})
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'activity' | 'breakdown' | 'leaderboard'>('activity')
  // Before the guard a 403 on either request resolved, its { error }
  // body landed in state typed as an array, and leaderboard.find below
  // threw - or, where the request simply failed, the page sat on
  // "Loading…" for ever because nothing cleared the flag.
  const [error, setError] = useState<{ forbidden: boolean } | null>(null)
  const [leaderboardFailed, setLeaderboardFailed] = useState(false)
  // Switching period twice quickly used to render whichever response
  // arrived last. Only the newest request is allowed to write state.
  const requestSeq = useRef(0)

  // me.isAdministrator is the documented server-derived short-circuit
  // (see hooks/useMe.ts) — never a hardcoded role-name comparison.
  const canSeeLeaderboard = !!me?.isAdministrator || (me?.permissions?.leaderboard?.view ?? false)

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    setLeaderboardFailed(false)
    const [myRes, lbRes] = await Promise.all([
      loadJson<{ total?: number; events?: PointEvent[]; breakdown?: Record<string, BreakdownEntry> }>(`/api/points/my?period=${period}`),
      canSeeLeaderboard
        ? loadList<LeaderEntry>(`/api/points/leaderboard?period=${period}`)
        : Promise.resolve<LoadResult<LeaderEntry[]>>({ ok: true, data: [] }),
    ])
    if (seq !== requestSeq.current) return
    if (myRes.ok) {
      const d = myRes.data ?? {}
      setTotal(typeof d.total === 'number' ? d.total : 0)
      setEvents(Array.isArray(d.events) ? d.events : [])
      setBreakdown(d.breakdown && typeof d.breakdown === 'object' ? d.breakdown : {})
    } else {
      setTotal(0)
      setEvents([])
      setBreakdown({})
      setError({ forbidden: myRes.forbidden })
    }
    setLeaderboard(lbRes.ok ? lbRes.data : [])
    setLeaderboardFailed(!lbRes.ok)
    setLoading(false)
  }, [period, canSeeLeaderboard])

  useEffect(() => { load() }, [load])

  const myRank = leaderboard.find(e => e.is_self)?.rank

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-warning-bg rounded-xl flex items-center justify-center text-warning">
            <TrophyIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-page-title font-medium text-text-primary">My Points</h1>
            <p className="text-sm text-text-muted">Track your performance score</p>
          </div>
        </div>
        <Tabs value={period} onValueChange={v => setPeriod(String(v))}>
          <TabsList className="border-b-0 gap-0 bg-surface-control p-1 rounded-lg">
            {PERIODS.map(p => (
              <TabsTrigger key={p.value} value={p.value} className="h-auto px-3 py-1.5 after:hidden data-active:bg-surface data-active:shadow-sm rounded-md">
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {error ? (
        <LoadError forbidden={error.forbidden} what="your points" onRetry={load} />
      ) : (
      <>
      {/* Score cards */}
      <div className={`grid gap-4 mb-6 ${canSeeLeaderboard && myRank ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="bg-primary rounded-2xl p-5 text-primary-foreground shadow-lg">
          <p className="text-sm font-medium mb-1 opacity-80">Total Points</p>
          <p className="text-4xl font-medium">{loading ? '—' : total}</p>
          <p className="text-xs mt-1 opacity-80">{PERIODS.find(p => p.value === period)?.label}</p>
        </div>
        <div className="bg-surface border border-border-light rounded-2xl p-5 shadow-sm">
          <p className="text-text-muted text-sm font-medium mb-1">Actions Taken</p>
          <p className="text-4xl font-medium text-text-primary">{loading ? '—' : events.length}</p>
          <p className="text-text-muted text-xs mt-1">Point-earning activities</p>
        </div>
        {canSeeLeaderboard && myRank && (
          <div className="bg-surface border border-border-light rounded-2xl p-5 shadow-sm">
            <p className="text-text-muted text-sm font-medium mb-1">Your Rank</p>
            <p className="text-4xl font-medium text-text-primary">
              {loading ? '—' : `${myRank}${getRankSuffix(myRank)}`}
            </p>
            <p className="text-text-muted text-xs mt-1">Out of {leaderboard.length} members</p>
          </div>
        )}
      </div>

      {/* Tabs — the same component as the period selector above (section
          33.3: sibling tab bars are styled and behave identically). */}
      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)} className="mb-5">
        <TabsList>
          {(['activity', 'breakdown', ...(canSeeLeaderboard ? ['leaderboard'] as const : [])] as const).map(t => (
            <TabsTrigger key={t} value={t}>
              {t === 'activity' ? 'Activity Log' : t === 'breakdown' ? 'Breakdown' : 'Leaderboard'}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Activity Log */}
      {tab === 'activity' && (
        <div className="space-y-2">
          {loading ? (
            <p className="text-text-muted text-sm text-center py-10">Loading…</p>
          ) : events.length === 0 ? (
            <div className="text-center py-16 text-text-muted">
              <TargetIcon className="size-10 mx-auto mb-3" />
              <p className="font-medium text-text-secondary">No points earned yet</p>
              <p className="text-sm mt-1">Start checking in, logging meetings, and submitting plans to earn points!</p>
            </div>
          ) : events.map(e => {
            const ActionIcon = ACTION_ICONS[e.action_type] ?? DEFAULT_ACTION_ICON
            return (
            <div key={e.id} className="flex items-center gap-3 bg-surface border border-border-light rounded-xl px-4 py-3 shadow-sm">
              <span className="w-8 h-8 flex items-center justify-center shrink-0 rounded-lg bg-surface-control text-text-secondary"><ActionIcon className="size-4" /></span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{e.description ?? e.action_type.replace(/_/g, ' ')}</p>
                <p className="text-xs text-text-muted">{formatDate(e.earned_at)}</p>
              </div>
              <span className="text-sm font-medium text-success bg-success-bg px-2.5 py-1 rounded-full whitespace-nowrap">+{e.points} pts</span>
            </div>
            )
          })}
        </div>
      )}

      {/* Breakdown */}
      {tab === 'breakdown' && (
        <div className="space-y-3">
          {loading ? (
            <p className="text-text-muted text-sm text-center py-10">Loading…</p>
          ) : Object.keys(breakdown).length === 0 ? (
            <p className="text-text-muted text-sm text-center py-10">No data for selected period.</p>
          ) : Object.entries(breakdown)
            .sort((a, b) => b[1].points - a[1].points)
            .map(([key, val]) => {
              const ActionIcon = ACTION_ICONS[key] ?? DEFAULT_ACTION_ICON
              return (
              <div key={key} className="bg-surface border border-border-light rounded-xl px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ActionIcon className="size-4 text-text-secondary" />
                    <span className="text-sm font-medium text-text-primary">{val.label}</span>
                  </div>
                  <span className="text-sm font-medium text-success">{val.points} pts</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 bg-surface-control rounded-full h-1.5">
                    <div className="bg-success h-1.5 rounded-full" style={{ width: `${Math.min(100, (val.points / total) * 100)}%` }} />
                  </div>
                  <span className="text-xs text-text-muted">{val.count}×</span>
                </div>
              </div>
              )
            })}
        </div>
      )}

      {/* Leaderboard. kit gap: section 2.4/21 has no gold/silver/bronze
          rank token, so the top three take AwardIcon on a warning tint
          (nearest to "achievement") and the rest a plain neutral chip
          with the rank number — see docs/kit-audit/kit-gaps.md. */}
      {tab === 'leaderboard' && canSeeLeaderboard && (
        <div className="space-y-2">
          {loading ? (
            <p className="text-text-muted text-sm text-center py-10">Loading…</p>
          ) : leaderboardFailed ? (
            <LoadError forbidden={false} what="the leaderboard" onRetry={load} />
          ) : leaderboard.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-10">No data for selected period.</p>
          ) : leaderboard.map(entry => (
            <div key={entry.user_id}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 border shadow-sm ${entry.is_self ? 'bg-primary-subtle border-primary-border' : 'bg-surface border-border-light'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 ${
                entry.rank <= 3 ? 'bg-warning-bg text-warning' : 'bg-surface-control text-text-secondary'
              }`}>
                {entry.rank <= 3 ? <AwardIcon className="size-4" /> : entry.rank}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {entry.name} {entry.is_self && <span className="text-xs text-primary font-normal">(you)</span>}
                </p>
                <p className="text-xs text-text-muted truncate">{entry.designation}</p>
              </div>
              <span className="text-sm font-medium text-text-primary">{entry.points} pts</span>
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  )
}
