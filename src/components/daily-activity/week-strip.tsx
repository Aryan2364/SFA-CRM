'use client'

import { useState, useEffect, useCallback, type ComponentProps } from 'react'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar, CalendarDayButton } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
  const [viewMonth, setViewMonth] = useState(() => new Date(selectedDate + 'T00:00:00'))
  const [filledDates, setFilledDates] = useState<Set<string>>(new Set())

  const loadFilled = useCallback(async () => {
    if (!calendarApiBase) return
    const monthKey = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}`
    try {
      const url = `${calendarApiBase}${calendarApiBase.includes('?') ? '&' : '?'}month=${monthKey}`
      const r = await fetch(url)
      if (r.ok) {
        const { filledDates: arr } = await r.json()
        setFilledDates(new Set(arr))
      }
    } catch { /* ignore */ }
  }, [calendarApiBase, viewMonth])

  useEffect(() => { if (showCalendar) loadFilled() }, [showCalendar, loadFilled])

  function FilledDayButton(dayProps: ComponentProps<typeof CalendarDayButton>) {
    const dateStr = toDateStr(dayProps.day.date)
    const isFilled = filledDates.has(dateStr)
    return (
      <CalendarDayButton {...dayProps}>
        {dayProps.children}
        {isFilled && (
          <span
            className={`pointer-events-none absolute bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full ${
              dayProps.modifiers.selected ? 'bg-primary-foreground/60' : 'bg-success'
            }`}
          />
        )}
      </CalendarDayButton>
    )
  }

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
        <Popover open={showCalendar} onOpenChange={setShowCalendar}>
          <PopoverTrigger
            render={
              <Button variant="ghost" size="sm" aria-label="Open calendar" className="shrink-0">
                <CalendarIcon />
              </Button>
            }
          />
          <PopoverContent align="end" className="w-auto p-2">
            <Calendar
              mode="single"
              month={viewMonth}
              onMonthChange={setViewMonth}
              selected={new Date(selectedDate + 'T00:00:00')}
              onSelect={d => { if (d) { onSelectDate(toDateStr(d)); setShowCalendar(false) } }}
              components={calendarApiBase ? { DayButton: FilledDayButton } : undefined}
            />
            {calendarApiBase && (
              <div className="flex items-center gap-1.5 border-t border-border-light px-1 pt-2">
                <span className="size-2 rounded-full bg-success" />
                <span className="text-meta text-text-muted">Has activity</span>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
