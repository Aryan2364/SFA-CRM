'use client'

/**
 * Opportunity detail — phone (docs/phone-plan.md item 6, FRONTEND_RULES_PHONE
 * §41.6). RecordSummary carries the four key facts, related rows for
 * meetings / follow-ups / members are one tap away, and the action bar's
 * primary "Move to stage" / secondary "Log meeting" mirror the desktop
 * header's menu (`src/components/deals/deal-status.tsx`) rather than
 * re-implementing its rules.
 *
 * Reuses `moveDealStage` and `DealCloseDialog` from deal-status.tsx — not
 * duplicated here — so the stage-log/undo/close behaviour is byte-identical
 * to desktop's. Only the presentation is phone's own: "Move to stage" opens
 * a bottom sheet of the open stages (§41.8), and Mark won / Mark lost live
 * in the app bar's three-dot menu (§41.4 rule 4).
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EllipsisVerticalIcon, ThumbsDownIcon, TrophyIcon } from 'lucide-react'

import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { ActionBar } from '@/components/ui/action-bar'
import { RecordSummary } from '@/components/ui/record-summary'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { BottomSheet, BottomSheetOption } from '@/components/ui/bottom-sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMe } from '@/hooks/useMe'
import { EMPTY, fmtAmount, fmtDate } from '@/lib/format'
import {
  DealCloseDialog,
  EDIT_REASON,
  moveDealStage,
  openStagesOf,
  type DealOutcome,
  type StageOption,
} from '@/components/deals/deal-status'

type Deal = {
  id: string
  name: string
  expected_value: number
  expected_close_date: string | null
  outcome: string | null
  company: { id: string; name: string; type?: string | null } | null
  contact: { id: string; name: string } | null
  stage: { id: string; name: string } | null
  access?: 'owner-scope' | 'work' | 'view'
}

type RelatedCounts = { meetings: number; followUps: number; members: number }

const REQUEST_TIMEOUT_MS = 15000

async function fetchWithDeadline(url: string, init?: RequestInit): Promise<Response> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: abort.signal })
  } finally {
    clearTimeout(timer)
  }
}

const VIEW_ONLY_REASON = 'This opportunity is shared with you to view only.'

export function PhoneDealDetailPage({ id }: { id: string }) {
  const router = useRouter()
  const me = useMe()
  const [deal, setDeal] = useState<Deal | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [stages, setStages] = useState<StageOption[]>([])
  const [closing, setClosing] = useState<DealOutcome | null>(null)
  const [stageSheetOpen, setStageSheetOpen] = useState(false)
  const [logging, setLogging] = useState(false)
  const [related, setRelated] = useState<RelatedCounts>({ meetings: 0, followUps: 0, members: 0 })

  async function load() {
    setLoading(true)
    setFailed(false)
    try {
      const [dealRes, stagesRes] = await Promise.all([
        fetchWithDeadline(`/api/deals/${id}`),
        fetchWithDeadline('/api/deals/stages'),
      ])
      if (!dealRes.ok) throw new Error('failed')
      const row = (await dealRes.json()) as Deal
      setDeal(row)
      if (stagesRes.ok) setStages((await stagesRes.json()) as StageOption[])

      const [meetingsRes, followUpsRes, membersRes] = await Promise.all([
        fetchWithDeadline(`/api/deals/${id}/meetings`).catch(() => null),
        fetchWithDeadline(`/api/deals/${id}/follow-ups`).catch(() => null),
        fetchWithDeadline(`/api/deals/${id}/members`).catch(() => null),
      ])
      const meetings = meetingsRes && meetingsRes.ok ? ((await meetingsRes.json()) as unknown[]) : []
      const followUps = followUpsRes && followUpsRes.ok ? ((await followUpsRes.json()) as unknown[]) : []
      const members = membersRes && membersRes.ok ? ((await membersRes.json()) as unknown[]) : []
      setRelated({
        meetings: Array.isArray(meetings) ? meetings.length : 0,
        followUps: Array.isArray(followUps) ? followUps.length : 0,
        members: Array.isArray(members) ? members.length : 0,
      })
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const viewOnly = deal?.access === 'view'
  const canEdit: boolean | null = viewOnly ? false : me ? Boolean(me.permissions?.deals?.edit) : null
  const editReason = viewOnly ? VIEW_ONLY_REASON : EDIT_REASON
  const canLogMeeting: boolean | null = me ? Boolean(me.permissions?.meetings?.create) : null
  const closed = deal?.outcome === 'won' || deal?.outcome === 'lost'
  const open = openStagesOf(stages)
  const dealLoaded = deal !== null
  const outcome = deal?.outcome ?? null

  // Mark won / Mark lost, in the app bar's three-dot menu. Memoised: the
  // app bar re-registers whenever `menu` changes identity, and a fresh
  // element every render would re-register on every render.
  const menu = useMemo(() => {
    if (!dealLoaded) return undefined
    const closeDisabled = canEdit !== true || closed
    // A disabled item says why in the menu itself — phone has no hover
    // tooltips (§41.8 rule 16). Nothing is said while `me` is still loading.
    const why = closed
      ? `Closed as ${outcome === 'won' ? 'won' : 'lost'}. A closed opportunity cannot be reopened.`
      : canEdit === false
        ? editReason
        : null
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="More actions"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg active:bg-white/10"
            />
          }
        >
          <EllipsisVerticalIcon aria-hidden className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {why ? (
            /* A GroupLabel THROWS without a Group above it — see dropdown-menu.tsx. */
            <DropdownMenuGroup>
              <DropdownMenuLabel className="whitespace-normal">{why}</DropdownMenuLabel>
            </DropdownMenuGroup>
          ) : null}
          <DropdownMenuItem className="h-11" disabled={closeDisabled} onClick={() => setClosing('won')}>
            <TrophyIcon /> Mark won
          </DropdownMenuItem>
          <DropdownMenuItem className="h-11" disabled={closeDisabled} onClick={() => setClosing('lost')}>
            <ThumbsDownIcon /> Mark lost
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }, [dealLoaded, canEdit, closed, outcome, editReason])

  usePhoneAppBar({ title: deal?.name ?? 'Opportunity', back: '/deals', menu })

  async function logMeeting() {
    if (!deal?.company || logging) return
    router.push(`/daily-activity/new?account=${deal.company.id}&deal=${deal.id}`)
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-7 w-2/3 animate-pulse rounded bg-surface-sunken" />
        <div className="h-20 animate-pulse rounded bg-surface-sunken" />
      </div>
    )
  }

  if (failed || !deal) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-body font-medium text-text-primary">This opportunity could not be loaded</p>
        <button type="button" onClick={load} className="text-body text-primary">
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <RecordSummary
        name={deal.name}
        badges={
          <>
            {deal.stage ? <Badge>{deal.stage.name}</Badge> : null}
            {deal.outcome ? (
              <Badge variant={deal.outcome === 'won' ? 'success' : 'warning'}>
                {deal.outcome === 'won' ? 'Won' : 'Lost'}
              </Badge>
            ) : null}
          </>
        }
        facts={[
          { label: 'Value', value: fmtAmount(deal.expected_value) },
          { label: 'Account', value: deal.company?.name ?? deal.contact?.name ?? EMPTY },
          {
            label: 'Expected close',
            value: deal.expected_close_date ? fmtDate(deal.expected_close_date) : null,
          },
          { label: 'Stage', value: deal.stage?.name ?? null },
        ]}
      />

      <div className="flex flex-col gap-2">
        <RelatedRow label="Meetings" count={related.meetings} />
        <RelatedRow label="Follow-ups" count={related.followUps} />
        <RelatedRow label="Shared with" count={related.members} />
      </div>

      <ActionBar>
        <PermissionTooltip allowed={canEdit !== false} reason={editReason}>
          <Button
            variant="secondary"
            className="w-full"
            disabled={canLogMeeting !== true || !deal.company}
            onClick={logMeeting}
          >
            Log meeting
          </Button>
        </PermissionTooltip>
        <PermissionTooltip allowed={canEdit !== false} reason={editReason}>
          <Button
            className="w-full"
            disabled={canEdit !== true || closed}
            onClick={() => setStageSheetOpen(true)}
          >
            {closed ? 'Closed' : 'Move to stage'}
          </Button>
        </PermissionTooltip>
      </ActionBar>

      <BottomSheet open={stageSheetOpen} onOpenChange={setStageSheetOpen} title="Move to stage">
        {open.length === 0 ? (
          <p className="px-3 py-3 text-body text-text-secondary">
            No stages are set up. Ask someone who manages Opportunity Stages.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {open.map(stage => {
              const current = deal.stage?.id === stage.id
              return (
                <BottomSheetOption
                  key={stage.id}
                  selected={current}
                  disabled={current}
                  onSelect={() => {
                    setStageSheetOpen(false)
                    moveDealStage(
                      { id: deal.id, name: deal.name, outcome: deal.outcome, stage: deal.stage },
                      stage,
                      row => setDeal(d => (d ? { ...d, ...(row as Partial<Deal>) } : d))
                    )
                  }}
                >
                  {stage.name}
                </BottomSheetOption>
              )
            })}
          </div>
        )}
      </BottomSheet>

      {closing ? (
        <DealCloseDialog
          deal={{ id: deal.id, name: deal.name, outcome: deal.outcome, stage: deal.stage }}
          outcome={closing}
          stages={stages}
          onOpenChange={open => {
            if (!open) setClosing(null)
          }}
          // DealCloseDialog shows the "marked as won/lost" toast itself.
          onClosed={row => setDeal(d => (d ? { ...d, ...(row as Partial<Deal>) } : d))}
        />
      ) : null}
    </div>
  )
}

/**
 * No dedicated phone screen exists yet for meetings/follow-ups/members lists
 * (not in scope here — no such route exists on desktop either, only
 * sections on this same detail page), so this is a count, not a link, until
 * one of those screens exists. No chevron: a row with nowhere to go must not
 * look tappable.
 */
function RelatedRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex min-h-11 items-center justify-between rounded-lg border border-border-light bg-surface px-3 py-2">
      <span className="text-body text-text-primary">{label}</span>
      <span className="text-body text-text-secondary">{count}</span>
    </div>
  )
}
