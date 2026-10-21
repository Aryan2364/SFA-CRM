'use client'

/**
 * Phone sections of "Inside a meeting" (FRONTEND_RULES_PHONE.md §41.6): the
 * parts a rep uses DURING and right after a visit, which desktop already has
 * on `meeting/[id]/page.tsx`.
 *
 *   PhoneMeetingAttendees  desktop's MeetingAttendeesSection, same routes
 *   PhoneMeetingDeals      desktop's DealsSection: stage, discussed, new
 *   PhoneMeetingOrder      the order taken at this visit, or the way to take one
 *   PhonePastNotes         desktop's Past notes, in a bottom sheet
 *
 * Every write goes through the route desktop calls, and every control is
 * gated on the permission that route checks. Nothing here is a bottom action
 * bar button: the bar stays Add note / Start-Stop (§41.6 rule 8).
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronRightIcon, HistoryIcon, PlusIcon, ReceiptTextIcon, StarIcon, UserPlusIcon, XIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Badge } from '@/components/ui/badge'
import { BottomSheet, BottomSheetOption } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ChoiceRow } from '@/components/ui/choice-row'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { PickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { moveDealStage, openStagesOf, type StageOption } from '@/components/deals/deal-status'
import { setDealDiscussed } from '@/components/meeting/deal-actions'
import { NewDealDialog } from '@/components/meeting/new-deal-dialog'
import { PastMeetingRow, type PastHistory } from '@/components/meeting/notes-section'
import type { MeetingCompany, MeetingDeal, VisitOrder } from '@/components/meeting/types'
import { fmtAmount, fmtDate } from '@/lib/format'

const TIMEOUT_MS = 15_000

const heading = 'text-label text-text-secondary'
const card = 'flex flex-col gap-2 rounded-lg border border-border-light bg-surface p-3'

/* ───────────────────────────── Who was there ───────────────────────────── */

type AttendeeRow = { id: string; contact_id: string; name: string; is_main: boolean }

const ATTENDEE_REASON =
  'Only the person who logged this meeting, or someone who can edit meetings, can change its attendees'

/**
 * `canEdit`: null while /me has not answered (disabled, no reason), false
 * (disabled + reason), true. A meeting reached only through sharing answers
 * the attendees route 404, so the section is left out, as on desktop.
 */
export function PhoneMeetingAttendees({
  visitId,
  companyId,
  canEdit,
}: {
  visitId: string
  companyId: string | null
  canEdit: boolean | null
}) {
  const { toast } = useToast()
  const [rows, setRows] = useState<AttendeeRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'hidden'>('loading')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/daily-activity/${visitId}/attendees`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (r.status === 404) return setState('hidden')
      if (!r.ok) return setState('error')
      const d = (await r.json()) as { attendees?: AttendeeRow[] }
      setRows(d.attendees ?? [])
      setState('ready')
    } catch {
      setState('error')
    }
  }, [visitId])

  useEffect(() => {
    setState('loading')
    void load()
  }, [load])

  async function save(next: { contact_id: string; is_main: boolean }[]) {
    setBusy(true)
    try {
      const r = await fetch(`/api/daily-activity/${visitId}/attendees`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees: next }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast(d.error || 'Could not update attendees', 'error')
        void load()
        return
      }
      setRows(d.attendees ?? [])
    } catch {
      toast('The connection dropped. Attendees were not saved.', 'error')
      void load()
    } finally {
      setBusy(false)
    }
  }

  const plain = (list: AttendeeRow[]) => list.map(r => ({ contact_id: r.contact_id, is_main: r.is_main }))

  function addContact(contactId: string, name: string) {
    if (rows.some(r => r.contact_id === contactId)) return
    const next = [...plain(rows), { contact_id: contactId, is_main: rows.length === 0 }]
    // Optimistic, so the name shows while the PATCH lands.
    setRows(prev => [...prev, { id: contactId, contact_id: contactId, name, is_main: prev.length === 0 }])
    void save(next)
  }

  function remove(contactId: string) {
    void save(plain(rows.filter(r => r.contact_id !== contactId)))
  }

  function makeMain(contactId: string) {
    void save(rows.map(r => ({ contact_id: r.contact_id, is_main: r.contact_id === contactId })))
  }

  /* The account's own linked people first (the likely ones), then the
     caller's contacts, as the Log meeting form does. */
  const fetchOptions = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      const needle = q.trim().toLowerCase()
      const have = new Set(rows.map(r => r.contact_id))
      const out: PickerOption[] = []
      if (companyId) {
        try {
          const lr = await fetch(`/api/companies/${companyId}/links`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
          if (lr.ok) {
            const links = (await lr.json()) as { contact_id: string; contact_name: string | null; is_active: boolean }[]
            for (const l of links) {
              const name = l.contact_name ?? ''
              if (!l.is_active || !name || have.has(l.contact_id)) continue
              if (needle && !name.toLowerCase().includes(needle)) continue
              out.push({ id: l.contact_id, label: name, sublabel: 'Linked to this account' })
            }
          }
        } catch {
          /* The contact search below still works. */
        }
      }
      const r = await fetch(`/api/contacts?mine=1&q=${encodeURIComponent(q.trim())}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!r.ok) throw new Error(String(r.status))
      const d = await r.json()
      const list = (Array.isArray(d) ? d : d.rows ?? []) as { id: string; name: string }[]
      const seen = new Set(out.map(o => o.id))
      for (const c of list) {
        if (have.has(c.id) || seen.has(c.id)) continue
        out.push({ id: c.id, label: c.name })
      }
      return out
    },
    [rows, companyId]
  )

  if (state === 'hidden') return null

  const known = canEdit !== null
  const editable = canEdit === true

  return (
    <section className="flex flex-col gap-2">
      <p className={heading}>Who was there</p>
      <div className={card}>
        {state === 'loading' ? (
          <Skeleton className="h-12 w-full" />
        ) : state === 'error' ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-body text-text-primary">Couldn&apos;t load who was there.</p>
            <Button variant="secondary" size="sm" onClick={() => { setState('loading'); void load() }}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="text-body text-text-secondary">No one recorded yet. Add who you met.</p>
            ) : (
              <ul className="flex flex-col">
                {rows.map(r => (
                  <li key={r.contact_id} className="flex items-center gap-1 border-b border-border-light last:border-b-0">
                    <PermissionTooltip allowed={!known || editable} reason={ATTENDEE_REASON}>
                      <button
                        type="button"
                        className="flex size-11 shrink-0 items-center justify-center text-text-muted disabled:pointer-events-none disabled:opacity-40"
                        onClick={() => makeMain(r.contact_id)}
                        disabled={!editable || busy}
                        aria-label={r.is_main ? `${r.name} is the main person` : `Mark ${r.name} as the main person`}
                      >
                        <StarIcon className={r.is_main ? 'size-5 fill-warning text-warning' : 'size-5'} />
                      </button>
                    </PermissionTooltip>
                    <span className="min-w-0 flex-1 break-words text-body text-text-primary">
                      {r.name}
                      {r.is_main ? <span className="ml-2 text-meta text-text-secondary">Main person</span> : null}
                    </span>
                    <PermissionTooltip allowed={!known || editable} reason={ATTENDEE_REASON}>
                      <button
                        type="button"
                        className="flex size-11 shrink-0 items-center justify-center text-text-muted disabled:pointer-events-none disabled:opacity-40"
                        onClick={() => remove(r.contact_id)}
                        disabled={!editable || busy}
                        aria-label={`Remove ${r.name}`}
                      >
                        <XIcon className="size-5" />
                      </button>
                    </PermissionTooltip>
                  </li>
                ))}
              </ul>
            )}
            {editable ? (
              <PickerSheetField
                label="Add person"
                placeholder="Add someone who was there"
                value={null}
                onChange={o => addContact(o.id, o.label)}
                fetchOptions={fetchOptions}
                disabled={busy}
              />
            ) : (
              <PermissionTooltip allowed={known ? false : undefined} reason={ATTENDEE_REASON}>
                <Button variant="secondary" disabled>
                  <UserPlusIcon />
                  Add person
                </Button>
              </PermissionTooltip>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/* ───────────────────────────── Opportunities ───────────────────────────── */

export function PhoneMeetingDeals({
  visitId,
  company,
  companyName,
  deals,
  openDealCount,
  discussedIds,
  visible,
  canEditDeals,
  canCreateDeal,
  canMarkDiscussed,
  canWriteMeeting,
  onDealChanged,
  onDiscussedChanged,
  onReload,
}: {
  visitId: string
  company: MeetingCompany | null
  companyName: string
  deals: MeetingDeal[]
  openDealCount: number
  discussedIds: string[]
  visible: boolean
  canEditDeals: boolean | null
  canCreateDeal: boolean | null
  canMarkDiscussed: boolean
  /** False for a meeting shared view-only: the reason for any disabled control. */
  canWriteMeeting: boolean
  onDealChanged: (deal: MeetingDeal) => void
  onDiscussedChanged: (dealId: string, discussed: boolean) => void
  onReload: () => void
}) {
  const { toast } = useToast()
  const [stages, setStages] = useState<StageOption[]>([])
  const [stagesLoaded, setStagesLoaded] = useState(false)
  const [stageFor, setStageFor] = useState<MeetingDeal | null>(null)
  const [newDeal, setNewDeal] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  /* The stage master, read only for someone who can move a stage or open a
     deal (the New opportunity form picks its first stage from it). */
  const needsStages = canEditDeals === true || canCreateDeal === true
  useEffect(() => {
    if (!needsStages) return
    let cancelled = false
    fetch('/api/deals/stages', { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then(async r => {
        if (cancelled || !r.ok) return
        const d = await r.json()
        setStages(Array.isArray(d) ? d : [])
        setStagesLoaded(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [needsStages])

  const discussed = new Set(discussedIds)
  const open = openStagesOf(stages)
  const editReason = canWriteMeeting
    ? 'Only someone who can edit opportunities can change a stage.'
    : 'This meeting is shared with you to view only.'
  const createReason = canWriteMeeting
    ? 'Only someone who can create opportunities can add one.'
    : 'This meeting is shared with you to view only.'

  async function pickStage(deal: MeetingDeal, target: StageOption) {
    setBusy(deal.id)
    await moveDealStage(
      { id: deal.id, name: deal.name, outcome: null, stage: deal.deal_stages ? { id: deal.deal_stages.id, name: deal.deal_stages.name } : null },
      target,
      row => {
        /* The stage route returns the deal through shapeDeal(): `stage`, not
           `deal_stages`. Map the one field that moved back, as desktop does. */
        const stage = (row.stage ?? null) as { id: string; name: string } | null
        onDealChanged({
          ...deal,
          deal_stage_id: stage?.id ?? target.id,
          deal_stages: stage
            ? { ...stage, sort_order: deal.deal_stages?.sort_order ?? 0 }
            : { id: target.id, name: target.name, sort_order: deal.deal_stages?.sort_order ?? 0 },
          stage_entered_at: (row.stage_entered_at as string | undefined) ?? new Date().toISOString(),
        })
      }
    )
    setBusy(null)
  }

  async function toggle(deal: MeetingDeal, next: boolean) {
    setBusy(deal.id)
    onDiscussedChanged(deal.id, next)
    const failure = await setDealDiscussed(visitId, deal.id, next)
    if (failure) {
      onDiscussedChanged(deal.id, !next)
      toast(failure, 'error')
    }
    setBusy(null)
  }

  const hidden = openDealCount - deals.length

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className={heading}>
          Opportunities
          {visible && openDealCount > 0 ? ` · ${discussed.size} discussed` : ''}
        </p>
        {visible && company ? (
          <PermissionTooltip allowed={canCreateDeal === null ? undefined : canCreateDeal && canWriteMeeting} reason={createReason}>
            <Button
              size="sm"
              variant="secondary"
              disabled={!(canCreateDeal === true && canWriteMeeting) || !stagesLoaded}
              onClick={() => setNewDeal(true)}
            >
              <PlusIcon />
              New opportunity
            </Button>
          </PermissionTooltip>
        ) : null}
      </div>

      {!visible ? (
        <p className="rounded-lg bg-surface-sunken p-3 text-body text-text-secondary">
          Opportunities are not part of your access.
        </p>
      ) : !company ? (
        <p className="rounded-lg bg-surface-sunken p-3 text-body text-text-secondary">
          This meeting is not linked to a saved account, so there is no pipeline to show.
        </p>
      ) : deals.length === 0 ? (
        <p className="rounded-lg bg-surface-sunken p-3 text-body text-text-secondary">
          No open opportunities at {companyName}.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {deals.map(deal => (
            <li key={deal.id} className={card}>
              <Link
                href={`/deals/${deal.id}`}
                className="flex min-h-11 items-center break-words text-body font-medium text-text-primary"
              >
                {deal.name}
              </Link>
              <p className="text-label text-text-secondary">
                {fmtAmount(deal.expected_value)} · {deal.probability}%
                {deal.expected_close_date ? ` · closes ${fmtDate(deal.expected_close_date)}` : ''}
              </p>

              {canEditDeals === true && canWriteMeeting && stages.length > 0 ? (
                <button
                  type="button"
                  disabled={busy === deal.id}
                  onClick={() => setStageFor(deal)}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border-light bg-surface px-3 text-left active:bg-surface-control disabled:opacity-60"
                  aria-label={`Change stage of ${deal.name}`}
                >
                  <span className="min-w-0">
                    <span className="block text-meta text-text-secondary">Stage</span>
                    <span className="block text-body text-text-primary">{deal.deal_stages?.name ?? 'Set a stage'}</span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-text-muted" aria-hidden />
                </button>
              ) : (
                <div className="flex min-h-11 items-center gap-2">
                  <span className="text-meta text-text-secondary">Stage</span>
                  <PermissionTooltip allowed={canEditDeals === null ? undefined : canEditDeals && canWriteMeeting} reason={editReason}>
                    <Badge>{deal.deal_stages?.name ?? 'No stage'}</Badge>
                  </PermissionTooltip>
                </div>
              )}

              {canMarkDiscussed ? (
                <ChoiceRow
                  control={
                    <Checkbox
                      checked={discussed.has(deal.id)}
                      disabled={busy === deal.id}
                      onCheckedChange={v => void toggle(deal, v === true)}
                    />
                  }
                  label="Discussed in this meeting"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {visible && company && hidden > 0 ? (
        <p className="text-label text-text-secondary">
          Showing {deals.length} of {openDealCount} open opportunities.{' '}
          <Link href={`/deals?companyId=${company.id}`} className="text-primary underline underline-offset-2">
            See them all
          </Link>
        </p>
      ) : null}

      <BottomSheet
        open={!!stageFor}
        onOpenChange={o => { if (!o) setStageFor(null) }}
        title="Move to stage"
        description={stageFor?.name}
      >
        {open.length === 0 ? (
          <p className="px-3 py-3 text-body text-text-secondary">
            No stages are set up. Ask someone who manages Opportunity Stages.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {open.map(stage => {
              const current = stageFor?.deal_stage_id === stage.id
              return (
                <BottomSheetOption
                  key={stage.id}
                  selected={current}
                  disabled={current}
                  onSelect={() => {
                    const deal = stageFor
                    setStageFor(null)
                    if (deal) void pickStage(deal, stage)
                  }}
                >
                  {stage.name}
                </BottomSheetOption>
              )
            })}
          </div>
        )}
      </BottomSheet>

      {newDeal && company ? (
        <NewDealDialog
          companyId={company.id}
          companyName={company.name}
          stages={stages.map((s, i) => ({ id: s.id, name: s.name, sort_order: i }))}
          onClose={() => setNewDeal(false)}
          onCreated={onReload}
        />
      ) : null}
    </section>
  )
}

/* ──────────────────────────────── Order ──────────────────────────────── */

export function PhoneMeetingOrder({
  visitId,
  company,
  companyName,
  visible,
  visitOrder,
  orderCount,
  canCreateOrder,
  canWriteMeeting,
}: {
  visitId: string
  company: MeetingCompany | null
  companyName: string
  visible: boolean
  visitOrder: VisitOrder | null
  orderCount: number
  /** null while /me has not answered. */
  canCreateOrder: boolean | null
  canWriteMeeting: boolean
}) {
  const router = useRouter()
  const reason = canWriteMeeting
    ? 'Only someone who can create orders can take one.'
    : 'This meeting is shared with you to view only.'

  return (
    <section className="flex flex-col gap-2">
      <p className={heading}>Order</p>
      {!visible ? (
        <p className="rounded-lg bg-surface-sunken p-3 text-body text-text-secondary">
          Orders are not part of your access.
        </p>
      ) : (
        <div className={card}>
          {visitOrder ? (
            <Link
              href={`/orders/${visitOrder.id}`}
              className="flex min-h-11 items-center justify-between gap-3 active:bg-surface-control"
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-body font-medium text-text-primary">{fmtAmount(visitOrder.total_amount)}</span>
                  <Badge variant={visitOrder.status === 'Placed' ? 'success' : 'warning'}>{visitOrder.status}</Badge>
                </span>
                <span className="block text-label text-text-secondary">
                  Taken in this meeting · {visitOrder.order_items.length}{' '}
                  {visitOrder.order_items.length === 1 ? 'line' : 'lines'}
                </span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-text-muted" aria-hidden />
            </Link>
          ) : (
            <>
              <p className="text-body text-text-secondary">No order taken in this meeting yet.</p>
              {company && !company.is_complete ? (
                <p className="text-label text-warning">
                  {companyName} is an incomplete record
                  {company.completeness_missing ? `: ${company.completeness_missing}` : ''}. An order taken now stays a
                  Draft until those details are filled in.
                </p>
              ) : null}
              <PermissionTooltip
                allowed={canCreateOrder === null ? undefined : canCreateOrder && canWriteMeeting}
                reason={reason}
              >
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={!(canCreateOrder === true && canWriteMeeting)}
                  onClick={() => router.push(`/orders/new?visit=${visitId}`)}
                >
                  <ReceiptTextIcon />
                  Take an order
                </Button>
              </PermissionTooltip>
            </>
          )}
          {company && orderCount > 0 ? (
            <Link
              href={`/orders?entityId=${company.id}`}
              className="flex min-h-11 items-center justify-between gap-3 border-t border-border-light pt-2 text-body text-text-primary"
            >
              Orders at {companyName} · {orderCount}
              <ChevronRightIcon className="size-4 shrink-0 text-text-muted" aria-hidden />
            </Link>
          ) : null}
        </div>
      )}
    </section>
  )
}

/* ─────────────────────────────── Past notes ─────────────────────────────── */

/** "Past notes · N" row; opens earlier meetings with this account in a sheet. */
export function PhonePastNotes({ visitId, canView }: { visitId: string; canView: boolean | null }) {
  const { toast } = useToast()
  const [history, setHistory] = useState<PastHistory | null>(null)
  const [failed, setFailed] = useState(false)
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState(false)

  // Another meeting opened from inside the sheet: this page stays mounted.
  useEffect(() => { setOpen(false); setHistory(null) }, [visitId])

  const fetchPage = useCallback(async (offset: number): Promise<PastHistory> => {
    const r = await fetch(`/api/daily-activity/${visitId}/history?offset=${offset}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  }, [visitId])

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setHistory(await fetchPage(0))
    } catch {
      setFailed(true)
    }
  }, [fetchPage])

  useEffect(() => { if (canView) void load() }, [canView, load])

  async function older() {
    if (!history || history.next_offset === null) return
    setMore(true)
    try {
      const page = await fetchPage(history.next_offset)
      setHistory(prev =>
        prev ? { ...page, items: [...prev.items, ...page.items.filter(p => !prev.items.some(i => i.id === p.id))] } : page
      )
    } catch {
      toast('Could not load older meetings. Try again.', 'error')
    }
    setMore(false)
  }

  const count = history?.total ?? 0

  return (
    <>
      <PermissionTooltip
        allowed={canView === null ? undefined : canView}
        reason="Only someone who can view meetings may see past notes."
      >
        <button
          type="button"
          disabled={!canView}
          onClick={() => setOpen(true)}
          className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border-light bg-surface px-3 text-left active:bg-surface-control disabled:opacity-60"
        >
          <span className="flex items-center gap-2 text-body text-text-primary">
            <HistoryIcon className="size-4 text-text-muted" aria-hidden />
            Past notes{history ? ` · ${count}` : ''}
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-text-muted" aria-hidden />
        </button>
      </PermissionTooltip>

      <BottomSheet open={open} onOpenChange={setOpen} title={`Past notes${history ? ` (${count})` : ''}`}>
        {failed ? (
          <div className="flex flex-col items-start gap-2 p-3">
            <p className="text-body text-text-primary">Couldn&apos;t load past notes.</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button>
          </div>
        ) : history === null ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : history.items.length === 0 ? (
          <p className="p-3 text-center text-body text-text-secondary">No earlier meetings with this account yet.</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border-light">
              {history.items.map(m => (
                <PastMeetingRow key={m.id} meeting={m} />
              ))}
            </ul>
            {history.next_offset !== null ? (
              <Button variant="secondary" className="mt-3 w-full" onClick={() => void older()} disabled={more}>
                {more ? 'Loading…' : `Show older (${history.total - history.items.length} more)`}
              </Button>
            ) : null}
          </>
        )}
      </BottomSheet>
    </>
  )
}
