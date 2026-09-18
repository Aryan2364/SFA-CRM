/**
 * The half of the tenant-settings contract that is safe on BOTH sides of the
 * client/server boundary: the type, the defaults, the accepted ranges and the
 * validator. No database import, and nothing may add one.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS, AND WHY IT MUST NOT BE MERGED BACK INTO settings.ts
 *
 * `src/lib/settings.ts` imports `prisma`, which imports `pg`, which imports
 * `fs`. A `'use client'` screen that imports ANYTHING from that module pulls
 * the whole chain into the browser bundle and the page dies at request time
 * with `Module not found: Can't resolve 'fs'`.
 *
 * `tsc --noEmit` does not catch it — the types are all perfectly valid, and the
 * failure is a bundler boundary, not a type error. It shows up only when the
 * page is actually rendered. So: values the screen needs live HERE, and
 * `settings.ts` re-exports them for server callers.
 *
 * (A `import type` of TenantSettings alone would have been free, since types
 * are erased. `TENANT_SETTINGS_LIMITS` is a real runtime object, and that is
 * what dragged the database in.)
 */

export type TenantSettings = {
  /** Minutes past midnight, 0–1439. `0` is midnight (P3-T6's default). */
  auto_checkout_minutes: number
  /** Metres. A meeting further than this from its party is flagged (P3-T8). */
  location_flag_threshold_m: number
  /** Days a deal may sit in one stage before it reads as stale. */
  deal_stage_ageing_days: number
}

/**
 * The values a tenant with no row gets, matching the column defaults in the
 * database so a row written by the screen and a row that does not exist yet
 * behave identically.
 */
export const TENANT_SETTINGS_DEFAULTS: Readonly<TenantSettings> = Object.freeze({
  auto_checkout_minutes: 0,
  location_flag_threshold_m: 500,
  deal_stage_ageing_days: 15,
})

/**
 * Accepted ranges, shared by the PUT route and the screen so the client cannot
 * offer a value the server will reject.
 *
 * The upper bounds are not decoration. All three columns are PostgreSQL
 * `integer` (int4, max 2147483647); a larger number reaches Prisma and throws,
 * which the route would return as a 500 rather than the 400 it is. The caps
 * below are generous enough to be invisible in practice — 100 km covers any
 * sane geo-fence, 10 years any sane ageing window — and keep every rejection a
 * 400 with a sentence the user can act on.
 */
export const TENANT_SETTINGS_LIMITS = Object.freeze({
  /** 1439 = 23:59. 1440 would be the next midnight. */
  auto_checkout_minutes: { min: 0, max: 1439 },
  location_flag_threshold_m: { min: 1, max: 100_000 },
  deal_stage_ageing_days: { min: 1, max: 3650 },
} satisfies Record<keyof TenantSettings, { min: number; max: number }>)

const FIELD_LABELS: Record<keyof TenantSettings, string> = {
  auto_checkout_minutes: 'Auto check-out time',
  location_flag_threshold_m: 'Location flag distance',
  deal_stage_ageing_days: 'Deal stage ageing',
}

export type ValidationResult =
  | { ok: true; values: TenantSettings }
  | { ok: false; error: string }

/**
 * Validate an untrusted request body into a complete TenantSettings.
 *
 * Rejects, rather than coerces: `""`, `null`, `"abc"`, `12.5`, `NaN`,
 * `Infinity` and anything outside the range above. A missing key is an error
 * too — this is a PUT of the whole object, so a partial body is a client bug
 * and silently defaulting it would overwrite a value the user never touched.
 */
export function validateTenantSettings(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Expected an object with all three settings.' }
  }

  const body = input as Record<string, unknown>
  const values = {} as TenantSettings

  for (const key of Object.keys(TENANT_SETTINGS_LIMITS) as (keyof TenantSettings)[]) {
    const raw = body[key]

    // `typeof null === 'object'`, and Number(null) is 0 — so an explicit null
    // would pass a naive numeric check as midnight / zero metres.
    if (typeof raw !== 'number') {
      return { ok: false, error: `${FIELD_LABELS[key]} must be a number.` }
    }
    if (!Number.isInteger(raw)) {
      // Number.isInteger is false for NaN and Infinity as well as for 12.5.
      return { ok: false, error: `${FIELD_LABELS[key]} must be a whole number.` }
    }

    const { min, max } = TENANT_SETTINGS_LIMITS[key]
    if (raw < min || raw > max) {
      return { ok: false, error: `${FIELD_LABELS[key]} must be between ${min} and ${max}.` }
    }

    values[key] = raw
  }

  return { ok: true, values }
}

/** Minutes past midnight → `"HH:MM"` in 24-hour form. For display and logs. */
export function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
