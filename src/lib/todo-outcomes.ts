/**
 * "Couldn't meet" outcomes — `todo_unmet_reasons` (a master) and
 * `todo_outcomes` (one row per to-do the rep explicitly marked as not met).
 *
 * NEITHER TABLE IS PUSHED YET. Same trap as `src/lib/gst-setting.ts` and
 * `src/lib/party-landline.ts`: the tables are not in any database (local or
 * production) and only a human may run `prisma db push`. Nothing reads or
 * writes them through Prisma's model API — every access here is raw SQL, and
 * every function treats Postgres 42P01 (undefined_table) as "not set up
 * yet": reads answer empty/defaults, writes answer `'unavailable'` so the
 * caller can return a 503 instead of a 500. Once a human pushes the schema,
 * the same code starts storing real rows with no further change.
 *
 * Exact DDL a human (or the owner's migration) should run:
 *
 *   CREATE TABLE IF NOT EXISTS todo_unmet_reasons (
 *     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     tenant_id   uuid NOT NULL,
 *     name        text NOT NULL,
 *     sort_order  int NOT NULL DEFAULT 0,
 *     is_active   boolean NOT NULL DEFAULT true,
 *     created_at  timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX IF NOT EXISTS todo_unmet_reasons_tenant_idx
 *     ON todo_unmet_reasons (tenant_id);
 *
 *   CREATE TABLE IF NOT EXISTS todo_outcomes (
 *     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     tenant_id   uuid NOT NULL,
 *     user_id     uuid NOT NULL,
 *     todo_kind   text NOT NULL CHECK (todo_kind IN ('plan','followup','next_meeting')),
 *     todo_ref    text NOT NULL,
 *     party_id    uuid NULL,
 *     due_date    date NOT NULL,
 *     outcome     text NOT NULL DEFAULT 'couldnt_meet' CHECK (outcome = 'couldnt_meet'),
 *     reason_id   uuid NULL,
 *     note        text NULL,
 *     new_date    date NULL,
 *     latitude    double precision NULL,
 *     longitude   double precision NULL,
 *     address     text NULL,
 *     created_at  timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX IF NOT EXISTS todo_outcomes_tenant_user_due_idx
 *     ON todo_outcomes (tenant_id, user_id, due_date);
 *   CREATE INDEX IF NOT EXISTS todo_outcomes_tenant_party_idx
 *     ON todo_outcomes (tenant_id, party_id);
 *
 * ⚠️ `npm run prisma:sync` runs `prisma db pull`, which would silently drop
 * any hand-declared model for these tables from schema.prisma if run before
 * they exist in the database — so neither table is declared there yet.
 */

import { prisma } from './db'

function isUndefinedTable(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown }; message?: unknown }
  if (e?.code === '42P01' || e?.meta?.code === '42P01' || e?.cause?.code === '42P01') return true
  return typeof e?.message === 'string' && /does not exist/i.test(e.message) && /todo_(unmet_reasons|outcomes)/.test(e.message)
}

export type TodoUnmetReason = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
}

const DEFAULT_REASONS = [
  'Customer not available',
  'No appointment',
  'Customer asked to postpone',
  'Not needed any more',
]

/** Seeds the four defaults for a tenant the first time its reasons list is
 *  read empty — ordinary editable rows after that, not fixed/hardcoded. */
async function seedDefaultsIfEmpty(tenantId: string): Promise<void> {
  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*)::bigint AS count FROM todo_unmet_reasons WHERE tenant_id = ${tenantId}::uuid
  `
  if (Number(count) > 0) return
  for (let i = 0; i < DEFAULT_REASONS.length; i++) {
    await prisma.$executeRaw`
      INSERT INTO todo_unmet_reasons (tenant_id, name, sort_order, is_active)
      VALUES (${tenantId}::uuid, ${DEFAULT_REASONS[i]}, ${i}, true)
    `
  }
}

export async function listUnmetReasons(
  tenantId: string,
  includeInactive: boolean
): Promise<{ rows: TodoUnmetReason[]; available: boolean }> {
  try {
    await seedDefaultsIfEmpty(tenantId)
    const rows = includeInactive
      ? await prisma.$queryRaw<TodoUnmetReason[]>`
          SELECT id, name, sort_order, is_active FROM todo_unmet_reasons
           WHERE tenant_id = ${tenantId}::uuid ORDER BY sort_order ASC`
      : await prisma.$queryRaw<TodoUnmetReason[]>`
          SELECT id, name, sort_order, is_active FROM todo_unmet_reasons
           WHERE tenant_id = ${tenantId}::uuid AND is_active = true ORDER BY sort_order ASC`
    return { rows, available: true }
  } catch (err) {
    if (isUndefinedTable(err)) return { rows: [], available: false }
    throw err
  }
}

export async function createUnmetReason(
  tenantId: string, name: string, sortOrder: number
): Promise<TodoUnmetReason | 'unavailable'> {
  try {
    const rows = await prisma.$queryRaw<TodoUnmetReason[]>`
      INSERT INTO todo_unmet_reasons (tenant_id, name, sort_order, is_active)
      VALUES (${tenantId}::uuid, ${name}, ${sortOrder}, true)
      RETURNING id, name, sort_order, is_active
    `
    return rows[0]
  } catch (err) {
    if (isUndefinedTable(err)) return 'unavailable'
    throw err
  }
}

export async function updateUnmetReason(
  tenantId: string, id: string, data: { name?: string; sort_order?: number; is_active?: boolean }
): Promise<TodoUnmetReason | 'unavailable' | null> {
  try {
    const current = await prisma.$queryRaw<TodoUnmetReason[]>`
      SELECT id, name, sort_order, is_active FROM todo_unmet_reasons
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`
    if (!current[0]) return null
    const name = data.name ?? current[0].name
    const sortOrder = data.sort_order ?? current[0].sort_order
    const isActive = data.is_active ?? current[0].is_active
    const rows = await prisma.$queryRaw<TodoUnmetReason[]>`
      UPDATE todo_unmet_reasons SET name = ${name}, sort_order = ${sortOrder}, is_active = ${isActive}
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
       RETURNING id, name, sort_order, is_active`
    return rows[0]
  } catch (err) {
    if (isUndefinedTable(err)) return 'unavailable'
    throw err
  }
}

export type TodoKind = 'plan' | 'followup' | 'next_meeting'

export type RecordOutcomeInput = {
  tenantId: string
  userId: string
  todoKind: TodoKind
  todoRef: string
  partyId: string | null
  dueDate: string
  reasonId: string | null
  note: string | null
  newDate: string | null
  latitude: number | null
  longitude: number | null
  address: string | null
}

export async function recordCouldntMeet(input: RecordOutcomeInput): Promise<{ id: string } | 'unavailable'> {
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO todo_outcomes
        (tenant_id, user_id, todo_kind, todo_ref, party_id, due_date, outcome,
         reason_id, note, new_date, latitude, longitude, address)
      VALUES
        (${input.tenantId}::uuid, ${input.userId}::uuid, ${input.todoKind}, ${input.todoRef},
         ${input.partyId}::uuid, ${input.dueDate}::date, 'couldnt_meet',
         ${input.reasonId}::uuid, ${input.note}, ${input.newDate}::date,
         ${input.latitude}, ${input.longitude}, ${input.address})
      RETURNING id
    `
    return rows[0]
  } catch (err) {
    if (isUndefinedTable(err)) return 'unavailable'
    throw err
  }
}

export type CouldntMeetRow = {
  todo_kind: TodoKind
  todo_ref: string
  party_id: string | null
  due_date: Date
}

/** Every "couldn't meet" outcome for these users due in `[from, to]` —
 *  used by the outcome-counting helper to pull a to-do out of Missed and
 *  into its own bucket. Empty when the table does not exist yet. */
export async function listCouldntMeet(
  tenantId: string, userIds: string[], from: string, to: string
): Promise<CouldntMeetRow[]> {
  if (userIds.length === 0) return []
  try {
    return await prisma.$queryRaw<CouldntMeetRow[]>`
      SELECT todo_kind, todo_ref, party_id, due_date FROM todo_outcomes
       WHERE tenant_id = ${tenantId}::uuid AND user_id = ANY(${userIds}::uuid[])
         AND due_date >= ${from}::date AND due_date <= ${to}::date
    `
  } catch (err) {
    if (isUndefinedTable(err)) return []
    throw err
  }
}

/** Parties with 3+ "couldn't meet" outcomes for a user within the rolling
 *  window ending `asOf` — the manager-view flag. Empty when unavailable. */
export async function partiesWithRepeatedCouldntMeet(
  tenantId: string, userId: string, sinceDate: string
): Promise<{ party_id: string; party_name: string | null; count: bigint }[]> {
  try {
    return await prisma.$queryRaw<{ party_id: string; party_name: string | null; count: bigint }[]>`
      SELECT o.party_id, c.name AS party_name, count(*)::bigint AS count
        FROM todo_outcomes o
        LEFT JOIN companies c ON c.id = o.party_id AND c.tenant_id = o.tenant_id
       WHERE o.tenant_id = ${tenantId}::uuid AND o.user_id = ${userId}::uuid
         AND o.party_id IS NOT NULL AND o.due_date >= ${sinceDate}::date
       GROUP BY o.party_id, c.name
      HAVING count(*) >= 3
    `
  } catch (err) {
    if (isUndefinedTable(err)) return []
    throw err
  }
}

/** `partiesWithRepeatedCouldntMeet` for many users in one query: the same rows,
 *  each tagged with its user. Empty when the table is unavailable. */
export async function partiesWithRepeatedCouldntMeetForUsers(
  tenantId: string, userIds: string[], sinceDate: string
): Promise<{ user_id: string; party_id: string; party_name: string | null; count: bigint }[]> {
  if (userIds.length === 0) return []
  try {
    return await prisma.$queryRaw<{ user_id: string; party_id: string; party_name: string | null; count: bigint }[]>`
      SELECT o.user_id, o.party_id, c.name AS party_name, count(*)::bigint AS count
        FROM todo_outcomes o
        LEFT JOIN companies c ON c.id = o.party_id AND c.tenant_id = o.tenant_id
       WHERE o.tenant_id = ${tenantId}::uuid AND o.user_id = ANY(${userIds}::uuid[])
         AND o.party_id IS NOT NULL AND o.due_date >= ${sinceDate}::date
       GROUP BY o.user_id, o.party_id, c.name
      HAVING count(*) >= 3
    `
  } catch (err) {
    if (isUndefinedTable(err)) return []
    throw err
  }
}
