'use client'

/**
 * Changing an opportunity's stage, and closing it Won or Lost — from the
 * record's header and from a list row. The board's drag and the meeting page
 * were the only two ways before, and neither exists on a phone (the board is
 * not offered below 768px, section 35.3) — so a rep in the field had no way to
 * move an opportunity at all.
 *
 * ONE MENU, TWO PLACES. `DealStatusMenu` is the three-dot menu of section 11.2
 * (record header: "everything else") and section 11.1.2 (list row actions).
 * It holds the stages as a "Move to" group, the same shape as the board
 * card's own menu, so the three ways to move a card read alike.
 *
 * THE RULES ARE THE ROUTES'. Every control here is gated on `deals.edit`,
 * because that is what all three routes it calls check:
 *
 *   PATCH /api/deals/[id]/stage  — the move, with its stage log
 *   POST  /api/deals/[id]/close  — Won/Lost; Lost needs a Reason for Loss
 *   PUT   /api/deals/[id]        — Edit (the caller's dialog)
 *
 * WHAT IS REVERSIBLE. A stage move is a status change, so it happens at once
 * with an Undo toast and no confirmation (section 38.1). Closing is NOT
 * reversible: no route can clear an outcome, so there is no Reopen yet. That
 * is why Won and Lost go through a dialog that says so — an action that cannot
 * be undone must not look like one that can.
 *
 * A CLOSED OPPORTUNITY keeps Edit (the PUT does not consult the outcome) but
 * its stage no longer moves: the stage route would accept the move and leave
 * the outcome behind, and a Won opportunity sitting in "Negotiation" is a
 * contradiction nobody could read back.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckIcon, EllipsisIcon, PencilIcon, ThumbsDownIcon, TrophyIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Label } from '@/components/ui/label'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from '@/components/ui/sonner'

/** A row of `GET /api/deals/stages`. `stage_type` is null while unavailable. */
export type StageOption = { id: string; name: string; stage_type?: 'Open' | 'Closed' | null }

export type DealOutcome = 'won' | 'lost'

/** The least of an opportunity this file needs, on the list and the detail alike. */
export type DealStatusTarget = {
  id: string
  name: string
  outcome: string | null
  stage: { id: string; name: string } | null
}

/** Section 26.2: the reason names who may, never a role. */
export const EDIT_REASON = 'Only someone who can edit opportunities can do this.'

/** Section 14 rule 4: every request carries a deadline, like the board's move. */
const REQUEST_TIMEOUT_MS = 15000

async function send(url: string, init: RequestInit): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: abort.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function errorText(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error ?? fallback
}

async function patchStage(dealId: string, stageId: string): Promise<Response> {
  return send(`/api/deals/${dealId}/stage`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deal_stage_id: stageId }),
  })
}

/** Stages a deal may be MOVED into. Closed stages are reached by closing it. */
export function openStagesOf(stages: StageOption[]): StageOption[] {
  return stages.filter(s => s.stage_type !== 'Closed')
}

export function closedStagesOf(stages: StageOption[]): StageOption[] {
  return stages.filter(s => s.stage_type === 'Closed')
}

/**
 * The move, with section 38.1's Undo. Undo is a second PATCH back to where the
 * opportunity stood, so both moves are in its stage history, as that section
 * asks. An opportunity that had no stage has nothing to go back to — the
 * stage route cannot set "no stage" — so that move gets a plain confirmation.
 *
 * `onChanged` receives the route's shaped row each time it lands.
 */
export async function moveDealStage(
  deal: DealStatusTarget,
  target: StageOption,
  onChanged: (row: Record<string, unknown>) => void
): Promise<void> {
  const previous = deal.stage
  let res: Response
  try {
    res = await patchStage(deal.id, target.id)
  } catch {
    toast.error('The connection dropped. The stage was not changed.')
    return
  }
  if (!res.ok) {
    toast.error(await errorText(res, 'The stage could not be changed. Nothing was saved.'))
    return
  }
  onChanged((await res.json()) as Record<string, unknown>)

  if (!previous || previous.id === target.id) {
    toast.success(`${deal.name} moved to ${target.name}`)
    return
  }
  toast.undo(`${deal.name} moved to ${target.name}`, async () => {
    let back: Response
    try {
      back = await patchStage(deal.id, previous.id)
    } catch {
      toast.error(`The connection dropped. ${deal.name} is still in ${target.name}.`)
      return
    }
    if (!back.ok) {
      toast.error(await errorText(back, `${deal.name} could not be moved back. It is still in ${target.name}.`))
      return
    }
    onChanged((await back.json()) as Record<string, unknown>)
    toast.success(`${deal.name} moved back to ${previous.name}`)
  })
}

/** Section 9 / 41: menu rows reach 44px on a phone. */
const ITEM = 'max-sm:h-11'

/**
 * The three-dot menu. `canEdit` is section 26.1's three values: `null` while
 * `/api/auth/me` has not answered (disabled, no reason), `false` (disabled
 * with the reason, on a focusable wrapper), `true`.
 */
export function DealStatusMenu({
  deal,
  stages,
  stagesLoaded,
  canEdit,
  canSetUpStages,
  onMove,
  onCloseRequest,
  onEdit,
  align = 'end',
  reason = EDIT_REASON,
}: {
  deal: DealStatusTarget
  stages: StageOption[]
  stagesLoaded: boolean
  canEdit: boolean | null
  canSetUpStages: boolean
  onMove: (target: StageOption) => void
  onCloseRequest: (outcome: DealOutcome) => void
  /** Present on a list row; the record header has its own Edit button. */
  onEdit?: () => void
  align?: 'start' | 'end'
  /** The disabled reason. A record rule (a view-only share) overrides the
      permission sentence; defaults to EDIT_REASON. */
  reason?: string
}) {
  const open = openStagesOf(stages)
  const closed = deal.outcome === 'won' || deal.outcome === 'lost'

  return (
    <PermissionTooltip allowed={canEdit !== false} reason={reason}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="max-sm:size-11"
              disabled={canEdit !== true}
              aria-label={`Actions for ${deal.name}`}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-64">
          {onEdit && (
            <>
              <DropdownMenuItem className={ITEM} onClick={onEdit}>
                <PencilIcon />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* A GroupLabel THROWS without a Group above it — see dropdown-menu.tsx. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {closed
                ? `Closed as ${deal.outcome === 'won' ? 'won' : 'lost'}, so its stage no longer changes`
                : 'Move to'}
            </DropdownMenuLabel>
            {!stagesLoaded ? (
              <DropdownMenuItem className={ITEM} disabled>
                Loading stages…
              </DropdownMenuItem>
            ) : open.length === 0 ? (
              /* Never an empty group: say why, and where stages come from. */
              canSetUpStages ? (
                <DropdownMenuItem className={ITEM} render={<Link href="/masters/lead-stages" />}>
                  Set up opportunity stages
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className={`${ITEM} h-auto min-h-control py-2 whitespace-normal`} disabled>
                  No stages are set up. Ask someone who manages Opportunity Stages.
                </DropdownMenuItem>
              )
            ) : (
              open.map(stage => {
                const current = deal.stage?.id === stage.id
                return (
                  <DropdownMenuItem
                    key={stage.id}
                    className={ITEM}
                    disabled={closed || current}
                    onClick={() => onMove(stage)}
                  >
                    <span className="min-w-0 flex-1 truncate">{stage.name}</span>
                    {current && <CheckIcon aria-label="Current stage" />}
                  </DropdownMenuItem>
                )
              })
            )}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuItem className={ITEM} disabled={closed} onClick={() => onCloseRequest('won')}>
            <TrophyIcon />
            Mark as won
          </DropdownMenuItem>
          <DropdownMenuItem className={ITEM} disabled={closed} onClick={() => onCloseRequest('lost')}>
            <ThumbsDownIcon />
            Mark as lost
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PermissionTooltip>
  )
}

type Reason = { id: string; name: string }

/** The closed stage a Won or Lost close lands in by default: one named for it. */
function defaultClosedStage(closedStages: StageOption[], outcome: DealOutcome): string {
  const match = closedStages.find(s => s.name.trim().toLowerCase().includes(outcome))
  return (match ?? closedStages[0])?.id ?? ''
}

/**
 * Won or Lost (§4.6). Lost needs a Reason for Loss from the master — the route
 * refuses without one, so the form asks first. When the firm has marked stages
 * Closed, the route insists a closing opportunity lands in one of them, so the
 * stage is asked for too, defaulting to the one named "Won" or "Lost".
 *
 * Section 7.1: a problem with one field is an inline field error, never a toast.
 */
export function DealCloseDialog({
  deal,
  outcome,
  stages,
  onOpenChange,
  onClosed,
}: {
  /** The opportunity being closed; null when the dialog is shut. */
  deal: DealStatusTarget | null
  outcome: DealOutcome
  stages: StageOption[]
  onOpenChange: (open: boolean) => void
  onClosed: (row: Record<string, unknown>) => void
}) {
  const open = deal !== null
  const closedStages = closedStagesOf(stages)
  const [reasons, setReasons] = useState<Reason[] | null>(null)
  const [reasonId, setReasonId] = useState('')
  const [stageId, setStageId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  /* Reset on every open: a dialog that reopens holding the last answer would
     close the next opportunity with someone else's reason. */
  useEffect(() => {
    if (!open) return
    setReasonId('')
    setStageId(defaultClosedStage(closedStagesOf(stages), outcome))
    setErrors({})
    setSaving(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, outcome])

  useEffect(() => {
    if (!open || outcome !== 'lost') return
    let live = true
    setReasons(null)
    send('/api/masters/reason-for-loss?active=true', { method: 'GET' })
      .then(async r => (r.ok ? ((await r.json()) as Reason[]) : []))
      .then(rows => live && setReasons(Array.isArray(rows) ? rows : []))
      .catch(() => live && setReasons([]))
    return () => {
      live = false
    }
  }, [open, outcome])

  const noReasons = outcome === 'lost' && reasons !== null && reasons.length === 0
  const word = outcome === 'won' ? 'won' : 'lost'

  async function save() {
    if (!deal || saving) return
    const next: Record<string, string> = {}
    if (outcome === 'lost' && !reasonId) next.reason = 'Choose why this opportunity was lost.'
    if (closedStages.length > 0 && !stageId) next.stage = 'Choose the stage it closes in.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    let res: Response
    try {
      res = await send(`/api/deals/${deal.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome,
          ...(outcome === 'lost' ? { reason_for_loss_id: reasonId } : {}),
          ...(stageId ? { deal_stage_id: stageId } : {}),
        }),
      })
    } catch {
      setSaving(false)
      setErrors({ form: 'The connection dropped. Nothing has been saved.' })
      return
    }
    if (!res.ok) {
      setSaving(false)
      setErrors({ form: await errorText(res, `Could not mark this opportunity as ${word}.`) })
      return
    }
    const row = (await res.json()) as Record<string, unknown>
    setSaving(false)
    onClosed(row)
    onOpenChange(false)
    toast.success(`${deal.name} marked as ${word}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Mark as {word}?</DialogTitle>
          <DialogDescription>
            {deal?.name} will be closed as {word} today. A closed opportunity cannot be reopened, so
            check this before you save.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {outcome === 'lost' && (
            <div>
              <Label htmlFor="dc-reason" required>Reason for loss</Label>
              {noReasons ? (
                <p className="mt-1.5 text-body text-text-secondary">
                  No reasons for loss are set up, and one is required to mark an opportunity lost. They
                  are added under Masters › Reason for Loss.
                </p>
              ) : (
                <SearchableSelect
                  id="dc-reason"
                  className="mt-1.5"
                  options={Object.fromEntries((reasons ?? []).map(r => [r.id, r.name]))}
                  value={reasonId}
                  onValueChange={value => {
                    setReasonId(value)
                    setErrors(({ reason: _cleared, form: _form, ...rest }) => rest)
                  }}
                  placeholder={reasons === null ? 'Loading reasons…' : 'Choose a reason'}
                  disabled={reasons === null}
                />
              )}
              <InlineFieldError>{errors.reason}</InlineFieldError>
            </div>
          )}

          {closedStages.length > 0 && (
            <div>
              <Label htmlFor="dc-stage" required>Closes in stage</Label>
              <SearchableSelect
                id="dc-stage"
                className="mt-1.5"
                options={Object.fromEntries(closedStages.map(s => [s.id, s.name]))}
                value={stageId}
                onValueChange={value => {
                  setStageId(value)
                  setErrors(({ stage: _cleared, form: _form, ...rest }) => rest)
                }}
                placeholder="Choose a stage"
              />
              <InlineFieldError>{errors.stage}</InlineFieldError>
            </div>
          )}

          {errors.form ? <InlineFieldError>{errors.form}</InlineFieldError> : null}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button onClick={save} disabled={saving || noReasons}>
            {saving ? 'Saving…' : `Mark as ${word}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
