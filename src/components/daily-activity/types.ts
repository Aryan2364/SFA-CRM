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

export type Visit = {
  id: string
  user_id?: string
  visit_type: string
  entity_id?: string | null
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
  /** Set when the meeting came from an approved weekly-plan line. */
  weekly_plan_item_id?: string | null
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

export type Entity = { id: string; name: string }

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
