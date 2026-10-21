/**
 * How a stored or fresh location accuracy (metres) reads to a person, and the
 * one threshold that separates a poor fix from an APPROXIMATE one.
 *
 * Past `APPROXIMATE_LOCATION_M` the phone's OS is sharing approximate location
 * (Android 12+ and iOS 14+ let the person choose Precise or Approximate, and
 * approximate blurs to roughly 2-3 km). Moving to an open spot cannot fix that,
 * so the sheet says how to turn Precise on, and a manager reading the saved
 * value can tell at a glance it was never a real fix. Client-safe: no imports.
 */

export const APPROXIMATE_LOCATION_M = 1000

export function isApproximateLocation(metres: number): boolean {
  return metres > APPROXIMATE_LOCATION_M
}

/** "about 2.5 km" / "about 12 km" - one decimal under 10 km. */
export function approximateKm(metres: number): string {
  const km = metres / 1000
  return `about ${km < 10 ? String(Math.round(km * 10) / 10) : Math.round(km)} km`
}

/** "accurate to about 20 m", or "approximate location (about 2.5 km)" past the threshold. */
export function accuracyLabel(metres: number): string {
  return isApproximateLocation(metres)
    ? `approximate location (${approximateKm(metres)})`
    : `accurate to about ${Math.round(metres)} m`
}
