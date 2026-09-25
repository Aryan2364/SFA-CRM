'use client'

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ColumnsIcon, ListIcon, PlusIcon, TriangleAlertIcon } from 'lucide-react'

import {
  ListPage,
  type ListColumn,
  type ListFilter,
  type ListPageProps,
} from '@/components/templates/list-page'
import { QuickFilterChip } from '@/components/alerts/data-health-alert'
import { DataHealthAlerts, type DataHealthAlertItem } from '@/components/alerts/data-health-popover'
import { Badge } from '@/components/ui/badge'
import {
  Board,
  useBoardAvailable,
  BOARD_MAX_COLUMNS,
  type BoardCard,
  type BoardColumn,
} from '@/components/ui/board'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'
import { EMPTY, fmtAmount, fmtDate, parseApiDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { DealDialog } from './deal-dialog'

/**
 * The Deals list (REBUILD-PLAN.md §4.2) and the pipeline header strip
 * (§4.8), P2-T7 and P2-T10.
 *
 * Everything on screen comes from ONE request. `GET /api/deals` already
 * embeds the company, contact, stage and owner names, the earliest OPEN
 * follow-up and `days_in_stage`, so a page of Deals is one round trip and
 * not one per row — see `src/app/api/deals/_shape.ts`.
 *
 * The Kanban view (§4.2, P2-T8) is deliberately NOT here. rgb-kit ships no
 * board and no drag-and-drop primitive, and that pattern has to be agreed
 * and written into AGENTS.md before it is built.
 */

/** A row of `GET /api/deals`, after `shapeDeal()` has renamed the relations. */
type DealRow = {
  id: string
  name: string
  expected_value: number
  probability: number
  expected_close_date: string | null
  days_in_stage: number | null
  company: { id: string; name: string } | null
  contact: { id: string; name: string } | null
  stage: { id: string; name: string } | null
  owner: { id: string; name: string } | null
  next_follow_up: { id: string; due_date: string | null; mode: string | null } | null
}

type NamedRow = { id: string; name: string }

/**
 * §4.7 — how long a Deal may stand in one stage before the ageing alert.
 *
 * TODO: read `tenant_settings.deal_stage_ageing_days` through
 * `getTenantSettings` once the settings reader lands (P3, 09-OPEN-QUESTIONS.md
 * records 15 days as the agreed default). It is a constant here rather than an
 * import so this screen does not depend on a module being built in parallel;
 * the default and the column default are the same number, so nothing changes
 * for a tenant that has not overridden it.
 */
const DEFAULT_STAGE_AGEING_DAYS = 15

/**
 * §14 rule 4 and §35.6 item 4: every move carries a deadline. A save that
 * cannot fail cannot be reverted, and the optimistic card would stay in the
 * wrong column for ever. Matches `list-page`'s own request deadline.
 */
const MOVE_TIMEOUT_MS = 15000

/**
 * Section 27.1: the hint says what the box ACTUALLY looks at. `GET /api/deals`
 * applies `?q=` to the Deal name alone — everything else on the row is either a
 * filter or not searchable at all, and claiming otherwise would send people
 * hunting for a company name the query never reads.
 */
const SEARCH_HINT =
  'Searches the deal name. Owner, stage, company and expected closing month are filters.'

/**
 * Local midnight today. The follow-up comparison is date-only on both sides:
 * `due_date` is a `@db.Date` and arrives as "YYYY-MM-DD", so a follow-up due
 * today is NOT overdue however late in the day it is read (§10's default is
 * that it becomes overdue on the day it passes).
 */
function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function isOverdue(dueDate: string | null | undefined): boolean {
  const due = parseApiDate(dueDate ?? null)
  if (!due) return false
  return due.getTime() < startOfToday().getTime()
}

/**
 * The options for the Expected Closing Month filter (§4.8). `list-page`
 * declares two kinds of filter, `select` and `date`, and a month is neither a
 * day nor an open-ended range — so it is a select over a window of months, in
 * exactly the `YYYY-MM` form `GET /api/deals?closeMonth=` takes.
 *
 * Three months back and twelve forward: a pipeline is mostly ahead of today,
 * and the months behind it are what a slipped Deal sits in.
 */
function closeMonthOptions(): Record<string, string> {
  const out: Record<string, string> = { '': 'Any month' }
  const now = new Date()
  for (let offset = -3; offset <= 12; offset += 1) {
    const month = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
    out[key] = month.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  }
  return out
}

/**
 * COLUMN CLASSIFICATION — section 10 rule 4.
 *
 *   essential          Deal, Company, Stage, Value, Actions
 *   hide-below-1024    Probability, Next follow-up
 *   hide-below-768     Days in stage
 *
 * Eight columns, which is the ceiling. Days in stage is the one the screen
 * exists to show after the money (§4.7 asks for the alert in BOTH views), so it
 * is the last of the three to go; probability and the follow-up date are the
 * two a narrow screen can lose and still answer "what is in the pipeline".
 *
 * NO `grow` COLUMN. `grow` is `w-full max-w-0` and only absorbs slack where
 * there is slack — on a table this wide it collapses the identifier instead.
 * Deal and Company are `truncate` without it, which the template caps at
 * `max-w-field-min` (160px) and truncates with the full text in a tooltip.
 */
function dealColumns(onView: (id: string) => void, ageingLimit: number): ListColumn<DealRow>[] {
  return [
    {
      id: 'name',
      header: 'Deal',
      truncate: true,
      cellClassName: 'font-medium text-text-primary',
      skeletonWidth: 'w-40',
      cell: deal => deal.name,
    },
    {
      id: 'company',
      header: 'Company',
      truncate: true,
      skeletonWidth: 'w-36',
      /* §4.1: a Deal may carry a Contact and no Company, so this is
         genuinely empty rather than missing data. */
      cell: deal => deal.company?.name ?? deal.contact?.name ?? EMPTY,
    },
    {
      id: 'stage',
      header: 'Stage',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-24',
      /* A stage is master data, not one of the fixed vocabularies in
         `status-badge.tsx`, so it is a neutral badge: the colour would
         otherwise claim a meaning the master does not define. A Deal with
         no stage yet is text, not a badge that reads "Unknown". */
      cell: deal =>
        deal.stage ? (
          <Badge>{deal.stage.name}</Badge>
        ) : (
          <span className="text-text-secondary">No stage</span>
        ),
    },
    {
      id: 'value',
      /*
       * "Value", which is §4.2's own word for this column.
       *
       * It does NOT buy the width back: measured at a 1280 window with the
       * sidebar open, zone 3 is 961px and the table's min-content is 975,
       * and this column's floor is the formatted amount (₹12,34,567.89 with
       * `whitespace-nowrap`), not the header above it. Eight columns of real
       * data scroll ~14-32px sideways inside zone 3 at exactly 1280 with the
       * sidebar open, and fit from ~1330 up or with the sidebar collapsed.
       * Section 10 rule 2's alternative — dropping another column — would
       * lose data at a width where the scroll costs a nudge.
       */
      header: 'Value',
      numeric: true,
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-24',
      cell: deal => fmtAmount(deal.expected_value),
    },
    {
      id: 'probability',
      header: 'Probability',
      tier: 'hide-below-1024',
      numeric: true,
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-10',
      /* §4.3 and §12, closed: probability is READ-ONLY everywhere outside
         the Deal itself. No control on the row. */
      cell: deal => `${deal.probability}%`,
    },
    {
      id: 'days',
      header: 'Days in stage',
      tier: 'hide-below-768',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-16',
      /* §4.7: the alert fires once the Deal has stood past the limit.
         Section 7.2 rule 1 — the badge carries an icon as well as the
         colour, because colour alone is invisible to a colour-blind user. */
      cell: deal => {
        if (deal.days_in_stage === null) return <span className="text-text-secondary">{EMPTY}</span>
        const label = `${deal.days_in_stage} ${deal.days_in_stage === 1 ? 'day' : 'days'}`
        return deal.days_in_stage > ageingLimit ? (
          <Badge variant="warning">
            <TriangleAlertIcon />
            {label}
          </Badge>
        ) : (
          <span>{label}</span>
        )
      },
    },
    {
      id: 'followUp',
      header: 'Next follow-up',
      tier: 'hide-below-1024',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-28',
      /* §4.5: the EARLIEST OPEN follow-up, which is what the route already
         embeds. "None" is a real state — the Deal has no open follow-up —
         and is not the same as a date that failed to arrive. */
      cell: deal => {
        const due = deal.next_follow_up?.due_date ?? null
        if (!due) return <span className="text-text-secondary">None</span>
        return isOverdue(due) ? (
          <Badge variant="warning">
            <TriangleAlertIcon />
            {fmtDate(due)}
          </Badge>
        ) : (
          <span>{fmtDate(due)}</span>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control-sm w-16',
      cell: deal => (
        <div className="flex items-center justify-end">
          <Button variant="secondary" size="sm" onClick={() => onView(deal.id)}>
            View
          </Button>
        </div>
      ),
    },
  ]
}

/* ─────────────────────────────────────────────────────────────
 * The board view — P2-T8, AGENTS.md §35, REBUILD-PLAN.md §4.2/§4.3
 * ───────────────────────────────────────────────────────────── */

/**
 * §4.3 item 4 — probability as a thin bar with the figure alongside.
 *
 * ⚠️ READ-ONLY, and it is a `span` rather than an `input` for that reason.
 * §4.3 and §12 both close this: probability is edited inside the Deal and
 * nowhere else. A slider on a card that is about to become draggable fights
 * the drag, especially on a phone.
 *
 * `role="img"` with a label rather than a progressbar role: a progressbar
 * announces a task in progress, and this is a stored value.
 */
function ProbabilityBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span
        role="img"
        aria-label={`Probability ${clamped}%`}
        className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-control"
      >
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="shrink-0 tabular-nums">{clamped}%</span>
    </span>
  )
}

/**
 * §4.3's six items, in its order, mapped onto what `board.tsx` renders.
 *
 *   1 Company name      -> `title`   (the largest text on the card)
 *   2 Deal name         -> `facts[0]`
 *   3 Expected value    -+
 *   4 Probability       -+ `facts[1]` — one row, so both fit the two-fact cap
 *   5 Days in stage     -+
 *   6 Next follow-up    -+ `badge` — both must be able to turn a warning colour
 *     Owner             -> `meta`
 *
 * ⚠️ TWO DEVIATIONS FROM §4.3, both forced by the component's card API, which
 * is byte-identical kit code and not mine to edit:
 *
 *   - The OWNER is a name on the bottom line, not a circle of initials in the
 *     top corner. That corner is the title and the three-dot menu, and the card
 *     exposes no slot there. What §4.3 wants it FOR — telling whose card is
 *     whose where many people share a column — survives, less compactly.
 *   - Items 5 and 6 share the one `badge` slot, as two badges side by side.
 *     Both have to be able to turn a warning colour, and `meta` renders one
 *     muted string (the component runs it through `String()`), so neither can
 *     live there.
 *
 * ⚠️ The STAGE is deliberately absent from the card. §35.5: the column IS the
 * status, and a badge repeating it disagrees with the column for as long as a
 * move is in flight.
 */
function dealBoardCard(deal: DealRow, ageingLimit: number): BoardCard {
  const due = deal.next_follow_up?.due_date ?? null
  const aged = deal.days_in_stage !== null && deal.days_in_stage > ageingLimit

  return {
    id: deal.id,
    // A stage-less Deal has no column to sit in; `stageless` below is what
    // stops it from disappearing silently.
    columnId: deal.stage?.id ?? '',
    // A Deal with neither company nor contact is legal (§4.1), and the card
    // still has to say something in its loudest line.
    title: deal.company?.name ?? deal.contact?.name ?? 'No company',
    facts: [
      deal.name,
      <span key="value" className="flex items-center gap-3">
        <span className="shrink-0 font-medium text-text-primary">
          {fmtAmount(deal.expected_value)}
        </span>
        <ProbabilityBar value={deal.probability} />
      </span>,
    ],
    badge: (
      <span className="flex flex-wrap items-center gap-1.5">
        {deal.days_in_stage !== null && (
          <Badge variant={aged ? 'warning' : 'neutral'}>
            {aged && <TriangleAlertIcon />}
            {deal.days_in_stage}d in stage
          </Badge>
        )}
        {due && (
          <Badge variant={isOverdue(due) ? 'warning' : 'neutral'}>
            {isOverdue(due) && <TriangleAlertIcon />}
            {fmtDate(due)}
          </Badge>
        )}
      </span>
    ),
    meta: deal.owner?.name ?? 'Unassigned',
  }
}

/**
 * §35.4: one column per value the status field declares, in the order the work
 * moves in — `deal_stages.sort_order`, which is the order `/api/deals/stages`
 * already returns. Never by record count, and never an order that changes as
 * cards move.
 *
 * `total` is the TRUE number under the current filters, not the rendered count
 * (§35.4, §35.7). Everything this screen filters is filtered server-side and
 * returned in full — `/api/deals` has no `take` — so counting the rows in hand
 * IS the true total, and stops being so the day that route gains one.
 */
function dealBoardColumns(stages: NamedRow[], rows: DealRow[]): BoardColumn[] {
  return stages.map(stage => ({
    id: stage.id,
    label: stage.name,
    total: rows.filter(row => row.stage?.id === stage.id).length,
  }))
}

/**
 * What the strip adds up. `null` is "not known yet or not knowable" —
 * before the first response and after a failed one — and is NOT the same as
 * three zeroes, which is a real pipeline with nothing in it. Section 14 rule
 * 1: the shape of what is coming, never a figure that is about to change.
 */
type PipelineTotals = { count: number; value: number; weighted: number; noFollowUp: number }

function totalsOf(rows: DealRow[]): PipelineTotals {
  let value = 0
  let weighted = 0
  let noFollowUp = 0
  for (const row of rows) {
    const amount = Number(row.expected_value) || 0
    value += amount
    // §4.8's "Estimated Value × Probability". Probability is a percentage in
    // the column (0-100, in tens), so it is divided here — a weighted figure
    // larger than the estimate would be nonsense.
    weighted += (amount * (Number(row.probability) || 0)) / 100
    // P5-T7 §7.7: "Deals Without Follow-up" — counted off the SAME rows the
    // strip totals, so the alert and the table underneath it never disagree
    // about what "on screen" means.
    if (!row.next_follow_up) noFollowUp += 1
  }
  return { count: rows.length, value, weighted, noFollowUp }
}

/**
 * §4.8's pipeline header strip. It counts WHAT IS ON SCREEN — the search and
 * the filters narrow it — because a total that ignored the filters would
 * contradict the rows underneath it.
 *
 * `shrink-0` is load-bearing: it sits above `ListPage` in a flex column with a
 * definite height, and a strip that could shrink would steal zone 3's height
 * instead of the page keeping it.
 *
 * ONE ROW, NOT THREE TILES, and that is a height decision rather than a taste
 * one. Section 11.1 gives zone 3 whatever the window has left after zones 1,
 * 1a, 2 and 4, so every pixel this strip takes is a pixel of table. Measured
 * at a 1280x700 window: the tile grid was 84px of a 600px page — 14% of the
 * screen spent on two numbers — and at 420px it stacked to 216px, more than a
 * third of the window, above a data area of 230. One row is 40 and wraps to
 * two at phone width.
 *
 * THE DEAL COUNT IS GONE FROM HERE because it was said twice. `ListPage`
 * already writes it into zone 1's meta line under the title ("8 deals"), which
 * is where section 11.1 puts a record count; a tile repeating it is the same
 * value in two forms.
 *
 * No `mb-4`: zone 1a already carries `mt-4` and zone 2 carries its own, so the
 * bottom margin only stacked a second 16px gap under the strip.
 */
function PipelineStrip({ totals }: { totals: PipelineTotals | null }) {
  const items: { label: string; value: string; skeletonWidth: string }[] = [
    {
      label: 'Estimated value',
      value: fmtAmount(totals?.value),
      skeletonWidth: 'w-28',
    },
    {
      label: 'Weighted value',
      value: fmtAmount(totals?.weighted),
      skeletonWidth: 'w-28',
    },
  ]

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border-light bg-surface px-4 py-2">
      {items.map(item => (
        <div key={item.label} className="flex min-w-0 items-baseline gap-2">
          <span className="text-label text-text-secondary">{item.label}</span>
          {totals === null ? (
            <Skeleton className={cn('h-4', item.skeletonWidth)} />
          ) : (
            <span className="text-body font-medium tabular-nums text-text-primary">
              {item.value}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * §11.6 / §35.1: the view switcher is a joined group at the FAR RIGHT of zone
 * 2, and `ListPage` reserves `toolbarExtra` for exactly it. The active side is
 * tinted; the other is the quiet one.
 *
 * Two ways, not three: this product has no card view, and §4 rule 2's "parallel
 * items behave identically" is about the ones that exist.
 */
function ViewSwitcher({
  view,
  onChange,
}: {
  view: 'list' | 'board'
  onChange: (view: 'list' | 'board') => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={view === 'list'}
        className={cn(
          'border-transparent bg-transparent',
          view === 'list' && 'bg-primary-subtle text-text-primary'
        )}
        onClick={() => onChange('list')}
      >
        <ListIcon />
        List
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={view === 'board'}
        className={cn(
          'border-transparent bg-transparent',
          view === 'board' && 'bg-primary-subtle text-text-primary'
        )}
        onClick={() => onChange('board')}
      >
        <ColumnsIcon />
        Board
      </Button>
    </div>
  )
}

/**
 * `useSearchParams` suspends, and a page that reads it without a boundary
 * around the reader takes the whole route down to the nearest one. The screen
 * itself is one component below this so the boundary is local.
 */
export default function DealsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-0 flex-col gap-4 md:h-full">
          <PipelineStrip totals={null} />
          {/* `md:` for the same reason the template's own heights carry
              it: below 768 this column has no definite height, so a
              `flex-1` child with `min-h-0` would have a zero
              hypothetical main size and the skeleton would be invisible
              rather than the shape of what is coming (section 14). */}
          <Skeleton className="h-96 rounded-xl md:h-auto md:min-h-0 md:flex-1" />
        </div>
      }
    >
      <DealsScreen />
    </Suspense>
  )
}

function DealsScreen() {
  const router = useRouter()
  const { toast } = useToast()
  const me = useMe()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [totals, setTotals] = useState<PipelineTotals | null>(null)
  const [stages, setStages] = useState<NamedRow[]>([])
  const [companies, setCompanies] = useState<NamedRow[]>([])
  const [team, setTeam] = useState<NamedRow[]>([])
  /* The template's only refetch lever. Bumped after a move lands. */
  const [refreshKey, setRefreshKey] = useState(0)
  /* P5-T7 §7.7 — "Deals Without Follow-up", the one-click narrowing state. */
  const [onlyNoFollowUp, setOnlyNoFollowUp] = useState(false)
  /* F-DEALS-CREATE — the create dialog this screen had no way to open. */
  const [createOpen, setCreateOpen] = useState(false)

  /*
   * §26: whether this user may create a Deal, read from the REAL permission
   * map — `/api/auth/me` builds it from `role_permissions`, the same table
   * `checkPermission(user, 'deals', 'create')` reads in `POST /api/deals` —
   * never from a role name. The Administrator branch mirrors the server's own
   * short-circuit. §26's closing note applies: this is appearance only, and
   * the route enforces the permission regardless of what renders here.
   */
  const canCreate =
    me?.role === 'Administrator' ||
    (me?.permissions?.deals?.create ?? me?.permissions?.deals?.edit ?? false)
  /* `useMe` starts at null, so for the first moment the answer is "not known
     yet", which is not the same as "not allowed". Attaching section 26's
     reason to that moment would tell the user they lack a permission nobody
     has looked up. The button is present and disabled until the answer
     arrives; only then does it either enable or explain itself. */
  const permissionsKnown = me !== null

  /*
   * §35.3: the board is offered at 768px and above. Below that the switcher
   * shows the list alone and a remembered `?view=board` silently renders the
   * list — nothing has failed, a view is simply not offered at this width.
   */
  const boardAvailable = useBoardAvailable()

  /*
   * §35.4 caps a board at seven columns and `board.tsx` THROWS past that
   * rather than rendering an eighth. `deal_stages` is user-editable master
   * data, so an administrator adding a couple of stages is enough to cross it
   * — which would take the whole screen down, not just the board.
   *
   * So the board is not offered at all past seven, and the switcher says why
   * in one line instead of vanishing without explanation. §26 hides a control
   * the user cannot use; it does not ask them to guess where it went.
   */
  const tooManyStages = stages.length > BOARD_MAX_COLUMNS
  const boardOffered = boardAvailable && stages.length > 0 && !tooManyStages

  const view: 'list' | 'board' =
    searchParams.get('view') === 'board' && boardOffered ? 'board' : 'list'

  /*
   * The choice lives in the URL so that Back from a Deal returns to the view
   * it was opened from — §11.6 asks for the choice to be remembered, and the
   * URL remembers it without a second store to fall out of step.
   */
  function setView(next: 'list' | 'board') {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'board') params.set('view', 'board')
    else params.delete('view')
    const query = params.toString()
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
  }

  /**
   * §35.6 — THE move. Every path (the menu today, the drag when the kit ships
   * it) is this one call, and `board.tsx` owns the optimistic half: the card is
   * already in the destination column when this runs, and a THROW is what sends
   * it back with an error toast.
   *
   * So this must not catch. It must also not hang: §14 rule 4 and §35.6 item 4
   * — a save that cannot fail cannot be reverted, and the card would sit in the
   * wrong column for ever. Hence the deadline.
   *
   * `PATCH /api/deals/[id]/stage` writes the `deal_stage_logs` row and resets
   * `stage_entered_at` in one transaction, so the ageing clock and the history
   * are the server's business, not this screen's. The refresh afterwards is
   * what brings the reset `days_in_stage` back to the card.
   */
  async function handleMove(cardId: string, toColumnId: string) {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), MOVE_TIMEOUT_MS)
    try {
      const r = await fetch(`/api/deals/${cardId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_stage_id: toColumnId }),
        signal: abort.signal,
      })
      if (!r.ok) throw new Error(String(r.status))
    } finally {
      clearTimeout(timer)
    }
    setRefreshKey(k => k + 1)
  }

  /*
   * The three pickers' options. Each one is independent of the others and of
   * the list, so a failure costs its own filter and nothing else — section 26:
   * a filter whose options could not be read is not shown at all, rather than
   * shown empty or shown and then always matching nothing.
   *
   * `/api/companies` needs the `companies` permission and `/api/orders/team`
   * needs a team, so both genuinely come back unusable for some users. That is
   * the same reason, not a swallow: the catch sets an empty list, and an empty
   * list removes the filter below.
   */
  useEffect(() => {
    let live = true
    const read = async (url: string): Promise<NamedRow[]> => {
      const r = await fetch(url)
      if (!r.ok) return []
      const body = await r.json()
      return Array.isArray(body) ? (body as NamedRow[]) : []
    }

    read('/api/deals/stages')
      .then(rows => live && setStages(rows))
      .catch(() => live && setStages([]))
    read('/api/companies')
      .then(rows => live && setCompanies(rows))
      .catch(() => live && setCompanies([]))
    read('/api/orders/team')
      .then(rows => live && setTeam(rows))
      .catch(() => live && setTeam([]))

    return () => {
      live = false
    }
  }, [])

  /*
   * Deliberately NOT memoised — the template holds `load` in a ref and never
   * makes it an effect dependency, so a new identity does not refetch and a
   * stable one is not needed.
   *
   * NO try/catch and NO `return []`. A rejection IS the failed state (section
   * 14 rules 3 and 4); catching here would render a 500 as "no deals match
   * these filters" and offer to clear filters that were never the problem.
   * The totals are cleared on the way out for the same reason — a strip left
   * showing the last good figures above a table that could not be loaded is a
   * number with nothing under it.
   */
  const load: ListPageProps<DealRow>['load'] = async ({ search, filters, signal }) => {
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (filters.owner) params.set('ownerId', filters.owner)
    if (filters.stage) params.set('stageId', filters.stage)
    if (filters.company) params.set('companyId', filters.company)
    if (filters.closeMonth) params.set('closeMonth', filters.closeMonth)
    const query = params.toString()

    const r = await fetch(`/api/deals${query ? `?${query}` : ''}`, { signal }).catch(error => {
      setTotals(null)
      throw error
    })
    if (!r.ok) {
      setTotals(null)
      throw new Error(String(r.status))
    }
    const body = await r.json()
    const loaded: DealRow[] = Array.isArray(body) ? body : []
    setTotals(totalsOf(loaded))
    // P5-T7: the alert banner's one-click narrowing, applied AFTER the
    // totals are taken off the full `loaded` set — so the banner's own
    // count stays true once its "View" button has been clicked, instead of
    // reading zero the moment the rows underneath it are narrowed.
    // `list-page.tsx` has no prop to set its declared filters from outside,
    // so this is a second filter this screen applies on top of them.
    return onlyNoFollowUp ? loaded.filter(row => !row.next_follow_up) : loaded
  }

  /* §4.8's four filters. Each one is declared, never rendered here — that is
     what keeps them inside the panel and out of the toolbar (section 27.3). */
  const filters: ListFilter[] = [
    ...(team.length > 1
      ? [
          {
            id: 'owner',
            label: 'Owner',
            kind: 'select' as const,
            /* Section 16.3: past about six options the menu needs a search,
               and a team runs past six sooner than it does not. */
            searchable: team.length > 6,
            options: {
              '': 'Anyone',
              ...Object.fromEntries(team.map(u => [u.id, u.name])),
            },
          },
        ]
      : []),
    ...(stages.length > 0
      ? [
          {
            id: 'stage',
            label: 'Stage',
            kind: 'select' as const,
            options: {
              '': 'Any stage',
              ...Object.fromEntries(stages.map(s => [s.id, s.name])),
            },
          },
        ]
      : []),
    ...(companies.length > 0
      ? [
          {
            id: 'company',
            label: 'Company',
            kind: 'select' as const,
            searchable: companies.length > 6,
            options: {
              '': 'Any company',
              ...Object.fromEntries(companies.map(c => [c.id, c.name])),
            },
          },
        ]
      : []),
    {
      id: 'closeMonth',
      label: 'Expected closing month',
      kind: 'select',
      searchable: true,
      options: closeMonthOptions(),
    },
  ]

  const healthAlerts: DataHealthAlertItem[] = [
    {
      id: 'no-follow-up',
      count: totals?.noFollowUp ?? 0,
      title: `${totals?.noFollowUp ?? 0} ${(totals?.noFollowUp ?? 0) === 1 ? 'deal has' : 'deals have'} no open follow-up`,
      detail: 'Missing a next follow-up date — nothing is scheduled to move these forward.',
      actionLabel: 'View deals with no follow-up',
      active: onlyNoFollowUp,
      onAction: () => { setOnlyNoFollowUp(true); setRefreshKey(k => k + 1) },
    },
  ]

  return (
    /*
     * The strip has no zone in section 11.1 — the template has four and zone
     * 1a is reserved for section 33's tabs — so it sits above zone 1, here,
     * and no prop is added to `list-page`.
     *
     * AT 768 AND ABOVE this wrapper is a flex COLUMN with a definite height,
     * never a plain div: the shell's content wrapper is what gives `ListPage`
     * its height, and a plain wrapper breaks that chain so the PAGE scrolls
     * instead of zone 3. `md:h-auto` on the template is load-bearing too —
     * `cn()` is an extended tailwind-merge, `h-full` and `flex-1` do not
     * conflict, so without it the template would keep its own `md:h-full` and
     * overflow by the height of anything above it.
     *
     * BELOW 768 every one of those classes is off, deliberately, and matches
     * `list-page`'s own boundary: the wrapper's height is its content, the
     * template grows to its rows and the shell's content wrapper scrolls the
     * page. Leaving `h-full min-h-0` unprefixed here would re-impose the
     * fixed height from outside and undo the template's half of it.
     */
    <div className="flex min-h-0 flex-col md:h-full">
      <ListPage<DealRow>
        className="md:h-auto md:min-h-0 md:flex-1"
        /*
         * F19: the heading was sitting below `PipelineStrip` and the
         * data-health banner, which used to render in a `div` above this
         * whole `ListPage` — above its own `<h1>`. Composed into the
         * `sectionTabs` slot instead, both now render directly UNDER the
         * title (zone 1a, section 33), never above it. Deals has no tabs
         * of its own, so the slot was free.
         */
        sectionTabs={
          /* The strip no longer carries its own bottom margin, so the
             gap between it and the chip belongs here — one place,
             applied only when the chip is actually rendered. */
          <div className="flex flex-col gap-2">
            <PipelineStrip totals={totals} />
            {onlyNoFollowUp ? (
              <QuickFilterChip
                label="Showing Deals without a follow-up only"
                onClear={() => { setOnlyNoFollowUp(false); setRefreshKey(k => k + 1) }}
              />
            ) : null}
          </div>
        }
        /* F25: the data-health alert is no longer a strip above the table
           — it is behind the header's alert icon, grouped with the other
           header controls. Only the applied-filter chip stays in zone 1a,
           and only while a filter is applied. */
        /*
         * Section 11.1 zone 1: the one primary action, top-right, grouped
         * with the alert trigger rather than stranded at the screen edge.
         *
         * Section 26: an individual action the user cannot perform is
         * DISABLED with the reason attached, not hidden — hiding is for whole
         * areas, like a sidebar section. Somebody who cannot find a button
         * does not know whether it does not exist or whether they may not use
         * it. The reason has to hang off `PermissionTooltip` rather than the
         * button: every disabled control here carries `pointer-events-none`,
         * so a tooltip on the button itself would be written and never
         * readable. This is the same wrapper the follow-ups section and the
         * board already use for their gated actions.
         *
         * No `<Link>` and no `router.push` — see the hydration note in
         * `parties/page.tsx`. A dialog also keeps the user on the list, which
         * is what lets the new row appear in place instead of after a
         * navigation.
         */
        action={
          <div className="flex items-center gap-2">
            <DataHealthAlerts alerts={healthAlerts} label="Deal data health" />
            <PermissionTooltip
              allowed={!permissionsKnown || canCreate}
              reason="Only someone who can create deals can add one."
            >
              <Button disabled={!canCreate} onClick={() => setCreateOpen(true)}>
                <PlusIcon />
                Create deal
              </Button>
            </PermissionTooltip>
          </div>
        }
        toolbarExtra={
          boardOffered ? (
            <ViewSwitcher view={view} onChange={setView} />
          ) : tooManyStages ? (
            <p className="text-meta text-text-muted">
              Board view needs {BOARD_MAX_COLUMNS} stages or fewer; this tenant
              has {stages.length}.
            </p>
          ) : undefined
        }
        title="Deals"
        noun={{ one: 'deal', many: 'deals' }}
        columns={dealColumns(id => router.push(`/deals/${id}`), DEFAULT_STAGE_AGEING_DAYS)}
        rowKey={deal => deal.id}
        filters={filters}
        load={load}
        /*
         * The template owns the fetch, so a move that lands has to come back
         * through it or the board keeps rendering pre-move data: the column
         * totals would stay on the old numbers and the moved card would keep
         * the days-in-stage the server has just reset. Measured — without this
         * the log row was written and the board did not notice.
         */
        refreshKey={refreshKey}
        /*
         * §35.1: the board IS zone 3 — same header, same toolbar, same
         * filters, same pagination bar. The template hands over the rows it
         * has already fetched and filtered, so the two views cannot disagree
         * about what is on screen, and it keeps every other zone-3 state for
         * itself: skeleton, failed, nothing-found and nothing-yet are read
         * before this, so an all-empty board is §35.9's empty SCREEN rather
         * than seven columns each saying they are empty.
         */
        renderData={
          view === 'board'
            ? boardRows => (
                <Board
                  columns={dealBoardColumns(stages, boardRows)}
                  cards={boardRows.map(row =>
                    dealBoardCard(row, DEFAULT_STAGE_AGEING_DAYS)
                  )}
                  onMove={handleMove}
                  onOpenCard={id => router.push(`/deals/${id}`)}
                  emptyColumnLabel="No deals in this stage"
                />
              )
            : undefined
        }
        searchPlaceholder="Search deals"
        searchHint={SEARCH_HINT}
        emptyYet={{
          heading: 'No deals yet',
          body: 'Every opportunity being worked — its stage, what it is worth and when it is expected to close — is listed here.',
          /* Section 13: "nothing yet" offers a primary create. It is left
             off for a user who may not create — an empty state's button
             cannot carry section 26's reason, and section 26's first rule is
             that no control may fail after being clicked. The header button
             above is where that user reads why. */
          actionLabel: canCreate ? 'Create deal' : undefined,
          onAction: canCreate ? () => setCreateOpen(true) : undefined,
        }}
      />

      <DealDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companies={companies}
        stages={stages}
        team={team}
        /*
         * No reload and no navigation: bumping the template's only refetch
         * lever re-runs `load` in place, so the new Deal appears in the list
         * (and in the pipeline strip, which `load` recomputes) without the
         * page going away and coming back.
         */
        onCreated={deal => {
          toast(`Deal "${deal.name}" created`)
          setRefreshKey(k => k + 1)
        }}
      />
    </div>
  )
}
