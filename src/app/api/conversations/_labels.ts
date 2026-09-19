import type { ContextType } from '../remarks/_context'

/**
 * F29 — THE ONE PLACE A CONTEXT TYPE BECOMES SOMETHING A PERSON READS.
 *
 * `daily_summary`, `weekly_plan_day` and the rest are internal keys of
 * `contextual_remarks.context_type`. They are storage, not language, and a
 * user should never meet one — underscore, lower case and all.
 *
 * The map is typed `Record<ContextType, string>`, and `ContextType` is the
 * vocabulary declared in `../remarks/_context`. That is deliberate and it is
 * the whole mechanism: adding a value there and not adding it here does not
 * leak the key onto the screen, it fails `tsc`. A label cannot be forgotten,
 * only written.
 *
 * `contextLabel()` takes a raw string because the database column is a plain
 * `text` and a row written before a type was retired is still a row. An
 * unknown key answers "Note" rather than itself — the point of this file is
 * that a key never reaches a screen, and that has to hold for the key nobody
 * anticipated too.
 */
export const CONTEXT_LABELS: Record<ContextType, string> = {
  meeting: 'Meeting',
  expense: 'Expense',
  weekly_plan: 'Weekly plan',
  weekly_plan_day: 'Weekly plan day',
  deal: 'Deal note',
  order: 'Order note',
  daily_summary: 'Daily Summary',
  weekly_summary: 'Weekly Summary',
}

export function contextLabel(contextType: string): string {
  return (CONTEXT_LABELS as Record<string, string>)[contextType] ?? 'Note'
}
