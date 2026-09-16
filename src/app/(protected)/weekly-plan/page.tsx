'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import StatusBadge from '@/components/ui/StatusBadge'
import { useToast } from '@/contexts/ToastContext'
import RemarksPanel from '@/components/ui/RemarksPanel'

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

type PlaceEntry = { id: string; place: string; dist: number; dealer: number; others: number }
type DayData = { [dateStr: string]: PlaceEntry[] }

type Plan = {
  id: string; status: string; submitted_at: string | null; manager_comment: string | null
  reopen_requested: boolean; reopen_request_message: string | null
  weekly_plan_items: { plan_date: string; from_place: string; to_place: string; new_dealers_goal: number; existing_dealers_goal: number; mode_of_travel: string; notes: string }[]
  week_start_date: string; week_end_date: string
  day_notes?: Record<string, string>
  week_goal?: string | null
}

type LogEntry = { id: string; action_type: string; actor_role: string; timestamp: string; previous_status: string | null; new_status: string | null; comment: string | null; users?: { name: string } }

let _entryId = 0
function newEntryId() { return `e${++_entryId}` }

function planItemsToDayData(items: Plan['weekly_plan_items'], weekDays: string[]): DayData {
  const dd: DayData = {}
  for (const day of weekDays) dd[day] = []
  for (const item of items) {
    if (!dd[item.plan_date]) dd[item.plan_date] = []
    dd[item.plan_date].push({
      id: newEntryId(),
      place: item.from_place || '',
      dist: item.existing_dealers_goal ?? 0,
      dealer: item.new_dealers_goal ?? 0,
      others: 0,
    })
  }
  return dd
}

// Item 9: skip blank rows — never store empty place entries
function dayDataToPlanItems(dayData: DayData) {
  const items: { plan_date: string; from_place: string; to_place: string | null; new_dealers_goal: number; existing_dealers_goal: number; mode_of_travel: string | null; notes: string }[] = []
  for (const [date, entries] of Object.entries(dayData)) {
    for (const entry of entries) {
      if (!entry.place.trim()) continue
      items.push({
        plan_date: date,
        from_place: entry.place,
        to_place: null,
        new_dealers_goal: entry.dealer,
        existing_dealers_goal: entry.dist,
        mode_of_travel: null,
        notes: entry.others > 0 ? String(entry.others) : '',
      })
    }
  }
  return items
}

// ---- Item 2: Searchable Place Combobox ----
function PlaceCombobox({ value, onChange, options, disabled }: {
  value: string; onChange: (v: string) => void
  options: { id: string; label: string }[]; disabled: boolean
}) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(value) }, [value])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(value)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [value])

  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        type="text" disabled={disabled} value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search place…"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
      />
      {!disabled && open && (
        <div className="absolute z-30 left-0 right-0 top-full mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 sm:min-h-[216px] sm:max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-400">No places found</p>
          ) : (
            filtered.map(o => (
              <button key={o.id} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(o.label); setQuery(o.label); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition ${o.label === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}>
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
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
  const [villages, setVillages] = useState<{ id: string; label: string; name: string }[]>([])
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0)
  const [reopenModal, setReopenModal] = useState(false)
  const [reopenMessage, setReopenMessage] = useState('')
  const [reopening, setReopening] = useState(false)
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({})
  const [weekGoal, setWeekGoal] = useState('')
  // Item 10: in-memory week cache
  const weekCache  = useRef<Map<string, DayData>>(new Map())
  const notesCache = useRef<Map<string, Record<string, string>>>(new Map())
  const goalCache  = useRef<Map<string, string>>(new Map())

  const weekStart = toDateStr(monday)
  const weekEnd = toDateStr(addDays(monday, 6))
  const weekDays = buildWeekDays(monday)

  useEffect(() => {
    fetch('/api/masters/territory-mapping/places').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setVillages(d)
    }).catch(() => toast('Failed to load location data', 'error'))
  }, [])

  const loadPlan = useCallback(async (clearCache = false) => {
    if (clearCache) weekCache.current.delete(weekStart)
    setLoading(true)
    const r = await fetch(`/api/weekly-plans/my?weekStart=${weekStart}`)
    const data = await r.json()
    setPlan(data)
    const cached = weekCache.current.get(weekStart)
    if (cached && !clearCache) {
      setDayData(cached)
      setDayNotes(notesCache.current.get(weekStart) ?? {})
      setWeekGoal(goalCache.current.get(weekStart) ?? '')
    } else if (data && data.weekly_plan_items) {
      setDayData(planItemsToDayData(data.weekly_plan_items, weekDays))
      setDayNotes(data.day_notes ?? {})
      setWeekGoal(data.week_goal ?? '')
    } else {
      const empty: DayData = {}
      for (const d of weekDays) empty[d] = []
      setDayData(empty)
      setDayNotes({})
      setWeekGoal('')
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

  async function loadLogs() {
    if (!plan) return
    const r = await fetch(`/api/weekly-plans/${plan.id}/logs`)
    setLogs(await r.json())
    setLogsOpen(true)
  }

  async function handleSaveDraft() {
    setSaving(true)
    const items = dayDataToPlanItems(dayData)
    if (!plan) {
      const r = await fetch('/api/weekly-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start_date: weekStart, week_end_date: weekEnd, items, day_notes: dayNotes, week_goal: weekGoal })
      })
      if (!r.ok) { toast((await r.json()).error, 'error') } else { toast('Draft created'); loadPlan(true) }
    } else {
      const r = await fetch(`/api/weekly-plans/${plan.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, day_notes: dayNotes, week_goal: weekGoal })
      })
      if (!r.ok) { toast((await r.json()).error, 'error') } else { toast('Saved'); loadPlan(true) }
    }
    setSaving(false)
  }

  async function handleSubmit() {
    // Check for rows where place was not selected
    const hasBlankPlace = Object.values(dayData).some(entries =>
      entries.some(e => !e.place.trim())
    )
    if (hasBlankPlace) {
      toast('Place cannot be blank — fill in all Place fields before submitting', 'error')
      return
    }
    const items = dayDataToPlanItems(dayData)
    // Item 4: block empty week submission
    if (items.length === 0) {
      toast('Please add at least one place before submitting', 'error')
      return
    }
    setSaving(true)
    let planId = plan?.id ?? null
    if (!plan) {
      const r = await fetch('/api/weekly-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start_date: weekStart, week_end_date: weekEnd, items, week_goal: weekGoal })
      })
      if (!r.ok) { toast((await r.json()).error, 'error'); setSaving(false); return }
      planId = (await r.json()).id
    } else if (['Draft', 'Rejected', 'Edited by Manager'].includes(plan.status)) {
      const r = await fetch(`/api/weekly-plans/${plan.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, day_notes: dayNotes, week_goal: weekGoal })
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

  function canAddPlace(dateStr: string): boolean {
    const entries = dayData[dateStr] || []
    if (entries.length === 0) return true
    return entries[entries.length - 1].place !== ''
  }

  function addPlace(dateStr: string) {
    setDayData(prev => ({
      ...prev,
      [dateStr]: [...(prev[dateStr] || []), { id: newEntryId(), place: '', dist: 0, dealer: 0, others: 0 }]
    }))
  }

  function removePlace(dateStr: string, entryId: string) {
    setDayData(prev => ({
      ...prev,
      [dateStr]: (prev[dateStr] || []).filter(e => e.id !== entryId)
    }))
  }

  function updatePlace(dateStr: string, entryId: string, field: keyof PlaceEntry, value: string | number) {
    // Item 1: duplicate place detection
    if (field === 'place' && typeof value === 'string' && value.trim() !== '') {
      const entries = dayData[dateStr] || []
      if (entries.some(e => e.id !== entryId && e.place === value)) {
        toast(`${value} is already added for this day`, 'error')
        return
      }
    }
    const clamped = (field === 'dist' || field === 'dealer' || field === 'others') ? Math.max(0, Number(value) || 0) : value
    setDayData(prev => ({
      ...prev,
      [dateStr]: (prev[dateStr] || []).map(e => e.id === entryId ? { ...e, [field]: clamped } : e)
    }))
  }

  // Item 10: save to cache before navigating
  function navigateWeek(delta: number) {
    weekCache.current.set(weekStart, dayData)
    notesCache.current.set(weekStart, dayNotes)
    goalCache.current.set(weekStart, weekGoal)
    setMonday(d => addDays(d, delta * 7))
  }

  if (!userId) return <div className="text-center py-12 text-gray-400">Please add yourself as a user in Masters first.</div>

  return (
    <div className="flex flex-col h-full">
      {/* Page title */}
      <div className="flex items-center gap-3 mb-6">
        <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <h2 className="text-xl font-medium text-gray-900">Weekly Plan</h2>
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
            <button onClick={loadLogs} className="text-xs text-gray-500 hover:underline">Audit Log</button>
          </div>
        )}
      </div>

      {/* Week navigator */}
      <div className="flex items-center justify-between mb-6 px-2">
        <button onClick={() => navigateWeek(-1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <span className="text-sm font-medium text-gray-800">{formatWeekRange(monday)}</span>
        <button onClick={() => navigateWeek(1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* Week Goal */}
      <div className="mb-5 rounded-xl border border-gray-200 bg-white px-4 sm:px-5 py-4 shadow-sm">
        <label className="block text-sm font-normal text-gray-700 mb-1.5">
          Upcoming week I want to Achieve
        </label>
        <textarea
          rows={3}
          disabled={!canEdit}
          value={weekGoal}
          onChange={e => setWeekGoal(e.target.value)}
          placeholder="Think in terms of Major closures, New Distributor Appointment, The Orders Expected, Sales value expected, New People to meet…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-500 placeholder:text-gray-500"
        />
      </div>

      {/* Status banners */}
      {plan && plan.status === 'Approved' && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-green-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Plan Approved
            </div>
            {canRequestReopen && (
              <button onClick={() => setReopenModal(true)} className="text-xs text-green-700 underline hover:text-green-800">Request Reopen</button>
            )}
          </div>
          {plan.manager_comment && <p className="text-sm text-green-600 mt-1 ml-7">{plan.manager_comment}</p>}
          {plan.reopen_requested && <p className="text-xs text-green-600 mt-1 ml-7 italic">Reopen request sent — awaiting manager response</p>}
        </div>
      )}
      {plan && plan.status === 'Rejected' && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-red-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Plan Rejected — Please revise and resubmit
          </div>
          {plan.manager_comment && <p className="text-sm text-red-600 mt-1 ml-7">{plan.manager_comment}</p>}
        </div>
      )}
      {plan && plan.status === 'Edited by Manager' && (
        <div className="mb-4 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-purple-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>
            Plan Edited by Manager — Review changes and resubmit
          </div>
          {plan.manager_comment && <p className="text-sm text-purple-600 mt-1 ml-7">{plan.manager_comment}</p>}
        </div>
      )}
      {plan && plan.status === 'On Hold' && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-yellow-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
              Plan On Hold
            </div>
            {canRequestReopen && (
              <button onClick={() => setReopenModal(true)} className="text-xs text-yellow-700 underline hover:text-yellow-800">Request Reopen</button>
            )}
          </div>
          {plan.manager_comment && <p className="text-sm text-yellow-600 mt-1 ml-7">{plan.manager_comment}</p>}
          {plan.reopen_requested && <p className="text-xs text-yellow-600 mt-1 ml-7 italic">Reopen request sent — awaiting manager response</p>}
        </div>
      )}
      {isSubmittedAwaitingReview && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
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
              <span className="text-xs text-blue-600 italic">Reopen request sent</span>
            ) : null}
          </div>
        </div>
      )}

      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : (
        <>
          {/* Day cards */}
          <div className="flex-1 overflow-y-auto space-y-4 pb-4">
            {weekDays.map(dateStr => {
              const entries = dayData[dateStr] || []
              const today = isToday(dateStr)
              return (
                <div key={dateStr} className={`rounded-xl border bg-white ${today ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'}`}>
                  {/* Day header */}
                  <div className="px-4 sm:px-5 pt-4 pb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-gray-900">{formatDayHeader(dateStr)}</h3>
                      {today && (
                        <span className="text-[11px] font-medium bg-blue-600 text-white px-2 py-0.5 rounded-md">Today</span>
                      )}
                    </div>
                  </div>

                  {/* Column headers — desktop only */}
                  <div className="hidden sm:block px-5 pb-1">
                    <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                      <span className="flex-1">Place</span>
                      <span className="w-[72px] text-center">Dist.</span>
                      <span className="w-[72px] text-center">Dealer</span>
                      <span className="w-[72px] text-center">Others</span>
                      <span className="w-8" />
                    </div>
                  </div>

                  {/* Entries */}
                  <div className="px-4 sm:px-5 pb-2 space-y-3 sm:space-y-2">
                    {entries.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-3">No entries yet</p>
                    ) : (
                      entries.map(entry => (
                        <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-2 pb-3 sm:pb-0 border-b border-gray-100 sm:border-0 last:border-0 last:pb-0">
                          {/* Place — full width on mobile */}
                          <div className="flex items-center gap-2 sm:contents">
                            <PlaceCombobox
                              value={entry.place}
                              onChange={v => updatePlace(dateStr, entry.id, 'place', v)}
                              options={villages}
                              disabled={!canEdit}
                            />
                            {canEdit && (
                              <button onClick={() => removePlace(dateStr, entry.id)} className="sm:hidden w-9 h-9 flex-shrink-0 flex items-center justify-center text-gray-400 hover:text-red-500 transition rounded-lg border border-gray-200">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                          {/* Numeric inputs — wrap row on mobile with labels */}
                          <div className="flex items-center gap-2 sm:contents">
                            <label className="flex-1 sm:hidden">
                              <span className="block text-[11px] font-medium text-gray-500 mb-1">Dist.</span>
                              <input type="number" min={0} disabled={!canEdit} value={entry.dist}
                                onChange={e => updatePlace(dateStr, entry.id, 'dist', Number(e.target.value))}
                                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
                            </label>
                            <input type="number" min={0} disabled={!canEdit} value={entry.dist}
                              onChange={e => updatePlace(dateStr, entry.id, 'dist', Number(e.target.value))}
                              className="hidden sm:block w-[72px] border border-gray-200 rounded-lg px-2 py-2 text-sm text-center text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />

                            <label className="flex-1 sm:hidden">
                              <span className="block text-[11px] font-medium text-gray-500 mb-1">Dealer</span>
                              <input type="number" min={0} disabled={!canEdit} value={entry.dealer}
                                onChange={e => updatePlace(dateStr, entry.id, 'dealer', Number(e.target.value))}
                                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
                            </label>
                            <input type="number" min={0} disabled={!canEdit} value={entry.dealer}
                              onChange={e => updatePlace(dateStr, entry.id, 'dealer', Number(e.target.value))}
                              className="hidden sm:block w-[72px] border border-gray-200 rounded-lg px-2 py-2 text-sm text-center text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />

                            <label className="flex-1 sm:hidden">
                              <span className="block text-[11px] font-medium text-gray-500 mb-1">Others</span>
                              <input type="number" min={0} disabled={!canEdit} value={entry.others}
                                onChange={e => updatePlace(dateStr, entry.id, 'others', Number(e.target.value))}
                                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
                            </label>
                            <input type="number" min={0} disabled={!canEdit} value={entry.others}
                              onChange={e => updatePlace(dateStr, entry.id, 'others', Number(e.target.value))}
                              className="hidden sm:block w-[72px] border border-gray-200 rounded-lg px-2 py-2 text-sm text-center text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />

                            {canEdit && (
                              <button onClick={() => removePlace(dateStr, entry.id)} className="hidden sm:flex w-8 h-8 items-center justify-center text-gray-400 hover:text-red-500 transition">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Place button */}
                  {canEdit && (
                    canAddPlace(dateStr) ? (
                      <button onClick={() => addPlace(dateStr)}
                        className="w-full py-2.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 transition flex items-center justify-center gap-1 border-t border-gray-100">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Add Place
                      </button>
                    ) : (
                      <div className="w-full py-2 text-xs text-amber-700 text-center border-t border-gray-100 bg-amber-50">
                        Select a place in the previous row first
                      </div>
                    )
                  )}

                  {/* Day Focus / Remarks */}
                  <div className="px-4 sm:px-5 pb-4 pt-3 border-t border-gray-100">
                    <label className="block text-xs font-normal text-gray-600 uppercase tracking-wide mb-1.5">Day Focus / Remarks</label>
                    <textarea
                      rows={2}
                      disabled={!canEdit}
                      value={dayNotes[dateStr] ?? ''}
                      onChange={e => setDayNotes(prev => ({ ...prev, [dateStr]: e.target.value }))}
                      placeholder="Add your focus or notes for the day…"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50 disabled:text-gray-500 placeholder:text-gray-500"
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer — stays at bottom of content area, does not overlap sidebar */}
          <div className="border-t border-gray-200 bg-white px-4 sm:px-6 py-3 flex items-center gap-2 sm:gap-3 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6">
            <div className="flex-1" />
            {canEdit && (
              <>
                <button onClick={handleSaveDraft} disabled={saving}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 sm:px-8 py-3 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition sm:min-w-[180px]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  Save Draft
                </button>
                <button onClick={handleSubmit} disabled={saving}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 sm:px-8 py-3 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-sm font-medium disabled:opacity-50 transition sm:min-w-[180px]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                  Submit Plan
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Audit Log Modal */}
      {logsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setLogsOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="font-medium text-gray-800">Audit Log</h3>
              <button onClick={() => setLogsOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="overflow-y-auto px-6 py-4 space-y-3">
              {logs.map(log => (
                <div key={log.id} className="flex gap-3 text-sm">
                  <div className="w-1 bg-blue-200 rounded-full shrink-0" />
                  <div>
                    <p className="font-medium text-gray-800">{log.action_type} <span className="text-gray-400 font-normal text-xs">by {log.users?.name ?? log.actor_role}</span></p>
                    {(log.previous_status || log.new_status) && <p className="text-xs text-gray-500">{log.previous_status} → {log.new_status}</p>}
                    {log.comment && <p className="text-xs text-yellow-700 bg-yellow-50 rounded px-2 py-0.5 mt-0.5">&ldquo;{log.comment}&rdquo;</p>}
                    <p className="text-xs text-gray-400">{new Date(log.timestamp).toLocaleString('en-IN')}</p>
                  </div>
                </div>
              ))}
              {logs.length === 0 && <p className="text-gray-400 text-sm">No log entries yet.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Item 7: Request Reopen Modal */}
      {reopenModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setReopenModal(false); setReopenMessage('') }} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-medium text-gray-800 mb-1">Request Plan Reopen</h3>
            <p className="text-xs text-gray-500 mb-4">Explain why you need to edit this plan. Your manager will be notified.</p>
            <textarea
              value={reopenMessage}
              onChange={e => setReopenMessage(e.target.value)}
              rows={4} placeholder="Reason for reopen request…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setReopenModal(false); setReopenMessage('') }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
                Cancel
              </button>
              <button onClick={handleRequestReopen} disabled={reopening || !reopenMessage.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition">
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

  return (
    <div className="flex flex-col h-full">
      <MyPlanTab userId={me?.userId ?? null} />
    </div>
  )
}
