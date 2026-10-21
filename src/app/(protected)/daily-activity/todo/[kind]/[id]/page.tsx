'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { EllipsisVerticalIcon, PlayIcon } from 'lucide-react'

import { useLayout } from '@/lib/layout'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import { loadJson } from '@/lib/load-list'
import { fmtAmount, fmtDate } from '@/lib/format'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { ActionBar } from '@/components/ui/action-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { RecordSummary, type KeyFact } from '@/components/ui/record-summary'
import { whenLayersSettled } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { OTHER_VISIT_TYPE } from '@/components/daily-activity/add-meeting-dialog'
import { CouldntMeetDialog, type CouldntMeetTarget } from '@/components/daily-activity/couldnt-meet-dialog'
import { LocationCheckSheet, type LocationReading } from '@/components/daily-activity/location-check-sheet'
import { sendStartStop } from '@/components/daily-activity/start-stop'
import {
  formatHHMM,
  toDateStr,
  type FollowUpItem,
  type MissedTodo,
  type NextMeetingItem,
  type PlannedItem,
  type Visit,
} from '@/components/daily-activity/types'

/**
 * A to-do on phone — a meeting that is due but not yet a meeting: an
 * Opportunity follow-up, an account's next-meeting date, an approved
 * weekly-plan line, or any of those left over from an earlier day (Missed).
 *
 * Desktop shows these as cards carrying Start meeting and Couldn't meet
 * (`todo-card.tsx`, `planned-card.tsx`, `missed-section.tsx`). On phone a
 * list row carries no actions — the row opens the record and every action is
 * on the record (FRONTEND_RULES_PHONE.md §41.5 rules 12-13) — so this is the
 * record: what is due, and the same two actions in its action bar.
 *
 * Start meeting does what the desktop card does: create the meeting with the
 * party the to-do already names, linked to the to-do (a plan line through
 * `weekly_plan_item_id`, a follow-up through `deal_follow_up_id`), then start
 * it — after the person has seen where they are (§41.16 rule 10). A to-do
 * with no party opens the Log meeting form instead, as desktop opens its
 * dialog. Either way the person lands on the meeting.
 *
 * URL: /daily-activity/todo/<followup|next-meeting|plan>/<id>?date=YYYY-MM-DD
 * — the day the Activity list was showing. A to-do is looked up on that day,
 * then among today's Missed.
 */

type Kind = 'followup' | 'next-meeting' | 'plan'

type Todo = {
  kind: Kind
  id: string
  /** The party the meeting would be with, when the to-do names one. */
  partyId: string | null
  partyName: string | null
  visitType: string
  heading: string
  dueDate: string
  dueTime: string | null
  /** From today's Missed list: due on an earlier day, still open. */
  missed: boolean
  dealId: string | null
  dealName: string | null
  /** Follow-up mode ("Call", "Meeting", …) or a plan line's route and travel. */
  detail: string | null
  notes: string | null
  expectedOrderValue: number | null
}

const KIND_LABEL: Record<Kind, string> = {
  followup: 'Opportunity follow-up',
  'next-meeting': 'Next meeting with the account',
  plan: 'Weekly plan',
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export default function TodoPage() {
  const { layout } = useLayout()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (layout !== 'desktop') return
    const date = searchParams.get('date')
    router.replace(date && DATE_ONLY.test(date) ? `/daily-activity?date=${date}` : '/daily-activity')
  }, [layout, router, searchParams])

  if (layout === 'desktop') return null
  return (
    <Suspense fallback={null}>
      <TodoPhone />
    </Suspense>
  )
}

function fromFollowUp(f: FollowUpItem): Todo {
  return {
    kind: 'followup',
    id: f.id,
    partyId: f.company_id,
    partyName: f.company_name,
    visitType: f.company_visit_type || OTHER_VISIT_TYPE,
    heading: f.company_name ?? f.deal_name,
    dueDate: f.due_date,
    dueTime: f.due_time,
    missed: false,
    dealId: f.deal_id,
    dealName: f.deal_name,
    detail: f.mode && f.mode !== 'Meeting' ? f.mode : null,
    notes: f.notes,
    expectedOrderValue: null,
  }
}

function fromNextMeeting(n: NextMeetingItem): Todo {
  return {
    kind: 'next-meeting',
    id: n.id,
    partyId: n.id,
    partyName: n.name,
    visitType: n.type || OTHER_VISIT_TYPE,
    heading: n.name,
    dueDate: n.next_follow_up_date,
    dueTime: n.next_follow_up_time,
    missed: false,
    dealId: null,
    dealName: null,
    detail: null,
    notes: null,
    expectedOrderValue: null,
  }
}

function fromPlan(p: PlannedItem): Todo {
  const route = [p.from_place, p.to_place].filter(Boolean).join(' to ')
  return {
    kind: 'plan',
    id: p.id,
    partyId: p.party_id && p.party_name ? p.party_id : null,
    partyName: p.party_name,
    // The party's own type; an untyped party is 'Other', never a guessed
    // 'Dealer'. `||`, not `??`: an untyped company stores '' (NOT NULL).
    visitType: p.party_visit_type || p.party_type || OTHER_VISIT_TYPE,
    heading: p.party_name ?? (route || 'Planned visit'),
    dueDate: p.plan_date,
    dueTime: null,
    missed: false,
    dealId: null,
    dealName: null,
    detail: [route, p.mode_of_travel].filter(Boolean).join(' · ') || null,
    notes: p.notes,
    expectedOrderValue: p.expected_order_value,
  }
}

function fromMissed(m: MissedTodo): Todo {
  return {
    kind: m.kind,
    id: m.id,
    partyId: m.party_id,
    partyName: m.party_id ? m.party_name : null,
    visitType: m.visit_type || OTHER_VISIT_TYPE,
    heading: m.party_name,
    dueDate: m.original_date,
    dueTime: null,
    missed: true,
    dealId: m.deal_id,
    dealName: null,
    detail: m.label,
    notes: null,
    expectedOrderValue: null,
  }
}

function TodoPhone() {
  const router = useRouter()
  const { toast } = useToast()
  const me = useMe()
  const params = useParams<{ kind: string; id: string }>()
  const searchParams = useSearchParams()
  const todayStr = toDateStr(new Date())
  const dateParam = searchParams.get('date')
  const date = dateParam && DATE_ONLY.test(dateParam) ? dateParam : todayStr
  const kind = (['followup', 'next-meeting', 'plan'] as const).find(k => k === params.kind) ?? null
  const id = params.id

  const [todo, setTodo] = useState<Todo | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'gone' | 'failed'>('loading')

  const perms = me?.permissions
  const canViewPlan = !!perms?.weekly_plan?.view

  const load = useCallback(async () => {
    if (!kind || !me) return
    setState(prev => (prev === 'ok' ? prev : 'loading'))
    const [todosRes, planRes, todayRes] = await Promise.all([
      loadJson<{ followups?: FollowUpItem[]; nextMeetings?: NextMeetingItem[]; missed?: MissedTodo[] }>(
        `/api/daily-activity/todos?date=${date}`
      ),
      // The plan route needs weekly_plan.view; without it there are no plan lines.
      kind === 'plan' && canViewPlan
        ? loadJson<{ items?: PlannedItem[] }>(`/api/daily-activity/plan?date=${date}`)
        : Promise.resolve({ ok: true as const, data: { items: [] as PlannedItem[] } }),
      // Missed is today's list; when the day shown is another, look there too.
      date === todayStr
        ? Promise.resolve(null)
        : loadJson<{ missed?: MissedTodo[] }>(`/api/daily-activity/todos?date=${todayStr}`),
    ])
    if (!todosRes.ok || !planRes.ok || (todayRes && !todayRes.ok)) {
      setState('failed')
      return
    }
    const d = todosRes.data ?? {}
    const missedList = [...(d.missed ?? []), ...((todayRes?.ok ? todayRes.data?.missed : null) ?? [])]
    const current =
      kind === 'followup'
        ? (d.followups ?? []).find(f => f.id === id)
        : kind === 'next-meeting'
          ? (d.nextMeetings ?? []).find(n => n.id === id)
          : (planRes.data?.items ?? []).find(p => p.id === id)
    const found = current
      ? kind === 'followup'
        ? fromFollowUp(current as FollowUpItem)
        : kind === 'next-meeting'
          ? fromNextMeeting(current as NextMeetingItem)
          : fromPlan(current as PlannedItem)
      : (() => {
          const m = missedList.find(x => x.kind === kind && x.id === id)
          return m ? fromMissed(m) : null
        })()
    setTodo(found)
    // Done, moved or closed since the list was drawn.
    setState(found ? 'ok' : 'gone')
  }, [kind, id, date, todayStr, me, canViewPlan])

  useEffect(() => { void load() }, [load])

  usePhoneAppBar({
    title: todo?.heading ?? 'To do',
    back: date === todayStr ? '/today' : `/today?date=${date}`,
    menu:
      todo && (todo.partyId || todo.dealId) ? (
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
            {todo.partyId ? (
              <DropdownMenuItem className="h-11" onClick={() => router.push(`/parties/companies/${todo.partyId}`)}>
                Open account
              </DropdownMenuItem>
            ) : null}
            {todo.dealId ? (
              <DropdownMenuItem className="h-11" onClick={() => router.push(`/deals/${todo.dealId}`)}>
                Open opportunity
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : undefined,
  })

  // ---- Start meeting --------------------------------------------------------
  const [locationOpen, setLocationOpen] = useState(false)
  const [couldntMeet, setCouldntMeet] = useState<CouldntMeetTarget | null>(null)
  // A sheet's close is a step back in history; a navigation started in the
  // same tap races it and is discarded. So: close, let it land, then go.
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  useEffect(() => {
    if (locationOpen || couldntMeet || !pendingHref) return
    let cancelled = false
    void whenLayersSettled().then(() => {
      if (!cancelled) router.replace(pendingHref)
    })
    return () => { cancelled = true }
  }, [locationOpen, couldntMeet, pendingHref, router])

  // Each gate is what its route checks: POST /api/daily-activity checks
  // meetings.create, the start PATCH meetings.edit, and Couldn't meet
  // meetings.view. A to-do with no party only opens the form, so it needs
  // create alone. undefined = /me not answered yet (kit §26.1).
  const startNeedsEdit = !!todo?.partyId
  const canStart: boolean | undefined = me
    ? !!perms?.meetings?.create && (!startNeedsEdit || !!perms?.meetings?.edit)
    : undefined
  const canCouldntMeet: boolean | undefined = me ? !!perms?.meetings?.view : undefined

  /** Meetings are logged on the day they happen: today's to-dos and Missed. */
  const actionable = !!todo && (todo.missed || todo.dueDate === todayStr)

  function logMeetingHref(t: Todo): string {
    const qs = new URLSearchParams({ date: todayStr })
    if (t.partyId) qs.set('account', t.partyId)
    if (t.dealId) qs.set('deal', t.dealId)
    // Desktop's rule: a Missed plan line is never re-linked (§5.3), so only a
    // current one carries its id into the form.
    if (t.kind === 'plan' && !t.missed) qs.set('plan', t.id)
    if (t.kind === 'followup') qs.set('followUp', t.id)
    return `/daily-activity/new?${qs.toString()}`
  }

  function pressStart() {
    if (!todo) return
    if (!todo.partyId || (todo.kind === 'plan' && todo.missed)) {
      router.push(logMeetingHref(todo))
      return
    }
    setLocationOpen(true)
  }

  async function createAndStart(reading: LocationReading | null): Promise<boolean> {
    if (!todo?.partyId || !todo.partyName) return false
    let created: Visit
    try {
      const r = await fetch('/api/daily-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visit_date: todayStr,
          visit_type: todo.visitType,
          entity_id: todo.partyId,
          entity_name: todo.partyName,
          is_new_entity: false,
          ...(todo.kind === 'plan' ? { weekly_plan_item_id: todo.id } : {}),
          ...(todo.kind === 'followup' ? { deal_follow_up_id: todo.id } : {}),
        }),
      })
      if (!r.ok) {
        toast((await r.json().catch(() => ({}))).error ?? 'Could not start the meeting.', 'error')
        return false
      }
      created = await r.json()
    } catch {
      toast('The connection dropped. Nothing was saved.', 'error')
      return false
    }
    const error = await sendStartStop(created.id, 'start', reading)
    if (error) {
      // The meeting exists but did not start: its own page carries Start, so
      // the way on is there, not a second meeting from here.
      toast(`Meeting logged, but it did not start: ${error}`, 'error')
    } else {
      toast('Meeting started', 'success')
    }
    setPendingHref(`/daily-activity/meeting/${created.id}`)
    return true
  }

  if (!kind) {
    return <Gone heading="This to-do could not be found" onBack={() => router.push('/today')} />
  }

  if (state === 'loading' || !me) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-7 w-2/3 animate-pulse rounded bg-surface-sunken" />
        <div className="h-20 animate-pulse rounded bg-surface-sunken" />
      </div>
    )
  }

  if (state === 'failed') {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-body font-medium text-text-primary">This to-do could not be loaded</p>
        <p className="text-body text-text-secondary">Check your connection and try again.</p>
        <Button variant="secondary" className="min-h-11" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    )
  }

  if (state === 'gone' || !todo) {
    return (
      <Gone
        heading="Nothing is due here any more"
        body="It may have been met, moved to another day, or closed. Your Activity list has what is still due."
        onBack={() => router.push(date === todayStr ? '/today' : `/today?date=${date}`)}
      />
    )
  }

  const factRows: (KeyFact | null)[] = [
    {
      label: 'Due',
      value: `${fmtDate(todo.dueDate)}${todo.dueTime ? ` · ${formatHHMM(todo.dueTime)}` : ''}`,
    },
    { label: 'Type', value: KIND_LABEL[todo.kind] },
    todo.dealName && todo.dealId
      ? {
          label: 'Opportunity',
          value: (
            <button
              type="button"
              className="text-left text-primary underline-offset-4 hover:underline"
              onClick={() => router.push(`/deals/${todo.dealId}`)}
            >
              {todo.dealName}
            </button>
          ),
        }
      : null,
    todo.detail ? { label: todo.kind === 'plan' && !todo.missed ? 'Route' : 'Details', value: todo.detail } : null,
    todo.expectedOrderValue ? { label: 'Expected order', value: fmtAmount(todo.expectedOrderValue) } : null,
  ]
  const facts = factRows.filter((f): f is KeyFact => !!f).slice(0, 4)

  return (
    <div className="flex flex-col gap-6">
      <RecordSummary
        name={todo.heading}
        badges={
          todo.missed ? (
            <Badge variant="danger">Overdue</Badge>
          ) : todo.dueDate === todayStr ? (
            <Badge variant="warning">Due today</Badge>
          ) : (
            <Badge variant="neutral">Due {fmtDate(todo.dueDate)}</Badge>
          )
        }
        facts={facts}
      />

      {todo.notes ? (
        <div className="flex flex-col gap-2">
          <p className="text-label text-text-secondary">Notes</p>
          <p className="whitespace-pre-wrap rounded-lg bg-surface-sunken p-3 text-body text-text-primary">{todo.notes}</p>
        </div>
      ) : null}

      {actionable ? (
        todo.partyId && !(todo.kind === 'plan' && todo.missed) ? (
          <p className="text-body text-text-secondary">
            To record where this meeting happens, allow location when you tap Start meeting.
          </p>
        ) : (
          <p className="text-body text-text-secondary">
            {todo.partyId
              ? 'Start meeting opens the meeting form with this account filled in.'
              : 'This has no account on file. Start meeting opens the meeting form to choose one.'}
          </p>
        )
      ) : (
        <p className="text-body text-text-secondary">
          {todo.dueDate > todayStr
            ? `You can start this meeting on ${fmtDate(todo.dueDate)}.`
            : 'This day has passed. What is still open shows under Overdue on today’s list.'}
        </p>
      )}

      {actionable ? (
        <ActionBar>
          <PermissionTooltip allowed={canCouldntMeet} reason="Only people allowed to view meetings can do this.">
            <Button
              variant="secondary"
              className="w-full"
              disabled={canCouldntMeet !== true}
              onClick={() =>
                setCouldntMeet({
                  todo_kind: todo.kind === 'next-meeting' ? 'next_meeting' : todo.kind,
                  todo_ref: todo.id,
                  party_id: todo.partyId,
                  due_date: todo.dueDate,
                  heading: todo.heading,
                })
              }
            >
              Couldn&apos;t meet
            </Button>
          </PermissionTooltip>
          <PermissionTooltip
            allowed={canStart}
            reason={
              startNeedsEdit
                ? 'Only people allowed to add and edit meetings can do this.'
                : 'Only people allowed to add meetings can do this.'
            }
          >
            <Button className="w-full" disabled={canStart !== true} onClick={pressStart}>
              <PlayIcon />
              Start meeting
            </Button>
          </PermissionTooltip>
        </ActionBar>
      ) : null}

      <LocationCheckSheet
        open={locationOpen}
        onOpenChange={setLocationOpen}
        title="Start meeting here?"
        confirmLabel="Start meeting"
        busyLabel="Starting…"
        requireLocation={false}
        onConfirm={createAndStart}
      />

      <CouldntMeetDialog
        target={couldntMeet}
        onClose={() => setCouldntMeet(null)}
        onSaved={() => {
          setCouldntMeet(null)
          setPendingHref(date === todayStr ? '/today' : `/today?date=${date}`)
        }}
      />
    </div>
  )
}

function Gone({ heading, body, onBack }: { heading: string; body?: string; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <p className="text-body font-medium text-text-primary">{heading}</p>
      {body ? <p className="text-body text-text-secondary">{body}</p> : null}
      <Button variant="secondary" className="min-h-11" onClick={onBack}>
        Back to Activity
      </Button>
    </div>
  )
}
