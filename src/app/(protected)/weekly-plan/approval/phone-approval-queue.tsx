'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { StatusBadge, WEEKLY_PLAN_STATUS } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { PhoneList, PhoneListRow } from '@/components/ui/phone-list'
import type { QueueResponse, QueueRow } from '@/components/weekly-plan/approval-types'
import { fmtDate, fmtDateTime } from '@/lib/format'

/**
 * Phone Plan approvals: the plans waiting on a manager, as a list of rows
 * (FRONTEND_RULES_PHONE 41.5), each opening the plan on its own screen.
 *
 * The data is the desktop queue's, from the same call: GET
 * /api/weekly-plans/approval?queue=. The route applies `checkPermission` and
 * `reviewableUserIds`, so every row here is one the caller may act on, and an
 * executive (Self scope) gets none, with the same words the desktop uses. The
 * three views are the desktop's three tabs, with the same names and counts;
 * `?view=` keeps the choice across opening a plan and coming back, as the
 * desktop's section tabs do. `?owner=` narrows the list to one person's plans
 * (a reopen request lands here for the person who asked).
 */

const VIEWS = [
  { value: 'awaiting', label: 'Awaiting you' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'decided', label: 'Decided' },
] as const

const VALID_VIEWS = new Set<string>(['awaiting', 'in_progress', 'decided', 'all'])

export function PhoneApprovalQueue() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requested = searchParams.get('view') ?? 'awaiting'
  const view = VALID_VIEWS.has(requested) ? requested : 'awaiting'
  const owner = searchParams.get('owner')

  usePhoneAppBar({ title: 'Plan approvals', back: '/today' })

  const [state, setState] = useState<'loading' | 'failed' | 'ready'>('loading')
  const [data, setData] = useState<QueueResponse | null>(null)
  const [search, setSearch] = useState('')
  const [attempt, setAttempt] = useState(0)

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch(`/api/weekly-plans/approval?queue=${encodeURIComponent(view)}`, {
        signal: AbortSignal.timeout(20000),
      })
      if (!r.ok) throw new Error('Could not load the approval queue')
      const body: QueueResponse = await r.json()
      if (!body || !Array.isArray(body.rows)) throw new Error('unexpected shape')
      setData(body)
      setState('ready')
      return true
    } catch {
      setState('failed')
      return false
    }
  }, [view])

  useEffect(() => {
    setState('loading')
    void load()
  }, [load, attempt])

  function go(next: { view?: string | null; owner?: string | null }) {
    const q = new URLSearchParams()
    const v = next.view === undefined ? view : next.view
    const o = next.owner === undefined ? owner : next.owner
    if (v && v !== 'awaiting') q.set('view', v)
    if (o) q.set('owner', o)
    const qs = q.toString()
    router.replace(`/weekly-plan/approval${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (data?.rows ?? []).filter(row => {
      if (owner && row.user_id !== owner) return false
      // Filtered here, as on the desktop: the queue is one manager's reports.
      return !term || (row.owner?.name ?? '').toLowerCase().includes(term)
    })
  }, [data, search, owner])

  const ownerName = owner ? (data?.rows.find(r => r.user_id === owner)?.owner?.name ?? 'this person') : null
  const counts = data?.counts

  const empty = (() => {
    if (data?.scope === 'own') {
      return (
        <EmptyState variant="nothing-waiting" heading="You do not review anyone">
          Weekly plans appear here when people report to you. Your own plan lives on the Weekly plan screen.
        </EmptyState>
      )
    }
    if (owner) {
      return (
        <EmptyState variant="nothing-waiting" heading={`No plans from ${ownerName}`}>
          Nothing from this person is in this list.
        </EmptyState>
      )
    }
    if (view === 'in_progress') {
      return (
        <EmptyState variant="nothing-waiting" heading="Nothing in progress">
          Plans you have put on hold or edited appear here until the owner resubmits them.
        </EmptyState>
      )
    }
    if (view === 'decided') {
      return (
        <EmptyState variant="nothing-waiting" heading="Nothing decided yet">
          Plans you have approved or rejected appear here.
        </EmptyState>
      )
    }
    return (
      <EmptyState variant="nothing-waiting" heading="Nothing is waiting on you">
        Plans your team submits appear here. Check In progress for plans you have held or edited.
      </EmptyState>
    )
  })()

  return (
    <PhoneList<QueueRow>
      state={state}
      onRetry={() => setAttempt(a => a + 1)}
      onRefresh={async () => { await load() }}
      noun={{ one: 'plan', many: 'plans' }}
      rows={rows}
      total={rows.length}
      rowKey={row => row.id}
      renderRow={row => (
        <PhoneListRow
          href={`/weekly-plan/approval/${row.id}`}
          name={row.owner?.name ?? 'Unknown'}
          status={
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              <StatusBadge vocabulary={WEEKLY_PLAN_STATUS} status={row.status} />
              {row.reopen_requested && <Badge variant="warning">Reopen</Badge>}
            </span>
          }
          facts={[
            `${fmtDate(row.week_start_date)} — ${fmtDate(row.week_end_date)}`,
            `${row.item_count} ${row.item_count === 1 ? 'line' : 'lines'}`,
          ]}
          meta={row.submitted_at ? `Submitted ${fmtDateTime(row.submitted_at)}` : undefined}
        />
      )}
      search={{ value: search, onChange: setSearch }}
      listKey="weekly-plan:approval"
      empty={empty}
      filters={{
        label: 'Show',
        value: view === 'all' ? null : view,
        onChange: v => go({ view: v ?? 'awaiting' }),
        chips: VIEWS.map(v => ({
          value: v.value,
          label: v.label,
          count: counts ? counts[v.value] ?? 0 : 0,
        })),
      }}
      activeFilters={
        owner
          ? [{
              key: 'owner',
              label: `Plans of ${ownerName}`,
              clearLabel: 'Show plans of everyone',
              onClear: () => go({ owner: null, view: view === 'all' ? 'awaiting' : view }),
            }]
          : undefined
      }
    />
  )
}
