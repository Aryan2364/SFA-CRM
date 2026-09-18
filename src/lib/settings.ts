import { prisma } from './db'
import { TENANT_SETTINGS_DEFAULTS, type TenantSettings } from './settings-shared'

/**
 * THE SINGLE READER FOR `tenant_settings` — 05-PHASE-3-PLAN.md P3-T1 step 4.
 *
 * Three consumers are coming and none of them may query the table directly:
 *
 *   P3-T6  auto check-out            `auto_checkout_minutes`
 *   P3-T8  the meeting location flag `location_flag_threshold_m`
 *   P2     deal stage ageing         `deal_stage_ageing_days`
 *
 * The reason this is a module and not three `findUnique` calls is the fallback.
 * `tenant_settings` is keyed BY tenant (`tenant_id` IS the primary key, modelled
 * on `tenant_point_settings`), so a tenant that has never opened the Settings
 * screen HAS NO ROW. Every consumer therefore needs a default, and if each one
 * carries its own then a tenant with no row gets a 500 m flag in one place and
 * a 100 m flag in another, with nothing crashing to say so. One reader, one set
 * of defaults, one answer.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ THIS MODULE IMPORTS PRISMA — IT IS SERVER-ONLY
 *
 * `prisma` pulls in `pg`, which pulls in `fs`. A `'use client'` file that
 * imports anything from here — even one constant — drags that whole chain into
 * the browser bundle and the page fails to render with `Module not found:
 * Can't resolve 'fs'`. `tsc --noEmit` does NOT catch it; the types are fine and
 * the failure is a bundler boundary.
 *
 * Everything a screen needs lives in `./settings-shared`, which has no database
 * import. It is re-exported below so server callers have one import to reach
 * for; client callers must import from `settings-shared` directly.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE `Int` AND NOT `Decimal`
 *
 * A Prisma `Decimal` serialises to a *string* through `JSON.stringify`, so
 * `threshold > 500` silently compares a string to a number and arithmetic that
 * forgets `serialize()` produces wrong answers rather than errors (CLAUDE.md,
 * PLAN.md §5.1). All three columns are `integer` in PostgreSQL for that reason,
 * which is also why this module returns plain `number` and the route that uses
 * it needs no `serialize()` call.
 *
 * WHY THE TIME IS MINUTES-PAST-MIDNIGHT AND NOT A `time` COLUMN
 *
 * P3-T1's second warning: the wire behaviour of a PostgreSQL `time` through
 * `serialize()` has never been verified, and an unverified serialisation of a
 * value the auto check-out job depends on is not worth the tidiness. `0` is
 * midnight, which is P3-T6's stated default — it does NOT mean "disabled".
 */

export {
  TENANT_SETTINGS_DEFAULTS,
  TENANT_SETTINGS_LIMITS,
  validateTenantSettings,
  minutesToClock,
} from './settings-shared'
export type { TenantSettings, ValidationResult } from './settings-shared'

/**
 * Read a tenant's settings, its stored row merged over the defaults.
 *
 * All three columns are NOT NULL, so in practice a row supplies all three — the
 * merge is written field by field anyway so that adding a nullable column later
 * cannot quietly return `null` to a consumer that expects a number.
 */
export async function getTenantSettings(tenantId: string): Promise<TenantSettings> {
  const row = await prisma.tenant_settings.findUnique({
    where: { tenant_id: tenantId },
    select: {
      auto_checkout_minutes: true,
      location_flag_threshold_m: true,
      deal_stage_ageing_days: true,
    },
  })

  if (!row) return { ...TENANT_SETTINGS_DEFAULTS }

  return {
    auto_checkout_minutes:
      row.auto_checkout_minutes ?? TENANT_SETTINGS_DEFAULTS.auto_checkout_minutes,
    location_flag_threshold_m:
      row.location_flag_threshold_m ?? TENANT_SETTINGS_DEFAULTS.location_flag_threshold_m,
    deal_stage_ageing_days:
      row.deal_stage_ageing_days ?? TENANT_SETTINGS_DEFAULTS.deal_stage_ageing_days,
  }
}
