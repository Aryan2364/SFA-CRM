'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import StatusBadge from '@/components/ui/StatusBadge'
import { useToast } from '@/contexts/ToastContext'

type SubCard = {
  id: string
  name: string
  level: string
  plan: { id: string; status: string } | null
  today_meetings: number
  today_expenses: number
  week_start: string
  week_end: string
}

const APPROVABLE = ['Submitted', 'Resubmitted']

export default function ReviewPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [cards, setCards] = useState<SubCard[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/review/summary-cards')
    if (r.ok) setCards(await r.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Re-fetch when user returns to the tab (handles manager/level changes)
  useEffect(() => {
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  async function handleApprove(planId: string, userId: string) {
    setActing(planId)
    const r = await fetch(`/api/weekly-plans/${planId}/approve`, { method: 'POST' })
    if (!r.ok) { toast((await r.json()).error ?? 'Failed to approve', 'error') }
    else { toast('Plan approved'); load() }
    setActing(null)
  }

  const pendingCount = cards.filter(c => c.plan && APPROVABLE.includes(c.plan.status)).length

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <h2 className="text-xl font-medium text-text-primary mb-6">Review</h2>
        <div className="text-center py-16 text-text-muted">Loading...</div>
      </div>
    )
  }

  if (cards.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <h2 className="text-xl font-medium text-text-primary mb-6">Review</h2>
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-surface-control rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <p className="text-text-muted font-medium">No subordinates found</p>
          <p className="text-xs text-text-muted mt-1">Assign yourself as a manager in Users</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-medium text-text-primary">Review</h2>
        <span className="text-sm text-text-muted">{cards.length} team member{cards.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Pending approvals banner */}
      {pendingCount > 0 && (
        <div className="mb-5 flex items-center gap-3 bg-warning-bg border border-warning-border rounded-xl px-4 py-3">
          <div className="w-8 h-8 bg-warning-bg rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-warning">{pendingCount} plan{pendingCount !== 1 ? 's' : ''} need your approval</p>
            <p className="text-xs text-warning mt-0.5">Click a team member to review their details</p>
          </div>
        </div>
      )}

      {/* Subordinate cards */}
      <div className="space-y-3">
        {cards.map(card => (
          <div key={card.id} className="bg-surface rounded-2xl border border-border-light overflow-hidden">
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-medium text-sm shrink-0">
                  {card.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-text-primary">{card.name}</h3>
                    {card.level && <span className="text-[11px] text-text-muted font-medium">{card.level}</span>}
                  </div>

                  {/* This week's plan */}
                  <div className="flex items-center gap-2 mt-2">
                    <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                    </svg>
                    <span className="text-xs text-text-muted">This week:</span>
                    {card.plan ? (
                      <StatusBadge status={card.plan.status} />
                    ) : (
                      <span className="text-xs text-text-secondary">No plan submitted</span>
                    )}
                    {card.plan && APPROVABLE.includes(card.plan.status) && (
                      <button
                        disabled={acting === card.plan.id}
                        onClick={(e) => { e.stopPropagation(); handleApprove(card.plan!.id, card.id) }}
                        className="ml-1 text-[11px] font-medium bg-green-600 hover:bg-green-700 text-white px-2 py-0.5 rounded-lg disabled:opacity-50 transition"
                      >
                        Approve
                      </button>
                    )}
                  </div>

                  {/* Today stats */}
                  <div className="flex gap-4 mt-1.5 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                      Today: <strong className="text-text-secondary">{card.today_meetings}</strong> meeting{card.today_meetings !== 1 ? 's' : ''}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" />
                      Expenses: <strong className="text-text-secondary">₹{card.today_expenses.toFixed(0)}</strong>
                    </span>
                  </div>
                </div>

                {/* Drill-down arrow */}
                <button
                  onClick={() => router.push(`/review/${card.id}`)}
                  className="p-2 rounded-xl hover:bg-surface-control text-text-muted hover:text-text-secondary transition shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
