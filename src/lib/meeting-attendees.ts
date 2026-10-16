/**
 * Meeting attendees — the people (contacts) present at a logged meeting
 * (`daily_visits` row), beyond the one account the meeting is logged against.
 *
 * ---------------------------------------------------------------------------
 * STORAGE — one table a human creates (prisma db push is not for agents):
 *
 *   CREATE TABLE IF NOT EXISTS meeting_attendees (
 *     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     tenant_id uuid NOT NULL,
 *     visit_id uuid NOT NULL,
 *     contact_id uuid NOT NULL,
 *     is_main boolean NOT NULL DEFAULT false,
 *     created_at timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE UNIQUE INDEX IF NOT EXISTS meeting_attendees_visit_contact_uq
 *     ON meeting_attendees (tenant_id, visit_id, contact_id);
 *   CREATE UNIQUE INDEX IF NOT EXISTS meeting_attendees_one_main_uq
 *     ON meeting_attendees (tenant_id, visit_id) WHERE is_main;
 *   CREATE INDEX IF NOT EXISTS meeting_attendees_contact_idx
 *     ON meeting_attendees (tenant_id, contact_id);
 *
 * At most one active "main" attendee per meeting — enforced by the partial
 * unique index AND in code (`pickMain` keeps only the first `is_main: true`
 * the caller sends, silently, rather than 400ing the whole request).
 *
 * ---------------------------------------------------------------------------
 * WHY RAW SQL, AND WHY EVERY CALL IS GUARDED — the same trap as
 * `src/lib/sharing.ts` and `src/lib/account-kind.ts`.
 *
 * The table is not in `prisma/schema.prisma` and may not exist in a given
 * database yet. So nothing touches it through Prisma's model API; every query
 * here is raw SQL, and a "table does not exist" failure (Postgres 42P01) is
 * caught: reads answer "no attendees" (`[]` / an empty map), and writes answer
 * `'unavailable'`, which routes turn into a 503 with `ATTENDEES_UNAVAILABLE`
 * — but ONLY for the attendees step itself. Logging the meeting (the
 * `daily_visits` row) must still succeed with the table absent: the route
 * calls `recordAttendees` AFTER the visit is created and only 503s the
 * attendee-saving response, never the visit itself; see the daily-activity
 * POST route for exactly how that is sequenced.
 *
 * ⚠️ EVERY raw query carries `tenant_id = $tenant`. This table has no FK to
 * anything, so the predicate is the only thing keeping one tenant's attendees
 * out of another's. Every body-sourced contact id is checked against the
 * caller's tenant (and their data scope) by the ROUTE, via
 * `firstForeignTenantRef` / the contacts scope helper, before it reaches here.
 *
 * ⚠️ `npm run prisma:sync` runs `prisma db pull`; once the table exists it
 * will add a model for it. That is harmless (nothing here uses the model),
 * but do not switch these queries to the model API without re-reading this
 * header.
 */

import { Prisma } from '@prisma/client'
import { prisma } from './db'

/** The sentence a write answers with while the table does not exist. */
export const ATTENDEES_UNAVAILABLE = 'This needs a database update first.'

/**
 * "The meeting_attendees table has not been created yet" — and nothing else.
 * Same detection shape as `src/lib/sharing.ts`'s `isTableMissing`, narrowed to
 * this one table.
 */
function isTableMissing(err: unknown): boolean {
  const e = err as {
    code?: unknown
    message?: unknown
    meta?: {
      code?: unknown
      driverAdapterError?: {
        cause?: { originalCode?: unknown; originalMessage?: unknown; kind?: unknown; table?: unknown }
      }
    }
    cause?: { code?: unknown; message?: unknown }
  }
  const named = (text: unknown) =>
    typeof text === 'string' && /\bmeeting_attendees\b/.test(text)

  const cause = e?.meta?.driverAdapterError?.cause
  if (cause) {
    const undefinedTable = cause.originalCode === '42P01' || cause.kind === 'TableDoesNotExist'
    return undefinedTable && (named(cause.table) || named(cause.originalMessage))
  }

  if (e?.code === '42P01' || e?.meta?.code === '42P01' || e?.cause?.code === '42P01') {
    return named(e?.message) || named(e?.cause?.message)
  }

  return (
    typeof e?.message === 'string' &&
    named(e.message) &&
    /42P01|relation .* does not exist|undefined[_ ]table/i.test(e.message)
  )
}

/**
 * Once the table is known to be missing, reads skip it for a short while
 * instead of sending Postgres a failing statement on every request. Writes
 * always try. Thirty seconds matches `sharing.ts`.
 */
const MISSING_TTL_MS = 30_000
let missingUntil = 0

function knownMissing(): boolean {
  return missingUntil > Date.now()
}

async function guardedRead<T>(empty: T, run: () => Promise<T>): Promise<T> {
  if (knownMissing()) return empty
  try {
    return await run()
  } catch (err) {
    if (isTableMissing(err)) {
      missingUntil = Date.now() + MISSING_TTL_MS
      return empty
    }
    throw err
  }
}

type WriteFailure = 'unavailable'

async function guardedWrite<T>(run: () => Promise<T>): Promise<T | WriteFailure> {
  try {
    const out = await run()
    missingUntil = 0
    return out
  } catch (err) {
    if (isTableMissing(err)) {
      missingUntil = Date.now() + MISSING_TTL_MS
      return 'unavailable'
    }
    throw err
  }
}

export type AttendeeInput = { contact_id: string; is_main?: boolean }

export type AttendeeRow = {
  id: string
  contact_id: string
  name: string
  is_main: boolean
  created_at: string
}

type RawAttendeeRow = Omit<AttendeeRow, 'created_at'> & { created_at: Date | string }

function shape(row: RawAttendeeRow): AttendeeRow {
  return {
    ...row,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

/**
 * Keep only the FIRST `is_main: true` in `list`, in order, clearing the rest.
 * The route uses this before writing, so a client that sends two mains never
 * 400s — it silently gets the first one, same spirit as `sharing.ts`'s
 * "silently keep the richer access" rules.
 */
export function pickMain(list: AttendeeInput[]): AttendeeInput[] {
  let seen = false
  return list.map(a => {
    if (a.is_main && !seen) {
      seen = true
      return { ...a, is_main: true }
    }
    return { ...a, is_main: false }
  })
}

/**
 * Attendees of one meeting, oldest first, main attendee's `is_main` true.
 * `[]` while the table does not exist or the meeting has none recorded.
 */
export async function listAttendees(tenantId: string, visitId: string): Promise<AttendeeRow[]> {
  const rows = await guardedRead<RawAttendeeRow[]>([], () =>
    prisma.$queryRaw<RawAttendeeRow[]>(Prisma.sql`
      SELECT a.id::text         AS id,
             a.contact_id::text AS contact_id,
             c.name             AS name,
             a.is_main          AS is_main,
             a.created_at       AS created_at
        FROM meeting_attendees a
        JOIN contacts c
          ON c.id = a.contact_id AND c.tenant_id = a.tenant_id
       WHERE a.tenant_id = ${tenantId}::uuid
         AND a.visit_id = ${visitId}::uuid
       ORDER BY a.created_at ASC, a.id ASC
    `)
  )
  return rows.map(shape)
}

/** Attendees for several meetings at once, keyed by visit id — for list screens. */
export async function listAttendeesForVisits(
  tenantId: string,
  visitIds: string[]
): Promise<Map<string, AttendeeRow[]>> {
  const map = new Map<string, AttendeeRow[]>()
  if (visitIds.length === 0) return map
  const rows = await guardedRead<(RawAttendeeRow & { visit_id: string })[]>([], () =>
    prisma.$queryRaw<(RawAttendeeRow & { visit_id: string })[]>(Prisma.sql`
      SELECT a.id::text         AS id,
             a.visit_id::text   AS visit_id,
             a.contact_id::text AS contact_id,
             c.name             AS name,
             a.is_main          AS is_main,
             a.created_at       AS created_at
        FROM meeting_attendees a
        JOIN contacts c
          ON c.id = a.contact_id AND c.tenant_id = a.tenant_id
       WHERE a.tenant_id = ${tenantId}::uuid
         AND a.visit_id IN (${Prisma.join(visitIds)})
       ORDER BY a.created_at ASC, a.id ASC
    `)
  )
  for (const row of rows) {
    const list = map.get(row.visit_id) ?? []
    list.push(shape(row))
    map.set(row.visit_id, list)
  }
  return map
}

/**
 * Replace the attendee list of one meeting. The caller (the route) has
 * already proved every `contact_id` belongs to this tenant and is visible to
 * the actor. `'unavailable'` when the table does not exist — the visit row
 * itself must already have been created by the time this is called; the
 * route turns `'unavailable'` into a 503 on the attendees part of the
 * response only.
 */
export async function setAttendees(
  tenantId: string,
  visitId: string,
  attendees: AttendeeInput[]
): Promise<'ok' | 'unavailable'> {
  const list = pickMain(attendees)
  const out = await guardedWrite(() =>
    prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM meeting_attendees
         WHERE tenant_id = ${tenantId}::uuid AND visit_id = ${visitId}::uuid
      `)
      for (const a of list) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO meeting_attendees (tenant_id, visit_id, contact_id, is_main)
          VALUES (${tenantId}::uuid, ${visitId}::uuid, ${a.contact_id}::uuid, ${!!a.is_main})
        `)
      }
      return 'ok' as const
    })
  )
  return out
}

/** Add attendees at meeting-creation time (same shape as `setAttendees`, for a brand-new visit with no prior rows). */
export const recordAttendees = setAttendees

/**
 * Other meetings (within this tenant) that share at least one of `contactIds`
 * as an attendee, excluding `excludeVisitId`. `[]` while the table does not
 * exist or `contactIds` is empty — "Past notes" matching falls back to the
 * account-only rule in that case.
 */
export async function visitIdsSharingAttendees(
  tenantId: string,
  contactIds: string[],
  excludeVisitId: string
): Promise<string[]> {
  if (contactIds.length === 0) return []
  const rows = await guardedRead<{ visit_id: string }[]>([], () =>
    prisma.$queryRaw<{ visit_id: string }[]>(Prisma.sql`
      SELECT DISTINCT a.visit_id::text AS visit_id
        FROM meeting_attendees a
       WHERE a.tenant_id = ${tenantId}::uuid
         AND a.visit_id != ${excludeVisitId}::uuid
         AND a.contact_id::text IN (${Prisma.join(contactIds)})
    `)
  )
  return rows.map(r => r.visit_id)
}

/** True once the table exists, for pages that want to hide the attendees UI instead of showing an empty panel. */
export async function isAttendeesAvailable(tenantId: string): Promise<boolean> {
  return guardedRead<boolean>(false, async () => {
    await prisma.$queryRaw(Prisma.sql`SELECT 1 FROM meeting_attendees WHERE tenant_id = ${tenantId}::uuid LIMIT 1`)
    return true
  })
}
