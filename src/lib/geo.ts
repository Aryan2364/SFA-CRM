/**
 * Distance between two points on Earth — REBUILD-PLAN.md §5.4, P3-T8.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES, AND WHY IT WAS WRONG
 *
 * `review/[userId]/page.tsx` decided a meeting's start and end locations
 * disagreed with:
 *
 *     Math.abs(lat - end_lat) > 0.001 || Math.abs(lng - end_lng) > 0.001
 *
 * Four things are wrong with that, and only the first is obvious:
 *
 *  1. It is degrees, not metres. 0.001° of latitude is about 111 m, so the
 *     threshold was never the 500 m anyone thought it was.
 *  2. A degree of LONGITUDE is not a fixed distance — it is 111 km at the
 *     equator and shrinks with the cosine of latitude, to about 102 km at
 *     Pune's 18.5°N and 0 at the poles. So the same code flagged a different
 *     real distance for every user, and a north-south move was judged on a
 *     different scale from an east-west one.
 *  3. `|dlat| > t || |dlng| > t` is a SQUARE, not a circle: a diagonal move of
 *     0.0014° in both axes — around 150 m — passed as clean, while 0.0011° due
 *     north — around 122 m — flagged.
 *  4. It ran in the browser, so it was advisory decoration on one screen and
 *     was not stored, not auditable, and absent from the rep's own view.
 *
 * This module is the replacement: real metres, computed server-side, compared
 * against the tenant's configured threshold, and persisted on the row.
 *
 * ---------------------------------------------------------------------------
 * HAVERSINE, AND WHY IT IS ENOUGH
 *
 * Haversine treats Earth as a sphere. The real figure is an ellipsoid, so
 * distances carry up to about 0.5% error — at 500 m that is under 3 m, far
 * inside the error of a phone's GPS fix (typically 5–50 m, worse indoors).
 * Vincenty's formulae would be more accurate and can fail to converge on
 * near-antipodal points; for "was this meeting logged where it was supposed to
 * be", that trade is not worth making.
 */

/** Mean Earth radius in metres (IUGG). */
const EARTH_RADIUS_M = 6_371_008.8

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

/** A point, in decimal degrees. Either half may be absent — see `distanceMetres`. */
export type LatLng = {
  latitude: number | null | undefined
  longitude: number | null | undefined
}

/**
 * Great-circle distance between two points, in metres.
 *
 * Returns `null` — never a number — when either point is incomplete or not
 * finite. **That is the whole point of the signature.** Location is nullable
 * in practice: the browser aborts start/stop on `PERMISSION_DENIED`, but on a
 * geolocation TIMEOUT it proceeds with nulls, so rows with a start fix and no
 * end fix are normal. Coercing a missing coordinate to 0 would place the point
 * in the Gulf of Guinea and report a distance of some thousands of kilometres,
 * flagging every such meeting as wildly out of place.
 *
 * A `null` here means "unknown", and the caller must treat it as unknown —
 * not as zero, and not as far.
 */
export function distanceMetres(a: LatLng, b: LatLng): number | null {
  const lat1 = a.latitude
  const lng1 = a.longitude
  const lat2 = b.latitude
  const lng2 = b.longitude

  // `== null` catches undefined too. Number.isFinite rejects NaN and Infinity,
  // which is what a malformed payload or a Decimal->number conversion of junk
  // would produce.
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null
  if (
    !Number.isFinite(lat1) || !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) || !Number.isFinite(lng2)
  ) {
    return null
  }

  const phi1 = toRadians(lat1)
  const phi2 = toRadians(lat2)
  const deltaPhi = toRadians(lat2 - lat1)
  const deltaLambda = toRadians(lng2 - lng1)

  const sinHalfDeltaPhi = Math.sin(deltaPhi / 2)
  const sinHalfDeltaLambda = Math.sin(deltaLambda / 2)

  const h =
    sinHalfDeltaPhi * sinHalfDeltaPhi +
    Math.cos(phi1) * Math.cos(phi2) * sinHalfDeltaLambda * sinHalfDeltaLambda

  // Math.min guards against h drifting a hair above 1 through floating-point
  // rounding for near-antipodal points, which would make Math.sqrt produce NaN.
  const c = 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)))

  return EARTH_RADIUS_M * c
}

/**
 * Should this meeting be flagged for review?
 *
 * Returns `false` when the distance is unknown, because §5.4's flag means "this
 * looks wrong", not "we could not tell". An unknown location is not evidence of
 * anything, and marking it would train reviewers to ignore the flag.
 *
 * The comparison is strictly greater-than: a meeting exactly at the threshold
 * is within it.
 *
 * ⚠️ Flagging is DISPLAY ONLY. §5.4 is explicit that no action follows from it —
 * nothing is blocked, nobody is notified, no approval is required. If you are
 * about to make something else depend on this boolean, that is a product
 * decision and not one this function implies.
 */
export function isLocationFlagged(
  start: LatLng,
  end: LatLng,
  thresholdMetres: number
): boolean {
  const distance = distanceMetres(start, end)
  if (distance === null) return false
  return distance > thresholdMetres
}
