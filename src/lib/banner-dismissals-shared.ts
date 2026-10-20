/*
 * The names components/ui/banner.tsx (the browser, writing) and
 * lib/banner-dismissals.server.ts (the server, reading for the first
 * paint) must agree on, written once (section 4 rule 2). Same split as
 * lib/layout-shared.ts: no "use client" here, so this file's values stay
 * plain values to a server module rather than becoming a client
 * reference.
 *
 * Section 7.5 rule 3: a closed banner is remembered "for that person in
 * that browser, per condition" and "returns if the condition gets
 * worse, such as its count rising". One cookie holds every banner this
 * browser has closed, for every person who has signed in on it: a map
 * from "<userId>.<condition>" to the level it was closed at. The level
 * is compared, not a boolean, so a rising count un-closes it.
 */

/** The one cookie every closable banner reads and writes. */
const BANNER_DISMISS_COOKIE = "banner-dismissed"

/**
 * Kept comfortably under the browser's roughly 4KB per-cookie limit,
 * leaving room for the cookie's own name and attributes.
 */
const BANNER_DISMISS_MAX_BYTES = 3500

/** A second bound, so one person closing hundreds of conditions on one
 * browser cannot alone exhaust the byte budget one entry at a time. */
const BANNER_DISMISS_MAX_ENTRIES = 200

/** `"<userId>.<condition>"` to the level it was closed at. */
type BannerDismissals = Record<string, number>

function decodeBannerDismissals(raw: string | undefined): BannerDismissals {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const result: BannerDismissals = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) result[key] = value
    }
    return result
  } catch {
    // A cookie this code did not write reads as nothing closed.
    return {}
  }
}

/**
 * Bounds a dismissal map to the entry and byte caps, dropping the
 * oldest entries first (object key order is insertion order for string
 * keys), and returns both the bounded map and its cookie-ready value.
 */
function encodeBannerDismissals(map: BannerDismissals): {
  bounded: BannerDismissals
  value: string
} {
  const bounded = { ...map }
  let keys = Object.keys(bounded)
  while (keys.length > BANNER_DISMISS_MAX_ENTRIES) {
    delete bounded[keys[0]]
    keys = Object.keys(bounded)
  }
  let value = encodeURIComponent(JSON.stringify(bounded))
  while (value.length > BANNER_DISMISS_MAX_BYTES && keys.length > 0) {
    delete bounded[keys[0]]
    keys = Object.keys(bounded)
    value = encodeURIComponent(JSON.stringify(bounded))
  }
  return { bounded, value }
}

export {
  BANNER_DISMISS_COOKIE,
  BANNER_DISMISS_MAX_BYTES,
  BANNER_DISMISS_MAX_ENTRIES,
  decodeBannerDismissals,
  encodeBannerDismissals,
  type BannerDismissals,
}
