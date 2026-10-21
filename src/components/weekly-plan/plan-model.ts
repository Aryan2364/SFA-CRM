import type { ItemsDiff } from '@/lib/weekly-plan-diff'
import type { PlanLineDraft } from '@/components/weekly-plan/plan-line-dialog'

/*
 * The weekly-plan editor's model: types, date helpers and the two payload
 * builders. Moved out of the desktop page VERBATIM so the phone screen reads
 * and writes a plan with exactly the same rules. Next.js forbids a page file
 * from exporting anything but its page, which is why this is a module.
 */

// ---- helpers ----
export function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}
export function toDateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
export function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
export function buildWeekDays(monday: Date) { return Array.from({ length: 7 }, (_, i) => toDateStr(addDays(monday, i))) }

/** The column heading: "Mon 15 Sep". Short, because the column is 280px. */
export function formatDayColumn(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const weekday = d.toLocaleDateString('en-IN', { weekday: 'short' })
  const month = d.toLocaleDateString('en-IN', { month: 'short' })
  return `${weekday} ${d.getDate()} ${month}`
}

/** The dialog's subtitle, where there is room for the long form. */
export function formatDayLong(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short' })
}

export function formatWeekRange(monday: Date) {
  const sun = addDays(monday, 6)
  const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })} ${d.getFullYear()}`
  return `${fmt(monday)} to ${fmt(sun)}`
}

export function formatCountdown(secs: number) {
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
export const BARE_NUMBER = /^\s*\d+(\.\d+)?\s*$/
export function readOthers(othersGoal: number | null | undefined, notes: string | null | undefined): number {
  if (othersGoal && othersGoal > 0) return othersGoal
  if (!notes || !BARE_NUMBER.test(notes)) return 0
  return Math.max(0, Math.trunc(Number(notes)))
}
export function carriedNote(notes: string | null | undefined): string {
  return notes && !BARE_NUMBER.test(notes) ? notes : ''
}

export const PLACEHOLDER_TYPE = '—'

/** One planned line. §5.1: a line is a PARTY, not a place. */
export type PlanEntry = PlanLineDraft
export type DayData = { [dateStr: string]: PlanEntry[] }

/** A checklist row. `id` is null until it has been saved. */
export type Goal = { key: string; id: string | null; text: string; is_done: boolean }

export type PlanItem = {
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

export type Plan = {
  id: string; status: string; submitted_at: string | null; manager_comment: string | null
  reopen_requested: boolean; reopen_request_message: string | null
  weekly_plan_items: PlanItem[]
  week_start_date: string; week_end_date: string
  day_notes?: Record<string, string>
  weekly_goals?: { id: string; text: string; is_done: boolean; sort_order: number }[]
  /**
   * The version the plan was read at. Save and Submit send it back as
   * `expected_version`, so a save from a screen loaded before a manager edit
   * is refused (409) instead of silently replacing the manager's lines.
   */
  version?: string | null
}

/**
 * `changes` is §5.2's before/after, already parsed by the logs route — null for
 * every action that recorded none. The casing of `action_type` is the API's,
 * never this screen's: 'EditByManager' is the ACTION, 'Edited by Manager' is
 * the STATUS, and the two are compared against different fields below.
 */
export type LogEntry = { id: string; action_type: string; actor_role: string; timestamp: string; previous_status: string | null; new_status: string | null; comment: string | null; users?: { name: string }; changes?: ItemsDiff | null }

/** A selectable party — a Company or a Contact, flattened into one list. */
export type PlanPartyOption = {
  id: string
  type: 'company' | 'contact'
  name: string
  /** The Company Type from the master. Read-only wherever it is shown. */
  companyType: string
  /** For a Contact, the company it hangs off; for a Company, its stage. */
  subtitle: string
}

let _entryId = 0
export function newEntryId() { return `e${++_entryId}` }

export function blankEntry(): PlanEntry {
  return {
    id: newEntryId(), partyId: '', partyType: '', dist: 0, dealer: 0, others: 0,
    expectedOrderValue: '', fromPlace: '', toPlace: '', modeOfTravel: '', note: '',
  }
}

export function planItemsToDayData(items: PlanItem[], weekDays: string[]): DayData {
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
export function dayDataToPlanItems(dayData: DayData) {
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

export function goalsFromPlan(plan: Plan | null): Goal[] {
  const rows = plan?.weekly_goals ?? []
  return rows.map(g => ({ key: g.id, id: g.id, text: g.text, is_done: g.is_done }))
}

let _goalKey = 0
export function blankGoal(): Goal { return { key: `g${++_goalKey}`, id: null, text: '', is_done: false } }

/**
 * §5.1: "Show 5 blank rows by default, with an 'Add' option below. No upper
 * limit." Padding on render rather than on load means the five blanks are a
 * property of the FORM, so they are never saved as five empty goals.
 */
export const MIN_GOAL_ROWS = 5
export function padGoals(goals: Goal[]): Goal[] {
  if (goals.length >= MIN_GOAL_ROWS) return goals
  return [...goals, ...Array.from({ length: MIN_GOAL_ROWS - goals.length }, blankGoal)]
}
// ---- My Plan Tab ----
export const PLAN_EDIT_REASON = 'Only someone who can edit weekly plans can do this.'
export const NETWORK_FAILURE = 'Couldn\u2019t reach the server. Check your connection and try again.'
