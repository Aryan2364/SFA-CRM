'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMe } from '@/hooks/useMe'

type PointEvent = {
  id: string; action_type: string; points: number; description: string | null; earned_at: string
}
type BreakdownEntry = { count: number; points: number; label: string }
type LeaderEntry = { user_id: string; name: string; designation: string; points: number; rank: number; is_self: boolean }

const ACTION_ICONS: Record<string, string> = {
  weekly_plan_submitted: '📋',
  weekly_plan_approved: '✅',
  daily_checkin: '🟢',
  daily_checkout: '🔴',
  meeting_logged: '🤝',
  expense_submitted: '💸',
  weekly_streak: '🔥',
}

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

  const canSeeLeaderboard = me?.role === 'Administrator' || (me?.permissions?.leaderboard?.view ?? false)

  const load = useCallback(async () => {
    setLoading(true)
    const [myRes, lbRes] = await Promise.all([
      fetch(`/api/points/my?period=${period}`).then(r => r.json()),
      canSeeLeaderboard
        ? fetch(`/api/points/leaderboard?period=${period}`).then(r => r.json())
        : Promise.resolve([]),
    ])
    setTotal(myRes.total ?? 0)
    setEvents(myRes.events ?? [])
    setBreakdown(myRes.breakdown ?? {})
    setLeaderboard(lbRes ?? [])
    setLoading(false)
  }, [period, canSeeLeaderboard])

  useEffect(() => { load() }, [load])

  const myRank = leaderboard.find(e => e.is_self)?.rank

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center text-xl">🏆</div>
          <div>
            <h1 className="text-2xl font-medium text-gray-900">My Points</h1>
            <p className="text-sm text-gray-500">Track your performance score</p>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${period === p.value ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Score cards */}
      <div className={`grid gap-4 mb-6 ${canSeeLeaderboard && myRank ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="bg-gradient-to-br from-yellow-400 to-orange-500 rounded-2xl p-5 text-white shadow-lg">
          <p className="text-yellow-100 text-sm font-medium mb-1">Total Points</p>
          <p className="text-4xl font-medium">{loading ? '—' : total}</p>
          <p className="text-yellow-100 text-xs mt-1">{PERIODS.find(p => p.value === period)?.label}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <p className="text-gray-500 text-sm font-medium mb-1">Actions Taken</p>
          <p className="text-4xl font-medium text-gray-900">{loading ? '—' : events.length}</p>
          <p className="text-gray-400 text-xs mt-1">Point-earning activities</p>
        </div>
        {canSeeLeaderboard && myRank && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <p className="text-gray-500 text-sm font-medium mb-1">Your Rank</p>
            <p className="text-4xl font-medium text-gray-900">
              {loading ? '—' : `${myRank}${getRankSuffix(myRank)}`}
            </p>
            <p className="text-gray-400 text-xs mt-1">Out of {leaderboard.length} members</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-5">
        {(['activity', 'breakdown', ...(canSeeLeaderboard ? ['leaderboard'] : [])] as const).map(t => (
          <button key={t} onClick={() => setTab(t as typeof tab)}
            className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition -mb-px ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'activity' ? 'Activity Log' : t === 'breakdown' ? 'Breakdown' : 'Leaderboard'}
          </button>
        ))}
      </div>

      {/* Activity Log */}
      {tab === 'activity' && (
        <div className="space-y-2">
          {loading ? (
            <p className="text-gray-400 text-sm text-center py-10">Loading…</p>
          ) : events.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-4xl mb-3">🎯</p>
              <p className="font-medium text-gray-600">No points earned yet</p>
              <p className="text-sm mt-1">Start checking in, logging meetings, and submitting plans to earn points!</p>
            </div>
          ) : events.map(e => (
            <div key={e.id} className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
              <span className="text-2xl w-8 text-center">{ACTION_ICONS[e.action_type] ?? '⭐'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{e.description ?? e.action_type.replace(/_/g, ' ')}</p>
                <p className="text-xs text-gray-400">{formatDate(e.earned_at)}</p>
              </div>
              <span className="text-sm font-medium text-green-600 bg-green-50 px-2.5 py-1 rounded-full whitespace-nowrap">+{e.points} pts</span>
            </div>
          ))}
        </div>
      )}

      {/* Breakdown */}
      {tab === 'breakdown' && (
        <div className="space-y-3">
          {loading ? (
            <p className="text-gray-400 text-sm text-center py-10">Loading…</p>
          ) : Object.keys(breakdown).length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-10">No data for selected period.</p>
          ) : Object.entries(breakdown)
            .sort((a, b) => b[1].points - a[1].points)
            .map(([key, val]) => (
              <div key={key} className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{ACTION_ICONS[key] ?? '⭐'}</span>
                    <span className="text-sm font-medium text-gray-800">{val.label}</span>
                  </div>
                  <span className="text-sm font-medium text-green-600">{val.points} pts</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                    <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (val.points / total) * 100)}%` }} />
                  </div>
                  <span className="text-xs text-gray-400">{val.count}×</span>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Leaderboard */}
      {tab === 'leaderboard' && canSeeLeaderboard && (
        <div className="space-y-2">
          {loading ? (
            <p className="text-gray-400 text-sm text-center py-10">Loading…</p>
          ) : leaderboard.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-10">No data for selected period.</p>
          ) : leaderboard.map(entry => (
            <div key={entry.user_id}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 border shadow-sm ${entry.is_self ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 ${
                entry.rank === 1 ? 'bg-yellow-400 text-white' :
                entry.rank === 2 ? 'bg-gray-300 text-gray-700' :
                entry.rank === 3 ? 'bg-orange-400 text-white' :
                'bg-gray-100 text-gray-500'
              }`}>
                {entry.rank <= 3 ? ['🥇','🥈','🥉'][entry.rank - 1] : entry.rank}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {entry.name} {entry.is_self && <span className="text-xs text-blue-600 font-normal">(you)</span>}
                </p>
                <p className="text-xs text-gray-400 truncate">{entry.designation}</p>
              </div>
              <span className="text-sm font-medium text-gray-800">{entry.points} pts</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
