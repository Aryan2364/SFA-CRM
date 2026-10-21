'use client'

/**
 * The Deal detail page — REBUILD-PLAN.md §4.1 (the record), §4.4 (Logs) and
 * §4.5 (Follow-ups). P2-T7's companion: the list's View action had nowhere to
 * go, and a link to a 404 is the dead end §13 exists to prevent.
 *
 * It reads one Deal and shows it, and since 13 Oct 2026 it is where the Deal
 * is changed too: the record header carries Edit (the create dialog in edit
 * mode) and section 11.2's three-dot menu, which moves the stage and closes
 * the Deal Won or Lost — see `components/deals/deal-status.tsx`. Before that
 * the only ways to move a Deal were the board (not offered on a phone) and a
 * meeting page, so a rep in the field could not update one at all.
 *
 * Still not here: attachments (P2-T11 — no upload component in the kit yet)
 * and Reopen (no route can clear an outcome yet).
 *
 * ⚠️ Probability is rendered as a FIGURE, never a control. §4.3 and §12 closed
 * that: it is edited inside the Deal's own editor and nowhere else, and this
 * page is not that editor.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT ON `templates/list-page.tsx`
 *
 * That template is a list screen: it declares `h-full`, divides a definite
 * height between four zones and gives zone 3 the only scrollbar. A detail page
 * wants the opposite — it grows, and the page scrolls. `AppShell`'s content
 * wrapper is already `h-full overflow-y-auto`, so this page is plain flow
 * content inside it.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO BACK ARROW
 *
 * AGENTS.md §1 rule 11: a back button does something different depending on
 * how the user arrived, which is what makes people feel lost. The breadcrumb
 * replaces it, and it reflects the structure of the software rather than the
 * history — the same decision the Company detail page records.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  BuildingIcon,
  CalendarPlusIcon,
  CheckIcon,
  PencilIcon,
  ClockIcon,
  TriangleAlertIcon,
  UserRoundIcon,
} from 'lucide-react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Badge } from '@/components/ui/badge'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { EMPTY, fmtAmount, fmtDate, fmtDateTime, parseApiDate } from '@/lib/format'
import { FollowUpsSection, type FollowUp } from '@/components/deals/follow-ups-section'
import { DealMeetingsSection } from '@/components/deals/deal-meetings-section'
import {
  DealCloseDialog,
  DealStatusMenu,
  EDIT_REASON,
  moveDealStage,
  type DealOutcome,
  type StageOption,
} from '@/components/deals/deal-status'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { useMe } from '@/hooks/useMe'
import { recordRecentItem } from '@/lib/recent-items'
import { SharedWithCard } from '@/components/sharing/shared-with-card'
import { toast } from '@/components/ui/sonner'
import { DealDialog, type NamedRow as DialogRow } from '../deal-dialog'
import { useLayout } from '@/lib/layout'
import { PhoneDealDetailPage } from './phone-deal-detail'

// ─────────────────────────────────────────────────────────────
// The wire shape
//
// Read off `src/app/api/deals/[id]/_handlers.ts` and `../_shape.ts`: a bare
// object, no envelope, with the relations renamed by `shapeDeal()` and two
// derived fields added. `expected_value` is a NUMBER here because `serialize()`
// ran first — a Decimal would have arrived as a string and every total built
// on it would be wrong.
//
// ⚠️ `deal_stage_logs` carries STAGE IDS, not stage names: `DEAL_DETAIL_INCLUDE`
// embeds the rows as they are, with no relation to `deal_stages`. That is why
// this page reads the stage master separately — see `stageNames` below.
// ─────────────────────────────────────────────────────────────

type NamedRef = { id: string; name: string }

// `FollowUp` is imported from `follow-ups-section.tsx` rather than declared
// twice. The section owns the §4.5 lifecycle and its shape is the one the
// follow-ups routes return, so a second copy here could only ever drift.

/**
 * A stable empty array for the section's `initialFollowUps`. A fresh `[]` on
 * every render is a new reference, which would restart the section's state
 * each time the page re-rendered while the Deal was still loading.
 */
const EMPTY_FOLLOW_UPS: FollowUp[] = []

type StageLog = {
  id: string
  from_stage_id: string | null
  to_stage_id: string
  changed_at: string
  days_in_previous_stage: number | null
}

type Deal = {
  id: string
  name: string
  expected_value: number
  probability: number
  expected_close_date: string | null
  source: string | null
  remarks: string | null
  outcome: string | null
  closed_at: string | null
  is_active: boolean
  created_at: string
  days_in_stage: number | null
  company: (NamedRef & { mobile_1: string | null; type?: string | null }) | null
  contact: (NamedRef & { mobile: string | null }) | null
  stage: NamedRef | null
  owner: NamedRef | null
  product: NamedRef | null
  product_category: NamedRef | null
  reason_for_loss: NamedRef | null
  follow_ups: FollowUp[]
  deal_stage_logs: StageLog[]
  /*
   * Sharing (src/lib/sharing.ts), all decided by the server and absent from an
   * older response: how the caller reaches this opportunity, whether they may
   * open its account (null for someone the opportunity ALONE was shared with),
   * whether they may change its "Shared with" list, and whether sharing exists
   * in this database yet.
   */
  access?: 'owner-scope' | 'work' | 'view'
  company_access?: 'owner-scope' | 'work' | 'view' | null
  can_share?: boolean
  sharing_available?: boolean
}

/** Section 26.2, a record rule: what a view-only share leaves disabled. */
const VIEW_ONLY_REASON = 'This opportunity is shared with you to view only.'

/** A failed load, told apart so the empty state can say the right thing. */
type LoadError = 'not-found' | 'forbidden' | 'failed'

/**
 * §4.7 — the same constant the list carries, for the same reason.
 *
 * TODO: read `tenant_settings.deal_stage_ageing_days` through the tenant
 * settings reader. It must arrive through an API route, not an import:
 * `src/lib/settings.ts` imports `@/lib/db`, and importing that from a client
 * page pulls the pg driver into the browser bundle and fails the build.
 */
const DEFAULT_STAGE_AGEING_DAYS = 15

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** Date-only on both sides: a follow-up due TODAY is not yet overdue (§10). */
function isOverdue(dueDate: string | null | undefined): boolean {
  const due = parseApiDate(dueDate ?? null)
  if (!due) return false
  return due.getTime() < startOfToday().getTime()
}

/** `—` for absent, never a blank line and never "null". */
function orEmpty(value: string | null | undefined) {
  return value && value.trim() !== '' ? value : EMPTY
}

/** One label/value pair. The label is the quiet half, the value the loud one. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-text-secondary">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-text-primary">{children}</dd>
    </div>
  )
}

function DealSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  )
}

/**
 * §4.4 Logs — when the Deal entered each stage and how long it stayed.
 *
 * `days_in_previous_stage` is written by `PATCH /api/deals/[id]/stage` at the
 * moment of the move, so it is the recorded answer rather than one recomputed
 * here from two timestamps; a Deal that has never moved has no rows at all,
 * which is a real state and not a failure.
 *
 * Stage names come from the master (`stageNames`), because the log rows carry
 * ids only. An id with no master row renders as "Unknown stage" rather than a
 * bare UUID — a deleted stage is the one way that happens.
 */
function StageHistoryCard({
  logs,
  stageNames,
  currentStage,
  daysInStage,
}: {
  logs: StageLog[]
  stageNames: Record<string, string>
  currentStage: string | null
  daysInStage: number | null
}) {
  const nameOf = (id: string | null) =>
    id ? (stageNames[id] ?? 'Unknown stage') : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage history</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <p className="text-body text-text-secondary">
            Now in{' '}
            <span className="font-medium text-text-primary">
              {currentStage ?? 'no stage'}
            </span>
            {daysInStage !== null && (
              <>
                {' '}for {daysInStage} {daysInStage === 1 ? 'day' : 'days'}
                {/* No full stop after this: the sentence can end in a badge,
                    and a stray period floating beside one reads as a typo. */}
                {daysInStage > DEFAULT_STAGE_AGEING_DAYS && (
                  <>
                    {' '}
                    <Badge variant="warning">
                      <TriangleAlertIcon />
                      Past the {DEFAULT_STAGE_AGEING_DAYS}-day limit
                    </Badge>
                  </>
                )}
              </>
            )}
          </p>

          {logs.length === 0 ? (
            <p className="text-body text-text-secondary">
              It has not moved stage yet, so there is nothing recorded here. Each
              move writes the stage it came from, the stage it went to and how
              long it stood there.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-light">
              {logs.map(log => {
                const from = nameOf(log.from_stage_id)
                return (
                  <li key={log.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                    <p className="text-body text-text-primary">
                      {from ? (
                        <>
                          <span className="text-text-secondary">{from}</span>
                          {' → '}
                        </>
                      ) : null}
                      <span className="font-medium">{nameOf(log.to_stage_id)}</span>
                    </p>
                    <p className="text-meta text-text-muted">
                      {fmtDateTime(log.changed_at)}
                      {log.days_in_previous_stage !== null && from
                        ? ` · stayed ${log.days_in_previous_stage} ${
                            log.days_in_previous_stage === 1 ? 'day' : 'days'
                          } in ${from}`
                        : ''}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function DealDetailPage() {
  const { layout } = useLayout()
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  if (layout === 'phone') return <PhoneDealDetailPage id={id} />
  return <DesktopDealDetailPage />
}

function DesktopDealDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id ?? ''

  const [deal, setDeal] = useState<Deal | null>(null)
  const [stageNames, setStageNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<LoadError | null>(null)
  const [loading, setLoading] = useState(true)
  /* The funnel stages the menu moves between, with `stage_type`. `stagesLoaded`
     is true only once the request has ANSWERED, so "no stages yet" is never
     read off a request still in flight. */
  const [stages, setStages] = useState<StageOption[]>([])
  const [stagesLoaded, setStagesLoaded] = useState(false)
  const [closing, setClosing] = useState<DealOutcome | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  /* The edit dialog's pickers, read the first time it opens and not before. */
  const [companies, setCompanies] = useState<DialogRow[]>([])
  const [team, setTeam] = useState<DialogRow[]>([])

  /* Section 26.1: `null` until /api/auth/me answers — "not known yet" is
     drawn disabled with no reason. All three routes behind the header's
     controls check `deals.edit`. */
  const me = useMe()
  const canEditRole: boolean | null = me ? Boolean(me.permissions?.deals?.edit) : null
  const canSetUpStages = Boolean(me?.permissions?.lead_stages?.create)
  /* A view-only share (src/lib/sharing.ts) is a record rule on top of the
     role: the routes 404 every write, so every write control here is disabled
     with that reason instead of the permission sentence. */
  const viewOnly = deal?.access === 'view'
  const canEdit: boolean | null = viewOnly ? false : canEditRole
  const editReason = viewOnly ? VIEW_ONLY_REASON : EDIT_REASON
  /* "Log a meeting": offered to someone the opportunity is shared with at
     'work', whose Daily Activity picker may not list this account at all
     (opportunity-only sharing). The meeting is linked to this opportunity. */
  const canLogMeetingRole: boolean | null = me ? Boolean(me.permissions?.meetings?.create) : null
  const [logging, setLogging] = useState(false)
  async function logMeeting() {
    if (!deal?.company || logging) return
    setLogging(true)
    try {
      const res = await fetch('/api/daily-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visit_type: deal.company.type?.trim() || 'Other',
          entity_id: deal.company.id,
          entity_name: deal.company.name,
          deal_id: deal.id,
        }),
      })
      const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null
      if (!res.ok || !body?.id) {
        toast.error(body?.error || 'The meeting could not be logged. Nothing was saved.')
        return
      }
      router.push(`/daily-activity/meeting/${body.id}`)
    } catch {
      toast.error('The connection dropped. The meeting was not logged.')
    } finally {
      setLogging(false)
    }
  }

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${id}`, { cache: 'no-store' })
      if (res.status === 404) return setError('not-found')
      if (res.status === 403) return setError('forbidden')
      if (!res.ok) return setError('failed')
      setDeal((await res.json()) as Deal)
    } catch {
      setError('failed')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  // Global search's "Recent" (src/lib/recent-items.ts). Fires from this
  // shared component rather than `phone-deal-detail.tsx`, so it covers
  // both layouts without touching that file.
  useEffect(() => {
    if (deal && me?.userId) {
      recordRecentItem(me.userId, {
        type: 'opportunity',
        id: deal.id,
        title: deal.name,
        subtitle: deal.company?.name ?? null,
        href: `/deals/${deal.id}`,
      })
    }
  }, [deal, me?.userId])

  /*
   * A quiet re-read after a change lands: the stage history and the days in
   * stage are the server's to recompute, and the skeleton must not replace a
   * page the user is looking at (global rule 5 — update in place, no flicker).
   */
  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/deals/${id}`, { cache: 'no-store' })
      if (res.ok) setDeal((await res.json()) as Deal)
    } catch {
      /* The values already merged from the write stand until the next load. */
    }
  }, [id])

  /** Merge what a write returned, then re-read the parts it does not carry. */
  const applyChange = useCallback(
    (row: Record<string, unknown>) => {
      setDeal(current =>
        current
          ? {
              ...current,
              stage: (row.stage as Deal['stage']) ?? current.stage,
              outcome: (row.outcome as string | null) ?? null,
              closed_at: (row.closed_at as string | null) ?? null,
              days_in_stage: (row.days_in_stage as number | null) ?? current.days_in_stage,
            }
          : current
      )
      void refresh()
    },
    [refresh]
  )

  useEffect(() => {
    let live = true
    fetch('/api/deals/stages')
      .then(async r => {
        if (!live || !r.ok) return
        const body = await r.json()
        setStages(Array.isArray(body) ? (body as StageOption[]) : [])
        setStagesLoaded(true)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!editOpen || companies.length > 0) return
    const read = async (url: string): Promise<DialogRow[]> => {
      const r = await fetch(url)
      if (!r.ok) return []
      const body = await r.json()
      return Array.isArray(body) ? (body as DialogRow[]) : []
    }
    read('/api/companies?fields=picker').then(setCompanies).catch(() => setCompanies([]))
    read('/api/orders/team').then(setTeam).catch(() => setTeam([]))
  }, [editOpen, companies.length])

  /*
   * The FULL stage master, not `/api/deals/stages`.
   *
   * That route is the funnel picker: it hides `Existing` and every inactive
   * stage, which is right for choosing a stage and wrong for reading history —
   * a Deal that passed through a stage since switched off would show "Unknown
   * stage" for a move that really happened. `/api/masters/lead-stages` returns
   * the table as it is and any authenticated user may read it.
   *
   * A failure costs the stage NAMES in the history card and nothing else, so it
   * is not allowed to fail the page: the card falls back to "Unknown stage".
   */
  useEffect(() => {
    let live = true
    fetch('/api/masters/lead-stages')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: NamedRef[]) => {
        if (!live) return
        const map: Record<string, string> = {}
        for (const row of Array.isArray(rows) ? rows : []) map[row.id] = row.name
        setStageNames(map)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="flex flex-col gap-6 pb-2">
      {/* Section 11.2: the breadcrumb is the first element on a detail page. */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/deals" />}>Opportunities</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{deal?.name ?? 'Opportunity'}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {loading && <DealSkeleton />}

      {!loading && error && (
        <div className="rounded-xl border border-border-light bg-surface">
          {error === 'not-found' && (
            <EmptyState
              variant="failed"
              heading="This opportunity is not here"
              actionLabel="Go to Opportunities"
              onAction={() => router.push('/deals')}
            >
              It may have been deleted, or it may belong to someone whose records
              you cannot see. The Opportunities list shows everything you can open.
            </EmptyState>
          )}
          {error === 'forbidden' && (
            <EmptyState
              variant="failed"
              heading="You cannot open opportunities"
              actionLabel="Go to Opportunities"
              onAction={() => router.push('/deals')}
            >
              Your role does not include viewing opportunities. An administrator can
              change that under Settings, Access Control.
            </EmptyState>
          )}
          {error === 'failed' && (
            <EmptyState
              variant="failed"
              heading="The opportunity could not be loaded"
              onAction={() => void load()}
            >
              The connection dropped while fetching it. Nothing has changed.
            </EmptyState>
          )}
        </div>
      )}

      {!loading && !error && deal && (
        <>
          {/*
            Global rule 1 and §4.3's ordering: the Deal name is the largest
            text and comes first; the company, the contact, the owner and the
            stage sit below it and smaller. `flex-wrap` rather than a fixed
            row — on a phone the meta items wrap instead of shrinking.
          */}
          <header className="flex flex-col gap-3">
            {/*
              Section 11.2 item 2: the name as the title with its status badges
              BESIDE it, and on the right one primary action (Edit) and the
              three-dot menu for everything else — the stage moves and Won/Lost.
              `flex-wrap`: on a phone the actions drop under the title rather
              than squeezing it.
            */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="min-w-0 break-words text-page-title font-medium text-text-primary">
                  {deal.name}
                </h1>
                {/*
                  A Deal Stage is master data a tenant configures, not one of
                  the fixed vocabularies in `status-badge.tsx`, so the kit
                  `Badge` carries the name without claiming a meaning the
                  master does not define.

                  Once an opportunity is closed, its stage badge and the
                  outcome badge below say the same thing twice (a stage
                  named "Won" next to a "✓ Won" badge) — the outcome badge
                  is the clearer of the two (it carries the icon and the
                  reason it closed), so it alone is shown once closed; the
                  stage badge still carries the OPEN stage name, which the
                  outcome badge never does.
                */}
                {deal.stage && !deal.outcome && <Badge>{deal.stage.name}</Badge>}
                {deal.outcome && (
                  <Badge variant={deal.outcome === 'won' ? 'success' : 'danger'}>
                    {deal.outcome === 'won' ? <CheckIcon /> : <TriangleAlertIcon />}
                    {deal.outcome === 'won' ? 'Won' : 'Lost'}
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {deal.sharing_available && deal.access === 'work' && deal.company && (
                  <PermissionTooltip
                    allowed={canLogMeetingRole !== false}
                    reason="Only someone who can create meetings can log one."
                  >
                    <Button
                      variant="secondary"
                      className="max-sm:min-h-11"
                      disabled={canLogMeetingRole !== true || logging}
                      onClick={() => void logMeeting()}
                    >
                      <CalendarPlusIcon />
                      Log a meeting
                    </Button>
                  </PermissionTooltip>
                )}
                <PermissionTooltip allowed={canEdit !== false} reason={editReason}>
                  <Button
                    className="max-sm:min-h-11"
                    disabled={canEdit !== true}
                    onClick={() => setEditOpen(true)}
                  >
                    <PencilIcon />
                    Edit
                  </Button>
                </PermissionTooltip>
                <DealStatusMenu
                  deal={deal}
                  stages={stages}
                  stagesLoaded={stagesLoaded}
                  canEdit={canEdit}
                  reason={editReason}
                  canSetUpStages={canSetUpStages}
                  onMove={target => void moveDealStage(deal, target, applyChange)}
                  onCloseRequest={setClosing}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <BuildingIcon className="size-icon shrink-0" aria-hidden="true" />
                {deal.company &&
                deal.company_access === null &&
                (deal.access === 'work' || deal.access === 'view') ? (
                  /* Shared with the caller on its own, not through its
                     account: the account page would 404 for them, so its
                     name is plain text (section 6.6 rule 4). */
                  deal.company.name
                ) : deal.company ? (
                  <Link
                    className="text-primary hover:text-primary-hover"
                    href={`/parties/companies/${deal.company.id}`}
                  >
                    {deal.company.name}
                  </Link>
                ) : (
                  /* §4.1: a Deal may carry a Contact and no Company. */
                  orEmpty(deal.contact?.name)
                )}
              </span>
              {deal.company && deal.contact && (
                <span className="inline-flex items-center gap-1.5">
                  <UserRoundIcon className="size-icon shrink-0" aria-hidden="true" />
                  {deal.contact.name}
                </span>
              )}
              <span aria-hidden="true" className="text-text-muted">·</span>
              <span>Owner: {orEmpty(deal.owner?.name)}</span>
              {/* Only for someone who reaches this through sharing — the
                  owner and their managers never see it. */}
              {(deal.access === 'work' || deal.access === 'view') && (
                <Badge>{deal.access === 'work' ? 'Shared with you: can work' : 'Shared with you: view only'}</Badge>
              )}
            </div>
            {stagesLoaded && stages.length === 0 && (
              /* Never a silent empty menu: say why nothing can be moved, and
                 where stages come from. */
              <p className="text-body text-text-secondary">
                No opportunity stages are set up, so this opportunity cannot be moved between stages.{' '}
                {canSetUpStages ? (
                  <Link className="text-primary-text underline" href="/masters/lead-stages">
                    Set up stages
                  </Link>
                ) : (
                  'Ask someone who manages Opportunity Stages to add them.'
                )}
              </p>
            )}
          </header>

          <DealCloseDialog
            deal={closing ? deal : null}
            outcome={closing ?? 'won'}
            stages={stages}
            onOpenChange={next => {
              if (!next) setClosing(null)
            }}
            onClosed={applyChange}
          />

          <DealDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            companies={companies}
            stages={[]}
            team={team}
            deal={deal}
            onSaved={() => void refresh()}
          />

          {/* Global rule 2: one column on a phone, two from 1024 up. */}
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-6 lg:col-span-2">
              {/*
                P2-T9. The section owns the whole §4.5 lifecycle — add, edit,
                mark done (with the prompt for the next date), re-open and
                delete — and writes through `/api/deals/[id]/follow-ups`. It is
                seeded from what this page already fetched rather than fetching
                the list a second time, and hands back every change so the page's
                copy of the Deal stays the one on screen.
              */}
              <FollowUpsSection
                dealId={deal.id}
                readOnlyReason={viewOnly ? VIEW_ONLY_REASON : null}
                initialFollowUps={deal.follow_ups ?? EMPTY_FOLLOW_UPS}
                onChange={followUps =>
                  setDeal(current => (current ? { ...current, follow_ups: followUps } : current))
                }
              />
              {/*
                §5.6. Every meeting this Deal was discussed in, each one a
                link into that meeting. It renders NOTHING when there are
                none — a Meeting is not compulsory for a Deal, so absence is
                an ordinary state and not an empty state. See the component.
              */}
              <DealMeetingsSection dealId={deal.id} />
              <StageHistoryCard
                logs={deal.deal_stage_logs ?? []}
                stageNames={stageNames}
                currentStage={deal.stage?.name ?? null}
                daysInStage={deal.days_in_stage}
              />
            </div>

            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
                    <Field label="Expected value">
                      {fmtAmount(deal.expected_value)}
                    </Field>
                    {/* Read-only figure. §4.3 and §12: never a control here. */}
                    <Field label="Probability">{deal.probability}%</Field>
                    <Field label="Expected closing date">
                      {fmtDate(deal.expected_close_date)}
                    </Field>
                    <Field label="Product">{orEmpty(deal.product?.name)}</Field>
                    <Field label="Product category">
                      {orEmpty(deal.product_category?.name)}
                    </Field>
                    <Field label="Source">{orEmpty(deal.source)}</Field>
                    {deal.company?.mobile_1 && (
                      <Field label="Phone number">
                        <a
                          className="text-primary hover:text-primary-hover"
                          href={`tel:${deal.company.mobile_1}`}
                        >
                          {deal.company.mobile_1}
                        </a>
                      </Field>
                    )}
                    {/* §4.6: a Lost Deal must carry its reason, so it is shown
                        wherever the loss is. */}
                    {deal.outcome === 'lost' && (
                      <Field label="Reason for loss">
                        {orEmpty(deal.reason_for_loss?.name)}
                      </Field>
                    )}
                    {deal.closed_at && (
                      <Field label="Closed">{fmtDateTime(deal.closed_at)}</Field>
                    )}
                    <Field label="Created">{fmtDate(deal.created_at)}</Field>
                  </dl>
                </CardContent>
              </Card>

              {deal.sharing_available && (
                <SharedWithCard
                  endpoint={`/api/deals/${deal.id}/members`}
                  canShare={deal.can_share === true}
                  noun="opportunity"
                />
              )}

              {deal.remarks && (
                <Card>
                  <CardHeader>
                    <CardTitle>Remarks</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-body text-text-primary">
                      {deal.remarks}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/*
                No "Back to Deals" button here on purpose. The breadcrumb above
                is already the way back, and §1 rule 11 plus global rule 4 both
                land on the same answer: one route back, said once.
              */}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
