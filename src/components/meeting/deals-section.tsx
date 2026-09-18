'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PlusIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fmtAmount, fmtDate } from '@/lib/format'
import type { MeetingDeal, NamedRef } from './types'

/**
 * §5.5 — the Company's **open Deals**, which of them were discussed, and the
 * Deal Stage changed without leaving the meeting.
 *
 * ---------------------------------------------------------------------------
 * THE STAGE CHANGE GOES THROUGH `PATCH /api/deals/[id]/stage`, NOT A NEW ROUTE
 *
 * That route does THREE writes in one transaction: the new stage, a
 * `deal_stage_logs` row naming who moved it and how long it stood in the stage
 * it left, and the `stage_entered_at` reset that restarts the §4.7 ageing
 * clock. A second path that only wrote `deals.deal_stage_id` would look
 * identical on this screen and be wrong in two invisible ways — the Deal's
 * history would have a hole in it exactly where a rep moved it from a meeting,
 * and the ageing badge would measure from the wrong moment. Neither throws, and
 * neither is noticed until somebody reads the Logs tab weeks later.
 *
 * The route answers with the updated Deal, and that answer replaces the row in
 * place. The list is never re-fetched and the row is never removed and
 * re-added: the user is looking at it while they change it.
 *
 * ---------------------------------------------------------------------------
 * "ALL, ONE, OR NONE" IS A TICK BOX PER DEAL
 *
 * Not a multi-select, and not a "save" button. §5.5's three cases are just the
 * three counts a column of tick boxes already produces, and a tick that writes
 * immediately means there is no half-marked state to lose when somebody's
 * phone locks mid-meeting.
 */
export function DealsSection({
  visitId,
  companyId,
  companyName,
  deals,
  openDealCount,
  discussedIds,
  stages,
  visible,
  canEditDeals,
  canCreateDeal,
  canMarkDiscussed,
  onDealChanged,
  onDiscussedChanged,
  onCreate,
}: {
  visitId: string
  companyId: string | null
  companyName: string
  deals: MeetingDeal[]
  openDealCount: number
  discussedIds: string[]
  stages: (NamedRef & { sort_order: number })[]
  visible: boolean
  canEditDeals: boolean
  canCreateDeal: boolean
  canMarkDiscussed: boolean
  onDealChanged: (deal: MeetingDeal) => void
  onDiscussedChanged: (dealId: string, discussed: boolean) => void
  onCreate: () => void
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  async function changeStage(deal: MeetingDeal, stageId: string) {
    if (stageId === deal.deal_stage_id) return
    setBusy(deal.id)
    const r = await fetch(`/api/deals/${deal.id}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_stage_id: stageId }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      toast(err.error ?? 'Could not change the stage', 'error')
      setBusy(null)
      return
    }
    const updated = await r.json()
    /*
     * The stage route returns the Deal through `shapeDeal()`, which renames the
     * relations — `stage`, not `deal_stages`. This screen's rows carry the
     * Prisma spelling, so the one field that moved is mapped back rather than
     * the whole row being replaced with a differently-shaped object. Getting
     * this wrong renders an empty stage name with no error anywhere.
     */
    onDealChanged({
      ...deal,
      deal_stage_id: updated.stage?.id ?? stageId,
      deal_stages: updated.stage
        ? { ...updated.stage, sort_order: deal.deal_stages?.sort_order ?? 0 }
        : (stages.find(s => s.id === stageId) ?? null),
      stage_entered_at: updated.stage_entered_at ?? new Date().toISOString(),
    })
    setBusy(null)
    toast(`${deal.name} moved to ${updated.stage?.name ?? 'the new stage'}`)
  }

  async function toggleDiscussed(deal: MeetingDeal, next: boolean) {
    setBusy(deal.id)
    // Optimistic, then reconciled: a tick that waits for a round trip on a
    // phone in a shop reads as broken.
    onDiscussedChanged(deal.id, next)
    const r = next
      ? await fetch('/api/deal-meetings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visit_id: visitId, deal_id: deal.id }),
        })
      : await fetch(
          `/api/deal-meetings?visit_id=${visitId}&deal_id=${deal.id}`,
          { method: 'DELETE' }
        )
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      onDiscussedChanged(deal.id, !next)
      toast(err.error ?? 'Could not save that', 'error')
    }
    setBusy(null)
  }

  const discussed = new Set(discussedIds)
  const hidden = openDealCount - deals.length
  const stageLabels = Object.fromEntries(stages.map(s => [s.id, s.name]))

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Open deals
          {visible && openDealCount > 0 ? (
            <span className="ml-2 text-label font-normal text-text-secondary">
              {discussed.size} marked discussed
            </span>
          ) : null}
        </CardTitle>
        <CardAction>
          {canCreateDeal && companyId ? (
            <Button size="sm" variant="secondary" onClick={onCreate}>
              <PlusIcon />
              New deal
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {!visible ? (
          <p className="py-6 text-center text-body text-text-secondary">
            Deals are not part of your access. Ask an administrator if you need
            to see this company&rsquo;s pipeline.
          </p>
        ) : !companyId ? (
          <p className="py-6 text-center text-body text-text-secondary">
            This meeting is not linked to a saved company, so there is no
            pipeline to show. Save the party as a record to track deals against
            it.
          </p>
        ) : deals.length === 0 ? (
          <p className="py-6 text-center text-body text-text-secondary">
            No open deals at {companyName}.
            {canCreateDeal ? ' Start one from this meeting with New deal.' : ''}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {deals.map(deal => (
                <li
                  key={deal.id}
                  className="flex flex-col gap-3 rounded-lg border border-border-light p-3 sm:flex-row sm:items-center"
                >
                  {canMarkDiscussed ? (
                    <label className="flex min-h-11 items-center gap-3 sm:min-h-0">
                      <Checkbox
                        checked={discussed.has(deal.id)}
                        disabled={busy === deal.id}
                        onCheckedChange={v => toggleDiscussed(deal, v === true)}
                        aria-label={`Discussed ${deal.name} in this meeting`}
                      />
                      <span className="text-label text-text-secondary sm:hidden">
                        Discussed in this meeting
                      </span>
                    </label>
                  ) : null}

                  <div className="min-w-0 flex-1">
                    {/* The identifier leads: largest, first. Everything else
                        is metadata and sits under it, smaller. */}
                    {/* §5.6's Meeting → Deal link. `min-h-11` on a phone: a
                        22px line of text is not a tap target, and this is the
                        only route from the meeting into the Deal. The
                        constraint is dropped from `sm` up, where the pointer
                        is a mouse and the row should stay compact — the same
                        shape the Discussed checkbox above uses. */}
                    <Link
                      href={`/deals/${deal.id}`}
                      className="flex min-h-11 items-center truncate text-body font-medium text-text-primary underline-offset-2 hover:underline sm:min-h-0"
                    >
                      {deal.name}
                    </Link>
                    <p className="text-label text-text-secondary">
                      {fmtAmount(deal.expected_value)} · {deal.probability}%
                      {deal.expected_close_date
                        ? ` · closes ${fmtDate(deal.expected_close_date)}`
                        : ''}
                      {deal.users ? ` · ${deal.users.name}` : ''}
                    </p>
                  </div>

                  <div className="sm:w-48">
                    {canEditDeals && stages.length > 0 ? (
                      <Select
                        value={deal.deal_stage_id ?? ''}
                        disabled={busy === deal.id}
                        /* Without `items` the trigger renders the raw VALUE,
                           which here is a uuid. The map is what turns it back
                           into the stage's name. */
                        items={stageLabels}
                        onValueChange={v => changeStage(deal, String(v))}
                      >
                        <SelectTrigger className="w-full" aria-label={`Stage of ${deal.name}`}>
                          <SelectValue placeholder="Set a stage" />
                        </SelectTrigger>
                        <SelectContent>
                          {stages.map(s => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      /* A read-only role gets the fact, not a control that
                         would 403. */
                      <Badge>{deal.deal_stages?.name ?? 'No stage'}</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {hidden > 0 ? (
              <p className="text-label text-text-secondary">
                Showing {deals.length} of {openDealCount} open deals.{' '}
                <Link
                  href={`/deals?companyId=${companyId}`}
                  className="text-text-primary underline underline-offset-2"
                >
                  See them all
                </Link>
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
