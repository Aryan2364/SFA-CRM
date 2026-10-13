/**
 * The GST flag applied to a party's completeness — pure functions, safe on both
 * sides of the client/server boundary. No database import, and nothing may add
 * one (see `settings-shared.ts` for why that matters).
 *
 * `companies.is_complete` / `completeness_missing` are STORED with the full
 * five-field rule (`src/lib/completeness.ts`), whatever the tenant's setting.
 * When `tenant_settings.gst_required_for_orders` is off, "GST Number" simply
 * stops counting: a party missing only its GST number is treated as complete,
 * and the field drops out of every list of what is missing. These helpers are
 * the one place that rule is written, so the order routes, the APIs that hand
 * completeness to screens, and the reports cannot disagree about it.
 *
 * A GST number that IS entered is still format-checked by `checkGstin()` —
 * the setting only stops a MISSING one from mattering.
 */

export const GST_FIELD = 'GST Number'

/** The stored ", "-separated list with GST removed when it is not required. */
export function effectiveMissing(
  missing: string | null | undefined,
  gstRequired: boolean
): string | null {
  if (!missing) return null
  if (gstRequired) return missing
  const kept = missing
    .split(',')
    .map(part => part.trim())
    .filter(part => part && part !== GST_FIELD)
  return kept.length > 0 ? kept.join(', ') : null
}

/**
 * Whether a party counts as complete under this tenant's setting.
 *
 * A stored `is_complete: false` with no recorded field list stays incomplete:
 * nothing says GST is the only gap, so switching the flag off must not wave
 * the record through.
 */
export function effectivelyComplete(
  isComplete: boolean | null | undefined,
  missing: string | null | undefined,
  gstRequired: boolean
): boolean {
  if (isComplete) return true
  if (gstRequired || !missing) return false
  return effectiveMissing(missing, false) === null
}

/** A party row with its completeness rewritten for this tenant's setting. */
export function withGstPolicy<T extends { is_complete?: boolean | null; completeness_missing?: string | null }>(
  row: T,
  gstRequired: boolean
): T {
  if (gstRequired) return row
  return {
    ...row,
    is_complete: effectivelyComplete(row.is_complete, row.completeness_missing, false),
    completeness_missing: effectiveMissing(row.completeness_missing, false),
  }
}

const INCOMPLETE_PREFIX = 'Party is incomplete: '

/**
 * An order's stored `blocked_reason`, as it should read now.
 *
 * Drafts blocked before the flag was switched off still carry
 * "Party is incomplete: GST Number" on the row. Read through this, a reason
 * that named only GST reads as no reason at all, and one that named GST among
 * other fields names only the others. Any other reason is returned unchanged.
 */
export function effectiveBlockedReason(
  reason: string | null | undefined,
  gstRequired: boolean
): string | null {
  if (!reason) return null
  if (gstRequired || !reason.startsWith(INCOMPLETE_PREFIX)) return reason
  const rest = effectiveMissing(reason.slice(INCOMPLETE_PREFIX.length), false)
  return rest ? `${INCOMPLETE_PREFIX}${rest}` : null
}
