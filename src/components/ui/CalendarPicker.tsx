'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

interface CalendarPickerProps {
  selectedDate: string      // YYYY-MM-DD
  onSelectDate: (d: string) => void
  onClose: () => void
  // Optional: URL to fetch filled dates from (e.g. /api/daily-activity/calendar?userId=X)
  calendarApiBase?: string
}

function toDateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function CalendarPicker({ selectedDate, onSelectDate, onClose, calendarApiBase }: CalendarPickerProps) {
  const initDate = new Date(selectedDate + 'T00:00:00')
  const [viewYear, setViewYear] = useState(initDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(initDate.getMonth()) // 0-indexed
  const [filledDates, setFilledDates] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)
  const todayStr = toDateStr(new Date())

  const monthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`

  const loadFilled = useCallback(async () => {
    if (!calendarApiBase) return
    try {
      const url = `${calendarApiBase}${calendarApiBase.includes('?') ? '&' : '?'}month=${monthKey}`
      const r = await fetch(url)
      if (r.ok) {
        const { filledDates: arr } = await r.json()
        setFilledDates(new Set(arr))
      }
    } catch { /* ignore */ }
  }, [calendarApiBase, monthKey])

  useEffect(() => { loadFilled() }, [loadFilled])

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  // Build grid: first day of month (Mon=0 offset)
  const firstDay = new Date(viewYear, viewMonth, 1)
  const dayOfWeek = firstDay.getDay() // 0=Sun, 1=Mon …
  const startOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1 // Mon-based offset
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div
      ref={panelRef}
      className="absolute z-50 top-full mt-2 right-0 bg-surface rounded-2xl border border-border-light shadow-2xl p-4 w-72 select-none"
    >
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-surface-control text-text-muted transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <span className="text-sm font-medium text-text-primary">{MONTHS[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-surface-control text-text-muted transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-normal text-text-muted py-1">{d}</div>
        ))}
      </div>

      {/* Dates grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isSelected = dateStr === selectedDate
          const isToday = dateStr === todayStr
          const isFilled = filledDates.has(dateStr)

          return (
            <button
              key={dateStr}
              onClick={() => { onSelectDate(dateStr); onClose() }}
              className={`relative flex flex-col items-center justify-center h-8 w-full rounded-lg text-xs font-medium transition
                ${isSelected
                  ? 'bg-primary text-primary-foreground'
                  : isToday
                    ? 'bg-primary-subtle text-primary font-medium'
                    : 'hover:bg-surface-control text-text-secondary'
                }`}
            >
              {day}
              {/* Filled indicator dot */}
              {isFilled && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-500" />
              )}
              {isFilled && isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-200" />
              )}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      {calendarApiBase && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border-light">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-text-muted">Has activity</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-gray-200" />
            <span className="text-[10px] text-text-muted">No activity</span>
          </div>
        </div>
      )}
    </div>
  )
}
