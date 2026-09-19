'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, MessageSquareIcon } from 'lucide-react'

import StatusBadge from '@/components/ui/StatusBadge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/contexts/ToastContext'
import RemarksPanel from '@/components/ui/RemarksPanel'
import { ManagerChanges, changeCountLabel } from '@/components/weekly-plan/manager-changes'
import { PlanBoard, PlanDayList, type PlanBoardLine } from '@/components/weekly-plan/plan-board'
import { PlanLineDialog, DayPicker, type PlanLineDraft } from '@/components/weekly-plan/plan-line-dialog'
import { WeeklyPriorities } from '@/components/weekly-plan/weekly-priorities'
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

/** The column heading: "Mon 15 Sep". Short, because the column is 280px. */
function formatDayColumn(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const weekday = d.toLocaleDateString('en-IN', { weekday: 'short' })
  const month = d.toLocaleDateString('en-IN', { month: 'short' })
  return `${weekday} ${d.getDate()} ${month}`
}

/** The dialog's subtitle, where there is room for the long form. */
function formatDayLong(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short' })
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
 *
 * ⚠️ F12 took Dist/Dealer/Others off the SCREEN. It did not take them out of
 * the database, and this pair of readers is exactly why they cannot simply be
 * dropped from the row type either: a legacy note still has to be told apart
 * from a legacy count, or the board would print "6" as a line's agenda.
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
type PlanEntry = PlanLineDraft
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

function blankEntry(): PlanEntry {
  return {
    id: newEntryId(), partyId: '', partyType: '', dist: 0, dealer: 0, others: 0,
    expectedOrderValue: '', fromPlace: '', toPlace: '', modeOfTravel: '', note: '',
  }
}

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

/**
 * Item 9: skip blank rows — a line with no party is an empty form row, not data.
 *
 * ⚠️ Every field the board stopped SHOWING is still written from the draft it
 * was read into. F12 retired Dist/Dealer/Others from the face of the plan and
 * explicitly not from the database, so a line saved through the new dialog
 * carries the counts, the places, the travel mode and the note it arrived
 * with. The manager's diff compares these fields, so a board that quietly
 * blanked them would have shown every re-saved plan as a change.
 */
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
        id="plan-line-party"
        type="text" disabled={disabled} value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search company or contact…"
        className="w-full border border-border-light rounded-lg px-3 py-2 text-[16px] sm:text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:bg-surface-sunken disabled:text-text-muted"
      />
      {!disabled && open && (
        <div className="absolute z-30 left-0 right-0 top-full mt-0.5 bg-surface border border-border-light rounded-lg shadow-lg max-h-56 overflow-y-auto">
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

/** What the dialog is currently editing. `entry` is a working copy. */
type LineEdit = {
  mode: 'add' | 'edit'
  date: string
  entry: PlanEntry
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
    const m = new Map<string, PartyOption>()
    for (const p of parties) m.set(p.id, p)
    return m
  }, [parties])

  // §5.1: the dropdown lists Companies AND Contacts — either can be selected.
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

  useEffect(() => {
    if (plan && plan.status === 'Edited by Manager') void fetchLogs(plan.id)
  }, [plan, fetchLogs])

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

  async function handleUndo() {
    if (!plan) return
    setSaving(true)
    const r = await fetch(`/api/weekly-plans/${plan.id}/undo-submit`, { method: 'POST' })
    if (!r.ok) { toast((await r.json()).error, 'error') } else { toast('Submit undone — plan is editable again'); loadPlan(true) }
    setSaving(false)
  }

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

  function selectPartyInDialog(option: PartyOption | null) {
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
    const r = await fetch(`/api/weekly-plans/${plan.id}/goals/${goal.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_done: next }),
    })
    if (!r.ok) {
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

  if (!userId) return <div className="py-12 text-center text-text-muted">Please add yourself as a user in Masters first.</div>

  const dialogParty = editing?.entry.partyId ? partyById.get(editing.entry.partyId) : undefined
  const mobileDay = selectedDay && weekDays.includes(selectedDay) ? selectedDay : weekDays[0]

  return (
    /*
      A fixed-height column, unlike the old page. The board is the one view on
      this screen that cannot live in normal flow: each of its seven columns
      scrolls vertically inside a host that must have a definite height, and it
      renders one screen tall with its columns cut off in anything that will
      not give it one. The shell's content wrapper is `h-full ... p-6` against
      an `h-dvh` root, so `h-full` here resolves to a real number and the
      shell's own scrollbar never appears.
    */
    <div className="flex h-full min-h-0 flex-col">
      {/* Pinned chrome: title, status, week changer. Only the columns scroll. */}
      <div className="shrink-0 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-medium text-text-primary">Weekly Plan</h2>
          {plan && <StatusBadge status={plan.status} />}
          {/*
            No add button here. Adding a line is a per-DAY action and it lives
            on the day's own column heading, next to the count of what is
            already there. Below 768px, where there are no columns, the day
            list carries its own.
          */}
          {plan && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
              <Button variant="ghost" size="sm" onClick={() => setRemarksOpen(true)}>
                <MessageSquareIcon />
                Chat
              </Button>
              <Button variant="ghost" size="sm" onClick={loadLogs}>Audit Log</Button>
            </div>
          )}
        </div>

        {/* Week changer, above the day row exactly as F9 asks. */}
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" size="icon" onClick={() => navigateWeek(-1)} aria-label="Previous week">
            <ChevronLeftIcon />
          </Button>
          <span className="text-body font-medium text-text-primary tabular-nums">
            {formatWeekRange(monday)}
          </span>
          <Button variant="secondary" size="icon" onClick={() => navigateWeek(1)} aria-label="Next week">
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      {/* Status banners */}
      {plan && plan.status === 'Approved' && (
        <div className="mb-3 shrink-0 rounded-xl border border-success-border bg-success-bg px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-label font-medium text-success">Plan Approved</span>
            {canRequestReopen && (
              <button onClick={() => setReopenModal(true)} className="text-meta text-success underline">Request Reopen</button>
            )}
          </div>
          {plan.manager_comment && <p className="mt-1 text-label text-success">{plan.manager_comment}</p>}
          {plan.reopen_requested && <p className="mt-1 text-meta text-success italic">Reopen request sent — awaiting manager response</p>}
        </div>
      )}
      {plan && plan.status === 'Rejected' && (
        <div className="mb-3 shrink-0 rounded-xl border border-danger-border bg-danger-bg px-4 py-2.5">
          <span className="text-label font-medium text-danger">Plan Rejected — please revise and resubmit</span>
          {plan.manager_comment && <p className="mt-1 text-label text-danger">{plan.manager_comment}</p>}
        </div>
      )}
      {plan && plan.status === 'Edited by Manager' && (
        <div className="mb-3 max-h-40 shrink-0 overflow-y-auto rounded-xl border border-primary-border bg-primary-subtle px-4 py-2.5">
          <span className="text-label font-medium text-primary">Plan Edited by Manager — review the changes and resubmit</span>
          {plan.manager_comment && <p className="mt-1 text-label text-primary">{plan.manager_comment}</p>}
          {/*
            §5.2: "The User must be able to see what changes his Manager made."
            The frozen before/after from the audit row — see
            src/lib/weekly-plan-diff.ts for why it is recorded at write time.
          */}
          {latestManagerEdit && (
            <div className="mt-2">
              <p className="text-meta font-medium text-primary">
                {changeCountLabel(latestManagerEdit)} to your plan
              </p>
              <ManagerChanges changes={latestManagerEdit} className="mt-1" />
            </div>
          )}
        </div>
      )}
      {plan && plan.status === 'On Hold' && (
        <div className="mb-3 shrink-0 rounded-xl border border-warning-border bg-warning-bg px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-label font-medium text-warning">Plan On Hold</span>
            {canRequestReopen && (
              <button onClick={() => setReopenModal(true)} className="text-meta text-warning underline">Request Reopen</button>
            )}
          </div>
          {plan.manager_comment && <p className="mt-1 text-label text-warning">{plan.manager_comment}</p>}
          {plan.reopen_requested && <p className="mt-1 text-meta text-warning italic">Reopen request sent — awaiting manager response</p>}
        </div>
      )}
      {isSubmittedAwaitingReview && (
        <div className="mb-3 shrink-0 rounded-xl border border-primary-border bg-primary-subtle px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-label font-medium text-primary">Awaiting manager review</span>
            {undoSecondsLeft > 0 ? (
              <Button variant="secondary" size="sm" onClick={handleUndo} disabled={saving}>
                Undo ({formatCountdown(undoSecondsLeft)})
              </Button>
            ) : canRequestReopen ? (
              <button onClick={() => setReopenModal(true)} className="text-meta text-primary underline">Request Reopen</button>
            ) : plan?.reopen_requested ? (
              <span className="text-meta text-primary italic">Reopen request sent</span>
            ) : null}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-text-muted">Loading…</div>
      ) : (
        <>
          {/*
            The board, at 768px and up. Below that it is not offered at all
            (section 35.3): seven 280px columns need about 2,000px and a phone
            has 390, so squeezing them would cost the week-at-a-glance
            comparison that is the whole point and give nothing back.

            Both views are in the markup and chosen by a media query rather
            than by `useBoardAvailable`, which reports false until the first
            effect runs — on a laptop that is a frame of the phone layout
            before the board appears.
          */}
          <div className="hidden min-h-0 flex-1 md:flex md:flex-col">
            <PlanBoard
              days={weekDays}
              lines={lines}
              dayLabel={formatDayColumn}
              canEdit={canEdit}
              onOpenLine={openEdit}
              onMoveLine={moveLine}
              onAddToDay={openAdd}
            />
          </div>

          {/* One day at a time, below 768px. */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 md:hidden">
            <DayPicker
              days={weekDays}
              counts={countsByDay}
              selected={mobileDay}
              today={weekDays.includes(todayStr) ? todayStr : null}
              onSelect={setSelectedDay}
            />
            <PlanDayList
              day={mobileDay}
              lines={lines}
              canEdit={canEdit}
              onOpenLine={openEdit}
              onAdd={() => openAdd(mobileDay)}
            />
          </div>

          {/* F14 — the weekly priorities, full width, its own scroll. */}
          <div className="mt-3 shrink-0">
            <WeeklyPriorities
              rows={goals}
              canEdit={canEdit}
              open={prioritiesOpen}
              onToggleOpen={() => setPrioritiesOpen(o => !o)}
              onChangeText={updateGoalText}
              onToggleDone={toggleGoal}
              onAdd={addGoal}
              onRemove={removeGoal}
            />
          </div>

          {canEdit && (
            <div className="mt-3 flex shrink-0 items-center justify-end gap-2">
              <Button variant="secondary" onClick={handleSaveDraft} disabled={saving} className="min-h-11 flex-1 sm:flex-initial">
                Save Draft
              </Button>
              <Button onClick={handleSubmit} disabled={saving} className="min-h-11 flex-1 sm:flex-initial">
                Submit Plan
              </Button>
            </div>
          )}
        </>
      )}

      {/* Add / edit one line */}
      <PlanLineDialog
        open={editing !== null}
        mode={editing?.mode ?? 'add'}
        dateLabel={editing ? formatDayLong(editing.date) : ''}
        date={editing?.date ?? weekDays[0]}
        dayOptions={dayOptions}
        onDateChange={changeLineDay}
        draft={editing?.entry ?? null}
        companyType={dialogParty?.companyType ?? null}
        canRemove={canEdit}
        partyField={
          <PartyCombobox
            value={editing?.entry.partyId ?? ''}
            onChange={selectPartyInDialog}
            options={parties}
            disabled={!canEdit}
          />
        }
        onExpectedValueChange={updateExpectedInDialog}
        onSave={saveLine}
        onRemove={removeLine}
        onClose={() => setEditing(null)}
      />

      {/* Saving would delete lines that have no party — say so first. */}
      <AlertDialog open={confirmDrop} onOpenChange={v => { if (!v) setConfirmDrop(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {partylessCount === 1
                ? 'One line has no party'
                : `${partylessCount} lines have no party`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              A planned line is stored against a party, so saving removes{' '}
              {partylessCount === 1 ? 'it' : 'them'} from the plan. Open{' '}
              {partylessCount === 1 ? 'the card' : 'each card'} and choose a
              party to keep {partylessCount === 1 ? 'it' : 'them'}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmDrop(false); void saveDraft() }}
            >
              Save without {partylessCount === 1 ? 'it' : 'them'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Audit Log Modal */}
      {logsOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div className="absolute inset-0 bg-(--backdrop)" onClick={() => setLogsOpen(false)} />
          <div className="relative flex max-h-[70vh] w-full max-w-lg flex-col rounded-2xl bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border-light px-6 py-4">
              <h3 className="font-medium text-text-primary">Audit Log</h3>
              <button onClick={() => setLogsOpen(false)} className="text-xl text-text-muted hover:text-text-secondary">&times;</button>
            </div>
            <div className="space-y-3 overflow-y-auto px-6 py-4">
              {logs.map(log => (
                <div key={log.id} className="flex gap-3 text-sm">
                  <div className="w-1 shrink-0 rounded-full bg-primary-subtle" />
                  <div>
                    <p className="font-medium text-text-primary">{log.action_type} <span className="text-xs font-normal text-text-muted">by {log.users?.name ?? log.actor_role}</span></p>
                    {(log.previous_status || log.new_status) && <p className="text-xs text-text-secondary">{log.previous_status} → {log.new_status}</p>}
                    {log.comment && <p className="mt-0.5 rounded bg-warning-bg px-2 py-0.5 text-xs text-warning">&ldquo;{log.comment}&rdquo;</p>}
                    {log.changes && <ManagerChanges changes={log.changes} className="mt-1" />}
                    <p className="text-xs text-text-secondary">{new Date(log.timestamp).toLocaleString('en-IN')}</p>
                  </div>
                </div>
              ))}
              {logs.length === 0 && <p className="text-sm text-text-muted">No log entries yet.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Item 7: Request Reopen Modal */}
      {reopenModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div className="absolute inset-0 bg-(--backdrop)" onClick={() => { setReopenModal(false); setReopenMessage('') }} />
          <div className="relative w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
            <h3 className="mb-1 font-medium text-text-primary">Request Plan Reopen</h3>
            <p className="mb-4 text-xs text-text-muted">Explain why you need to edit this plan. Your manager will be notified.</p>
            <textarea
              value={reopenMessage}
              onChange={e => setReopenMessage(e.target.value)}
              rows={4} placeholder="Reason for reopen request…"
              className="mb-4 w-full resize-none rounded-xl border border-border-light px-3 py-2 text-sm focus:ring-2 focus:ring-primary-ring focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setReopenModal(false); setReopenMessage('') }}>Cancel</Button>
              <Button onClick={handleRequestReopen} disabled={reopening || !reopenMessage.trim()}>
                {reopening ? 'Sending…' : 'Send Request'}
              </Button>
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

  // `h-full` so the board inside gets a definite height to fill.
  return (
    <div className="h-full min-h-0">
      <MyPlanTab userId={me?.userId ?? null} />
    </div>
  )
}
