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
import { ChevronRightIcon, EllipsisVerticalIcon, PencilIcon, PlusIcon, ThumbsDownIcon, TrophyIcon } from 'lucide-react'

import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { ActionBar } from '@/components/ui/action-bar'
import { RecordSummary } from '@/components/ui/record-summary'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
import { useToast } from '@/contexts/ToastContext'
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

type Meeting = {
  id: string
  visit_date: string
  entity_name: string | null
  visit_type: string | null
  users: { name: string } | null
}

type FollowUp = {
  id: string
  due_date: string
  mode: string
  status: string
  notes: string | null
}

type RelatedCounts = { meetings: number; followUps: number }

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
  const { toast } = useToast()
  const [deal, setDeal] = useState<Deal | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [stages, setStages] = useState<StageOption[]>([])
  const [closing, setClosing] = useState<DealOutcome | null>(null)
  const [stageSheetOpen, setStageSheetOpen] = useState(false)
  const [logging, setLogging] = useState(false)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [meetingsSheetOpen, setMeetingsSheetOpen] = useState(false)
  const [followUpsSheetOpen, setFollowUpsSheetOpen] = useState(false)
  const [addingFollowUp, setAddingFollowUp] = useState(false)
  const [followUpDate, setFollowUpDate] = useState('')
  const [followUpNote, setFollowUpNote] = useState('')
  const [savingFollowUp, setSavingFollowUp] = useState(false)

  const related: RelatedCounts = { meetings: meetings.length, followUps: followUps.length }

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

      const [meetingsRes, followUpsRes] = await Promise.all([
        fetchWithDeadline(`/api/deals/${id}/meetings`).catch(() => null),
        fetchWithDeadline(`/api/deals/${id}/follow-ups`).catch(() => null),
      ])
      const meetingRows = meetingsRes && meetingsRes.ok ? ((await meetingsRes.json()) as Meeting[]) : []
      const followUpRows = followUpsRes && followUpsRes.ok ? ((await followUpsRes.json()) as FollowUp[]) : []
      setMeetings(Array.isArray(meetingRows) ? meetingRows : [])
      setFollowUps(Array.isArray(followUpRows) ? followUpRows : [])
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  async function addFollowUp() {
    if (!followUpDate || savingFollowUp) return
    setSavingFollowUp(true)
    try {
      const res = await fetchWithDeadline(`/api/deals/${id}/follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: followUpDate, mode: 'call', notes: followUpNote.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast(body.error ?? 'Could not add the follow-up.', 'error')
        return
      }
      const created = (await res.json()) as FollowUp
      setFollowUps(rows => [...rows, created].sort((a, b) => a.due_date.localeCompare(b.due_date)))
      setFollowUpDate('')
      setFollowUpNote('')
      setAddingFollowUp(false)
      toast('Follow-up added.', 'success')
    } catch {
      toast('The connection dropped. Nothing has been saved.', 'error')
    } finally {
      setSavingFollowUp(false)
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
          <DropdownMenuItem
            className="h-11"
            disabled={canEdit !== true}
            onClick={() => router.push(`/deals/${id}/edit`)}
          >
            <PencilIcon /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem className="h-11" disabled={closeDisabled} onClick={() => setClosing('won')}>
            <TrophyIcon /> Mark won
          </DropdownMenuItem>
          <DropdownMenuItem className="h-11" disabled={closeDisabled} onClick={() => setClosing('lost')}>
            <ThumbsDownIcon /> Mark lost
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }, [dealLoaded, canEdit, closed, outcome, editReason, router, id])

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
          { label: 'Value', value: deal.expected_value ? fmtAmount(deal.expected_value) : null },
          { label: 'Account', value: deal.company?.name ?? deal.contact?.name ?? EMPTY },
          {
            label: 'Expected close',
            value: deal.expected_close_date ? fmtDate(deal.expected_close_date) : null,
          },
        ]}
      />

      <div className="flex flex-col gap-2">
        <RelatedRow label="Meetings" count={related.meetings} onClick={() => setMeetingsSheetOpen(true)} />
        <RelatedRow label="Follow-ups" count={related.followUps} onClick={() => setFollowUpsSheetOpen(true)} />
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

      <BottomSheet open={meetingsSheetOpen} onOpenChange={setMeetingsSheetOpen} title="Meetings">
        {meetings.length === 0 ? (
          <p className="px-3 py-3 text-body text-text-secondary">No meetings have been logged on this opportunity yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {meetings.map(m => (
              <BottomSheetOption
                key={m.id}
                onSelect={() => {
                  setMeetingsSheetOpen(false)
                  router.push(`/daily-activity/meeting/${m.id}`)
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-text-primary">{fmtDate(m.visit_date)}</span>
                  <span className="truncate text-label text-text-secondary">
                    {m.entity_name ?? m.visit_type ?? ''}{m.users?.name ? ` · ${m.users.name}` : ''}
                  </span>
                </span>
              </BottomSheetOption>
            ))}
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={followUpsSheetOpen} onOpenChange={setFollowUpsSheetOpen} title="Follow-ups">
        <div className="flex flex-col gap-3 px-1">
          {followUps.length === 0 ? (
            <p className="px-2 py-1 text-body text-text-secondary">No follow-ups yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {followUps.map(f => (
                <div
                  key={f.id}
                  className="flex min-h-11 flex-col gap-0.5 rounded-lg border border-border-light px-3 py-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-body text-text-primary">{fmtDate(f.due_date)}</span>
                    <Badge variant={f.status === 'done' ? 'success' : 'neutral'}>
                      {f.status === 'done' ? 'Done' : 'Open'}
                    </Badge>
                  </div>
                  {f.notes ? <span className="text-label text-text-secondary">{f.notes}</span> : null}
                </div>
              ))}
            </div>
          )}

          {addingFollowUp ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border-light p-3">
              <Input
                type="date"
                value={followUpDate}
                onChange={e => setFollowUpDate(e.target.value)}
                style={{ fontSize: 16 }}
              />
              <Textarea
                value={followUpNote}
                onChange={e => setFollowUpNote(e.target.value)}
                placeholder="Note (optional)"
                style={{ fontSize: 16 }}
              />
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setAddingFollowUp(false)}>
                  Cancel
                </Button>
                <Button className="flex-1" disabled={!followUpDate || savingFollowUp} onClick={addFollowUp}>
                  Add
                </Button>
              </div>
            </div>
          ) : (
            <PermissionTooltip allowed={canEdit !== false} reason={editReason}>
              <Button
                variant="secondary"
                className="w-full"
                disabled={canEdit !== true}
                onClick={() => setAddingFollowUp(true)}
              >
                <PlusIcon className="size-4" /> Add follow-up
              </Button>
            </PermissionTooltip>
          )}
        </div>
      </BottomSheet>
    </div>
  )
}

/** Meetings/Follow-ups open their own bottom sheet; a chevron marks that it
 *  is tappable (FRONTEND_RULES_PHONE §41.8). */
function RelatedRow({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 items-center justify-between rounded-lg border border-border-light bg-surface px-3 py-2 text-left active:bg-surface-sunken"
    >
      <span className="text-body text-text-primary">{label}</span>
      <span className="flex items-center gap-1 text-body text-text-secondary">
        {count}
        <ChevronRightIcon className="size-4" aria-hidden />
      </span>
    </button>
  )
}
