'use client'

import { useState } from 'react'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import CalendarPicker from '@/components/ui/CalendarPicker'
import { DAY_LABELS, getWeekDates, toDateStr } from './types'

/**
 * The seven-day strip. Unchanged in behaviour from the legacy screen —
 * it is lifted out of the 1685-line file so the page shell is readable,
 * not redesigned.
 *
 * It lives in the pinned header, so its own height is fixed and only the
 * day list below it scrolls.
 */
export function WeekStrip({
  selectedDate,
  onSelectDate,
  onPrevWeek,
  onNextWeek,
  calendarApiBase,
}: {
  selectedDate: string
  onSelectDate: (d: string) => void
  onPrevWeek: () => void
  onNextWeek: () => void
  calendarApiBase?: string
}) {
  const todayStr = toDateStr(new Date())
  const weekDates = getWeekDates(new Date(selectedDate + 'T00:00:00'))
  const [showCalendar, setShowCalendar] = useState(false)

  return (
    <div className="relative">
      <div className="flex items-center gap-1 rounded-xl border border-border-light bg-surface px-2 py-1.5">
        <Button variant="ghost" size="sm" onClick={onPrevWeek} aria-label="Previous week" className="shrink-0">
          <ChevronLeftIcon />
        </Button>

        <div className="flex flex-1 items-center justify-between gap-0.5">
          {weekDates.map((d, i) => {
            const ds = toDateStr(d)
            const isSelected = ds === selectedDate
            const isToday = ds === todayStr
            return (
              <button
                key={ds}
                onClick={() => onSelectDate(ds)}
                aria-current={isSelected ? 'date' : undefined}
                className={[
                  'relative flex min-h-11 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1.5 transition-colors duration-200',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'text-text-secondary hover:bg-surface-control',
                ].join(' ')}
              >
                <span className={`text-meta uppercase ${isSelected ? 'text-primary-foreground' : 'text-text-muted'}`}>
                  {DAY_LABELS[i]}
                </span>
                <span
                  className={`text-body font-medium ${
                    isSelected ? 'text-primary-foreground' : isToday ? 'text-primary' : 'text-text-primary'
                  }`}
                >
                  {d.getDate()}
                </span>
                {isToday && (
                  <span
                    className={`absolute bottom-0.5 size-1 rounded-full ${isSelected ? 'bg-primary-foreground' : 'bg-primary'}`}
                  />
                )}
              </button>
            )
          })}
        </div>

        <Button variant="ghost" size="sm" onClick={onNextWeek} aria-label="Next week" className="shrink-0">
          <ChevronRightIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowCalendar(v => !v)}
          aria-label="Open calendar"
          className="shrink-0"
        >
          <CalendarIcon />
        </Button>
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
