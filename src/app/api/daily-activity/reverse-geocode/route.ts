import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * P3-T7 — server-side reverse geocoding for the start/stop toggle.
 *
 * WHAT THIS REPLACES
 *
 * `reverseGeocode()` used to call `nominatim.openstreetmap.org` DIRECTLY
 * FROM THE BROWSER, on every start and every stop. Four problems, none
 * of which produced an error anyone would see:
 *
 *  1. Every user's own IP hit an unkeyed third party. OSM's usage policy
 *     asks for an identifying User-Agent and at most one request per
 *     second; a browser cannot send a custom User-Agent at all, so the
 *     app was an anonymous client of a volunteer-run service.
 *  2. No rate-limit handling. Nominatim answers a flood with 403/429 and
 *     the `catch {}` swallowed it, so the address silently became null
 *     and looked like a plain geocoding miss.
 *  3. The user's coordinates were disclosed to a third party from their
 *     own machine, which is not something the tenant agreed to.
 *  4. No caching: two meetings in the same shop geocoded twice.
 *
 * All four are fixed by moving the call here. The browser now talks only
 * to this app.
 *
 * WHAT THIS IS NOT
 *
 * The address is DECORATION. `latitude`/`longitude` are what the §5.4
 * location flag is computed from, server-side, and it is computed from
 * the numbers regardless of whether this route answers. So every failure
 * path here returns `{ address: null }` with a 200 — a geocoding outage
 * must not fail a start or a stop.
 */

/** Round to ~11 m, so the same shop is one cache key on every visit. */
const cacheKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX = 500
const cache = new Map<string, { address: string | null; at: number }>()

/*
 * OSM asks for no more than one request per second. This serialises every
 * caller of this route through one promise chain with a gap between calls,
 * which is the only honest way to keep that promise when several reps press
 * Start at the same moment. It is per-process and resets on redeploy; that is
 * acceptable for a politeness delay, and the cache absorbs the common case.
 */
const MIN_GAP_MS = 1100
let queue: Promise<unknown> = Promise.resolve()
let lastCallAt = 0

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCallAt)
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    lastCallAt = Date.now()
    return fn()
  })
  // Keep the chain alive even when one link rejects.
  queue = run.catch(() => {})
  return run
}

async function lookup(lat: number, lng: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18`
  // AbortSignal.timeout: an unreachable Nominatim must not hold a start open.
  const res = await fetch(url, {
    headers: {
      // OSM's policy requires an identifying agent. A browser cannot set this.
      'User-Agent': 'RGB-SFA/1.0 (sales force automation; contact tech@rgbindia.com)',
      'Accept-Language': 'en',
    },
    signal: AbortSignal.timeout(6000),
    cache: 'no-store',
  })
  // 429 and 403 are the rate-limit answers, and they used to be invisible.
  if (!res.ok) throw new Error(`nominatim ${res.status}`)
  const data = (await res.json()) as { display_name?: string }
  return typeof data.display_name === 'string' ? data.display_name : null
}

export async function POST(req: NextRequest) {
  // Authenticated callers only — this is not an open geocoding proxy.
  await requireUser()

  let lat: unknown
  let lng: unknown
  try {
    const body = await req.json()
    lat = body?.latitude
    lng = body?.longitude
  } catch {
    return NextResponse.json({ address: null }, { status: 200 })
  }

  // Nulls are the NORMAL case, not an error: on a geolocation timeout the
  // browser starts the meeting with no coordinates at all.
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ address: null })
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ address: null })
  }

  const key = cacheKey(lat, lng)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ address: hit.address, cached: true })
  }

  try {
    const address = await enqueue(() => lookup(lat as number, lng as number))
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
    cache.set(key, { address, at: Date.now() })
    return NextResponse.json({ address })
  } catch (err) {
    // Logged rather than swallowed, so a rate-limit block is findable.
    console.warn('[reverse-geocode] lookup failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ address: null })
  }
}
