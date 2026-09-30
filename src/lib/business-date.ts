/**
 * The business calendar — what "today" means for this deployment.
 *
 * Reps' browsers run in IST and decide the date on screen from local time;
 * production servers run UTC. Taking "today" from the server process's clock
 * (`new Date().toISOString()`, or `getDate()` on a UTC box) therefore disagrees
 * with the screen for the 5½ hours between 00:00 and 05:30 IST: the day the rep
 * is looking at is rejected as "in the future", and check-in writes
 * yesterday's attendance row.
 *
 * Every server decision about which calendar day it is goes through here
 * instead, computed in `APP_TIMEZONE` (default `Asia/Kolkata`) with
 * `Intl.DateTimeFormat`, so the answer is the same on a UTC server, an IST dev
 * machine, or anywhere else.
 *
 * `APP_TIMEZONE` is server-only and read at runtime. Never give it a
 * `NEXT_PUBLIC_` prefix.
 *
 * Dates are `"YYYY-MM-DD"` strings, the same shape `dateOnlyString()` produces
 * from a `@db.Date` column, so the two compare directly. To store one in a
 * `@db.Date` column, pass it through `new Date(str)` exactly as the routes
 * already do — a bare `YYYY-MM-DD` parses as UTC midnight, which Prisma writes
 * as that same calendar date.
 */

const DEFAULT_TIMEZONE = 'Asia/Kolkata'

let cached: { zone: string; fmt: Intl.DateTimeFormat } | null = null

const makeFormatter = (timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
})

function formatter(): Intl.DateTimeFormat {
  const zone = process.env.APP_TIMEZONE?.trim() || DEFAULT_TIMEZONE
  if (cached?.zone === zone) return cached.fmt
  let fmt: Intl.DateTimeFormat
  try {
    fmt = makeFormatter(zone)
  } catch {
    // A misspelt zone must not take every date-handling route down with a
    // RangeError; fall back to the documented default.
    console.error(`[business-date] Invalid APP_TIMEZONE "${zone}", using ${DEFAULT_TIMEZONE}`)
    fmt = makeFormatter(DEFAULT_TIMEZONE)
  }
  cached = { zone, fmt }
  return fmt
}

/** Wall-clock fields of `at` in the business timezone. */
function wallClock(at: Date) {
  const parts: Record<string, number> = {}
  for (const p of formatter().formatToParts(at)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The business calendar date `at` falls on, as `"YYYY-MM-DD"`. Defaults to now. */
export function businessDate(at: Date = new Date()): string {
  const { year, month, day } = wallClock(at)
  return `${year}-${pad(month)}-${pad(day)}`
}

/** The business month `at` falls in, as `"YYYY-MM"`. Defaults to now. */
export function businessMonth(at: Date = new Date()): string {
  return businessDate(at).slice(0, 7)
}

/** `"YYYY-MM-DD"` plus `days` calendar days. Pure date arithmetic, no zone. */
export function addDays(dateOnly: string, days: number): string {
  const t = Date.parse(`${dateOnly}T00:00:00.000Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** Business-zone offset from UTC at instant `t`, in ms (IST: +19 800 000). */
function offsetAt(t: number): number {
  const w = wallClock(new Date(t))
  // Formatted fields drop milliseconds, so compare against t truncated to the second.
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(t / 1000) * 1000
}

/**
 * The instant the business day `dateOnly` begins (00:00 in the business
 * timezone). For IST, `"2026-09-28"` → `2026-09-27T18:30:00.000Z`.
 */
export function businessDayStart(dateOnly: string): Date {
  const guess = Date.parse(`${dateOnly}T00:00:00.000Z`)
  let t = guess - offsetAt(guess)
  // One correction pass covers a DST transition between the guess and the answer.
  const again = guess - offsetAt(t)
  if (again !== t) t = again
  return new Date(t)
}

/**
 * Half-open instant range `[gte, lt)` covering the whole business day
 * `dateOnly`, for filtering a timestamptz column by business date.
 */
export function businessDayRange(dateOnly: string): { gte: Date; lt: Date } {
  return { gte: businessDayStart(dateOnly), lt: businessDayStart(addDays(dateOnly, 1)) }
}
