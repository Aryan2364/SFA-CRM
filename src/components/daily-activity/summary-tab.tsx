'use client'

import { fmtAmount } from '@/lib/format'
import { Expense, PlannedItem, Visit } from './types'

/**
 * Planned against actual for the day in view.
 *
 * §5.3 rule 2 removed the Plan TAB, not the plan. The plan still belongs
 * here, because this is the one place where seeing it next to the actual
 * numbers is the point rather than a detour; in the Meetings list it
 * appears as work to do, and here as the target that work was against.
 */
export function SummaryTab({
  visits,
  expenses,
  planned,
  plannedLoading,
}: {
  visits: Visit[]
  expenses: Expense[]
  planned: PlannedItem[]
  plannedLoading: boolean
}) {
  const completed = visits.filter(v => v.status === 'Completed').length
  const active = visits.filter(v => v.status === 'Active').length
  const pending = visits.filter(v => v.status === 'Pending').length
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)

  const goal = (k: keyof PlannedItem) => planned.reduce((s, p) => s + Number(p[k] ?? 0), 0)
  const plannedMeetings = goal('new_dealers_goal') + goal('existing_dealers_goal') + goal('others_goal')

  const tiles: { label: string; value: string; hint?: string }[] = [
    {
      label: 'Planned meetings',
      value: plannedLoading ? '—' : String(plannedMeetings),
      hint: planned.length === 0 ? 'No approved plan for this day' : `${planned.length} approved plan line${planned.length === 1 ? '' : 's'}`,
    },
    {
      label: 'Meetings logged',
      value: String(visits.length),
      hint: [completed ? `${completed} done` : '', active ? `${active} active` : '', pending ? `${pending} pending` : '']
        .filter(Boolean)
        .join(' · ') || 'Nothing logged yet',
    },
    {
      label: 'Expenses',
      value: fmtAmount(totalExpenses),
      hint: `${expenses.length} entr${expenses.length === 1 ? 'y' : 'ies'}`,
    },
  ]

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map(t => (
          <div key={t.label} className="rounded-xl border border-border-light bg-surface px-4 py-3">
            <p className="text-body text-text-secondary">{t.label}</p>
            <p className="mt-1 text-section font-medium tabular-nums text-text-primary">{t.value}</p>
            {t.hint && <p className="mt-0.5 text-meta text-text-muted">{t.hint}</p>}
          </div>
        ))}
      </div>

      {planned.length > 0 && (
        <div>
          <h3 className="mb-2 text-label font-medium text-text-secondary">Approved plan for the day</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {planned.map(p => (
              <div key={p.id} className="rounded-xl border border-border-light bg-surface px-4 py-3">
                <p className="text-body font-medium text-text-primary">
                  {p.party_name ?? ([p.from_place, p.to_place].filter(Boolean).join(' → ') || '—')}
                </p>
                <p className="mt-1 text-meta text-text-muted">
                  {p.new_dealers_goal ?? 0} new · {p.existing_dealers_goal ?? 0} existing
                  {p.others_goal ? ` · ${p.others_goal} other` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
