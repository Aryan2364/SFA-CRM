'use client'

/**
 * The Deal detail page — REBUILD-PLAN.md §4.1 (the record), §4.4 (Logs) and
 * §4.5 (Follow-ups). P2-T7's companion: the list's View action had nowhere to
 * go, and a link to a 404 is the dead end §13 exists to prevent.
 *
 * DELIBERATELY SMALL, AND DISPLAY ONLY. It reads one Deal and shows it. The
 * three things it does not do are other people's tasks, not omissions:
 *
 *   P2-T9   creating and completing follow-ups — the list here is read-only
 *   P2-T11  attachments — there is no upload component in the kit yet
 *   §4.1    editing the Deal, including closing it Won/Lost
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
  CheckIcon,
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

type FollowUp = {
  id: string
  due_date: string | null
  mode: string | null
  status: string
  notes: string | null
  completed_at: string | null
}

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
  company: (NamedRef & { mobile_1: string | null }) | null
  contact: (NamedRef & { mobile: string | null }) | null
  stage: NamedRef | null
  owner: NamedRef | null
  product: NamedRef | null
  product_category: NamedRef | null
  reason_for_loss: NamedRef | null
  follow_ups: FollowUp[]
  deal_stage_logs: StageLog[]
}

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
 * §4.5. Read-only: due date, mode, status, notes and completed-on, which is
 * every column the table has. Open ones first and by due date, which is the
 * order the work happens in; done ones after, since they are history.
 *
 * An open follow-up whose date has passed carries the same warning badge the
 * list uses — one rule for "overdue", stated in both places the user meets it.
 *
 * `status-badge.tsx` has no follow-up vocabulary and is held by another agent,
 * so these are the kit `Badge` directly rather than an edit to that file.
 * Section 7.2 rule 1 still holds: every one carries an icon as well as a
 * colour.
 */
function FollowUpsCard({ followUps }: { followUps: FollowUp[] }) {
  const sorted = [...followUps].sort((a, b) => {
    const aDone = a.status === 'done'
    const bDone = b.status === 'done'
    if (aDone !== bDone) return aDone ? 1 : -1
    return (a.due_date ?? '').localeCompare(b.due_date ?? '')
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Follow-ups</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-body text-text-secondary">
            No follow-ups yet. A follow-up records what is due next on this
            deal — a meeting, a call, an email — and the earliest open one is
            what shows on the Deals list.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-light">
            {sorted.map(followUp => {
              const done = followUp.status === 'done'
              const overdue = !done && isOverdue(followUp.due_date)
              return (
                <li key={followUp.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {done ? (
                      <Badge variant="success">
                        <CheckIcon />
                        Done
                      </Badge>
                    ) : overdue ? (
                      <Badge variant="warning">
                        <TriangleAlertIcon />
                        Overdue
                      </Badge>
                    ) : (
                      <Badge>
                        <ClockIcon />
                        Not done
                      </Badge>
                    )}
                    <span className="text-body font-medium text-text-primary">
                      {fmtDate(followUp.due_date)}
                    </span>
                    <span className="text-body text-text-secondary">
                      {orEmpty(followUp.mode)}
                    </span>
                    {done && followUp.completed_at && (
                      <span className="text-meta text-text-muted">
                        Completed {fmtDateTime(followUp.completed_at)}
                      </span>
                    )}
                  </div>
                  {followUp.notes && (
                    <p className="whitespace-pre-wrap text-body text-text-secondary">
                      {followUp.notes}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
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
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id ?? ''

  const [deal, setDeal] = useState<Deal | null>(null)
  const [stageNames, setStageNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<LoadError | null>(null)
  const [loading, setLoading] = useState(true)

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
            <BreadcrumbLink render={<Link href="/deals" />}>Deals</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{deal?.name ?? 'Deal'}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {loading && <DealSkeleton />}

      {!loading && error && (
        <div className="rounded-xl border border-border-light bg-surface">
          {error === 'not-found' && (
            <EmptyState
              variant="failed"
              heading="This deal is not here"
              actionLabel="Go to Deals"
              onAction={() => router.push('/deals')}
            >
              It may have been deleted, or it may belong to someone whose records
              you cannot see. The Deals list shows everything you can open.
            </EmptyState>
          )}
          {error === 'forbidden' && (
            <EmptyState
              variant="failed"
              heading="You cannot open deals"
              actionLabel="Go to Deals"
              onAction={() => router.push('/deals')}
            >
              Your role does not include viewing deals. An administrator can
              change that under Settings, Access Control.
            </EmptyState>
          )}
          {error === 'failed' && (
            <EmptyState
              variant="failed"
              heading="The deal could not be loaded"
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
            <h1 className="text-page-title font-medium text-text-primary">
              {deal.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <BuildingIcon className="size-icon shrink-0" aria-hidden="true" />
                {deal.company ? (
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
              {/*
                A Deal Stage is master data a tenant configures, not one of the
                fixed vocabularies in `status-badge.tsx` — and that file is held
                by another agent, so a DEAL_STAGE entry is not this screen's to
                add. The kit `Badge` carries the name without claiming a
                meaning the master does not define.
              */}
              {deal.stage && <Badge>{deal.stage.name}</Badge>}
              {deal.outcome && (
                <Badge variant={deal.outcome === 'won' ? 'success' : 'danger'}>
                  {deal.outcome === 'won' ? <CheckIcon /> : <TriangleAlertIcon />}
                  {deal.outcome === 'won' ? 'Won' : 'Lost'}
                </Badge>
              )}
            </div>
          </header>

          {/* Global rule 2: one column on a phone, two from 1024 up. */}
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <FollowUpsCard followUps={deal.follow_ups ?? []} />
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
