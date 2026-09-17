'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlertIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { StatusBadge, WEEKLY_PLAN_STATUS } from '@/components/status-badge'
import {
  ListPage,
  type ListColumn,
  type ListPageProps,
} from '@/components/templates/list-page'
import { Banner, BannerDescription, BannerTitle } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { fmtAmount } from '@/lib/format'

type SubCard = {
  id: string
  name: string
  plan: { id: string; status: string } | null
  today_meetings: number
  today_expenses: number
  week_start: string
  week_end: string
}

/** The two statuses a manager can approve from. Unchanged. */
const APPROVABLE = ['Submitted', 'Resubmitted']

/**
 * Section 27.1: the hint states what the box ACTUALLY looks at, not
 * what it ought to. `/api/review/summary-cards` takes no query at all,
 * so the filtering below is done here over the array it returns — which
 * means the two text fields a row HAS are both covered, and there is
 * nothing else on the record to miss.
 */
const SEARCH_HINT = 'Searches the team member’s name and their plan status.'

/**
 * COLUMN CLASSIFICATION — section 10 rule 4.
 *
 *   essential          Team member, This week, Meetings, Expenses, Actions
 *   hide-below-1024    none
 *   hide-below-768     none
 *
 * Five columns, four of them narrow and fixed-width by their content,
 * and the table measures 726px inside 911px of zone 3 at 1024 and 726
 * inside 719 at 768 — so nothing scrolls sideways at 1024 and nothing
 * needs dropping to stop it. Section 10 rule 2 makes dropping columns
 * the alternative to a sideways scroll; with no sideways scroll to
 * avoid, dropping a column would lose data for nothing.
 *
 * Every one of the five is also load-bearing on its own: the name is
 * who the row is, the plan status is the only thing the Approve action
 * is keyed on, the two counts are the whole point of the screen ("what
 * did my team do today"), and Actions is the only route into the
 * person's detail — a row without it is a dead end.
 */
function reviewColumns(
  onOpen: (userId: string) => void,
  onApprove: (planId: string) => void,
  acting: string | null
): ListColumn<SubCard>[] {
  return [
    {
      id: 'name',
      header: 'Team member',
      grow: true,
      truncate: true,
      cellClassName: 'font-medium text-text-primary',
      skeletonWidth: 'w-40',
      cell: card => card.name,
    },
    {
      id: 'plan',
      header: 'This week',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-28',
      /*
       * "No plan submitted" is a real, distinct state and not an
       * unknown status: the person has no weekly_plans row at all.
       * Section 11.1's "status is always a badge" governs a status;
       * the ABSENCE of one is text, and rendering it as a badge would
       * claim the plan exists and reads "Unknown".
       */
      cell: card =>
        card.plan ? (
          <StatusBadge vocabulary={WEEKLY_PLAN_STATUS} status={card.plan.status} />
        ) : (
          <span className="text-text-secondary">No plan submitted</span>
        ),
    },
    {
      id: 'meetings',
      header: 'Meetings today',
      numeric: true,
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-8',
      cell: card => card.today_meetings.toLocaleString('en-IN'),
    },
    {
      id: 'expenses',
      header: 'Expenses today',
      numeric: true,
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-16',
      cell: card => fmtAmount(card.today_expenses),
    },
    {
      id: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control-sm w-16',
      /*
       * Section 6.1: Approve is not the screen's one main action — it
       * appears on as many rows as have a plan waiting — so rule 1
       * puts it at secondary along with View. It is not destructive
       * either, so not danger. The green it used to carry was section
       * 2.4's success colour, which states the STATUS of a record and
       * says nothing about a button's place in the hierarchy.
       *
       * Section 14 rule 2: disabled while the POST is in flight, so
       * nobody approves the same plan three times.
       */
      cell: card => (
        <div className="flex items-center justify-end gap-2">
          {card.plan && APPROVABLE.includes(card.plan.status) && (
            <Button
              variant="secondary"
              size="sm"
              disabled={acting === card.plan.id}
              aria-busy={acting === card.plan.id}
              onClick={() => onApprove(card.plan!.id)}
            >
              Approve
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => onOpen(card.id)}>
            View
          </Button>
        </div>
      ),
    },
  ]
}

export default function ReviewPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [acting, setActing] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  /* The template's only refetch lever. Bumped on focus and after an
     approve. */
  const [refreshKey, setRefreshKey] = useState(0)

  /*
   * Re-fetch when the user returns to the tab, which is how a manager
   * or level change made in another tab reaches this screen. The
   * template holds `load` itself, so what is nudged is `refreshKey`.
   */
  useEffect(() => {
    const onFocus = () => setRefreshKey(k => k + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  /*
   * Deliberately NOT memoised — the template holds it in a ref.
   *
   * No try/catch: a rejection IS the failed state. The old version of
   * this screen did `if (r.ok) setCards(...)` with no else, so a 500
   * rendered as "no subordinates found" and invited the manager to go
   * and assign themselves a team they already had.
   */
  const load: ListPageProps<SubCard>['load'] = async ({ search, signal }) => {
    const r = await fetch('/api/review/summary-cards', { signal }).catch(
      error => {
        /* Not a swallow — it is rethrown on the next line, so the
           rejection still IS the failed state. The banner is cleared
           because a count from the last good response would otherwise
           sit above a table that says it could not be loaded. */
        setPendingCount(0)
        throw error
      }
    )
    if (!r.ok) {
      setPendingCount(0)
      throw new Error(String(r.status))
    }
    const body = await r.json()
    const rows: SubCard[] = Array.isArray(body) ? body : []

    /* The banner counts the whole team, not the search result: the
       plans still need approving when the box is narrowed. */
    setPendingCount(
      rows.filter(c => c.plan && APPROVABLE.includes(c.plan.status)).length
    )

    const q = search.trim().toLowerCase()
    if (!q) return rows
    /* The route takes no query parameter, so the search is applied
       here over the two text fields a row has. */
    return rows.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        (c.plan?.status ?? 'No plan submitted').toLowerCase().includes(q)
    )
  }

  async function handleApprove(planId: string) {
    setActing(planId)
    try {
      const r = await fetch(`/api/weekly-plans/${planId}/approve`, {
        method: 'POST',
      })
      if (!r.ok) {
        toast(
          ((await r.json()) as { error?: string }).error ?? 'Failed to approve',
          'error'
        )
        return
      }
      toast('Plan approved')
      setRefreshKey(k => k + 1)
    } finally {
      setActing(null)
    }
  }

  return (
    /*
     * OVERNIGHT: the pending-approvals banner has no zone in §11.1 — see overnight-queue-2026-09-18.md
     *
     * Section 7.1 calls this exactly a banner: a condition the manager
     * can carry on past, which stays true until the plans are
     * approved. Section 11.1 has four zones and none of them is for
     * one, and zone 1a is reserved for section 33's tabs — so it is
     * NOT put there, and no prop is added to `list-page`.
     *
     * It therefore sits above zone 1, inside this file. The wrapper is
     * a flex COLUMN with a definite height, not a plain div: the
     * shell's content wrapper is the scroll container, `ListPage` is
     * `h-full` inside it, and a plain wrapper would break that height
     * chain and make the PAGE scroll instead of zone 3. `h-full
     * min-h-0 flex-col` here plus `min-h-0 flex-1` on the template
     * keeps zone 3 the only scrolling zone — measured, not assumed.
     */
    <div className="flex h-full min-h-0 flex-col">
      {pendingCount > 0 && (
        <Banner variant="warning" className="mb-4 shrink-0">
          <TriangleAlertIcon />
          <BannerTitle>
            {pendingCount} plan{pendingCount !== 1 ? 's' : ''} need your approval
          </BannerTitle>
          <BannerDescription>
            Approve from this list, or open a team member to read the plan
            first.
          </BannerDescription>
        </Banner>
      )}

      <ListPage<SubCard>
        className="min-h-0 flex-1"
        title="Review"
        noun={{ one: 'team member', many: 'team members' }}
        columns={reviewColumns(
          userId => router.push(`/review/${userId}`),
          handleApprove,
          acting
        )}
        rowKey={card => card.id}
        load={load}
        refreshKey={refreshKey}
        searchPlaceholder="Search team members"
        searchHint={SEARCH_HINT}
        emptyYet={{
          heading: 'No team members yet',
          body: 'People who report to you appear here with this week’s plan and today’s activity. Assign yourself as their manager in Users.',
        }}
      />
    </div>
  )
}
