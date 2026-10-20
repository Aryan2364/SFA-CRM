/**
 * `deal_follow_ups.due_time` / `companies.next_follow_up_time` — the optional
 * clock time alongside the "Next meeting" date those two tables already
 * carry (see `src/app/api/daily-activity/[id]/next-meeting/route.ts`).
 *
 * Same trap as `src/lib/gst-setting.ts` / `src/lib/party-landline.ts`: the
 * columns are declared in `prisma/schema.prisma` but have not been pushed to
 * every database, so nothing reads or writes them through Prisma's model
 * API — both tables have dozens of unselected calls elsewhere that would
 * start asking Postgres for a column it does not have. Raw SQL only, with a
 * read answering `null` and a write answering `false` on 42703 (undefined
 * column) so the route can save the date and tell the user the time did not
 * stick, instead of failing the whole request.
 */

import { prisma } from './db'

type RawDb = Pick<typeof prisma, '$queryRaw' | '$executeRaw'>

export const NEXT_MEETING_TIME_NOT_SAVED =
  'Saved without the time — the database needs an update first.'

function isTimeColumnMissing(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown }; message?: unknown }
  if (e?.code === '42703' || e?.meta?.code === '42703' || e?.cause?.code === '42703') return true
  return typeof e?.message === 'string' && /(due_time|next_follow_up_time)/.test(e.message) && /does not exist|undefined column/i.test(e.message)
}

/** `"HH:MM"` (24h), or `null` if the column is missing or the row has none. */
export async function readFollowUpTime(tenantId: string, id: string, db: RawDb = prisma): Promise<string | null> {
  try {
    const rows = await db.$queryRaw<{ t: string | null }[]>`
      SELECT to_char(due_time, 'HH24:MI') AS t FROM deal_follow_ups
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`
    return rows[0]?.t ?? null
  } catch (err) {
    if (isTimeColumnMissing(err)) return null
    throw err
  }
}

export async function readCompanyNextMeetingTime(tenantId: string, companyId: string, db: RawDb = prisma): Promise<string | null> {
  try {
    const rows = await db.$queryRaw<{ t: string | null }[]>`
      SELECT to_char(next_follow_up_time, 'HH24:MI') AS t FROM companies
       WHERE id = ${companyId}::uuid AND tenant_id = ${tenantId}::uuid`
    return rows[0]?.t ?? null
  } catch (err) {
    if (isTimeColumnMissing(err)) return null
    throw err
  }
}

/** Store (or clear, with `null`) a follow-up's time. `false` if the column is not there yet. */
export async function writeFollowUpTime(tenantId: string, id: string, time: string | null, db: RawDb = prisma): Promise<boolean> {
  try {
    await db.$executeRaw`
      UPDATE deal_follow_ups SET due_time = ${time}::time
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`
    return true
  } catch (err) {
    if (isTimeColumnMissing(err)) return false
    throw err
  }
}

/** Store (or clear, with `null`) an account's next-meeting time. `false` if the column is not there yet. */
export async function writeCompanyNextMeetingTime(tenantId: string, companyId: string, time: string | null, db: RawDb = prisma): Promise<boolean> {
  try {
    await db.$executeRaw`
      UPDATE companies SET next_follow_up_time = ${time}::time
       WHERE id = ${companyId}::uuid AND tenant_id = ${tenantId}::uuid`
    return true
  } catch (err) {
    if (isTimeColumnMissing(err)) return false
    throw err
  }
}

/** Times for several follow-up rows at once, keyed by id; `null` map value where the column is missing. */
export async function readFollowUpTimes(tenantId: string, ids: string[], db: RawDb = prisma): Promise<Map<string, string | null> | null> {
  if (ids.length === 0) return new Map()
  try {
    const rows = await db.$queryRaw<{ id: string; t: string | null }[]>`
      SELECT id::text AS id, to_char(due_time, 'HH24:MI') AS t FROM deal_follow_ups
       WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])`
    return new Map(rows.map(r => [r.id, r.t]))
  } catch (err) {
    if (isTimeColumnMissing(err)) return null
    throw err
  }
}

/** Times for several accounts' `next_follow_up_time`, keyed by id; `null` map value where the column is missing. */
export async function readCompanyNextMeetingTimes(tenantId: string, ids: string[], db: RawDb = prisma): Promise<Map<string, string | null> | null> {
  if (ids.length === 0) return new Map()
  try {
    const rows = await db.$queryRaw<{ id: string; t: string | null }[]>`
      SELECT id::text AS id, to_char(next_follow_up_time, 'HH24:MI') AS t FROM companies
       WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])`
    return new Map(rows.map(r => [r.id, r.t]))
  } catch (err) {
    if (isTimeColumnMissing(err)) return null
    throw err
  }
}

/** `"HH:MM"`, 24h, or `undefined` if malformed. */
export function parseHHMM(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const m = value.trim().match(/^([0-1]?\d|2[0-3]):([0-5]\d)$/)
  if (!m) return undefined
  return `${m[1].padStart(2, '0')}:${m[2]}`
}
