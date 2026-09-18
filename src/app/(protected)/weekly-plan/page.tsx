'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import StatusBadge from '@/components/ui/StatusBadge'
import { useToast } from '@/contexts/ToastContext'
import RemarksPanel from '@/components/ui/RemarksPanel'
import { ManagerChanges, changeCountLabel } from '@/components/weekly-plan/manager-changes'
import type { ItemsDiff } from '@/lib/weekly-plan-diff'

// ---- helpers ----
function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}
function toDateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function buildWeekDays(monday: Date) { return Array.from({ length: 7 }, (_, i) => toDateStr(addDays(monday, i))) }
function isToday(dateStr: string) { return dateStr === toDateStr(new Date()) }

function formatDayHeader(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const weekday = d.toLocaleDateString('en-IN', { weekday: 'long' })
  const day = String(d.getDate()).padStart(2, '0')
  const month = d.toLocaleDateString('en-IN', { month: 'short' })
  return `${weekday}, ${day} ${month}`
}

function formatWeekRange(monday: Date) {
  const sun = addDays(monday, 6)
  const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })} ${d.getFullYear()}`
  return `${fmt(monday)} to ${fmt(sun)}`
}

function formatCountdown(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * The mirror of `src/app/api/weekly-plans/_items.ts` — see the long note there.
 *
 * ⚠️ "Others" used to have no column of its own: it was stringified into the
 * TEXT column `notes` on save and hardcoded back to 0 on load, so every value a
 * user typed was lost on the next reload. `others_goal` is now the real home.
 * Rows written before it existed still have their number stranded in `notes`, so
 * a 0 in the column falls back to it — a legacy row shows what its user typed
 * rather than a confident 0 that would assert "none" where the truth is
 * "unknown". Saving the row moves the value across for good.
 *
 * The regex stays strict: it is the one place a note is reread as a number, and
 * a looser match would eat 'Collection focus'.
 */
const BARE_NUMBER = /^\s*\d+(\.\d+)?\s*$/
function readOthers(othersGoal: number | null | undefined, notes: string | null | undefined): number {
  if (othersGoal && othersGoal > 0) return othersGoal
  if (!notes || !BARE_NUMBER.test(notes)) return 0
  return Math.max(0, Math.trunc(Number(notes)))
}
function carriedNote(notes: string | null | undefined): string {
  return notes && !BARE_NUMBER.test(notes) ? notes : ''
}

const PLACEHOLDER_TYPE = '—'

/** One planned line. §5.1: a line is a PARTY, not a place. */
type PlanEntry = {
  id: string
  partyId: string
  partyType: 'company' | 'contact' | ''
  dist: number
  dealer: number
  others: number
  /** Kept as a string so an empty field stays distinguishable from a typed 0. */
  expectedOrderValue: string
  /**
   * Location is off the screen (§5.1) but its columns live on for a release, so
   * whatever an older place-based row carried is round-tripped invisibly. Without
   * this, the first re-save of an existing plan would blank its places.
   */
  fromPlace: string
  toPlace: string
  modeOfTravel: string
  /** Free text already in `notes` — preserved, never shown, see above. */
  note: string
}
type DayData = { [dateStr: string]: PlanEntry[] }

/** A checklist row. `id` is null until it has been saved. */
type Goal = { key: string; id: string | null; text: string; is_done: boolean }

type PlanItem = {
  plan_date: string
  from_place: string | null
  to_place: string | null
  new_dealers_goal: number | null
  existing_dealers_goal: number | null
  mode_of_travel: string | null
  notes: string | null
  others_goal: number | null
  party_id: string | null
  party_type: string | null
  expected_order_value: number | null
}

type Plan = {
  id: string; status: string; submitted_at: string | null; manager_comment: string | null
  reopen_requested: boolean; reopen_request_message: string | null
  weekly_plan_items: PlanItem[]
  week_start_date: string; week_end_date: string
  day_notes?: Record<string, string>
  weekly_goals?: { id: string; text: string; is_done: boolean; sort_order: number }[]
}

/**
 * `changes` is §5.2's before/after, already parsed by the logs route — null for
 * every action that recorded none. The casing of `action_type` is the API's,
 * never this screen's: 'EditByManager' is the ACTION, 'Edited by Manager' is
 * the STATUS, and the two are compared against different fields below.
 */
type LogEntry = { id: string; action_type: string; actor_role: string; timestamp: string; previous_status: string | null; new_status: string | null; comment: string | null; users?: { name: string }; changes?: ItemsDiff | null }

/** A selectable party — a Company or a Contact, flattened into one list. */
type PartyOption = {
  id: string
  type: 'company' | 'contact'
  name: string
  /** The Company Type from the master. Read-only wherever it is shown. */
  companyType: string
  /** For a Contact, the company it hangs off; for a Company, its stage. */
  subtitle: string
}

let _entryId = 0
function newEntryId() { return `e${++_entryId}` }

function planItemsToDayData(items: PlanItem[], weekDays: string[]): DayData {
  const dd: DayData = {}
  for (const day of weekDays) dd[day] = []
  for (const item of items) {
    if (!dd[item.plan_date]) dd[item.plan_date] = []
    dd[item.plan_date].push({
      id: newEntryId(),
      partyId: item.party_id ?? '',
      partyType: item.party_type === 'company' || item.party_type === 'contact' ? item.party_type : '',
      dist: item.existing_dealers_goal ?? 0,
      dealer: item.new_dealers_goal ?? 0,
      // Was hardcoded to 0 — the data-loss bug. See readOthers above.
      others: readOthers(item.others_goal, item.notes),
      expectedOrderValue: item.expected_order_value != null ? String(item.expected_order_value) : '',
      fromPlace: item.from_place ?? '',
      toPlace: item.to_place ?? '',
      modeOfTravel: item.mode_of_travel ?? '',
      note: carriedNote(item.notes),
    })
  }
  return dd
}

/** Item 9: skip blank rows — a line with no party is an empty form row, not data. */
function dayDataToPlanItems(dayData: DayData) {
  const items: Record<string, unknown>[] = []
  for (const [date, entries] of Object.entries(dayData)) {
    for (const entry of entries) {
      if (!entry.partyId) continue
      items.push({
        plan_date: date,
        party_id: entry.partyId,
        party_type: entry.partyType || null,
        // '' means the optional field was left blank, which is null — not 0.
        expected_order_value: entry.expectedOrderValue.trim() === ''
          ? null
          : Number(entry.expectedOrderValue),
        new_dealers_goal: entry.dealer,
        existing_dealers_goal: entry.dist,
        others_goal: entry.others,
        // Free text only now — a count never goes back into this column.
        notes: entry.note,
        from_place: entry.fromPlace || null,
        to_place: entry.toPlace || null,
        mode_of_travel: entry.modeOfTravel || null,
      })
    }
  }
  return items
}

function goalsFromPlan(plan: Plan | null): Goal[] {
  const rows = plan?.weekly_goals ?? []
  return rows.map(g => ({ key: g.id, id: g.id, text: g.text, is_done: g.is_done }))
}

let _goalKey = 0
function blankGoal(): Goal { return { key: `g${++_goalKey}`, id: null, text: '', is_done: false } }

/**
 * §5.1: "Show 5 blank rows by default, with an 'Add' option below. No upper
 * limit." Padding on render rather than on load means the five blanks are a
 * property of the FORM, so they are never saved as five empty goals.
 */
const MIN_GOAL_ROWS = 5
function padGoals(goals: Goal[]): Goal[] {
  if (goals.length >= MIN_GOAL_ROWS) return goals
  return [...goals, ...Array.from({ length: MIN_GOAL_ROWS - goals.length }, blankGoal)]
}

// ---- Searchable Party Combobox (§5.1 — replaces the Place picker) ----
function PartyCombobox({ value, onChange, options, disabled }: {
  value: string
  onChange: (option: PartyOption | null) => void
  options: PartyOption[]
  disabled: boolean
}) {
  const selected = options.find(o => o.id === value) ?? null
  const [query, setQuery] = useState(selected?.name ?? '')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(selected?.name ?? '') }, [selected?.name])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(selected?.name ?? '')
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [selected?.name])

  const filtered = query.trim() && query !== selected?.name
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : options

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        type="text" disabled={disabled} value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search company or contact…"
        className="w-full border border-border-light rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:bg-surface-sunken disabled:text-text-muted"
      />
      {!disabled && open && (
        <div className="absolute z-30 left-0 right-0 top-full mt-0.5 bg-surface border border-border-light rounded-lg shadow-lg max-h-56 sm:max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-muted">No parties found</p>
          ) : (
            filtered.slice(0, 200).map(o => (
              <button key={`${o.type}:${o.id}`} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(o); setQuery(o.name); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-primary-subtle transition ${o.id === value ? 'bg-primary-subtle' : ''}`}>
                <span className="flex items-center gap-2">
                  <span className={`shrink-0 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    o.type === 'company' ? 'bg-primary-subtle text-primary' : 'bg-success-bg text-success'
                  }`}>
                    {o.type === 'company' ? 'Company' : 'Contact'}
                  </span>
                  <span className={`min-w-0 truncate ${o.id === value ? 'text-primary font-medium' : 'text-text-secondary'}`}>
                    {o.name}
                  </span>
                  {o.subtitle && <span className="ml-auto shrink-0 text-xs text-text-muted">{o.subtitle}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One cell of the entry row. The label is shown only below `sm`, where the row
 * stacks; on desktop the column headers above the list carry the names, so
 * repeating them per row would be the same value said twice.
 */
function Cell({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`min-w-0 ${className}`}>
      <span className="block sm:hidden text-[11px] font-medium text-text-muted mb-1">{label}</span>
      {children}
    </label>
  )
}

// ---- My Plan Tab ----
function MyPlanTab({ userId }: { userId: string | null }) {
  const { toast } = useToast()
  const [monday, setMonday] = useState(() => getMondayOf(new Date()))
  const [plan, setPlan] = useState<Plan | null>(null)
  const [dayData, setDayData] = useState<DayData>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsOpen, setLogsOpen] = useState(false)
  const [remarksOpen, setRemarksOpen] = useState(false)
  const [parties, setParties] = useState<PartyOption[]>([])
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0)
  const [reopenModal, setReopenModal] = useState(false)
  const [reopenMessage, setReopenMessage] = useState('')
  const [reopening, setReopening] = useState(false)
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({})
  const [goals, setGoals] = useState<Goal[]>(() => padGoals([]))
  // Item 10: in-memory week cache
  const weekCache  = useRef<Map<string, DayData>>(new Map())
  const notesCache = useRef<Map<string, Record<string, string>>>(new Map())
  // ⚠️ Holds the CHECKLIST now, not the old free-text string. It is written by
  // navigateWeek and cleared by loadPlan(true) alongside the other two — a
  // checklist that missed that invalidation would follow the user into the next
  // week and be saved onto the wrong plan.
  const goalCache  = useRef<Map<string, Goal[]>>(new Map())

  const weekStart = toDateStr(monday)
  const weekEnd = toDateStr(addDays(monday, 6))
  const weekDays = buildWeekDays(monday)

  /** Index by id so a row can resolve its party's name and locked Company Type. */
  const partyById = useMemo(() => {
    const m = new Map<string, PartyOption>()
    for (const p of parties) m.set(p.id, p)
    return m
  }, [parties])

  // §5.1: the dropdown lists Companies AND Contacts — either can be selected.
  // Both are fetched once; the list is the tenant's party master and does not
  // change while a week is being planned.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/companies').then(r => r.ok ? r.json() : []),
      fetch('/api/contacts').then(r => r.ok ? r.json() : []),
    ]).then(([companies, contacts]) => {
      if (cancelled) return
      const list: PartyOption[] = []
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
    }).catch(() => toast('Failed to load companies and contacts', 'error'))
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
    const r = await fetch(`/api/weekly-plans/my?weekStart=${weekStart}`)
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
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  useEffect(() => { loadPlan() }, [loadPlan])

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

  /**
   * Split from `loadLogs` so the trail can be fetched WITHOUT opening the
   * modal. §5.2's banner renders the manager's before/after inline, and that
   * payload lives on the audit row — so the plan screen needs the log as data
   * whenever the plan comes back edited, not only when somebody asks for the
   * history.
   */
  const fetchLogs = useCallback(async (planId: string) => {
    const r = await fetch(`/api/weekly-plans/${planId}/logs`)
    if (!r.ok) return
    const data = await r.json()
    setLogs(Array.isArray(data) ? data : [])
  }, [])

  async function loadLogs() {
    if (!plan) return
    await fetchLogs(plan.id)
    setLogsOpen(true)
  }

  /*
    The trail is loaded eagerly for exactly one status. 'Edited by Manager' is
    the only state whose banner has something to render from it, so every other
    plan costs no extra request.
  */
  useEffect(() => {
    if (plan && plan.status === 'Edited by Manager') void fetchLogs(plan.id)
  }, [plan, fetchLogs])

  /**
   * The change the banner shows: the most recent manager edit that actually
   * recorded a before/after.
   *
   * `logs` arrives newest-first from the API, so the first match is the latest.
   * Matched on the ACTION 'EditByManager' — not on the status — because a plan
   * can be edited twice and only the last edit is the one still unreviewed.
   * Pre-release rows carry `changes: null` and are skipped rather than shown
   * as an empty change list.
   */
  const latestManagerEdit = useMemo(
    () => logs.find(l => l.action_type === 'EditByManager' && l.changes)?.changes ?? null,
    [logs],
  )

  /** Blank rows are form, not data — only goals with text are sent. */
  function goalsPayload() {
    return goals
      .filter(g => g.text.trim())
      .map((g, i) => ({ id: g.id, text: g.text.trim(), is_done: g.is_done, sort_order: i }))
  }

  async function handleSaveDraft() {
    setSaving(true)
    const items = dayDataToPlanItems(dayData)
    if (!plan) {
      const r = await fetch('/api/weekly-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start_date: weekStart, week_end_date: weekEnd, items, day_notes: dayNotes, goals: goalsPayload() })
      })
      if (!r.ok) { toast((await r.json()).error, 'error') } else { toast('Draft created'); loadPlan(true) }
    } else {
      const r = await fetch(`/api/weekly-plans/${plan.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, day_notes: dayNotes, goals: goalsPayload() })
      })
      if (!r.ok) { toast((await r.json()).error, 'error') } else { toast('Saved'); loadPlan(true) }
    }
    setSaving(false)
  }

  async function handleSubmit() {
    // A row with no party selected is an unfinished line, not an empty one —
    // the same guard the blank-place check was (Location is gone, the rule is not).
    const hasBlankParty = Object.values(dayData).some(entries =>
      entries.some(e => !e.partyId)
    )
    if (hasBlankParty) {
      toast('Every line needs a party — select one or remove the row before submitting', 'error')
      return
    }
    const items = dayDataToPlanItems(dayData)
    // Item 4: block empty week submission
    if (items.length === 0) {
      toast('Please add at least one party before submitting', 'error')
      return
    }
    setSaving(true)
    let planId = plan?.id ?? null
    if (!plan) {
      const r = await fetch('/api/weekly-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start_date: weekStart, week_end_date: weekEnd, items, day_notes: dayNotes, goals: goalsPayload() })
      })
      if (!r.ok) { toast((await r.json()).error, 'error'); setSaving(false); return }
      planId = (await r.json()).id
    } else if (['Draft', 'Rejected', 'Edited by Manager'].includes(plan.status)) {
      const r = await fetch(`/api/weekly-plans/${plan.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, day_notes: dayNotes, goals: goalsPayload() })
      })
      if (!r.ok) { toast((await r.json()).error, 'error'); setSaving(false); return }
    }
    const r = await fetch(`/api/weekly-plans/${planId}/submit`, { method: 'POST' })
    if (!r.ok) { toast((await r.json()).error, 'error') } else { toast('Submitted for review!'); loadPlan(true) }
    setSaving(false)
  }

  // Item 5 & 6: undo submit
  async function handleUndo() {
    if (!plan) return
    setSaving(true)
    const r = await fetch(`/api/weekly-plans/${plan.id}/undo-submit`, { method: 'POST' })
    if (!r.ok) { toast((await r.json()).error, 'error') } else { toast('Submit undone — plan is editable again'); loadPlan(true) }
    setSaving(false)
  }

  // Item 7: request reopen
  async function handleRequestReopen() {
    if (!plan || !reopenMessage.trim()) return
    setReopening(true)
    const r = await fetch(`/api/weekly-plans/${plan.id}/request-reopen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: reopenMessage.trim() })
    })
    if (!r.ok) { toast((await r.json()).error, 'error') } else {
      toast('Reopen request sent to manager')
      setReopenModal(false)
      setReopenMessage('')
      loadPlan(true)
    }
    setReopening(false)
  }

  const canEdit = !plan || ['Draft', 'Rejected', 'Edited by Manager'].includes(plan.status)
  const isSubmittedAwaitingReview = plan && ['Submitted', 'Resubmitted'].includes(plan.status)
  const canRequestReopen = plan && !canEdit && !plan.reopen_requested && undoSecondsLeft === 0

  function canAddParty(dateStr: string): boolean {
    const entries = dayData[dateStr] || []
    if (entries.length === 0) return true
    return entries[entries.length - 1].partyId !== ''
  }

  function addParty(dateStr: string) {
    setDayData(prev => ({
      ...prev,
      [dateStr]: [...(prev[dateStr] || []), {
        id: newEntryId(), partyId: '', partyType: '', dist: 0, dealer: 0, others: 0,
        expectedOrderValue: '', fromPlace: '', toPlace: '', modeOfTravel: '', note: '',
      }]
    }))
  }

  function removeParty(dateStr: string, entryId: string) {
    setDayData(prev => ({
      ...prev,
      [dateStr]: (prev[dateStr] || []).filter(e => e.id !== entryId)
    }))
  }

  /** Item 1: the same day cannot plan the same party twice. */
  function selectParty(dateStr: string, entryId: string, option: PartyOption | null) {
    if (option) {
      const entries = dayData[dateStr] || []
      if (entries.some(e => e.id !== entryId && e.partyId === option.id)) {
        toast(`${option.name} is already planned for this day`, 'error')
        return
      }
    }
    setDayData(prev => ({
      ...prev,
      [dateStr]: (prev[dateStr] || []).map(e => e.id === entryId
        ? { ...e, partyId: option?.id ?? '', partyType: option?.type ?? '' }
        : e)
    }))
  }

  function updateCount(dateStr: string, entryId: string, field: 'dist' | 'dealer' | 'others', value: number) {
    const clamped = Math.max(0, Number(value) || 0)
    setDayData(prev => ({
      ...prev,
      [dateStr]: (prev[dateStr] || []).map(e => e.id === entryId ? { ...e, [field]: clamped } : e)
    }))
  }

  /**
   * Held as typed so the field can be genuinely empty. Anything that is not a
   * non-negative number is rejected at the keystroke rather than silently
   * becoming 0 on save — §5.1 makes this field optional, so blank must mean
   * blank.
   */
  function updateExpectedValue(dateStr: string, entryId: string, raw: string) {
    if (raw !== '' && !/^\d*\.?\d{0,2}$/.test(raw)) return
    setDayData(prev => ({
      ...prev,
      [dateStr]: (prev[dateStr] || []).map(e => e.id === entryId ? { ...e, expectedOrderValue: raw } : e)
    }))
  }

  // ---- Weekly Goal Checklist (§5.1) ----
  function updateGoalText(key: string, text: string) {
    setGoals(prev => prev.map(g => g.key === key ? { ...g, text } : g))
  }

  /**
   * ⚠️ Ticking is allowed in EVERY status, unlike every other control here.
   * §5.1: the points are ticked "during the week", and during the week the plan
   * is Approved — gating this on `canEdit` would make the checklist untickable
   * exactly when it is meant to be used. A saved row is persisted immediately so
   * the tick survives without pressing Save; an unsaved row is local until the
   * next save, because there is nothing to PATCH yet.
   */
  async function toggleGoal(key: string) {
    const goal = goals.find(g => g.key === key)
    if (!goal) return
    const next = !goal.is_done
    setGoals(prev => prev.map(g => g.key === key ? { ...g, is_done: next } : g))
    if (!goal.id || !plan) return
    const r = await fetch(`/api/weekly-plans/${plan.id}/goals/${goal.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_done: next }),
    })
    if (!r.ok) {
      // Put the row back the way it was rather than leaving the screen claiming
      // something the database does not agree with.
      setGoals(prev => prev.map(g => g.key === key ? { ...g, is_done: goal.is_done } : g))
      toast('Could not update that goal', 'error')
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

  if (!userId) return <div className="text-center py-12 text-text-muted">Please add yourself as a user in Masters first.</div>

  const doneCount = goals.filter(g => g.text.trim() && g.is_done).length
  const goalCount = goals.filter(g => g.text.trim()).length

  return (
    /*
      No `h-full` and no inner scroller. The shell's content wrapper
      (`components/shell/app-shell.tsx`) IS the scroll container; a page that
      pins itself to 100% of it and then scrolls its own day list nests two
      vertical scrollers, which is what left 2131px of day cards inside a 369px
      window while the page itself refused to move. The page grows, the shell
      scrolls, and the header and footer below are sticky against it.
    */
    <div className="flex flex-col">
      {/* Sticky chrome: title, status and week navigator stay reachable while
          the seven day cards scroll beneath them. The negative margins bleed
          over the shell's 24px padding so nothing shows through at the edges.

          ⚠️ `-top-6`, not `top-0`. A sticky element is held by its MARGIN box,
          so the `-mt-6` that bleeds over the shell's padding also drags the
          sticky threshold 24px down — measured: the header parked 24px low and
          a strip of the day card behind it stayed visible above it. Offsetting
          the threshold by the same 24px puts the border box back on the
          scrollport edge; the element's own `pt-6` supplies the spacing. */}
      <div className="sticky -top-6 z-20 -mx-6 -mt-6 bg-surface-sunken px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <svg className="w-6 h-6 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <h2 className="text-xl font-medium text-text-primary">Weekly Plan</h2>
          {plan && <StatusBadge status={plan.status} />}
          {plan && (
            <div className="flex items-center gap-3 ml-auto">
              <button onClick={() => setRemarksOpen(true)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
                Chat
              </button>
              <button onClick={loadLogs} className="text-xs text-text-muted hover:underline">Audit Log</button>
            </div>
          )}
        </div>

        {/* Week navigator */}
        <div className="mt-4 flex items-center justify-between px-2">
          <button onClick={() => navigateWeek(-1)} aria-label="Previous week" className="p-2 rounded-lg hover:bg-surface-control text-text-muted transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="text-sm font-medium text-text-primary">{formatWeekRange(monday)}</span>
          <button onClick={() => navigateWeek(1)} aria-label="Next week" className="p-2 rounded-lg hover:bg-surface-control text-text-muted transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Weekly Goal Checklist — §5.1, replaces the single free-text box */}
      <div className="mb-5 rounded-xl border border-border-light bg-surface px-4 sm:px-5 py-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-medium text-text-primary">Upcoming week I want to Achieve</h3>
          {goalCount > 0 && (
            <span className="text-xs font-medium text-text-muted">{doneCount}/{goalCount} done</span>
          )}
        </div>
        <div className="space-y-2">
          {goals.map((goal, i) => (
            <div key={goal.key} className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={goal.is_done}
                // Ticking is never gated on status — see toggleGoal. An empty
                // row has nothing to tick.
                disabled={!goal.text.trim()}
                onChange={() => toggleGoal(goal.key)}
                aria-label={goal.text.trim() ? `Mark "${goal.text.trim()}" done` : 'Goal not written yet'}
                className="w-[18px] h-[18px] shrink-0 rounded border-border accent-primary disabled:opacity-40 cursor-pointer disabled:cursor-default"
              />
              <input
                type="text"
                disabled={!canEdit}
                value={goal.text}
                onChange={e => updateGoalText(goal.key, e.target.value)}
                placeholder={i === 0 ? 'e.g. Close the Nashik distributor appointment' : 'Add a point…'}
                className={`flex-1 min-w-0 border border-border-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:bg-surface-sunken disabled:text-text-muted placeholder:text-text-muted ${
                  goal.is_done ? 'line-through text-text-muted' : 'text-text-primary'
                }`}
              />
              {canEdit && (
                <button onClick={() => removeGoal(goal.key)} aria-label="Remove goal"
                  className="w-9 h-9 sm:w-8 sm:h-8 shrink-0 flex items-center justify-center text-text-muted hover:text-danger transition rounded-lg">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <button onClick={addGoal}
            className="mt-3 flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add
          </button>
        )}
      </div>

      {/* Status banners */}
      {plan && plan.status === 'Approved' && (
        <div className="mb-4 bg-success-bg border border-success-border rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-success">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Plan Approved
            </div>
            {canRequestReopen && (
              <button onClick={() => setReopenModal(true)} className="text-xs text-green-700 underline hover:text-green-800">Request Reopen</button>
            )}
          </div>
          {plan.manager_comment && <p className="text-sm text-success mt-1 ml-7">{plan.manager_comment}</p>}
          {plan.reopen_requested && <p className="text-xs text-success mt-1 ml-7 italic">Reopen request sent — awaiting manager response</p>}
        </div>
      )}
      {plan && plan.status === 'Rejected' && (
        <div className="mb-4 bg-danger-bg border border-danger-border rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-danger">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Plan Rejected — Please revise and resubmit
          </div>
          {plan.manager_comment && <p className="text-sm text-danger mt-1 ml-7">{plan.manager_comment}</p>}
        </div>
      )}
      {plan && plan.status === 'Edited by Manager' && (
        <div className="mb-4 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-purple-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>
            Plan Edited by Manager — Review changes and resubmit
          </div>
          {plan.manager_comment && <p className="text-sm text-purple-600 mt-1 ml-7">{plan.manager_comment}</p>}
          {/*
            §5.2: "The User must be able to see what changes his Manager made."
            The banner said to review the changes without ever showing them, so
            the owner had to compare the grid against their own memory of it.
            This is the frozen before/after from the audit row — see
            src/lib/weekly-plan-diff.ts for why it is recorded at write time.
          */}
          {latestManagerEdit && (
            <div className="mt-2 ml-7">
              <p className="text-xs font-medium text-purple-700">
                {changeCountLabel(latestManagerEdit)} to your plan
              </p>
              <ManagerChanges changes={latestManagerEdit} className="mt-1" />
            </div>
          )}
        </div>
      )}
      {plan && plan.status === 'On Hold' && (
        <div className="mb-4 bg-warning-bg border border-warning-border rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-warning">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
              Plan On Hold
            </div>
            {canRequestReopen && (
              <button onClick={() => setReopenModal(true)} className="text-xs text-yellow-700 underline hover:text-yellow-800">Request Reopen</button>
            )}
          </div>
          {plan.manager_comment && <p className="text-sm text-warning mt-1 ml-7">{plan.manager_comment}</p>}
          {plan.reopen_requested && <p className="text-xs text-warning mt-1 ml-7 italic">Reopen request sent — awaiting manager response</p>}
        </div>
      )}
      {isSubmittedAwaitingReview && (
        <div className="mb-4 bg-primary-subtle border border-primary-border rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Awaiting manager review
            </div>
            {/* Item 5 & 6: undo button with countdown */}
            {undoSecondsLeft > 0 ? (
              <button onClick={handleUndo} disabled={saving}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                </svg>
                Undo ({formatCountdown(undoSecondsLeft)})
              </button>
            ) : canRequestReopen ? (
              <button onClick={() => setReopenModal(true)} className="text-xs text-blue-700 underline hover:text-blue-800">Request Reopen</button>
            ) : plan?.reopen_requested ? (
              <span className="text-xs text-primary italic">Reopen request sent</span>
            ) : null}
          </div>
        </div>
      )}

      {loading ? <div className="text-center py-12 text-text-muted">Loading...</div> : (
        <>
          {/* Day cards — plain flow. The shell scrolls, not this. */}
          <div className="space-y-4 pb-4">
            {weekDays.map(dateStr => {
              const entries = dayData[dateStr] || []
              const today = isToday(dateStr)
              return (
                <div key={dateStr} className={`rounded-xl border bg-surface ${today ? 'border-primary-border ring-1 ring-primary-ring' : 'border-border-light'}`}>
                  {/* Day header */}
                  <div className="px-4 sm:px-5 pt-4 pb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-text-primary">{formatDayHeader(dateStr)}</h3>
                      {today && (
                        <span className="text-[11px] font-medium bg-primary text-primary-foreground px-2 py-0.5 rounded-md">Today</span>
                      )}
                    </div>
                  </div>

                  {/* Column headers — desktop only. Widths mirror the row below. */}
                  {entries.length > 0 && (
                    <div className="hidden sm:block px-5 pb-1">
                      <div className="flex items-center gap-2 text-xs font-medium text-text-muted">
                        <span className="flex-1 min-w-0">Party</span>
                        <span className="w-36">Company Type</span>
                        <span className="w-[68px] text-center">Dist.</span>
                        <span className="w-[68px] text-center">Dealer</span>
                        <span className="w-[68px] text-center">Others</span>
                        <span className="w-28 text-center">Expected ₹</span>
                        <span className="w-8" />
                      </div>
                    </div>
                  )}

                  {/* Entries */}
                  <div className="px-4 sm:px-5 pb-2 space-y-3 sm:space-y-2">
                    {entries.length === 0 ? (
                      <p className="text-sm text-text-muted text-center py-3">No parties planned yet</p>
                    ) : (
                      entries.map(entry => {
                        const party = entry.partyId ? partyById.get(entry.partyId) : undefined
                        return (
                          <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center gap-2 pb-3 sm:pb-0 border-b border-border-light sm:border-0 last:border-0 last:pb-0">
                            <Cell label="Party" className="sm:flex-1">
                              <PartyCombobox
                                value={entry.partyId}
                                onChange={o => selectParty(dateStr, entry.id, o)}
                                options={parties}
                                disabled={!canEdit}
                              />
                            </Cell>

                            {/*
                              §5.1: "the Company Type is fetched from the master
                              and shown locked (read-only). The master value is
                              final and cannot be changed here." So it is text,
                              never an input — a disabled input would still read
                              as a field someone could enable.
                            */}
                            <Cell label="Company Type" className="sm:w-36">
                              <div className="w-full rounded-lg border border-border-light bg-surface-sunken px-3 py-2 text-sm truncate"
                                title={party ? party.companyType : undefined}>
                                {party
                                  ? <span className="text-text-secondary">{party.companyType}</span>
                                  : <span className="text-text-muted">Select a party</span>}
                              </div>
                            </Cell>

                            <Cell label="Dist." className="sm:w-[68px]">
                              <input type="number" min={0} disabled={!canEdit} value={entry.dist}
                                onChange={e => updateCount(dateStr, entry.id, 'dist', Number(e.target.value))}
                                className="w-full border border-border-light rounded-lg px-2 py-2 text-sm text-center text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:bg-surface-sunken" />
                            </Cell>
                            <Cell label="Dealer" className="sm:w-[68px]">
                              <input type="number" min={0} disabled={!canEdit} value={entry.dealer}
                                onChange={e => updateCount(dateStr, entry.id, 'dealer', Number(e.target.value))}
                                className="w-full border border-border-light rounded-lg px-2 py-2 text-sm text-center text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:bg-surface-sunken" />
                            </Cell>
                            {/* Others now has `others_goal` to itself, so it is
                                an ordinary field again — it no longer competes
                                with a free-text note for one text column. */}
                            <Cell label="Others" className="sm:w-[68px]">
                              <input type="number" min={0} disabled={!canEdit} value={entry.others}
                                onChange={e => updateCount(dateStr, entry.id, 'others', Number(e.target.value))}
                                className="w-full border border-border-light rounded-lg px-2 py-2 text-sm text-center text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:bg-surface-sunken" />
                            </Cell>

                            {/* §5.1: optional. Blank is a real answer — it is
                                stored as NULL, not as 0. */}
                            <Cell label="Expected order value (optional)" className="sm:w-28">
                              <input type="text" inputMode="decimal" disabled={!canEdit}
                                value={entry.expectedOrderValue}
                                onChange={e => updateExpectedValue(dateStr, entry.id, e.target.value)}
                                placeholder="Optional"
                                className="w-full border border-border-light rounded-lg px-2 py-2 text-sm text-right text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:bg-surface-sunken placeholder:text-text-muted placeholder:text-xs" />
                            </Cell>

                            {canEdit && (
                              <button onClick={() => removeParty(dateStr, entry.id)} aria-label="Remove line"
                                className="h-11 sm:h-8 w-full sm:w-8 shrink-0 flex items-center justify-center gap-1.5 text-text-muted hover:text-danger transition rounded-lg border border-border-light sm:border-0">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                <span className="sm:hidden text-sm">Remove</span>
                              </button>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>

                  {/* Add Party button */}
                  {canEdit && (
                    canAddParty(dateStr) ? (
                      <button onClick={() => addParty(dateStr)}
                        className="w-full py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-sunken transition flex items-center justify-center gap-1 border-t border-border-light">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Add Party
                      </button>
                    ) : (
                      <div className="w-full py-2 text-xs text-warning text-center border-t border-border-light bg-warning-bg">
                        Select a party in the previous row first
                      </div>
                    )
                  )}

                  {/* Day Focus / Remarks — per day, distinct from the week checklist */}
                  <div className="px-4 sm:px-5 pb-4 pt-3 border-t border-border-light">
                    <label className="block text-xs font-normal text-text-secondary uppercase tracking-wide mb-1.5">Day Focus / Remarks</label>
                    <textarea
                      rows={2}
                      disabled={!canEdit}
                      value={dayNotes[dateStr] ?? ''}
                      onChange={e => setDayNotes(prev => ({ ...prev, [dateStr]: e.target.value }))}
                      placeholder="Add your focus or notes for the day…"
                      className="w-full border border-border-light rounded-lg px-3 py-2 text-sm text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-success disabled:bg-surface-sunken disabled:text-text-muted placeholder:text-text-muted"
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer — sticky against the shell's scroller, so Save and Submit
              stay reachable without scrolling back through seven day cards.
              `-bottom-6` for the same reason the header uses `-top-6`: the
              `-mb-6` bleed would otherwise hold it 24px clear of the fold. */}
          {canEdit && (
            <div className="sticky -bottom-6 z-20 border-t border-border-light bg-surface px-4 sm:px-6 py-3 flex items-center gap-2 sm:gap-3 -mx-6 -mb-6">
              <div className="flex-1" />
              <button onClick={handleSaveDraft} disabled={saving}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 sm:px-8 py-3 border border-border rounded-xl text-sm font-medium text-text-secondary hover:bg-surface-sunken disabled:opacity-50 transition sm:min-w-[180px]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                Save Draft
              </button>
              <button onClick={handleSubmit} disabled={saving}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 sm:px-8 py-3 bg-primary-pressed hover:bg-primary-hover text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50 transition sm:min-w-[180px]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Submit Plan
              </button>
            </div>
          )}
        </>
      )}

      {/* Audit Log Modal */}
      {logsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-(--backdrop)" onClick={() => setLogsOpen(false)} />
          <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
              <h3 className="font-medium text-text-primary">Audit Log</h3>
              <button onClick={() => setLogsOpen(false)} className="text-text-muted hover:text-text-secondary text-xl">&times;</button>
            </div>
            <div className="overflow-y-auto px-6 py-4 space-y-3">
              {logs.map(log => (
                <div key={log.id} className="flex gap-3 text-sm">
                  <div className="w-1 bg-primary-subtle rounded-full shrink-0" />
                  <div>
                    <p className="font-medium text-text-primary">{log.action_type} <span className="text-text-muted font-normal text-xs">by {log.users?.name ?? log.actor_role}</span></p>
                    {(log.previous_status || log.new_status) && <p className="text-xs text-text-secondary">{log.previous_status} → {log.new_status}</p>}
                    {log.comment && <p className="text-xs text-warning bg-warning-bg rounded px-2 py-0.5 mt-0.5">&ldquo;{log.comment}&rdquo;</p>}
                    {/* Every manager edit in the history, not just the last one. */}
                    {log.changes && <ManagerChanges changes={log.changes} className="mt-1" />}
                    <p className="text-xs text-text-secondary">{new Date(log.timestamp).toLocaleString('en-IN')}</p>
                  </div>
                </div>
              ))}
              {logs.length === 0 && <p className="text-text-muted text-sm">No log entries yet.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Item 7: Request Reopen Modal */}
      {reopenModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-(--backdrop)" onClick={() => { setReopenModal(false); setReopenMessage('') }} />
          <div className="relative bg-surface rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-medium text-text-primary mb-1">Request Plan Reopen</h3>
            <p className="text-xs text-text-muted mb-4">Explain why you need to edit this plan. Your manager will be notified.</p>
            <textarea
              value={reopenMessage}
              onChange={e => setReopenMessage(e.target.value)}
              rows={4} placeholder="Reason for reopen request…"
              className="w-full border border-border-light rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-ring mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setReopenModal(false); setReopenMessage('') }}
                className="px-4 py-2 text-sm text-text-secondary border border-border-light rounded-lg hover:bg-surface-sunken transition">
                Cancel
              </button>
              <button onClick={handleRequestReopen} disabled={reopening || !reopenMessage.trim()}
                className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary-hover rounded-lg disabled:opacity-50 transition">
                {reopening ? 'Sending…' : 'Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remarks / Chat Panel */}
      {plan && (
        <RemarksPanel
          isOpen={remarksOpen}
          onClose={() => setRemarksOpen(false)}
          contextType="weekly_plan"
          contextId={plan.id}
          contextTitle={`Weekly Plan — ${formatWeekRange(monday)}`}
        />
      )}
    </div>
  )
}

// ---- Main Page ----
export default function WeeklyPlanPage() {
  const { toast } = useToast()
  const [me, setMe] = useState<{ userId: string | null; hasSubordinates: boolean } | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => setMe({ userId: d.userId, hasSubordinates: d.hasSubordinates })).catch(() => toast('Failed to load user settings', 'error'))
  }, [toast])

  // No `h-full` here either — it was what pinned the page to the shell's height
  // and forced the day list to grow its own scrollbar instead of the page.
  return <MyPlanTab userId={me?.userId ?? null} />
}
