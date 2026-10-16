'use client'

import { useEffect, useMemo, useState } from 'react'

import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import StatusBadge from '@/components/ui/StatusBadge'

/**
 * Phone Weekly plan — READ-ONLY (owner decision, docs/phone-plan.md §3):
 * approving/editing a plan stays on the computer. Same URL as the desktop
 * editor (FRONTEND_RULES_PHONE §41.2 rule 4): `page.tsx` renders this when
 * `useLayout()` says phone, and the desktop editor otherwise.
 *
 * Data: `GET /api/weekly-plans/my?weekStart=` (gated `weekly_plan:view`),
 * the caller's own plan for the week — there is no `userId` param, so this
 * is inherently self-scoped by the route itself.
 */

type PlanItem = {
  id: string
  plan_date: string
  from_place: string | null
  to_place: string | null
  new_dealers_goal: number | null
  existing_dealers_goal: number | null
  others_goal: number | null
  mode_of_travel: string | null
  notes: string | null
}

type Plan = {
  id: string
  status: string
  week_start_date: string
  week_end_date: string
  weekly_plan_items: PlanItem[]
}

function toStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function mondayOf(d: Date): Date {
  const r = new Date(d)
  const day = r.getDay()
  const diff = day === 0 ? -6 : 1 - day
  r.setDate(r.getDate() + diff)
  r.setHours(0, 0, 0, 0)
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function formatDay(dateStr: string): { weekday: string; day: string } {
  const d = new Date(dateStr + 'T00:00:00')
  return {
    weekday: d.toLocaleDateString('en-IN', { weekday: 'long' }),
    day: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
  }
}

export function PhoneWeeklyPlan() {
  const monday = useMemo(() => toStr(mondayOf(new Date())), [])
  const [state, setState] = useState<'loading' | 'failed' | 'ready'>('loading')
  const [plan, setPlan] = useState<Plan | null>(null)

  usePhoneAppBar({ title: 'Weekly plan', back: '/more' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setState('loading')
      try {
        const res = await fetch(`/api/weekly-plans/my?weekStart=${monday}`)
        if (!res.ok) throw new Error('failed')
        const data = await res.json()
        if (cancelled) return
        setPlan(data)
        setState('ready')
      } catch {
        if (!cancelled) setState('failed')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [monday])

  const days = Array.from({ length: 7 }, (_, i) => toStr(addDays(mondayOf(new Date()), i)))
  const itemsByDay = new Map<string, PlanItem[]>()
  for (const item of plan?.weekly_plan_items ?? []) {
    const key = item.plan_date.slice(0, 10)
    itemsByDay.set(key, [...(itemsByDay.get(key) ?? []), item])
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-xl border border-border-light bg-surface px-4 py-3">
        <p className="text-body font-medium text-text-primary">This week&apos;s plan</p>
        {plan ? <StatusBadge status={plan.status} /> : null}
      </div>

      {state === 'loading' ? (
        <p className="px-1 py-6 text-body text-text-muted">Loading…</p>
      ) : state === 'failed' ? (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <p className="text-body font-medium text-text-primary">The plan could not be loaded</p>
          <p className="text-body text-text-muted">Check your connection and try again.</p>
        </div>
      ) : !plan ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <p className="text-body font-medium text-text-primary">No plan for this week yet</p>
          <p className="text-body text-text-muted">Weekly plans are created on the computer.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {days.map(day => {
            const { weekday, day: dayLabel } = formatDay(day)
            const items = itemsByDay.get(day) ?? []
            return (
              <li key={day} className="rounded-xl border border-border-light bg-surface p-3">
                <p className="text-label font-medium text-text-secondary">
                  {weekday} · {dayLabel}
                </p>
                {items.length === 0 ? (
                  <p className="mt-1 text-body text-text-muted">Nothing planned</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {items.map(item => (
                      <li key={item.id} className="rounded-lg bg-surface-sunken p-2">
                        <p className="text-body text-text-primary">
                          {item.from_place || item.to_place
                            ? [item.from_place, item.to_place].filter(Boolean).join(' → ')
                            : 'Visit'}
                        </p>
                        <p className="text-meta text-text-muted">
                          {[
                            item.mode_of_travel,
                            item.new_dealers_goal ? `${item.new_dealers_goal} new` : null,
                            item.existing_dealers_goal ? `${item.existing_dealers_goal} existing` : null,
                            item.others_goal ? `${item.others_goal} other` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {item.notes ? <p className="mt-1 text-meta text-text-muted">{item.notes}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
