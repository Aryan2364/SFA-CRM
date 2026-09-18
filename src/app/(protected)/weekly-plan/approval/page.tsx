'use client'

import { Suspense, useCallback, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionTabs } from '@/components/ui/section-tabs'
import StatusBadge from '@/components/ui/StatusBadge'
import { ListPage, type ListColumn } from '@/components/templates/list-page'
import { PlanReviewPanel } from '@/components/weekly-plan/plan-review-panel'
import type { QueueResponse, QueueRow } from '@/components/weekly-plan/approval-types'
import { fmtDate, fmtDateTime } from '@/lib/format'

/**
 * §5.2 — Weekly Plan Approval.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `/review`
 *
 * `/review` is a per-PERSON screen: one card per team member, this week, with
 * their attendance and activity beside the plan. It answers "how is my team
 * doing". This answers a different question — "what am I holding up" — and its
 * unit is a PLAN, across weeks, filtered by the statuses a manager must act on.
 * A plan submitted three weeks ago and never decided is invisible on `/review`
 * and is the first row here.
 *
 * ---------------------------------------------------------------------------
 * EVERY AUTHORISATION ANSWER COMES FROM THE SERVER
 *
 * The queue route applies `checkPermission` and `scopedUserIds`, and returns
 * `canDecide` — the result of `checkPermission(user, 'weekly_plan', 'edit')`.
 * This file never looks at a role name. Three consequences that are the point
 * of the design rather than side effects:
 *
 *   - An executive (Self scope) gets zero rows, because the route removes the
 *     caller from their own reviewable set. The screen says so in words.
 *   - A viewer with view-but-not-edit gets a readable queue and NO decision
 *     buttons, instead of five buttons that 403.
 *   - A manager gets exactly their visible subordinates, by `data_scope`, not
 *     by the manual visibility grant `/review` leans on.
 */

const TABS = [
  { value: 'awaiting', label: 'Awaiting you' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'decided', label: 'Decided' },
]

const SEARCH_HINT = 'Searches the plan owner’s name'

function columns(
  canDecide: boolean,
  onOpen: (id: string) => void,
): ListColumn<QueueRow>[] {
  return [
    {
      id: 'owner',
      header: 'Person',
      grow: true,
      truncate: true,
      cellClassName: 'font-medium text-text-primary',
      cell: row => row.owner?.name ?? 'Unknown',
    },
    {
      id: 'week',
      header: 'Week',
      cell: row => `${fmtDate(row.week_start_date)} — ${fmtDate(row.week_end_date)}`,
    },
    {
      id: 'status',
      header: 'Status',
      cell: row => (
        <span className="flex items-center gap-1.5">
          <StatusBadge status={row.status} />
          {row.reopen_requested && <Badge variant="warning">Reopen</Badge>}
        </span>
      ),
    },
    {
      id: 'lines',
      header: 'Lines',
      numeric: true,
      tier: 'hide-below-768',
      cell: row => row.item_count,
    },
    {
      id: 'submitted',
      header: 'Submitted',
      tier: 'hide-below-1024',
      cell: row => (row.submitted_at ? fmtDateTime(row.submitted_at) : '—'),
    },
    {
      /*
        One action per row, and the same one on every row — the four decisions
        live inside the panel, where the plan being decided on is visible. A
        row-level Approve would ask a manager to approve a week they have not
        read.

        The label follows the permission rather than the button appearing and
        disappearing: a view-only user still opens the plan, and finds no
        decision buttons inside. `canDecide` is the server's answer for
        `weekly_plan` EDIT, never a role name.
      */
      id: 'open',
      header: '',
      cell: row => (
        <Button
          variant={canDecide ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => onOpen(row.id)}
        >
          {canDecide ? 'Review' : 'View'}
        </Button>
      ),
    },
  ]
}

function ApprovalQueue() {
  const searchParams = useSearchParams()
  const queue = searchParams.get('view') ?? 'awaiting'

  const [counts, setCounts] = useState<QueueResponse['counts'] | null>(null)
  const [canDecide, setCanDecide] = useState(false)
  const [scope, setScope] = useState<QueueResponse['scope'] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(
    async ({ search, signal }: { search: string; signal: AbortSignal }) => {
      const r = await fetch(`/api/weekly-plans/approval?queue=${encodeURIComponent(queue)}`, {
        signal,
      })
      if (!r.ok) throw new Error('Could not load the approval queue')
      const data: QueueResponse = await r.json()
      setCounts(data.counts ?? null)
      setCanDecide(Boolean(data.canDecide))
      setScope(data.scope ?? null)

      // Filtered here rather than in the route: the queue is one manager's
      // subordinates, which is tens of rows, and the template already debounces
      // the box. A server-side search would be a round trip per keystroke for
      // a list that fits in memory.
      const term = search.trim().toLowerCase()
      if (!term) return data.rows
      return data.rows.filter(row => (row.owner?.name ?? '').toLowerCase().includes(term))
    },
    [queue],
  )

  const tabs = TABS.map(t => ({
    ...t,
    label: counts ? `${t.label} (${counts[t.value as keyof typeof counts] ?? 0})` : t.label,
  }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListPage<QueueRow>
        className="min-h-0 flex-1"
        title="Plan Approvals"
        noun={{ one: 'plan', many: 'plans' }}
        sectionTabs={<SectionTabs tabs={tabs} value={queue} />}
        columns={columns(canDecide, setOpenId)}
        rowKey={row => row.id}
        load={load}
        refreshKey={`${queue}:${refreshKey}`}
        searchPlaceholder="Search by person"
        searchHint={SEARCH_HINT}
        emptyYet={
          scope === 'own'
            ? {
                heading: 'You do not review anyone',
                body: 'Weekly plans appear here when people report to you. Your own plan lives on the Weekly Plan screen.',
              }
            : queue === 'awaiting'
              ? {
                  heading: 'Nothing is waiting on you',
                  body: 'Plans your team submits appear here. Check In progress for plans you have held or edited.',
                }
              : queue === 'in_progress'
                ? {
                    heading: 'Nothing in progress',
                    body: 'Plans you have put on hold or edited appear here until the owner resubmits them.',
                  }
                : {
                    heading: 'Nothing decided yet',
                    body: 'Plans you have approved or rejected appear here.',
                  }
        }
      />

      <PlanReviewPanel
        planId={openId}
        canDecide={canDecide}
        onClose={() => setOpenId(null)}
        onChanged={() => setRefreshKey(k => k + 1)}
      />
    </div>
  )
}

/**
 * `SectionTabs` reads `useSearchParams`, and so does this page. Without a
 * Suspense boundary above them the route silently opts out of static rendering.
 */
export default function ApprovalPage() {
  return (
    <Suspense fallback={null}>
      <ApprovalQueue />
    </Suspense>
  )
}
