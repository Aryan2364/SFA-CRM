'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

import { useToast } from '@/contexts/ToastContext'
import { requestNotificationOffer } from '@/components/shell/notification-offer-host'
import type { PlanBoardLine } from '@/components/weekly-plan/plan-board'
import {
  NETWORK_FAILURE,
  PLACEHOLDER_TYPE,
  addDays,
  blankEntry,
  buildWeekDays,
  dayDataToPlanItems,
  formatDayLong,
  getMondayOf,
  goalsFromPlan,
  blankGoal,
  padGoals,
  planItemsToDayData,
  toDateStr,
  type DayData,
  type Goal,
  type LogEntry,
  type Plan,
  type PlanEntry,
  type PlanPartyOption,
} from '@/components/weekly-plan/plan-model'

/** What the line dialog is currently editing. `entry` is a working copy. */
export type LineEdit = {
  mode: 'add' | 'edit'
  date: string
  entry: PlanEntry
}

/**
 * The owner's weekly-plan editor, as a hook.
 *
 * Moved out of the desktop page VERBATIM (the body below is that page's
 * `MyPlanTab` state and handlers, unchanged) so the phone screen drives the
 * same load, save, submit, undo, reopen and goal calls with the same payloads,
 * validation and permission inputs. The desktop page and the phone screen
 * differ only in how they arrange what this returns.
 *
 * `canCreate` / `canEditPlan` mirror what the routes check: POST
 * /api/weekly-plans needs weekly_plan.create; every write on an existing
 * plan (PUT, submit, undo, request-reopen) needs weekly_plan.edit.
 */
export function usePlanEditor({ canCreate, canEditPlan }: { canCreate: boolean; canEditPlan: boolean }) {
  const { toast } = useToast()
  const [monday, setMonday] = useState(() => getMondayOf(new Date()))
  const [plan, setPlan] = useState<Plan | null>(null)
  const [dayData, setDayData] = useState<DayData>({})
  /*
   * True from the first render, not from the effect that fetches. Starting at
   * false paints one frame of an empty week — seven "Nothing planned" columns
   * asserting the plan is empty before the request that would say so has even
   * been made. The same mistake the page-level guard used to make.
   */
  const [loading, setLoading] = useState(true)
  /* Section 14.3: failed is its own branch, never a skeleton that never ends. */
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsOpen, setLogsOpen] = useState(false)
  const [remarksOpen, setRemarksOpen] = useState(false)
  const [parties, setParties] = useState<PlanPartyOption[]>([])
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0)
  const [reopenModal, setReopenModal] = useState(false)
  const [reopenMessage, setReopenMessage] = useState('')
  const [reopening, setReopening] = useState(false)
  /*
   * F11 took Day Focus / Remarks off the screen. `day_notes` is still loaded
   * and still sent back exactly as it arrived, so an existing plan's notes are
   * not wiped by the first save through the new screen — the same discipline
   * F12 asks for on the three goal counts.
   */
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({})
  const [goals, setGoals] = useState<Goal[]>(() => padGoals([]))
  const [editing, setEditing] = useState<LineEdit | null>(null)
  const [prioritiesOpen, setPrioritiesOpen] = useState(true)
  const [confirmDrop, setConfirmDrop] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  // Item 10: in-memory week cache
  const weekCache  = useRef<Map<string, DayData>>(new Map())
  const notesCache = useRef<Map<string, Record<string, string>>>(new Map())
  const goalCache  = useRef<Map<string, Goal[]>>(new Map())

  const weekStart = toDateStr(monday)
  const weekEnd = toDateStr(addDays(monday, 6))
  const weekDays = useMemo(() => buildWeekDays(monday), [monday])

  /*
   * "Today" is read once per render from the client clock. It is only ever
   * used to choose which day the phone view opens on, so there is nothing for
   * a timezone skew to corrupt.
   */
  const todayStr = toDateStr(new Date())

  /** Index by id so a row can resolve its party's name and locked Company Type. */
  const partyById = useMemo(() => {
    const m = new Map<string, PlanPartyOption>()
    for (const p of parties) m.set(p.id, p)
    return m
  }, [parties])

  // §5.1: the dropdown lists Companies AND Contacts — either can be selected.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/companies?fields=picker').then(r => { if (!r.ok) throw new Error('companies'); return r.json() }),
      fetch('/api/contacts').then(r => { if (!r.ok) throw new Error('contacts'); return r.json() }),
    ]).then(([companies, contacts]) => {
      if (cancelled) return
      const list: PlanPartyOption[] = []
      if (Array.isArray(companies)) {
        for (const c of companies) {
          list.push({
            id: c.id, type: 'company', name: c.name ?? '',
            companyType: (c.type ?? '').trim() || PLACEHOLDER_TYPE,
            subtitle: c.stage ?? '',
          })
        }
      }
      if (Array.isArray(contacts)) {
        for (const c of contacts) {
          // A Contact can belong to MANY companies (§3.4) and the list is
          // primary-first, so [0] is the one whose type applies.
          const primary = Array.isArray(c.companies) ? c.companies[0] : null
          list.push({
            id: c.id, type: 'contact', name: c.name ?? '',
            companyType: (primary?.type ?? '').trim() || PLACEHOLDER_TYPE,
            subtitle: primary?.name ?? '',
          })
        }
      }
      list.sort((a, b) => a.name.localeCompare(b.name))
      setParties(list)
    }).catch(() => toast('Couldn\u2019t load accounts and contacts, so lines can\u2019t be added yet. Reload the page to try again.', 'error'))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPlan = useCallback(async (clearCache = false) => {
    if (clearCache) {
      weekCache.current.delete(weekStart)
      notesCache.current.delete(weekStart)
      goalCache.current.delete(weekStart)
    }
    setLoading(true)
    setLoadError(false)
    try {
      // `fetch` has no deadline of its own (section 14.4): without this a
      // stalled response never settles and the skeleton stays for ever.
      const r = await fetch(`/api/weekly-plans/my?weekStart=${weekStart}`, {
        signal: AbortSignal.timeout(20000),
      })
      if (!r.ok) throw new Error(`weekly-plans/my ${r.status}`)
      const data = await r.json()
      setPlan(data)
      const cached = weekCache.current.get(weekStart)
      if (cached && !clearCache) {
        setDayData(cached)
        setDayNotes(notesCache.current.get(weekStart) ?? {})
        setGoals(padGoals(goalCache.current.get(weekStart) ?? goalsFromPlan(data)))
      } else if (data && data.weekly_plan_items) {
        setDayData(planItemsToDayData(data.weekly_plan_items, weekDays))
        setDayNotes(data.day_notes ?? {})
        setGoals(padGoals(goalsFromPlan(data)))
      } else {
        const empty: DayData = {}
        for (const d of weekDays) empty[d] = []
        setDayData(empty)
        setDayNotes({})
        setGoals(padGoals([]))
      }
    } catch {
      // The banners above read from `plan`; a stale week's status must not
      // stay on screen describing a week that failed to load.
      setPlan(null)
      setLoadError(true)
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  useEffect(() => { loadPlan() }, [loadPlan])

  /* The phone view opens on today when the week contains it, else on Monday. */
  useEffect(() => {
    setSelectedDay(weekDays.includes(todayStr) ? todayStr : weekDays[0])
  }, [weekDays, todayStr])

  // Undo countdown — Items 5 & 6
  useEffect(() => {
    if (!plan || !plan.submitted_at || !['Submitted', 'Resubmitted'].includes(plan.status)) {
      setUndoSecondsLeft(0)
      return
    }
    const submittedAt = new Date(plan.submitted_at).getTime()
    const WINDOW = 15 * 60 * 1000
    function calcRemaining() {
      return Math.max(0, Math.floor((submittedAt + WINDOW - Date.now()) / 1000))
    }
    setUndoSecondsLeft(calcRemaining())
    const interval = setInterval(() => {
      const rem = calcRemaining()
      setUndoSecondsLeft(rem)
      if (rem === 0) clearInterval(interval)
    }, 1000)
    return () => clearInterval(interval)
  }, [plan])

  /** Resolves true when the log is loaded; a failure is never read as "no entries". */
  const fetchLogs = useCallback(async (planId: string): Promise<boolean> => {
    try {
      const r = await fetch(`/api/weekly-plans/${planId}/logs`, { signal: AbortSignal.timeout(20000) })
      if (!r.ok) return false
      const data = await r.json()
      if (!Array.isArray(data)) return false
      setLogs(data)
      return true
    } catch {
      return false
    }
  }, [])

  async function loadLogs() {
    if (!plan) return
    if (await fetchLogs(plan.id)) setLogsOpen(true)
    else toast('Couldn\u2019t load the audit log. Check your connection and try again.', 'error')
  }

  useEffect(() => {
    if (plan && plan.status === 'Edited by Manager') void fetchLogs(plan.id)
  }, [plan, fetchLogs])

  /*
    Two manager verbs return a plan as 'Edited by Manager': an edit of its
    lines (EditByManager) and "Suggest changes" (Suggest), which changes no line
    and carries its request in `manager_comment`. The newest log that moved the
    plan INTO that status says which one this is — and only an edit's
    before/after belongs on the banner; an older edit's diff, already
    resubmitted, must not reappear under a later suggestion.
  */
  const latestReturn = useMemo(
    () => logs.find(l => l.new_status === 'Edited by Manager') ?? null,
    [logs],
  )
  const returnedAsSuggestion = latestReturn?.action_type === 'Suggest'
  const latestManagerEdit =
    latestReturn?.action_type === 'EditByManager' ? latestReturn.changes ?? null : null

  /** Blank rows are form, not data — only goals with text are sent. */
  function goalsPayload() {
    return goals
      .filter(g => g.text.trim())
      .map((g, i) => ({ id: g.id, text: g.text.trim(), is_done: g.is_done, sort_order: i }))
  }

  /**
   * ⚠️ Lines with no party are DISCARDED by a save, and always have been —
   * `dayDataToPlanItems` skips them, on this screen and on the one before it.
   *
   * On the old grid that was survivable: a party-less line was a visibly
   * unfinished form row with an empty picker in it. On the board it is a
   * finished-looking card showing its journey, and 51 of the 55 rows in the
   * database are exactly that. Pressing Save Draft would delete six of
   * somebody's cards with a "Saved" toast.
   *
   * So the save asks first. The write path is untouched — this is the screen
   * refusing to trigger it silently.
   */
  const partylessCount = useMemo(
    () => Object.values(dayData).reduce((n, entries) => n + entries.filter(e => !e.partyId).length, 0),
    [dayData],
  )

  async function handleSaveDraft() {
    if (partylessCount > 0) {
      setConfirmDrop(true)
      return
    }
    await saveDraft()
  }

  async function saveDraft() {
    setSaving(true)
    try {
      const items = dayDataToPlanItems(dayData)
      if (!plan) {
        const r = await fetch('/api/weekly-plans', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ week_start_date: weekStart, week_end_date: weekEnd, items, day_notes: dayNotes, goals: goalsPayload() })
        })
        if (!r.ok) { await refuse(r) } else { toast('Draft created'); loadPlan(true) }
      } else {
        const r = await fetch(`/api/weekly-plans/${plan.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, day_notes: dayNotes, goals: goalsPayload(), expected_version: plan.version ?? undefined })
        })
        if (!r.ok) { await refuse(r) } else { toast('Saved'); loadPlan(true) }
      }
    } catch {
      toast(NETWORK_FAILURE, 'error')
    } finally {
      setSaving(false)
    }
  }

  /**
   * A refused write, in-app. A 409 means the plan moved on since this screen
   * loaded it (a manager edit or decision, another tab): the message says so
   * and the plan is reloaded to show what it is now — never retried over it.
   */
  async function refuse(r: Response) {
    const body = await r.json().catch(() => ({}))
    toast(body?.error ?? 'Could not save the plan. Please try again.', 'error')
    if (r.status === 409) loadPlan(true)
  }

  async function handleSubmit() {
    /*
     * A line without a party can no longer be created — the dialog will not
     * save one. The guard stays because a plan loaded from an older draft can
     * still contain one, and submitting it would silently drop the line.
     */
    const hasBlankParty = Object.values(dayData).some(entries =>
      entries.some(e => !e.partyId)
    )
    if (hasBlankParty) {
      toast('Every line needs a party — open the line and select one, or remove it', 'error')
      return
    }
    const items = dayDataToPlanItems(dayData)
    if (items.length === 0) {
      toast('Please add at least one party before submitting', 'error')
      return
    }
    setSaving(true)
    try {
      let planId = plan?.id ?? null
      // The version Submit claims: the one this screen shows, or the one the
      // create / save just below left — so Submit sends exactly what was saved.
      let version = plan?.version ?? undefined
      if (!plan) {
        const r = await fetch('/api/weekly-plans', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ week_start_date: weekStart, week_end_date: weekEnd, items, day_notes: dayNotes, goals: goalsPayload() })
        })
        if (!r.ok) { await refuse(r); return }
        const created = await r.json().catch(() => null)
        if (!created?.id) { toast(NETWORK_FAILURE, 'error'); return }
        planId = created.id
        version = created.version ?? undefined
      } else if (['Draft', 'Rejected', 'Edited by Manager'].includes(plan.status)) {
        const r = await fetch(`/api/weekly-plans/${plan.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, day_notes: dayNotes, goals: goalsPayload(), expected_version: version })
        })
        if (!r.ok) { await refuse(r); return }
        version = (await r.json().catch(() => null))?.version ?? undefined
      }
      const r = await fetch(`/api/weekly-plans/${planId}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_version: version }),
      })
      if (!r.ok) { await refuse(r) } else { toast('Submitted for review!'); requestNotificationOffer(); loadPlan(true) }
    } catch {
      toast(NETWORK_FAILURE, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleUndo() {
    if (!plan) return
    setSaving(true)
    try {
      const r = await fetch(`/api/weekly-plans/${plan.id}/undo-submit`, { method: 'POST' })
      if (!r.ok) { await refuse(r) } else { toast('Submit undone — plan is editable again'); loadPlan(true) }
    } catch {
      toast(NETWORK_FAILURE, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleRequestReopen() {
    if (!plan || !reopenMessage.trim()) return
    setReopening(true)
    try {
      const r = await fetch(`/api/weekly-plans/${plan.id}/request-reopen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reopenMessage.trim() })
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        toast(body?.error ?? 'Could not send the reopen request. Please try again.', 'error')
      } else {
        toast('Reopen request sent to manager')
        setReopenModal(false)
        setReopenMessage('')
        loadPlan(true)
      }
    } catch {
      toast(NETWORK_FAILURE, 'error')
    } finally {
      setReopening(false)
    }
  }

  /** The plan's status allows editing. */
  const statusEditable = !plan || ['Draft', 'Rejected', 'Edited by Manager'].includes(plan.status)
  /** Status AND permission: creating a first draft needs weekly_plan.create,
   *  changing an existing plan needs weekly_plan.edit (the routes' own checks). */
  const canWrite = plan ? canEditPlan : canCreate
  const canEdit = statusEditable && canWrite
  // Submitting a brand-new plan creates it, then submits it: both actions.
  const canSubmit = canEditPlan && (plan ? true : canCreate)
  const isSubmittedAwaitingReview = plan && ['Submitted', 'Resubmitted'].includes(plan.status)
  const canRequestReopen = plan && !statusEditable && !plan.reopen_requested && undoSecondsLeft === 0

  // ---- the board's data ----

  /**
   * F13's card. Firm name leads; the type and the agenda sit under it.
   *
   * `party_id` is NULL on 51 of the 55 rows that exist today, so the fallback
   * is not an edge case — it is most of the board. It states the journey the
   * row actually carries rather than inventing a firm name, and it says "No
   * party yet" where the type would be, so the card is honest about being
   * incomplete instead of looking finished.
   */
  const lines: PlanBoardLine[] = useMemo(() => {
    const out: PlanBoardLine[] = []
    for (const day of weekDays) {
      for (const entry of dayData[day] ?? []) {
        const party = entry.partyId ? partyById.get(entry.partyId) : undefined
        const journey = [entry.fromPlace, entry.toPlace].filter(Boolean).join(' → ')
        const hasParty = Boolean(entry.partyId)
        out.push({
          id: entry.id,
          date: day,
          title: party?.name || (hasParty ? 'Party not in your list' : journey || 'Untitled line'),
          type: party?.companyType && party.companyType !== PLACEHOLDER_TYPE ? party.companyType : '',
          agenda: entry.note,
          expected: entry.expectedOrderValue.trim()
            ? `₹${Number(entry.expectedOrderValue).toLocaleString('en-IN')}`
            : '',
          isFallback: !hasParty,
        })
      }
    }
    return out
  }, [weekDays, dayData, partyById])

  const countsByDay = useMemo(() => {
    const m: Record<string, number> = {}
    for (const day of weekDays) m[day] = (dayData[day] ?? []).length
    return m
  }, [weekDays, dayData])

  const entryIndex = useMemo(() => {
    const m = new Map<string, { date: string; entry: PlanEntry }>()
    for (const [date, entries] of Object.entries(dayData)) {
      for (const entry of entries) m.set(entry.id, { date, entry })
    }
    return m
  }, [dayData])

  // ---- line editing ----

  const dayOptions = useMemo(
    () => weekDays.map(d => [d, formatDayLong(d)] as [string, string]),
    [weekDays],
  )

  /*
   * Stable, because it is a dependency of the board's column memo. A fresh
   * function each render would rebuild all seven columns — and with them the
   * seven plus buttons — on every keystroke anywhere on the page.
   */
  const openAdd = useCallback((date: string) => {
    setEditing({ mode: 'add', date, entry: blankEntry() })
  }, [])

  /**
   * Re-dating a line from the dialog. On an EDIT this is the same operation
   * the drag is, so it goes through the same duplicate guard: moving a line
   * onto a day that already plans that party is refused, with the reason, and
   * the field stays where it was.
   */
  function changeLineDay(date: string) {
    setEditing(prev => {
      if (!prev || prev.date === date) return prev
      if (prev.entry.partyId && duplicateOn(date, prev.entry.partyId, prev.entry.id)) {
        toast('That party is already planned for that day', 'error')
        return prev
      }
      return { ...prev, date }
    })
  }

  function openEdit(lineId: string) {
    const found = entryIndex.get(lineId)
    if (!found) return
    // A working COPY. Cancel has to leave the plan exactly as it was, and it
    // cannot if the dialog is mutating the row in place.
    setEditing({ mode: 'edit', date: found.date, entry: { ...found.entry } })
  }

  /** Item 1: the same day cannot plan the same party twice. */
  function duplicateOn(date: string, partyId: string, exceptEntryId: string) {
    return (dayData[date] ?? []).some(e => e.id !== exceptEntryId && e.partyId === partyId)
  }

  function selectPartyInDialog(option: PlanPartyOption | null) {
    setEditing(prev => {
      if (!prev) return prev
      if (option && duplicateOn(prev.date, option.id, prev.entry.id)) {
        toast(`${option.name} is already planned for this day`, 'error')
        return prev
      }
      return {
        ...prev,
        entry: { ...prev.entry, partyId: option?.id ?? '', partyType: option?.type ?? '' },
      }
    })
  }

  /**
   * Held as typed so the field can be genuinely empty. Anything that is not a
   * non-negative number is rejected at the keystroke rather than silently
   * becoming 0 on save — §5.1 makes this field optional, so blank must mean
   * blank.
   */
  function updateExpectedInDialog(raw: string) {
    if (raw !== '' && !/^\d*\.?\d{0,2}$/.test(raw)) return
    setEditing(prev => prev ? { ...prev, entry: { ...prev.entry, expectedOrderValue: raw } } : prev)
  }

  function saveLine() {
    if (!editing || !editing.entry.partyId) return
    const { mode, date, entry } = editing
    setDayData(prev => {
      const next = { ...prev }
      /*
       * Pulled out of EVERY day before being put back, not mapped in place.
       * The Day field can move a line while it is being edited, and a
       * map over the target day would simply not find it — leaving the old
       * copy where it was and silently discarding the edit.
       */
      if (mode === 'edit') {
        for (const day of Object.keys(next)) {
          next[day] = next[day].filter(e => e.id !== entry.id)
        }
      }
      next[date] = [...(next[date] ?? []), entry]
      return next
    })
    setEditing(null)
    toast(mode === 'add' ? 'Line added — remember to save the plan' : 'Line updated')
  }

  function removeLine() {
    if (!editing) return
    const { entry } = editing
    // Across every day, for the same reason saveLine is: the Day field may
    // have moved the line since the dialog opened.
    setDayData(prev => {
      const next: DayData = {}
      for (const [day, entries] of Object.entries(prev)) {
        next[day] = entries.filter(e => e.id !== entry.id)
      }
      return next
    })
    setEditing(null)
    toast('Line removed — remember to save the plan')
  }

  /**
   * A card dragged to another column is re-dated. Local to the draft; the
   * existing write path keys items by date, so nothing downstream changes.
   *
   * Throwing is how the board is told to put the card back — see its
   * optimistic layer. A silent return would leave the card in a day the plan
   * does not agree with.
   */
  const moveLine = useCallback(async (lineId: string, toDay: string) => {
    if (!canEdit) throw new Error('locked')
    const found = entryIndex.get(lineId)
    if (!found) throw new Error('missing')
    if (found.date === toDay) return
    if (found.entry.partyId && duplicateOn(toDay, found.entry.partyId, lineId)) {
      toast('That party is already planned for that day', 'error')
      throw new Error('duplicate')
    }
    setDayData(prev => ({
      ...prev,
      [found.date]: (prev[found.date] ?? []).filter(e => e.id !== lineId),
      [toDay]: [...(prev[toDay] ?? []), found.entry],
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, entryIndex, dayData, toast])

  // ---- Weekly Goal Checklist (§5.1) ----
  function updateGoalText(key: string, text: string) {
    setGoals(prev => prev.map(g => g.key === key ? { ...g, text } : g))
  }

  /**
   * ⚠️ Ticking is allowed in EVERY status, unlike every other control here.
   * §5.1: the points are ticked "during the week", and during the week the plan
   * is Approved — gating this on `canEdit` would make the checklist untickable
   * exactly when it is meant to be used.
   */
  async function toggleGoal(key: string) {
    const goal = goals.find(g => g.key === key)
    if (!goal) return
    const next = !goal.is_done
    setGoals(prev => prev.map(g => g.key === key ? { ...g, is_done: next } : g))
    if (!goal.id || !plan) return
    let ok = false
    try {
      const r = await fetch(`/api/weekly-plans/${plan.id}/goals/${goal.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_done: next }),
      })
      ok = r.ok
    } catch { /* reverted below */ }
    if (!ok) {
      setGoals(prev => prev.map(g => g.key === key ? { ...g, is_done: goal.is_done } : g))
      toast('Could not update that goal. Please try again.', 'error')
    }
  }

  function addGoal() { setGoals(prev => [...prev, blankGoal()]) }

  function removeGoal(key: string) {
    setGoals(prev => padGoals(prev.filter(g => g.key !== key)))
  }

  // Item 10: save to cache before navigating
  function navigateWeek(delta: number) {
    weekCache.current.set(weekStart, dayData)
    notesCache.current.set(weekStart, dayNotes)
    goalCache.current.set(weekStart, goals)
    setMonday(d => addDays(d, delta * 7))
  }

  const dialogParty = editing?.entry.partyId ? partyById.get(editing.entry.partyId) : undefined
  const mobileDay = selectedDay && weekDays.includes(selectedDay) ? selectedDay : weekDays[0]

  return {
    plan, loading, loadError, saving, logs, logsOpen, setLogsOpen, remarksOpen, setRemarksOpen,
    monday, weekStart, weekEnd, weekDays, navigateWeek, loadPlan, loadLogs,
    parties, partyById, undoSecondsLeft, reopenModal, setReopenModal, reopenMessage, setReopenMessage,
    reopening, goals, editing, setEditing, prioritiesOpen, setPrioritiesOpen,
    confirmDrop, setConfirmDrop, setSelectedDay, todayStr, mobileDay,
    returnedAsSuggestion, latestManagerEdit, partylessCount,
    handleSaveDraft, saveDraft, handleSubmit, handleUndo, handleRequestReopen,
    statusEditable, canWrite, canEdit, canSubmit, isSubmittedAwaitingReview, canRequestReopen,
    lines, countsByDay, dayOptions, openAdd, openEdit, changeLineDay, selectPartyInDialog,
    updateExpectedInDialog, saveLine, removeLine, moveLine, dialogParty,
    updateGoalText, toggleGoal, addGoal, removeGoal, dayData,
  }
}
