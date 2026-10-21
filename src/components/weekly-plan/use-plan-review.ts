'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '@/contexts/ToastContext'
import { fmtDate } from '@/lib/format'
import {
  DECISIONS,
  NOT_REVIEWER_REASON,
  notActionableReason,
  type DecisionKey,
  type PlanDetail,
  type PlanItem,
} from './approval-types'
import { changeCountLabel } from './manager-changes'
import { usePartyOptions } from './party-combobox'

/*
 * One plan under review: loading it, the four decisions, and the manager's
 * edit. Moved out of `PlanReviewPanel` VERBATIM so the phone review screen
 * calls the same routes with the same payloads, the same `expected_version`
 * claim and the same 409 handling. The panel (desktop dialog) and the phone
 * screen differ only in how they arrange what this returns.
 */

/** A line being edited. `key` is local and never sent. */
export type DraftLine = {
  key: string
  plan_date: string
  party_id: string | null
  party_type: string | null
  party_label: string | null
  dealer: number
  distributor: number
  others: number
  expected: string
  notes: string
}

let _key = 0
export function draftKey() {
  _key += 1
  return `d${_key}`
}

export function toDraft(item: PlanItem): DraftLine {
  return {
    key: draftKey(),
    plan_date: item.plan_date,
    party_id: item.party_id,
    party_type: item.party_type,
    party_label: item.party_label,
    dealer: item.new_dealers_goal ?? 0,
    distributor: item.existing_dealers_goal ?? 0,
    others: item.others_goal ?? 0,
    // '' is "did not say", which the API distinguishes from 0.
    expected: item.expected_order_value != null ? String(item.expected_order_value) : '',
    notes: item.notes ?? '',
  }
}

/** The shape `POST /edit-by-manager` feeds to `toItemRows`. */
export function toPayload(lines: DraftLine[]) {
  return lines.map(l => ({
    plan_date: l.plan_date,
    party_id: l.party_id,
    party_type: l.party_type,
    new_dealers_goal: l.dealer,
    existing_dealers_goal: l.distributor,
    others_goal: l.others,
    expected_order_value: l.expected.trim() === '' ? null : Number(l.expected),
    notes: l.notes,
  }))
}

/** The seven dates of the plan's week, from its own start date. */
export function weekDates(weekStart: string): string[] {
  const [y, m, d] = weekStart.split('-').map(Number)
  if (!y || !m || !d) return []
  const out: string[] = []
  for (let i = 0; i < 7; i += 1) {
    // Built from parts and stepped by date: `new Date(weekStart)` reads a bare
    // YYYY-MM-DD as UTC midnight and lands on the previous day west of
    // Greenwich, which shifts the whole week by one weekday.
    const day = new Date(y, m - 1, d + i)
    out.push(
      `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(
        day.getDate(),
      ).padStart(2, '0')}`,
    )
  }
  return out
}

export function dayLabel(planDate: string): string {
  const [y, m, d] = planDate.split('-').map(Number)
  if (!y || !m || !d) return planDate
  const local = new Date(y, m - 1, d)
  return `${local.toLocaleDateString(undefined, { weekday: 'long' })} · ${fmtDate(planDate)}`
}

export function usePlanReview({
  planId,
  onClose,
  onChanged,
}: {
  /** `null` closes the review. */
  planId: string | null
  onClose: () => void
  /** Called after any write, so the list behind refetches its counts. */
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [plan, setPlan] = useState<PlanDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [decision, setDecision] = useState<DecisionKey | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [editNote, setEditNote] = useState('')
  const [busy, setBusy] = useState(false)

  // The party list is only fetched once the manager actually starts editing —
  // a reviewer who only approves never pays for two master reads.
  const parties = usePartyOptions(editing)

  const load = useCallback(async () => {
    if (!planId) return
    setFailed(false)
    try {
      const r = await fetch(`/api/weekly-plans/${planId}`)
      if (!r.ok) {
        setFailed(true)
        return
      }
      const data: PlanDetail = await r.json()
      setPlan(data)
      setLines(data.weekly_plan_items.map(toDraft))
    } catch {
      setFailed(true)
    }
  }, [planId])

  useEffect(() => {
    if (!planId) {
      setPlan(null)
      setEditing(false)
      return
    }
    setPlan(null)
    void load()
  }, [planId, load])

  const dates = useMemo(() => (plan ? weekDates(plan.week_start_date) : []), [plan])

  /** Why a manager verb is unavailable on this plan, or null when it is not. */
  const verbLock = (allowedFrom: readonly string[]): string | null => {
    if (!plan) return null
    if (!plan.canReview) return NOT_REVIEWER_REASON
    return allowedFrom.includes(plan.status) ? null : notActionableReason(plan.status)
  }

  const byDay = useMemo(() => {
    const map = new Map<string, PlanItem[]>()
    for (const item of plan?.weekly_plan_items ?? []) {
      const bucket = map.get(item.plan_date)
      if (bucket) bucket.push(item)
      else map.set(item.plan_date, [item])
    }
    return map
  }, [plan])

  const draftsByDay = useMemo(() => {
    const map = new Map<string, DraftLine[]>()
    for (const line of lines) {
      const bucket = map.get(line.plan_date)
      if (bucket) bucket.push(line)
      else map.set(line.plan_date, [line])
    }
    return map
  }, [lines])

  /** The most recent manager edit that recorded a before/after. */
  const lastEdit = useMemo(
    () => plan?.logs.find(l => l.action_type === 'EditByManager' && l.changes)?.changes ?? null,
    [plan],
  )

  function patch(key: string, change: Partial<DraftLine>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...change } : l)))
  }

  function addLine(date: string) {
    setLines(prev => [
      ...prev,
      {
        key: draftKey(),
        plan_date: date,
        party_id: null,
        party_type: null,
        party_label: null,
        dealer: 0,
        distributor: 0,
        others: 0,
        expected: '',
        notes: '',
      },
    ])
  }

  async function runDecision(comment: string) {
    if (!plan || !decision) return
    setBusy(true)
    try {
      const spec = DECISIONS[decision]
      const r = await fetch(`/api/weekly-plans/${plan.id}/${spec.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment, expected_version: plan.version ?? undefined }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        // The API's own message, rendered in-app. Never an alert().
        toast(body?.error ?? `Could not ${spec.label.toLowerCase()} the plan`, 'error')
        // A 409 is the plan having moved on (a decision elsewhere, an owner
        // save): show what it is now rather than leave the stale plan up to
        // be decided on again. Never retried behind the manager's back.
        if (r.status === 409) {
          setDecision(null)
          onChanged()
          await load()
        }
        return
      }
      toast(spec.done, 'success')
      setDecision(null)
      onChanged()
      onClose()
    } catch {
      toast('Network error — the plan was not changed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    if (!plan) return
    setBusy(true)
    try {
      const r = await fetch(`/api/weekly-plans/${plan.id}/edit-by-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: toPayload(lines),
          comment: editNote.trim() || undefined,
          expected_version: plan.version ?? undefined,
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast(body?.error ?? 'Could not save the plan', 'error')
        // The plan changed under the edit: reload it, and the edit with it —
        // these lines were drawn over a version that no longer exists.
        if (r.status === 409) {
          setSaveOpen(false)
          setEditing(false)
          onChanged()
          await load()
        }
        return
      }
      // The route answers with the diff it froze, so the count reported here is
      // the same one the owner will see — not a client-side recount.
      const changed = body?.changes
      toast(
        changed && (changed.added?.length || changed.removed?.length || changed.changed?.length)
          ? `Saved — ${changeCountLabel(changed)} sent to ${plan.owner?.name ?? 'the owner'}`
          : 'Saved — no lines changed',
        'success',
      )
      setSaveOpen(false)
      setEditNote('')
      setEditing(false)
      onChanged()
      await load()
    } catch {
      toast('Network error — the plan was not changed', 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Accept or decline a reopen request. The same two routes and the same empty
   * body the review page's plan list posts; both gate on `weekly_plan` EDIT and
   * `canReview`, exactly as the decisions do.
   */
  async function answerReopen(kind: 'accept-reopen' | 'decline-reopen') {
    if (!plan) return
    setBusy(true)
    try {
      const r = await fetch(`/api/weekly-plans/${plan.id}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast(body?.error ?? 'Could not complete that action. Please try again.', 'error')
        // 409: the request was already answered. Show the plan as it is now.
        if (r.status === 409) {
          onChanged()
          await load()
        }
        return
      }
      toast(kind === 'accept-reopen' ? 'Reopen accepted — the plan is back with its owner' : 'Reopen declined')
      onChanged()
      await load()
    } catch {
      toast('Network error — the plan was not changed', 'error')
    } finally {
      setBusy(false)
    }
  }

  /** Discard: the drafts go back to what the plan actually holds, so leaving
   *  edit mode never half-applies anything. */
  function discardEdit() {
    if (!plan) return
    setLines(plan.weekly_plan_items.map(toDraft))
    setEditing(false)
  }

  return {
    plan, failed, load, editing, setEditing, lines, setLines, decision, setDecision,
    saveOpen, setSaveOpen, editNote, setEditNote, busy, parties, dates, verbLock,
    byDay, draftsByDay, lastEdit, patch, addLine, runDecision, saveEdit, discardEdit, answerReopen,
  }
}
