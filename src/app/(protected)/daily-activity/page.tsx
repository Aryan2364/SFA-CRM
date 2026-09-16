'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import RemarksPanel from '@/components/ui/RemarksPanel'
import CalendarPicker from '@/components/ui/CalendarPicker'

// ---- Types ----
type NewProspectPayload = { name: string; mobile_1: string | null; state_id: string | null; district_id: string | null; taluka_id: string | null; village_id: string | null }

type Visit = {
  id: string
  visit_type: string
  entity_name: string
  new_prospect?: NewProspectPayload
  is_new_entity: boolean
  status: 'Pending' | 'Active' | 'Completed'
  start_time: string | null
  end_time: string | null
  duration_secs: number | null
  latitude: number | null
  longitude: number | null
  address: string | null
  end_latitude: number | null
  end_longitude: number | null
  end_address: string | null
  notes: string | null
}

type Entity = { id: string; name: string }

type Expense = {
  id: string
  category: string
  amount: number
  notes: string | null
  expense_date: string
  photo_url: string | null
}

type PlanItem = {
  id: string
  from_place: string
  to_place: string
  new_dealers_goal: number
  existing_dealers_goal: number
  mode_of_travel: string
  notes: string
}

type PlanDay = {
  plan_status: string
  items: PlanItem[]
} | null

type OrderItem = { product_id: string | null; product_name: string; qty: number; rate: number }
type Product = { id: string; name: string; price: number }

const EXPENSE_CATEGORIES = ['Travel', 'Food', 'Accommodation', 'Phone', 'Stationary', 'Miscellaneous'] as const

// ---- Helpers ----
function formatDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function getWeekDates(baseDate: Date): Date[] {
  const d = new Date(baseDate)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const r = new Date(d)
    r.setDate(d.getDate() + i)
    return r
  })
}

function toDateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ---- Week Strip ----
function WeekStrip({ selectedDate, onSelectDate, onPrevWeek, onNextWeek, calendarApiBase }: {
  selectedDate: string
  onSelectDate: (d: string) => void
  onPrevWeek: () => void
  onNextWeek: () => void
  calendarApiBase?: string
}) {
  const todayStr = toDateStr(new Date())
  const selDate = new Date(selectedDate + 'T00:00:00')
  const weekDates = getWeekDates(selDate)
  const [showCalendar, setShowCalendar] = useState(false)

  return (
    <div className="relative mb-5">
      <div className="flex items-center gap-1 bg-white rounded-2xl border border-gray-200 px-2 py-2 shadow-sm">
        <button onClick={onPrevWeek} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>

        <div className="flex-1 flex items-center justify-between gap-0.5">
          {weekDates.map((d, i) => {
            const ds = toDateStr(d)
            const isSelected = ds === selectedDate
            const isToday = ds === todayStr
            return (
              <button
                key={ds}
                onClick={() => onSelectDate(ds)}
                className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-xl flex-1 transition relative ${
                  isSelected
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-gray-50 text-gray-600'
                }`}
              >
                <span className={`text-[10px] font-normal uppercase tracking-wide ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>
                  {DAY_LABELS[i]}
                </span>
                <span className={`text-sm font-medium ${isSelected ? 'text-white' : isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                  {d.getDate()}
                </span>
                {isToday && (
                  <span className={`w-1.5 h-1.5 rounded-full absolute bottom-1 ${isSelected ? 'bg-blue-200' : 'bg-blue-500'}`} />
                )}
              </button>
            )
          })}
        </div>

        <button onClick={onNextWeek} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>

        {/* Calendar icon button */}
        <button
          onClick={() => setShowCalendar(v => !v)}
          className={`p-1.5 rounded-lg transition shrink-0 ${showCalendar ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-400'}`}
          title="Open calendar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
        </button>
      </div>

      {showCalendar && (
        <CalendarPicker
          selectedDate={selectedDate}
          onSelectDate={d => { onSelectDate(d); setShowCalendar(false) }}
          onClose={() => setShowCalendar(false)}
          calendarApiBase={calendarApiBase}
        />
      )}
    </div>
  )
}

// ---- Visit Card ----
function VisitCard({ visit, onStart, onStop, onDelete, onOrderEntry, onRemarks, onNotesUpdate }: {
  visit: Visit
  onStart: (id: string) => void
  onStop: (id: string) => void
  onDelete: (id: string) => void
  onOrderEntry: (visit: Visit) => void
  onRemarks: (visit: Visit) => void
  onNotesUpdate: (id: string, notes: string) => Promise<void>
}) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [notesText, setNotesText] = useState(visit.notes ?? '')
  const [notesSaving, setNotesSaving] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)

  useEffect(() => {
    if (visit.status === 'Active' && visit.start_time) {
      const update = () => setElapsed(Math.floor((Date.now() - new Date(visit.start_time!).getTime()) / 1000))
      update()
      intervalRef.current = setInterval(update, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
      setElapsed(visit.duration_secs ?? 0)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [visit.status, visit.start_time, visit.duration_secs])

  const typeColor = visit.visit_type === 'Dealer' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
  const statusColor = visit.status === 'Active'
    ? 'bg-amber-100 text-amber-700'
    : visit.status === 'Completed'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-gray-100 text-gray-500'

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden transition-all ${visit.status === 'Active' ? 'border-amber-300 shadow-md shadow-amber-50' : 'border-gray-200'}`}>
      {visit.status === 'Active' && <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-400 animate-pulse" />}
      {visit.status === 'Completed' && <div className="h-1 bg-emerald-400" />}

      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-normal px-2 py-0.5 rounded-full ${typeColor}`}>{visit.visit_type}</span>
              {visit.is_new_entity && <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">New</span>}
              <span className={`text-[11px] font-normal px-2 py-0.5 rounded-full ${statusColor}`}>{visit.status}</span>
            </div>
            <h3 className="mt-1.5 text-base font-medium text-gray-900 truncate">{visit.entity_name}</h3>
          </div>

          <div className="flex flex-col items-center gap-1 shrink-0">
            {visit.status === 'Pending' && (
              <button onClick={() => onStart(visit.id)}
                className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center shadow transition">
                <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              </button>
            )}
            {visit.status === 'Active' && (
              <>
                <button onClick={() => onStop(visit.id)}
                  className="w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow transition">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
                </button>
                <span className="text-xs font-mono font-medium text-amber-600 tabular-nums">{formatDuration(elapsed)}</span>
              </>
            )}
            {visit.status === 'Completed' && (
              <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-1">
          {visit.start_time && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Started {formatTime(visit.start_time)}</span>
              {visit.end_time && <span>· Ended {formatTime(visit.end_time)}</span>}
            </div>
          )}
          {visit.status === 'Completed' && visit.duration_secs != null && (
            <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Duration: {formatDuration(visit.duration_secs)}
            </div>
          )}
        </div>

        {/* Action row */}
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
          {(visit.status === 'Active' || visit.status === 'Completed') && (
            <button onClick={() => onOrderEntry(visit)}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
              </svg>
              Order Entry
            </button>
          )}
          {visit.status === 'Completed' && (
            <button onClick={() => setNotesOpen(o => !o)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition ${notesOpen ? 'bg-amber-50 text-amber-700' : 'text-gray-500 hover:text-amber-700 hover:bg-amber-50'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              Notes{visit.notes ? ' ✓' : ''}
            </button>
          )}
          {visit.latitude != null && (
            <button onClick={() => setLocationOpen(o => !o)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition ${locationOpen ? 'bg-teal-50 text-teal-700' : 'text-gray-500 hover:text-teal-700 hover:bg-teal-50'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              Location
            </button>
          )}
          {visit.status === 'Pending' && (
            <button onClick={() => onDelete(visit.id)}
              className="text-xs text-gray-400 hover:text-red-500 transition ml-auto">
              Delete
            </button>
          )}
          <button onClick={() => onRemarks(visit)} className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition" title="Remarks">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
          </button>
        </div>

        {/* Meeting Notes expandable section */}
        {visit.status === 'Completed' && notesOpen && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs font-normal text-gray-500 uppercase tracking-wide mb-2">Meeting Notes</p>
            <textarea
              rows={4}
              value={notesText}
              onChange={e => setNotesText(e.target.value)}
              placeholder="Add structured notes about this meeting…"
              className="w-full text-sm text-gray-800 border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-300"
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={async () => {
                  setNotesSaving(true)
                  await onNotesUpdate(visit.id, notesText)
                  setNotesSaving(false)
                  setNotesOpen(false)
                }}
                disabled={notesSaving}
                className="text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg transition disabled:opacity-60">
                {notesSaving ? 'Saving…' : 'Save Notes'}
              </button>
            </div>
          </div>
        )}

        {/* Location expandable section */}
        {locationOpen && visit.latitude != null && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs font-normal text-gray-500 uppercase tracking-wide mb-2">Location Details</p>
            <div className="space-y-2">
              <div className="bg-teal-50 rounded-lg px-3 py-2">
                <p className="text-[10px] font-normal text-teal-600 uppercase mb-0.5">Start Location</p>
                <p className="text-xs text-gray-700">{visit.address ?? `${visit.latitude}, ${visit.longitude}`}</p>
              </div>
              {visit.end_latitude != null && (
                <div className={`rounded-lg px-3 py-2 ${
                  visit.latitude != null && visit.end_latitude != null &&
                  (Math.abs(visit.latitude - visit.end_latitude) > 0.001 || Math.abs((visit.longitude ?? 0) - (visit.end_longitude ?? 0)) > 0.001)
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-teal-50'
                }`}>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] font-normal text-teal-600 uppercase mb-0.5">End Location</p>
                    {visit.latitude != null && visit.end_latitude != null &&
                      (Math.abs(visit.latitude - visit.end_latitude) > 0.001 || Math.abs((visit.longitude ?? 0) - (visit.end_longitude ?? 0)) > 0.001) && (
                      <span className="text-[10px] font-normal text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">Mismatch</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-700">{visit.end_address ?? `${visit.end_latitude}, ${visit.end_longitude}`}</p>
                </div>
              )}
              {visit.status === 'Active' && !visit.end_latitude && (
                <p className="text-xs text-gray-400 italic">End location will be captured when meeting is stopped.</p>
              )}
              <button
                onClick={() => setMapOpen(o => !o)}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
                </svg>
                {mapOpen ? 'Hide Map' : 'View on Google Maps'}
              </button>
              {mapOpen && (
                <div className="relative rounded-xl overflow-hidden border border-gray-200">
                  <iframe
                    src={`https://www.google.com/maps?q=${visit.latitude},${visit.longitude}&z=15&output=embed`}
                    className="w-full h-48"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    title="Meeting start location"
                  />
                  <button
                    onClick={() => setMapOpen(false)}
                    className="absolute top-2 right-2 bg-white/90 hover:bg-white rounded-lg p-1 shadow text-gray-500 hover:text-gray-700"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Add Meeting Modal ----
function AddMeetingModal({ onClose, onAdd }: { onClose: () => void; onAdd: (v: Partial<Visit>) => void }) {
  const { toast } = useToast()
  const [leadTypes, setLeadTypes] = useState<{ id: string; name: string }[]>([])
  const [visitType, setVisitType] = useState('')
  const [mode, setMode] = useState<'existing' | 'lead' | 'new_prospect'>('existing')
  const [entityId, setEntityId] = useState('')
  const [entities, setEntities] = useState<Entity[]>([])
  const [entLoading, setEntLoading] = useState(false)
  // New prospect fields
  const [npName, setNpName]     = useState('')
  const [npMobile, setNpMobile] = useState('')
  const [npPlace, setNpPlace]   = useState('')
  const [npTalukaId, setNpTalukaId]   = useState('')
  const [npVillageId, setNpVillageId] = useState('')
  const [npDistrictId, setNpDistrictId] = useState('')
  const [npStateId, setNpStateId]     = useState('')
  const [placeOptions, setPlaceOptions] = useState<{ value: string; label: string }[]>([])
  const [placeMap, setPlaceMap] = useState<Map<string, { state_id: string; district_id: string; taluka_id: string; village_id: string | null }>>(new Map())
  const [placeQuery, setPlaceQuery] = useState('')
  const [placeDropOpen, setPlaceDropOpen] = useState(false)
  const [entityQuery, setEntityQuery] = useState('')
  const [entityDropOpen, setEntityDropOpen] = useState(false)

  useEffect(() => {
    fetch('/api/masters/lead-types').then(r => r.json()).then((d: { id: string; name: string }[]) => {
      setLeadTypes(Array.isArray(d) ? d : [])
      if (d.length > 0) setVisitType(d[0].name)
    }).catch(() => toast('Failed to load visit types', 'error'))
    // Load place options for new prospect
    Promise.all([
      fetch('/api/masters/districts').then(r => r.json()),
      fetch('/api/masters/talukas').then(r => r.json()),
      fetch('/api/masters/villages').then(r => r.json()),
    ]).then(([districts, talukas, villages]) => {
      const distMap = new Map(districts.map((d: { id: string; name: string }) => [d.id, d]))
      const taluMap = new Map(talukas.map((t: { id: string; name: string; district_id: string }) => [t.id, t]))
      const pm = new Map<string, { state_id: string; district_id: string; taluka_id: string; village_id: string | null }>()
      const opts: { value: string; label: string }[] = []
      for (const t of talukas) {
        const dist = distMap.get(t.district_id) as { id: string; name: string; state_id: string } | undefined
        if (!dist) continue
        const val = `t:${t.id}`
        opts.push({ value: val, label: `District: ${dist.name}, Taluka: ${t.name}` })
        pm.set(val, { state_id: dist.state_id, district_id: t.district_id, taluka_id: t.id, village_id: null })
      }
      for (const v of villages) {
        const talu = taluMap.get(v.taluka_id) as { id: string; name: string; district_id: string } | undefined
        const dist = talu ? distMap.get(talu.district_id) as { id: string; name: string; state_id: string } | undefined : undefined
        if (!talu || !dist) continue
        const val = `v:${v.id}`
        opts.push({ value: val, label: `District: ${dist.name}, Taluka: ${talu.name}, Village: ${v.name}` })
        pm.set(val, { state_id: dist.state_id, district_id: talu.district_id, taluka_id: v.taluka_id, village_id: v.id })
      }
      setPlaceOptions(opts)
      setPlaceMap(pm)
    }).catch(() => toast('Failed to load location data', 'error'))
  }, [])

  useEffect(() => {
    if (!visitType || mode === 'new_prospect') return
    setEntityId('')
    setEntityQuery('')
    setEntLoading(true)
    const status = mode === 'lead' ? 'lead' : 'existing'
    fetch(`/api/business-partners?type=${encodeURIComponent(visitType)}&status=${status}`)
      .then(r => r.json())
      .then(d => { setEntities(Array.isArray(d) ? d : []); setEntLoading(false) })
      .catch(() => setEntLoading(false))
  }, [visitType, mode])

  function handlePlaceSelect(val: string) {
    setNpPlace(val)
    const r = placeMap.get(val)
    if (r) { setNpStateId(r.state_id); setNpDistrictId(r.district_id); setNpTalukaId(r.taluka_id); setNpVillageId(r.village_id ?? '') }
    else { setNpStateId(''); setNpDistrictId(''); setNpTalukaId(''); setNpVillageId('') }
    const label = placeOptions.find(o => o.value === val)?.label ?? ''
    setPlaceQuery(label)
    setPlaceDropOpen(false)
  }

  function handleAdd() {
    if (!visitType) return
    if (mode === 'new_prospect') {
      if (!npName.trim()) return
      onAdd({ visit_type: visitType, new_prospect: { name: npName.trim(), mobile_1: npMobile.trim() || null, state_id: npStateId || null, district_id: npDistrictId || null, taluka_id: npTalukaId || null, village_id: npVillageId || null } } as Partial<Visit>)
    } else {
      if (!entityId) return
      const selected = entities.find(e => e.id === entityId)
      onAdd({ visit_type: visitType, entity_id: entityId, entity_name: selected?.name ?? '', is_new_entity: false } as Partial<Visit>)
    }
  }

  const canAdd = visitType && (mode === 'new_prospect' ? !!npName.trim() : !!entityId)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="font-medium text-gray-900">New Meeting</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Step 1: Type */}
          <div>
            <label htmlFor="da-lead-type" className="block text-sm font-medium text-gray-700 mb-1">Lead Type</label>
            <select id="da-lead-type" name="visit_type" value={visitType} onChange={e => setVisitType(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">Select type…</option>
              {leadTypes.map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Step 2: Mode */}
          <div>
            <p className="block text-sm font-medium text-gray-700 mb-2">Record Type</p>
            <div className="grid grid-cols-3 gap-2">
              {(['existing', 'lead', 'new_prospect'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`py-2.5 rounded-xl text-xs font-medium border-2 transition ${mode === m ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  {m === 'existing' ? 'Existing' : m === 'lead' ? 'Lead' : 'New Prospect'}
                </button>
              ))}
            </div>
          </div>

          {/* Step 3: Conditional content */}
          {mode !== 'new_prospect' ? (
            <div>
              <label htmlFor="da-entity-search" className="block text-sm font-medium text-gray-700 mb-1">
                Select {mode === 'lead' ? 'Lead' : visitType || 'Record'}
              </label>
              {entLoading ? (
                <div className="text-sm text-gray-400 py-2">Loading…</div>
              ) : (
                <div className="relative">
                  <input
                    id="da-entity-search"
                    name="entity_query"
                    type="text"
                    value={entityQuery}
                    onChange={e => { setEntityQuery(e.target.value); setEntityId(''); setEntityDropOpen(true) }}
                    onFocus={() => setEntityDropOpen(true)}
                    onBlur={() => setTimeout(() => setEntityDropOpen(false), 150)}
                    placeholder="Search…"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {entityDropOpen && (
                    <ul className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {(entityQuery
                        ? entities.filter(e => e.name.toLowerCase().includes(entityQuery.toLowerCase()))
                        : entities
                      ).length === 0 ? (
                        <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
                      ) : (
                        (entityQuery
                          ? entities.filter(e => e.name.toLowerCase().includes(entityQuery.toLowerCase()))
                          : entities
                        ).map(e => (
                          <li key={e.id}
                            onMouseDown={() => { setEntityId(e.id); setEntityQuery(e.name); setEntityDropOpen(false) }}
                            className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700">
                            {e.name}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              )}
              {entities.length === 0 && !entLoading && (
                <p className="text-xs text-amber-600 mt-1">No records found for this type / status.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label htmlFor="da-np-name" className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
                <input id="da-np-name" name="np_name" type="text" value={npName} onChange={e => setNpName(e.target.value)} placeholder="Prospect name"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="da-np-mobile" className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
                <input id="da-np-mobile" name="np_mobile" type="tel" value={npMobile} onChange={e => setNpMobile(e.target.value)} placeholder="10-digit number" maxLength={10}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="da-np-place" className="block text-sm font-medium text-gray-700 mb-1">Place</label>
                <div className="relative">
                  <input
                    id="da-np-place"
                    name="np_place"
                    type="text"
                    value={placeQuery}
                    onChange={e => { setPlaceQuery(e.target.value); setNpPlace(''); setPlaceDropOpen(true) }}
                    onFocus={() => setPlaceDropOpen(true)}
                    onBlur={() => setTimeout(() => setPlaceDropOpen(false), 150)}
                    placeholder="Search district, taluka or village…"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {placeDropOpen && (
                    <ul className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {(() => {
                        const filtered = placeQuery
                          ? placeOptions.filter(o => o.label.toLowerCase().includes(placeQuery.toLowerCase())).slice(0, 50)
                          : placeOptions.slice(0, 50)
                        return filtered.length === 0
                          ? <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
                          : filtered.map(o => (
                              <li key={o.value}
                                onMouseDown={() => handlePlaceSelect(o.value)}
                                className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700">
                                {o.label}
                              </li>
                            ))
                      })()}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="px-5 pb-5 flex gap-2 sticky bottom-0 bg-white border-t border-gray-200 pt-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
          <button onClick={handleAdd} disabled={!canAdd}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-40 transition">
            Add Meeting
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Add Expense Modal ----
function AddExpenseModal({ onClose, onAdd }: { onClose: () => void; onAdd: (e: Partial<Expense>) => void }) {
  const { toast } = useToast()
  const [category, setCategory] = useState<string>('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [expenseCategories, setExpenseCategories] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetch('/api/masters/expense-categories').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setExpenseCategories(d)
    }).catch(() => toast('Failed to load expense categories', 'error'))
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setPhotoError(null)
    if (!file) { setPhotoFile(null); setPhotoPreview(null); return }
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
      setPhotoError('Only JPG and PNG files are allowed')
      e.target.value = ''; return
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Photo must be 5 MB or less')
      e.target.value = ''; return
    }
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function removePhoto() {
    setPhotoFile(null)
    setPhotoError(null)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(null)
  }

  async function handleSubmit() {
    if (!category || !amount || Number(amount) <= 0) return
    setSubmitting(true)
    let photo_url: string | null = null
    if (photoFile) {
      const fd = new FormData()
      fd.append('file', photoFile)
      const r = await fetch('/api/expenses/upload', { method: 'POST', body: fd })
      if (!r.ok) { setPhotoError((await r.json()).error ?? 'Upload failed'); setSubmitting(false); return }
      photo_url = (await r.json()).url
    }
    onAdd({ category, amount: Number(amount), notes: notes || null, photo_url } as Partial<Expense>)
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="font-medium text-gray-900">Add Expense</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label htmlFor="da-expense-category" className="block text-sm font-medium text-gray-700 mb-1">Category <span className="text-red-500">*</span></label>
            <select id="da-expense-category" name="category" value={category} onChange={e => setCategory(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">Select category…</option>
              {expenseCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="da-expense-amount" className="block text-sm font-medium text-gray-700 mb-1">Amount (₹) <span className="text-red-500">*</span></label>
            <input id="da-expense-amount" name="amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} min="0.01" step="0.01"
              placeholder="0.00"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label htmlFor="da-expense-notes" className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input id="da-expense-notes" name="notes" type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Optional description"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <p className="block text-sm font-medium text-gray-700 mb-1">Receipt Photo</p>
            {photoPreview ? (
              <div className="relative w-full">
                <img src={photoPreview} alt="Receipt preview" className="w-full max-h-48 object-contain rounded-xl border border-gray-200 bg-gray-50" />
                <button onClick={removePhoto}
                  className="absolute top-2 right-2 w-6 h-6 bg-white rounded-full shadow flex items-center justify-center text-gray-500 hover:text-red-500 transition">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center gap-2 w-full border-2 border-dashed border-gray-200 rounded-xl py-4 px-3 cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition">
                <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <span className="text-xs text-gray-500">Upload receipt photo (JPG/PNG, max 5 MB)</span>
                <input type="file" accept="image/jpeg,image/jpg,image/png" className="hidden" onChange={handleFileChange} />
              </label>
            )}
            {photoError && <p className="text-xs text-red-500 mt-1">{photoError}</p>}
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
          <button onClick={handleSubmit}
            disabled={!category || !amount || Number(amount) <= 0 || submitting}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-40 transition">
            {submitting ? 'Saving...' : 'Add Expense'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Order Entry Modal ----
function OrderEntryModal({ visit, onClose, onSaved }: { visit: Visit; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [items, setItems] = useState<OrderItem[]>([{ product_id: null, product_name: '', qty: 1, rate: 0 }])
  const [products, setProducts] = useState<Product[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load products
    fetch('/api/masters/products').then(r => r.json()).then(d => {
      setProducts(Array.isArray(d) ? d : [])
    }).catch(() => toast('Failed to load products', 'error')).finally(() => {})

    // Load existing order
    fetch(`/api/orders?visitId=${visit.id}`).then(r => r.json()).then(d => {
      if (d?.order_items?.length) {
        setItems(d.order_items.map((i: { product_id: string | null; product_name: string; qty: number; rate: number }) => ({
          product_id: i.product_id,
          product_name: i.product_name,
          qty: i.qty,
          rate: Number(i.rate),
        })))
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [visit.id])

  function addRow() {
    setItems(prev => [...prev, { product_id: null, product_name: '', qty: 1, rate: 0 }])
  }

  function removeRow(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function updateRow(idx: number, field: keyof OrderItem, value: string | number | null) {
    setItems(prev => prev.map((row, i) => i !== idx ? row : { ...row, [field]: value }))
  }

  function onProductSelect(idx: number, productId: string) {
    const p = products.find(p => p.id === productId)
    if (p) {
      setItems(prev => prev.map((row, i) => i !== idx ? row : {
        ...row, product_id: p.id, product_name: p.name, rate: Number(p.price)
      }))
    } else {
      updateRow(idx, 'product_id', null)
    }
  }

  const total = items.reduce((s, i) => s + i.qty * i.rate, 0)

  async function handleSave() {
    const validItems = items.filter(i => i.product_name.trim())
    if (validItems.length === 0) { toast('Add at least one product', 'error'); return }
    setSaving(true)
    const r = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visit_id: visit.id, order_date: visit.start_time?.split('T')[0] ?? toDateStr(new Date()), items: validItems }),
    })
    if (!r.ok) { toast((await r.json()).error ?? 'Failed to save order', 'error') }
    else { toast('Order saved'); onSaved(); onClose() }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h3 className="font-medium text-gray-900">Order Entry</h3>
            <p className="text-xs text-gray-500 mt-0.5">{visit.entity_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? <div className="text-center py-8 text-gray-400">Loading...</div> : (
            <>
              {/* Column headers */}
              <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-medium text-gray-500 px-1">
                <div className="col-span-5">Product</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-2 text-center">Rate</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-1" />
              </div>

              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <select
                        value={item.product_id ?? ''}
                        onChange={e => {
                          if (e.target.value === '') {
                            updateRow(idx, 'product_id', null)
                          } else {
                            onProductSelect(idx, e.target.value)
                          }
                        }}
                        className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        <option value="">Select product...</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {!item.product_id && (
                        <input type="text" value={item.product_name} onChange={e => updateRow(idx, 'product_name', e.target.value)}
                          placeholder="Or type name..."
                          className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      )}
                    </div>
                    <div className="col-span-2">
                      <input type="number" min="1" value={item.qty} onChange={e => updateRow(idx, 'qty', Math.max(1, Number(e.target.value)))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="col-span-2">
                      <input type="number" min="0" step="0.01" value={item.rate} onChange={e => updateRow(idx, 'rate', Number(e.target.value))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="col-span-2 text-right text-sm font-medium text-gray-700 pr-1">
                      ₹{(item.qty * item.rate).toFixed(0)}
                    </div>
                    <div className="col-span-1 flex justify-center">
                      {items.length > 1 && (
                        <button onClick={() => removeRow(idx)} className="p-1 text-gray-400 hover:text-red-500 transition">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={addRow} className="mt-3 w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 hover:border-blue-300 hover:text-blue-500 transition flex items-center justify-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                Add Row
              </button>

              <div className="mt-4 flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
                <span className="text-sm text-gray-600">Total:</span>
                <span className="text-lg font-medium text-gray-900">₹{total.toFixed(0)}</span>
              </div>
            </>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-2 border-t border-gray-100 pt-4 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-40 transition">
            {saving ? 'Saving...' : 'Save Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Tab: Plan ----
function PlanTab({ selectedDate }: { selectedDate: string }) {
  const [planDay, setPlanDay] = useState<PlanDay>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/weekly-plans/day?date=${selectedDate}`)
      .then(r => r.json())
      .then(d => { setPlanDay(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedDate])

  if (loading) return <div className="text-center py-12 text-gray-400">Loading plan...</div>
  if (!planDay || planDay.items.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
          </svg>
        </div>
        <p className="text-gray-500 font-medium">No plan found for this day</p>
        <p className="text-xs text-gray-400 mt-1">Go to Weekly Plan to add entries</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {planDay.plan_status && (
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-4 px-1">
          <span>Weekly Plan Status:</span>
          <span className="font-medium text-gray-700">{planDay.plan_status}</span>
        </div>
      )}
      {planDay.items.map((item) => (
        <div key={item.id} className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-medium text-gray-900">{item.from_place || '—'}</p>
              {item.to_place && <p className="text-xs text-gray-500 mt-0.5">To: {item.to_place}</p>}
              <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-600">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />Dist. target: <strong>{item.existing_dealers_goal}</strong></span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />Dealer target: <strong>{item.new_dealers_goal}</strong></span>
                {item.mode_of_travel && <span className="flex items-center gap-1">Travel: <strong>{item.mode_of_travel}</strong></span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Tab: Expenses ----
function ExpensesTab({ selectedDate, onOpenRemarks, isFuture }: { selectedDate: string; onOpenRemarks: (id: string) => void; isFuture?: boolean }) {
  const { toast } = useToast()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  const CATEGORY_COLORS: Record<string, string> = {
    Travel: 'bg-blue-100 text-blue-700',
    Food: 'bg-orange-100 text-orange-700',
    Accommodation: 'bg-purple-100 text-purple-700',
    Phone: 'bg-teal-100 text-teal-700',
    Stationary: 'bg-yellow-100 text-yellow-700',
    Miscellaneous: 'bg-gray-100 text-gray-600',
  }

  const loadExpenses = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/expenses?date=${selectedDate}`)
    if (r.ok) setExpenses(await r.json())
    setLoading(false)
  }, [selectedDate])

  useEffect(() => { loadExpenses() }, [loadExpenses])

  async function handleAdd(partial: Partial<Expense>) {
    if (isFuture) { toast('Cannot create expenses for future dates', 'error'); return }
    const r = await fetch('/api/expenses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...partial, expense_date: selectedDate }),
    })
    if (!r.ok) { toast((await r.json()).error, 'error'); return }
    setShowAdd(false)
    loadExpenses()
  }

  async function handleDelete(id: string) {
    const r = await fetch(`/api/expenses/${id}`, { method: 'DELETE' })
    if (!r.ok) { toast('Failed to delete expense', 'error'); return }
    loadExpenses()
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div>
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : expenses.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          </div>
          <p className="text-gray-500 font-medium">No expenses logged</p>
          <p className="text-xs text-gray-400 mt-1">Tap + to add an expense</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Total bar */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl text-sm mb-2">
            <span className="text-gray-600">{expenses.length} expense{expenses.length !== 1 ? 's' : ''}</span>
            <span className="font-medium text-gray-800">Total: ₹{total.toFixed(0)}</span>
          </div>
          {expenses.map(exp => (
            <div key={exp.id} className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-normal px-2 py-0.5 rounded-full ${CATEGORY_COLORS[exp.category] ?? 'bg-gray-100 text-gray-600'}`}>
                      {exp.category}
                    </span>
                    <span className="text-base font-medium text-gray-900 ml-auto">₹{Number(exp.amount).toFixed(0)}</span>
                  </div>
                  {exp.notes && <p className="text-sm text-gray-500 mt-1.5">{exp.notes}</p>}
                  {exp.photo_url && (
                    <a href={exp.photo_url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                      <img src={exp.photo_url} alt="Receipt" className="h-20 w-auto rounded-lg border border-gray-200 object-cover hover:opacity-90 transition" />
                    </a>
                  )}
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-end gap-2">
                <button onClick={() => handleDelete(exp.id)} className="text-xs text-gray-400 hover:text-red-500 transition">Delete</button>
                <button onClick={() => onOpenRemarks(exp.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition" title="Remarks">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddExpenseModal onClose={() => setShowAdd(false)} onAdd={handleAdd} />}

      {/* FAB */}
      {!isFuture && (
        <button onClick={() => setShowAdd(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 transition z-30">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ---- Tab: Summary ----
function SummaryTab({ selectedDate, visits, expenses, planDay }: {
  selectedDate: string
  visits: Visit[]
  expenses: Expense[]
  planDay: PlanDay
}) {
  const completed = visits.filter(v => v.status === 'Completed').length
  const active = visits.filter(v => v.status === 'Active').length
  const pending = visits.filter(v => v.status === 'Pending').length
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="space-y-5">
      {/* Plan section */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-1.5 h-4 bg-blue-500 rounded-full inline-block" />
          Planned
        </h3>
        {!planDay || planDay.items.length === 0 ? (
          <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3">No plan for this day</p>
        ) : (
          <div className="space-y-2">
            {planDay.items.map(item => (
              <div key={item.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <p className="text-sm font-medium text-gray-800">{item.from_place || '—'}</p>
                <div className="flex gap-4 mt-1 text-xs text-gray-500">
                  <span>Dist. target: <strong>{item.existing_dealers_goal}</strong></span>
                  <span>Dealer target: <strong>{item.new_dealers_goal}</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actual section */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-1.5 h-4 bg-emerald-500 rounded-full inline-block" />
          Actual
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-gray-200 rounded-2xl px-4 py-4">
            <p className="text-xs text-gray-500 mb-1">Meetings</p>
            <p className="text-2xl font-medium text-gray-900">{visits.length}</p>
            <div className="flex gap-2 mt-1 text-xs">
              {completed > 0 && <span className="text-emerald-600">{completed} done</span>}
              {active > 0 && <span className="text-amber-600">{active} active</span>}
              {pending > 0 && <span className="text-gray-500">{pending} pending</span>}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl px-4 py-4">
            <p className="text-xs text-gray-500 mb-1">Expenses</p>
            <p className="text-2xl font-medium text-gray-900">₹{totalExpenses.toFixed(0)}</p>
            <p className="text-xs text-gray-400 mt-1">{expenses.length} entr{expenses.length !== 1 ? 'ies' : 'y'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Main Page (inner — uses useSearchParams, must be inside Suspense) ----
// ---- Attendance Card ----
type AttendanceRecord = {
  id: string
  check_in_time: string | null
  check_in_latitude: number | null
  check_in_longitude: number | null
  check_out_time: string | null
  check_out_latitude: number | null
  check_out_longitude: number | null
}

function AttendanceCard() {
  const { toast } = useToast()
  const todayStr = toDateStr(new Date())
  const [record, setRecord] = useState<AttendanceRecord | null | undefined>(undefined)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    fetch(`/api/attendance?date=${todayStr}`)
      .then(r => r.json())
      .then(setRecord)
      .catch(() => setRecord(null))
  }, [todayStr])

  function getLocation(): Promise<{ latitude: number; longitude: number } | null> {
    return new Promise(resolve => {
      if (!navigator.geolocation) { resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 8000 }
      )
    })
  }

  async function handleCheckIn() {
    setActing(true)
    const loc = await getLocation()
    const res = await fetch('/api/attendance/check-in', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loc ?? {})
    })
    const data = await res.json()
    if (!res.ok) { toast(data.error ?? 'Check-in failed', 'error') }
    else { toast('Checked in successfully', 'success'); setRecord(data) }
    setActing(false)
  }

  async function handleCheckOut() {
    setActing(true)
    const loc = await getLocation()
    const res = await fetch('/api/attendance/check-out', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loc ?? {})
    })
    const data = await res.json()
    if (!res.ok) { toast(data.error ?? 'Check-out failed', 'error') }
    else { toast('Checked out successfully', 'success'); setRecord(data) }
    setActing(false)
  }

  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  const fmtCoords = (lat: number | null, lng: number | null) =>
    lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : null

  if (record === undefined) return null

  const checkedIn  = !!record?.check_in_time
  const checkedOut = !!record?.check_out_time

  return (
    <div className={`rounded-xl border px-4 py-3 mb-4 flex items-center gap-4 ${
      checkedOut ? 'bg-gray-50 border-gray-200' :
      checkedIn  ? 'bg-amber-50 border-amber-200' :
                   'bg-green-50 border-green-200'
    }`}>
      {/* Status dot */}
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${checkedOut ? 'bg-gray-400' : checkedIn ? 'bg-amber-500' : 'bg-green-500'}`} />

      {/* Info */}
      <div className="flex-1 min-w-0">
        {!checkedIn && (
          <p className="text-sm font-medium text-green-800">Not checked in yet</p>
        )}
        {checkedIn && (
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-gray-800">
              In: <span className="font-medium">{fmtTime(record!.check_in_time!)}</span>
              {fmtCoords(record!.check_in_latitude, record!.check_in_longitude) &&
                <span className="ml-2 text-xs text-gray-500">{fmtCoords(record!.check_in_latitude, record!.check_in_longitude)}</span>
              }
            </p>
            {checkedOut && (
              <p className="text-sm text-gray-600">
                Out: <span className="font-medium">{fmtTime(record!.check_out_time!)}</span>
                {fmtCoords(record!.check_out_latitude, record!.check_out_longitude) &&
                  <span className="ml-2 text-xs text-gray-500">{fmtCoords(record!.check_out_latitude, record!.check_out_longitude)}</span>
                }
              </p>
            )}
          </div>
        )}
      </div>

      {/* Action button */}
      {!checkedIn && (
        <button onClick={handleCheckIn} disabled={acting}
          className="flex-shrink-0 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition">
          {acting ? 'Locating…' : 'Check In'}
        </button>
      )}
      {checkedIn && !checkedOut && (
        <button onClick={handleCheckOut} disabled={acting}
          className="flex-shrink-0 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition">
          {acting ? 'Locating…' : 'Check Out'}
        </button>
      )}
      {checkedOut && (
        <span className="flex-shrink-0 text-xs font-medium text-gray-500 bg-gray-100 px-3 py-1.5 rounded-lg">Done</span>
      )}
    </div>
  )
}

function DailyActivityInner() {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()

  // Date + week navigation
  const [selectedDate, setSelectedDate] = useState(() => {
    return searchParams.get('date') ?? toDateStr(new Date())
  })

  // Offset in weeks from current week (0 = current, -1 = last, etc.)
  const [weekOffset, setWeekOffset] = useState(0)

  // Active tab
  const initialTab = (searchParams.get('tab') as 'plan' | 'meetings' | 'expenses' | 'summary') ?? 'meetings'
  const [activeTab, setActiveTab] = useState<'plan' | 'meetings' | 'expenses' | 'summary'>(initialTab)

  // Visits state
  const [visits, setVisits] = useState<Visit[]>([])
  const [visitLoading, setVisitLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [showMeetingModal, setShowMeetingModal] = useState(false)
  const [locationDenied, setLocationDenied] = useState<{ visitId: string; action: 'start' | 'stop' } | null>(null)
  const [orderEntry, setOrderEntry] = useState<Visit | null>(null)

  // Expenses (loaded by ExpensesTab but also needed for Summary)
  const [summaryExpenses, setSummaryExpenses] = useState<Expense[]>([])
  const [planDay, setPlanDay] = useState<PlanDay>(null)

  // Remarks panel
  const [remarksPanel, setRemarksPanel] = useState<{ contextType: 'meeting' | 'expense'; contextId: string; title: string } | null>(null)
  const initialRemarks = searchParams.get('remarks')

  useEffect(() => {
    if (initialRemarks) {
      setRemarksPanel({ contextType: 'meeting', contextId: initialRemarks, title: 'Remarks' })
    }
  }, [initialRemarks])

  // Compute week start given weekOffset
  function getWeekStartForOffset(offset: number) {
    const today = new Date()
    const day = today.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(today)
    monday.setDate(today.getDate() + diff + offset * 7)
    monday.setHours(0, 0, 0, 0)
    return monday
  }

  // When offset changes, reset selected date to Monday of new week
  const handlePrevWeek = useCallback(() => {
    const newOffset = weekOffset - 1
    setWeekOffset(newOffset)
    const monday = getWeekStartForOffset(newOffset)
    setSelectedDate(toDateStr(monday))
  }, [weekOffset])

  const handleNextWeek = useCallback(() => {
    const newOffset = weekOffset + 1
    setWeekOffset(newOffset)
    const monday = getWeekStartForOffset(newOffset)
    setSelectedDate(toDateStr(monday))
  }, [weekOffset])

  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date)
  }, [])

  // Load visits for selected date
  const loadVisits = useCallback(async () => {
    setVisitLoading(true)
    const r = await fetch(`/api/daily-activity?date=${selectedDate}`)
    if (r.ok) setVisits(await r.json())
    setVisitLoading(false)
  }, [selectedDate])

  useEffect(() => { loadVisits() }, [loadVisits])

  // Load plan + expenses for Summary tab
  useEffect(() => {
    fetch(`/api/weekly-plans/day?date=${selectedDate}`).then(r => r.json()).then(d => setPlanDay(d)).catch(() => toast('Failed to load plan data', 'error'))
    fetch(`/api/expenses?date=${selectedDate}`).then(r => r.json()).then(d => {
      if (Array.isArray(d)) setSummaryExpenses(d)
    }).catch(() => toast('Failed to load expenses', 'error'))
  }, [selectedDate])

  const isFuture = selectedDate > toDateStr(new Date())

  async function handleAdd(partial: Partial<Visit>) {
    if (isFuture) { toast('Cannot create meetings for future dates', 'error'); return }
    const r = await fetch('/api/daily-activity', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...partial, visit_date: selectedDate }),
    })
    if (!r.ok) { toast((await r.json()).error, 'error'); return }
    setShowMeetingModal(false)
    loadVisits()
  }

  async function handleStart(id: string) {
    if (acting) return
    setActing(true)
    let latitude: number | null = null
    let longitude: number | null = null
    let address: string | null = null
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
      )
      latitude = pos.coords.latitude
      longitude = pos.coords.longitude
      try {
        const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`)
        const geoData = await geo.json()
        address = geoData.display_name ?? null
      } catch { /* ignore */ }
    } catch (err) {
      const code = (err as GeolocationPositionError)?.code
      if (code === 1 /* PERMISSION_DENIED */) {
        setActing(false)
        setLocationDenied({ visitId: id, action: 'start' })
        return
      }
      // Timeout or unavailable — proceed without GPS
    }
    const r = await fetch(`/api/daily-activity/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', latitude, longitude, address }),
    })
    if (!r.ok) {
      const err = await r.json()
      toast(err.error, 'error')
      if (err.error?.includes('active')) loadVisits() // refresh so user can see the active meeting
    } else {
      loadVisits()
    }
    setActing(false)
  }

  async function handleStop(id: string) {
    if (acting) return
    setActing(true)
    let end_latitude: number | null = null
    let end_longitude: number | null = null
    let end_address: string | null = null
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
      )
      end_latitude = pos.coords.latitude
      end_longitude = pos.coords.longitude
      try {
        const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${end_latitude}&lon=${end_longitude}&format=json`)
        const geoData = await geo.json()
        end_address = geoData.display_name ?? null
      } catch { /* ignore */ }
    } catch (err) {
      const code = (err as GeolocationPositionError)?.code
      if (code === 1 /* PERMISSION_DENIED */) {
        setActing(false)
        setLocationDenied({ visitId: id, action: 'stop' })
        return
      }
      // Timeout or unavailable — proceed without GPS
    }
    const r = await fetch(`/api/daily-activity/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', end_latitude, end_longitude, end_address }),
    })
    if (!r.ok) { toast((await r.json()).error, 'error') } else { loadVisits() }
    setActing(false)
  }

  async function handleDelete(id: string) {
    const r = await fetch(`/api/daily-activity/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    })
    if (!r.ok) { toast((await r.json()).error, 'error') } else { loadVisits() }
  }

  async function handleNotesUpdate(id: string, notes: string) {
    const r = await fetch(`/api/daily-activity/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_notes', notes }),
    })
    if (r.ok) {
      const updated = await r.json()
      setVisits(prev => prev.map(v => v.id === id ? { ...v, notes: updated.notes } : v))
    }
  }

  function handleOpenMeetingRemarks(visit: Visit) {
    setRemarksPanel({ contextType: 'meeting', contextId: visit.id, title: visit.entity_name })
  }

  function handleOpenExpenseRemarks(expenseId: string) {
    setRemarksPanel({ contextType: 'expense', contextId: expenseId, title: 'Expense Remark' })
  }

  const displayDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  const TABS = [
    { id: 'plan', label: 'Plan' },
    { id: 'meetings', label: 'Meetings' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'summary', label: 'Summary' },
  ] as const

  return (
    <div className="max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-medium text-gray-900">Daily Activity</h2>
          <p className="text-xs text-gray-400 mt-0.5">{displayDate}</p>
        </div>
      </div>

      {/* Attendance — only for today */}
      {selectedDate === toDateStr(new Date()) && <AttendanceCard />}

      {/* Week strip */}
      <WeekStrip
        selectedDate={selectedDate}
        onSelectDate={handleSelectDate}
        onPrevWeek={handlePrevWeek}
        onNextWeek={handleNextWeek}
        calendarApiBase="/api/daily-activity/calendar"
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`pb-3 px-3 text-sm font-medium border-b-2 transition ${activeTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'plan' && <PlanTab selectedDate={selectedDate} />}

      {activeTab === 'meetings' && (
        <div>
          {visitLoading ? (
            <div className="text-center py-16 text-gray-400">Loading...</div>
          ) : visits.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
              </div>
              <p className="text-gray-500 font-medium">No meetings today</p>
              <p className="text-sm text-gray-400 mt-1">Tap + to log a meeting</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-4 px-4 py-3 bg-gray-50 rounded-xl text-sm">
                <span className="text-gray-600">{visits.length} meeting{visits.length !== 1 ? 's' : ''}</span>
                {visits.some(v => v.status === 'Active') && (
                  <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />1 active
                  </span>
                )}
                {visits.filter(v => v.status === 'Completed').length > 0 && (
                  <span className="text-emerald-600">{visits.filter(v => v.status === 'Completed').length} done</span>
                )}
              </div>
              <div className="space-y-3">
                {visits.map(visit => (
                  <VisitCard key={visit.id} visit={visit}
                    onStart={handleStart} onStop={handleStop} onDelete={handleDelete}
                    onOrderEntry={setOrderEntry}
                    onRemarks={handleOpenMeetingRemarks}
                    onNotesUpdate={handleNotesUpdate} />
                ))}
              </div>
            </>
          )}

          {/* FAB */}
          {!isFuture && (
            <button onClick={() => setShowMeetingModal(true)}
              className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 transition z-30">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          )}
        </div>
      )}

      {activeTab === 'expenses' && (
        <ExpensesTab selectedDate={selectedDate} onOpenRemarks={handleOpenExpenseRemarks} isFuture={isFuture} />
      )}

      {activeTab === 'summary' && (
        <SummaryTab
          selectedDate={selectedDate}
          visits={visits}
          expenses={summaryExpenses}
          planDay={planDay}
        />
      )}

      {/* Modals */}
      {showMeetingModal && <AddMeetingModal onClose={() => setShowMeetingModal(false)} onAdd={handleAdd} />}
      {orderEntry && <OrderEntryModal visit={orderEntry} onClose={() => setOrderEntry(null)} onSaved={loadVisits} />}

      {/* Location permission denied modal */}
      {locationDenied && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <button
              onClick={() => setLocationDenied(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="flex flex-col items-center text-center gap-3 mb-5">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 text-base">Location Access Blocked</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Your browser has blocked location access. Please enable it to {locationDenied.action === 'start' ? 'start' : 'stop'} the meeting.
                </p>
              </div>
              <div className="w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-left text-xs text-amber-800 space-y-1">
                <p className="font-medium">How to enable location:</p>
                <p>• Tap the lock / info icon in your browser&apos;s address bar</p>
                <p>• Find <strong>Location</strong> and set it to <strong>Allow</strong></p>
                <p>• Then tap <strong>Try Again</strong> below</p>
              </div>
            </div>
            <button
              onClick={() => {
                const { visitId, action } = locationDenied
                setLocationDenied(null)
                if (action === 'start') handleStart(visitId)
                else handleStop(visitId)
              }}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Remarks Panel */}
      {remarksPanel && (
        <RemarksPanel
          isOpen={!!remarksPanel}
          onClose={() => {
            setRemarksPanel(null)
            // Remove ?remarks= from URL
            if (searchParams.get('remarks')) router.replace('/daily-activity')
          }}
          contextType={remarksPanel.contextType}
          contextId={remarksPanel.contextId}
          contextTitle={remarksPanel.title}
        />
      )}
    </div>
  )
}

export default function DailyActivityPage() {
  return (
    <Suspense fallback={<div className="text-center py-16 text-gray-400">Loading...</div>}>
      <DailyActivityInner />
    </Suspense>
  )
}
