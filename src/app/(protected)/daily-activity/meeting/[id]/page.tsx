'use client'

/**
 * Inside a Meeting — P3-T9, REBUILD-PLAN.md §5.5.
 *
 * One meeting, opened. Everything §5.5 asks for is here: Minutes of the
 * Meeting, the company's open Deals and last few Orders, which Deals were
 * discussed, a stage change without leaving the page, a new Deal or Order
 * raised from here, inline order entry priced by the server, any Draft order
 * still unplaced, and View All into Orders carrying the company.
 *
 * ---------------------------------------------------------------------------
 * ALMOST NOTHING HERE IS NEW, AND THAT IS THE POINT
 *
 *   Minutes            `contextual_remarks`, context type `meeting`
 *   a note on a Deal   the same table, context type `deal`
 *   a note on an Order the same table, context type `order`
 *   discussed Deals    `deal_meetings`, the join that already existed
 *   stage change       `PATCH /api/deals/[id]/stage` — writes `deal_stage_logs`
 *   new Deal           `POST /api/deals`
 *   order taking       `POST /api/orders`, which prices from `products.price`
 *
 * The only route written for this screen is the GET that assembles them, and
 * the only new table row shapes are ones those routes already wrote.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 *
 * The header is pinned, so the meeting's identity and the way back stay put
 * while the Deals and Orders below scroll. `AppShell` already supplies the
 * scroll container and a generous width cap, so this page is plain flow content
 * inside it and never a narrow centred column — §5.5's screen is a working
 * surface with a grid of order lines on it.
 *
 * On a wide screen the notes column is sticky beside the record rather than
 * above it: §5.5 says minutes can be written "while the meeting is running",
 * which means they must be reachable while the user is reading the Deals, not
 * only after scrolling back up. On a phone it is one column: what was discussed
 * last time first, then this meeting's notes, because reading the one and
 * writing the other is what somebody opens the screen to do.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY NOT BUILT HERE — P3-T11 is the cross-linking task. This page
 * carries the company on its outbound links (`/orders?company=…&q=…`,
 * `/deals?companyId=…`) and nothing on the other end reads them yet. Nothing
 * links INTO this page either; the seam is the route, `/daily-activity/meeting/
 * [id]`, which takes a `daily_visits.id` and nothing else.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { CalendarClockIcon, MapPinIcon, TriangleAlertIcon } from 'lucide-react'

import { useMe } from '@/hooks/useMe'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { MeetingAttendeesSection } from '@/components/daily-activity/meeting-attendees-section'
import { NextMeetingDialog } from '@/components/daily-activity/next-meeting-dialog'
import { DealsSection } from '@/components/meeting/deals-section'
import { NewDealDialog } from '@/components/meeting/new-deal-dialog'
import { NotesSection } from '@/components/meeting/notes-section'
import { OrdersSection } from '@/components/meeting/orders-section'
import type {
  MeetingContext,
  MeetingDeal,
  NamedRef,
  NoteTarget,
} from '@/components/meeting/types'
import { formatDuration } from '@/components/daily-activity/types'
import { fmtAmount, fmtDate, fmtTime } from '@/lib/format'
import { useLayout } from '@/lib/layout'
import { PhoneMeetingDetailPage } from './phone-meeting-detail'

type Stage = NamedRef & { sort_order: number }
type LoadState = 'loading' | 'ok' | 'not-found' | 'failed'

export default function MeetingPage() {
  const { layout } = useLayout()
  const params = useParams<{ id: string }>()
  const visitId = params?.id ?? ''
  if (layout === 'phone') return <PhoneMeetingDetailPage visitId={visitId} />
  return <DesktopMeetingPage />
}

function DesktopMeetingPage() {
  const params = useParams<{ id: string }>()
  const visitId = params?.id ?? ''
  const me = useMe()

  const [ctx, setCtx] = useState<MeetingContext | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [stages, setStages] = useState<Stage[]>([])
  /* Answered, not just empty: see DealsSection's no-stages note. */
  const [stagesLoaded, setStagesLoaded] = useState(false)
  const [newDeal, setNewDeal] = useState(false)
  const [nextMeetingOpen, setNextMeetingOpen] = useState(false)
  const [nextMeeting, setNextMeeting] = useState<{ due_date: string; deal_name: string | null } | null>(null)

  const loadNextMeeting = useCallback(async () => {
    if (!visitId) return
    const r = await fetch(`/api/daily-activity/${visitId}/next-meeting`)
    if (!r.ok) return
    const d = await r.json()
    setNextMeeting(d.next_meeting ?? null)
  }, [visitId])

  useEffect(() => { void loadNextMeeting() }, [loadNextMeeting])

  const load = useCallback(async () => {
    if (!visitId) return
    const r = await fetch(`/api/daily-activity/${visitId}`)
    if (r.status === 404 || r.status === 403) {
      setState('not-found')
      return
    }
    if (!r.ok) {
      setState('failed')
      return
    }
    setCtx(await r.json())
    setState('ok')
  }, [visitId])

  useEffect(() => { void load() }, [load])

  /*
   * The stage master, read only when the viewer can actually change a stage
   * or open a deal (the New deal dialog picks its first stage from it).
   * Fetching it for a read-only role would be a request whose only possible
   * use is to populate a control that role must not see.
   */
  const canEditDeals = !!me?.permissions?.deals?.edit
  const needsStages = canEditDeals || !!me?.permissions?.deals?.create
  useEffect(() => {
    if (!needsStages) return
    let cancelled = false
    fetch('/api/deals/stages')
      .then(async r => {
        if (cancelled || !r.ok) return
        const d = await r.json()
        setStages(Array.isArray(d) ? d : [])
        setStagesLoaded(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [needsStages])

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (state !== 'ok' || !ctx) {
    /* No dead end: both failures offer the way back to the day. */
    return (
      <EmptyState
        variant={state === 'failed' ? 'failed' : 'nothing-found'}
        heading={state === 'failed' ? 'This meeting could not be loaded' : 'Meeting not found'}
        actionLabel="Back to Daily Activity"
        onAction={() => { window.location.href = '/daily-activity' }}
      >
        {state === 'failed'
          ? 'Something went wrong reading it. Try again, or go back to the day.'
          : 'It may have been deleted, or it belongs to someone outside your access.'}
      </EmptyState>
    )
  }

  const { visit, company } = ctx
  const day = visit.visit_date.slice(0, 10)

  /*
   * `ctx.can_write` is false only when this meeting was reached through
   * sharing rather than the viewer's own `meetings` scope (src/lib/
   * sharing.ts, Aryan 2026-10-13) — a colleague's meeting on a shared
   * opportunity or account. Every write on the meeting (minutes, discussed
   * flag, next meeting) is gated on it in addition to the role permission:
   * the server re-checks its own scope regardless, but the controls must
   * not invite a tap that will 403.
   */
  const canWriteMeeting = ctx.can_write
  const canWriteNotes = canWriteMeeting && !!me?.permissions?.meetings?.edit
  const canMarkDiscussed = canWriteNotes && !!me?.permissions?.deals?.view
  /* Three-state, for MeetingAttendeesSection: `null` while `useMe()` has not
     resolved yet — its controls render disabled with no reason rather than a
     wrong "not allowed" shown before the answer is in (kit §26's "not known
     yet is not not allowed"). `ctx` is already loaded by this point (the page
     returns earlier otherwise), so only `me` can still be in flight. */
  const canEditAttendees: boolean | null = me === null ? null : canWriteNotes
  /* "Past notes" button in the Minutes header: same three-state rule as
     `canEditAttendees` above — `null` while `useMe()` is still in flight, so
     the button renders disabled with no reason rather than a wrong "not
     allowed". `meetings.view` is the permission the history route itself
     checks; reaching this page at all already proves access to THIS meeting
     (via scope or sharing), which is the other half of the route's gate. */
  const canViewHistory: boolean | null = me === null ? null : !!me?.permissions?.meetings?.view
  /* POST /api/orders with a visit_id checks orders.create, and — when the
     meeting already carries an order, so the post is a re-punch — orders.edit
     as well. */
  const canCreateOrder =
    canWriteMeeting &&
    !!me?.permissions?.orders?.create && (!ctx.visit_order || !!me?.permissions?.orders?.edit)
  /* POST /api/deals checks deals.create; the stage and close routes check
     deals.edit, which is canEditDeals above. */
  const canCreateDeal = canWriteMeeting && !!me?.permissions?.deals?.create

  /*
   * §5.5's "a note … linked to a specific Deal or Order" — the meeting always
   * first, then only the Deals and Orders THIS viewer was actually given. The
   * list is built from what came back, so a target the viewer cannot reach is
   * never offered and the POST behind it can never 403.
   */
  const noteTargets: NoteTarget[] = [
    { kind: 'meeting', id: visit.id, label: 'This meeting' },
    ...ctx.deals.map(d => ({ kind: 'deal' as const, id: d.id, label: d.name })),
    ...[...ctx.draft_orders, ...ctx.recent_orders]
      /* An order can be in both lists; the same id twice would give the picker
         two identical options and React two children with one key. */
      .filter((o, i, all) => all.findIndex(x => x.id === o.id) === i)
      .map(o => ({
        kind: 'order' as const,
        id: o.id,
        label: `${fmtAmount(o.total_amount)} · ${fmtDate(o.order_date)}`,
      })),
  ]

  function replaceDeal(updated: MeetingDeal) {
    setCtx(prev =>
      prev ? { ...prev, deals: prev.deals.map(d => (d.id === updated.id ? updated : d)) } : prev
    )
  }

  function setDiscussed(dealId: string, discussed: boolean) {
    setCtx(prev => {
      if (!prev) return prev
      const ids = prev.discussed_deal_ids.filter(id => id !== dealId)
      return { ...prev, discussed_deal_ids: discussed ? [...ids, dealId] : ids }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Pinned. The negative margins pull it out to the scroll container's
          own padding so the bar spans the full width rather than floating
          inside a gutter.

          `-top-6`, not `top-0`: a sticky inset is measured from the scroll
          container's CONTENT edge, which the shell's 24px `p-6` pushes 24px
          down. With `top-0` the bar stopped 24px below the top bar and the
          Deals and Orders scrolled visibly through that strip above it.
          -24px cancels the padding, exactly as `-mt-6` does for the flow
          position, so the bar pins flush against the top bar. */}
      <header className="sticky -top-6 z-20 -mx-6 -mt-6 flex flex-col gap-2 border-b border-border-light bg-surface px-6 py-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/daily-activity?date=${day}`} />}>
                Daily Activity
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{visit.entity_name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {/* The party leads: largest, first. Status and metadata sit
                under it, smaller. */}
            <h1 className="truncate text-page-title font-medium text-text-primary">
              {company && company.can_open !== false ? (
                <Link
                  href={`/parties/companies/${company.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {visit.entity_name}
                </Link>
              ) : (
                visit.entity_name
              )}
            </h1>
            <p className="text-label text-text-secondary">
              {visit.visit_type} · {fmtDate(day)}
              {visit.start_time ? ` · ${fmtTime(visit.start_time)}` : ''}
              {visit.duration_secs ? ` · ${formatDuration(visit.duration_secs)}` : ''}
              {visit.users ? ` · ${visit.users.name}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                visit.status === 'Active'
                  ? 'warning'
                  : visit.status === 'Completed'
                    ? 'success'
                    : 'neutral'
              }
            >
              {visit.status}
            </Badge>
            {visit.is_manual_entry ? <Badge>Entered by hand</Badge> : null}
            {visit.location_flagged ? (
              <Badge variant="warning" className="gap-1">
                <MapPinIcon className="size-3" />
                Location differs
              </Badge>
            ) : null}
            {company && !company.is_complete ? (
              <Badge variant="warning" className="gap-1">
                <TriangleAlertIcon className="size-3" />
                Incomplete party
              </Badge>
            ) : null}
            {!canWriteMeeting ? (
              <Badge variant="neutral">Shared with you: view only</Badge>
            ) : null}
          </div>
        </div>

        {/* "Set next meeting" is ALWAYS available here, whatever the
            meeting's status — including Completed — but it is a write on
            THIS meeting, so a shared, read-only viewer gets it disabled with
            a reason rather than hidden (section 26). */}
        <div className="flex flex-wrap items-center gap-2 text-body text-text-secondary">
          {nextMeeting && (
            <span>
              Next meeting: {fmtDate(nextMeeting.due_date)}
              {nextMeeting.deal_name ? ` · ${nextMeeting.deal_name}` : ''}
            </span>
          )}
          <PermissionTooltip
            allowed={canWriteMeeting}
            reason="This meeting is shared with you to view only."
          >
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setNextMeetingOpen(true)}
              disabled={!canWriteMeeting}
            >
              <CalendarClockIcon />
              {nextMeeting ? 'Change next meeting' : 'Set next meeting'}
            </Button>
          </PermissionTooltip>
        </div>
      </header>

      {/*
        DOM order is the phone's reading order: this meeting's minutes (with
        earlier meetings now reachable from its own "Past notes" button), then
        Deals and Orders. On a wide screen the grid places them explicitly —
        the minutes in the right column spanning both rows so they stay sticky
        beside everything on the left.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
        <div className="flex flex-col gap-4 lg:col-span-2 lg:col-start-1 lg:row-start-1">
          {/*
            Attendees (§8, Stage 2). Edit gate matches `canWriteNotes` above
            exactly: the meeting must be the viewer's own (not reached only
            through sharing) AND their role carries `meetings.edit` — the
            same two conditions the new PATCH route itself re-checks, so a
            control shown here can never 403.
          */}
          <MeetingAttendeesSection visitId={visit.id} canEdit={canEditAttendees} />
        </div>

        <div className="lg:col-start-3 lg:row-span-2 lg:row-start-1">
          <div className="lg:sticky lg:top-28">
            <NotesSection
              visitId={visit.id}
              targets={noteTargets}
              canWrite={canWriteNotes}
              earlierNote={visit.notes}
              canViewHistory={canViewHistory}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2 lg:col-start-1 lg:row-start-2">
          <DealsSection
            visitId={visit.id}
            companyId={company?.id ?? null}
            /* The COMPANY's own name, not the visit's display name: since
               the meeting form learned to name the person met,
               `entity_name` can read "Ramesh Kumar · ACME Traders" and
               this prop labels a company. `entity_name` stays the
               fallback for a meeting with no linked party. */
            companyName={company?.name ?? visit.entity_name}
            deals={ctx.deals}
            openDealCount={ctx.open_deal_count}
            discussedIds={ctx.discussed_deal_ids}
            stages={stages}
            stagesLoaded={stagesLoaded}
            visible={ctx.deals_visible}
            canEditDeals={canEditDeals}
            canCreateDeal={canCreateDeal}
            canMarkDiscussed={canMarkDiscussed}
            onDealChanged={replaceDeal}
            onDiscussedChanged={setDiscussed}
            onCreate={() => setNewDeal(true)}
          />

          <OrdersSection
            visitId={visit.id}
            visitDate={day}
            companyId={company?.id ?? null}
            /* The company's own name — see DealsSection above. */
            companyName={company?.name ?? visit.entity_name}
            recentOrders={ctx.recent_orders}
            orderCount={ctx.order_count}
            draftOrders={ctx.draft_orders}
            visitOrder={ctx.visit_order}
            visible={ctx.orders_visible}
            canCreateOrder={canCreateOrder}
            partyComplete={company?.is_complete ?? true}
            partyMissing={company?.completeness_missing ?? null}
            onSaved={load}
          />
        </div>
      </div>

      {nextMeetingOpen && (
        <NextMeetingDialog
          visitId={visit.id}
          mode="manage"
          onClose={() => setNextMeetingOpen(false)}
          onSaved={loadNextMeeting}
        />
      )}

      {newDeal && company ? (
        <NewDealDialog
          companyId={company.id}
          companyName={company.name}
          stages={stages}
          onClose={() => setNewDeal(false)}
          onCreated={load}
        />
      ) : null}
    </div>
  )
}
