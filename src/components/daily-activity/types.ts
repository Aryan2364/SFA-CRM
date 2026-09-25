/**
 * P3-T5 (§5.3). The Daily Activity screen's shared vocabulary.
 *
 * The screen was one 1685-line file. It is split here so that P3-T7
 * (the start/stop toggle), P3-T9 (inside-a-meeting), P3-T10 (past /
 * manual entry) and P3-T11 (cross-links) each have one small file to
 * attach to instead of a scroll position.
 */

export type NewProspectPayload = {
  name: string
  mobile_1: string | null
  state_id: string | null
  district_id: string | null
  taluka_id: string | null
  village_id: string | null
}

/** The PERSON a meeting was with, from `daily_visits.contact_id`. */
export type VisitContact = { id: string; name: string; designation: string | null }

export type Visit = {
  id: string
  user_id?: string
  visit_type: string
  entity_id?: string | null
  entity_name: string
  /**
   * The person met, as a real reference rather than text.
   *
   * ⚠️ `null` means EITHER "this meeting named no person" OR "the
   * `daily_visits.contact_id` column has not been pushed yet". Nothing on
   * screen needs to tell those apart, because `entity_name` already carries
   * the person's name either way — it is written as "Ramesh Kumar · ACME
   * Traders" when a person is named. Use this field for linking and filtering,
   * never as the only source of the displayed name.
   */
  contact?: VisitContact | null
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
  /** Set when the meeting came from an approved weekly-plan line. */
  weekly_plan_item_id?: string | null
  /**
   * P3-T10 (§5.3) — the meeting was typed in after the fact rather than
   * timed live, so its start and end are somebody's recollection.
   *
   * The card marks it, because a hand-typed duration must never be read as
   * a captured one. It carries no other consequence: nothing is blocked and
   * nothing is recomputed from it.
   */
  is_manual_entry?: boolean
  /**
   * §5.4's location flag, decided SERVER-SIDE on stop: a real Haversine
   * distance in metres against the tenant's `location_flag_threshold_m`
   * (default 500). See `src/lib/geo.ts`.
   *
   * It is `false` — not true — when either fix is missing, which is the
   * common case on a geolocation timeout. Unknown is not evidence.
   *
   * ⚠️ DISPLAY ONLY. Nothing is blocked, nobody is notified. Do not make
   * anything else depend on this boolean.
   */
  location_flagged?: boolean
}

/**
 * A pickable party from `/api/business-partners`.
 *
 * `type` is the party's own `companies.type` and `stage` its funnel stage.
 * Both arrived with F6: once the meeting form stopped asking the user to
 * choose a lead type and a stage, the party's own values became the only
 * honest source for `daily_visits.visit_type` and for the Lead/Existing
 * marker in the list. Both are optional because the route did not always
 * return them.
 */
export type Entity = { id: string; name: string; type?: string | null; stage?: string | null }

export type Expense = {
  id: string
  category: string
  amount: number
  notes: string | null
  expense_date: string
  photo_url: string | null
}

/**
 * One line of an APPROVED weekly plan, for the day in view.
 *
 * `party_id` is nullable in the schema and null on every seeded row, so
 * a planned line is NOT guaranteed to name someone to meet — half of
 * these are route lines (from → to plus goals). The card renders both
 * shapes; only the party-linked shape can start a meeting with no
 * selection step.
 */
export type PlannedItem = {
  id: string
  plan_date: string
  from_place: string | null
  to_place: string | null
  new_dealers_goal: number | null
  existing_dealers_goal: number | null
  others_goal: number | null
  mode_of_travel: string | null
  notes: string | null
  party_id: string | null
  party_type: string | null
  party_name: string | null
  /** The party's own `companies.type`, so a meeting started from the plan
   *  is filed under the same lead type the party has. */
  party_visit_type: string | null
  expected_order_value: number | null
  user_id: string
  user_name: string
}

export type OrderItem = { product_id: string | null; product_name: string; qty: number; rate: number }
export type Product = { id: string; name: string; price: number }

export type AttendanceRecord = {
  id: string
  date: string
  check_in_time: string | null
  check_in_latitude: number | null
  check_in_longitude: number | null
  check_in_address: string | null
  check_out_time: string | null
  check_out_latitude: number | null
  check_out_longitude: number | null
  check_out_address: string | null
}

// ---- Formatting helpers (pure, shared by every card) ----

export function formatDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

/**
 * The local calendar date as "YYYY-MM-DD".
 *
 * NOT `toISOString().split('T')[0]` — that is UTC, and this machine runs
 * IST, so between 00:00 and 05:30 local it answers yesterday. Every date
 * the screen sends to the server goes through here.
 */
export function toDateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getWeekDates(baseDate: Date): Date[] {
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

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Browser geolocation, resolving to null rather than throwing on
 * anything except an explicit denial.
 *
 * P3-T7's note applies here: on PERMISSION_DENIED the caller aborts and
 * shows the dialog; on timeout it proceeds with nulls. So lat/long are
 * nullable in practice and every consumer must handle null.
 */
export function getPosition(): Promise<{ latitude: number; longitude: number } | { denied: true } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      err => resolve(err?.code === 1 ? { denied: true } : null),
      { timeout: 8000 }
    )
  })
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  /*
   * P3-T7: this used to `fetch('https://nominatim.openstreetmap.org/…')`
   * straight from the browser — an unkeyed third party, reached from the
   * user's own IP, with no identifying User-Agent (a browser cannot send
   * one), no rate-limit handling, and the 403/429 swallowed by the catch
   * so it looked like an ordinary geocoding miss.
   *
   * It now goes through the app, which identifies itself, serialises
   * calls to one per second and caches. See
   * `src/app/api/daily-activity/reverse-geocode/route.ts`.
   *
   * The address is decoration; the flag is computed from the numbers. So
   * a failure here still resolves to null and the start/stop proceeds.
   */
  try {
    const r = await fetch('/api/daily-activity/reverse-geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: lat, longitude: lng }),
    })
    if (!r.ok) return null
    const d = (await r.json()) as { address?: string | null }
    return d.address ?? null
  } catch {
    return null
  }
}

// ---- Attendance state (F3) ----

/**
 * The four honest readings of an attendance row, in one place so the
 * compact chip and the expanded panel can never disagree.
 *
 * F3: **"Absent" is a claim about the past.** A day that has not
 * happened yet cannot have had attendance recorded, so a future date
 * reads `not-yet`, never `absent`. Today with no check-in is
 * `not-marked` — still open, not yet a failure. Only a PAST day with no
 * check-in is `absent`.
 */
export type AttendanceState = 'present' | 'not-marked' | 'not-yet' | 'absent'

export function attendanceState(
  dateStr: string,
  record: AttendanceRecord | null | undefined
): AttendanceState {
  if (record?.check_in_time) return 'present'
  const today = toDateStr(new Date())
  if (dateStr > today) return 'not-yet'
  if (dateStr === today) return 'not-marked'
  return 'absent'
}

export const ATTENDANCE_LABEL: Record<AttendanceState, string> = {
  present: 'Present',
  'not-marked': 'Not marked present',
  'not-yet': 'Not yet',
  absent: 'Absent',
}

export const ATTENDANCE_SENTENCE: Record<AttendanceState, string> = {
  present: 'Working hours are running.',
  'not-marked': 'Check in to mark yourself present and start counting working hours.',
  'not-yet': 'This day has not happened yet, so there is nothing to record.',
  absent: 'No attendance was recorded on this day.',
}

/**
 * F1 — a worked duration that can never read negative.
 *
 * The bug: `now` was captured once by `useState(() => Date.now())` at
 * mount and only refreshed by a 30s interval that did not exist until
 * `checkedIn` became true. Press Check in an hour after the page loaded
 * and the very first render computed `mountTime - checkInTime`, i.e.
 * MINUS one hour — which the old `${Math.floor(ms/3_600_000)}h
 * ${Math.floor((ms%3_600_000)/60_000)}m` formatter rendered literally as
 * `-1h -1m`. Thirty seconds later the interval fired, `now` caught up and
 * it "self-corrected". Nothing to do with the IST/UTC skew: 1h1m is how
 * long that tab had been open.
 *
 * The clock is fixed at the call site. This is the belt-and-braces half:
 * a clock that disagrees with itself reads `0h 0m`, never a negative.
 */
export function formatWorked(ms: number) {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  return `${Math.floor(safe / 3_600_000)}h ${Math.floor((safe % 3_600_000) / 60_000)}m`
}
