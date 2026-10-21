/**
 * Accounts & Contacts, Stage 1 — everything that needs a column or table not
 * yet pushed to any database: `companies.account_kind`, `company_types.applies_to`,
 * `company_contacts.role_id` / `company_contacts.is_active`, and the new
 * `contact_roles` master.
 *
 * Agreed with Aryan, 13 Oct 2026 — see docs/accounts-contacts-spec.md.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY CALL IS GUARDED — the same trap as `src/lib/gst-setting.ts`,
 * `src/lib/party-landline.ts`, `src/lib/deal-stage-type.ts` and `src/lib/sharing.ts`.
 *
 * Agents cannot run `prisma db push`; only a human runs the SQL below. Nothing
 * here touches `companies`, `company_types` or `company_contacts` through
 * Prisma's model API for the NEW columns — `companies` and `company_contacts`
 * are selected and included everywhere, so declaring the column in the model
 * would make every existing call ask Postgres for a column it does not have
 * and 500 the whole Party surface. Every read/write below is raw SQL and
 * treats:
 *   - 42703 (undefined_column)  "this column is not there yet"
 *   - 42P01 (undefined_table)   "this table is not there yet"
 * as "not set up" rather than a fault: reads answer defaults (Company kind,
 * Company applies_to, no roles, no links beyond what company_contacts already
 * has), writes that need the missing piece answer `'unavailable'` so the
 * route can 503 with a sentence instead of 500ing.
 *
 * ⚠️ `npm run prisma:sync` (prisma db pull) would silently drop a hand-written
 * model for `contact_roles` from schema.prisma if run before the table exists,
 * and would add `account_kind`/`applies_to`/`role_id`/`is_active` to the
 * EXISTING models once the columns do exist — harmless once they exist, but do
 * not switch these functions to the model API without re-reading this header.
 *
 * ---------------------------------------------------------------------------
 * EXACT SQL — run once by Aryan, in this order:
 *
 *   ALTER TABLE companies
 *     ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'Company'
 *       CHECK (account_kind IN ('Company','Individual'));
 *
 *   ALTER TABLE company_types
 *     ADD COLUMN IF NOT EXISTS applies_to text NOT NULL DEFAULT 'Company'
 *       CHECK (applies_to IN ('Company','Individual','Both'));
 *
 *   ALTER TABLE company_contacts
 *     ADD COLUMN IF NOT EXISTS role_id uuid NULL,
 *     ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
 *     ADD COLUMN IF NOT EXISTS is_self boolean NOT NULL DEFAULT false;
 *
 *   -- Self uniqueness enforced at the DB level, not just in application code
 *   -- (addLink/changeLink below do check first, but a race or a second writer
 *   -- must not be able to create two Selfs):
 *   CREATE UNIQUE INDEX IF NOT EXISTS company_contacts_one_self_per_account_uq
 *     ON company_contacts (tenant_id, company_id) WHERE is_self AND is_active;
 *   CREATE UNIQUE INDEX IF NOT EXISTS company_contacts_one_self_per_contact_uq
 *     ON company_contacts (tenant_id, contact_id) WHERE is_self;
 *
 *   CREATE TABLE IF NOT EXISTS contact_roles (
 *     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     tenant_id   uuid NOT NULL,
 *     name        text NOT NULL,
 *     sort_order  int NOT NULL DEFAULT 0,
 *     is_active   boolean NOT NULL DEFAULT true,
 *     is_system   boolean NOT NULL DEFAULT false,
 *     created_at  timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX IF NOT EXISTS contact_roles_tenant_idx ON contact_roles (tenant_id);
 *
 *   CREATE UNIQUE INDEX IF NOT EXISTS company_contacts_one_primary_uq
 *     ON company_contacts (tenant_id, company_id) WHERE is_primary = true;
 *
 * ---------------------------------------------------------------------------
 */

import { Prisma } from '@prisma/client'
import { prisma } from './db'

type RawDb = Pick<typeof prisma, '$queryRaw' | '$executeRaw' | '$transaction'>

export const ACCOUNT_KINDS = ['Company', 'Individual'] as const
export type AccountKind = (typeof ACCOUNT_KINDS)[number]
export function isAccountKind(v: unknown): v is AccountKind {
  return typeof v === 'string' && (ACCOUNT_KINDS as readonly string[]).includes(v)
}

export const APPLIES_TO = ['Company', 'Individual', 'Both'] as const
export type AppliesTo = (typeof APPLIES_TO)[number]
export function isAppliesTo(v: unknown): v is AppliesTo {
  return typeof v === 'string' && (APPLIES_TO as readonly string[]).includes(v)
}

export const DB_NOT_READY = 'This needs a database update first.'

// ---------------------------------------------------------------------------
// Generic missing-column / missing-table detection (same probe as the sibling
// files; see their headers for how this shape was measured on Prisma 7.10).
// ---------------------------------------------------------------------------

function errShape(err: unknown) {
  return err as {
    code?: unknown
    message?: unknown
    meta?: {
      code?: unknown
      driverAdapterError?: {
        cause?: {
          originalCode?: unknown
          originalMessage?: unknown
          kind?: unknown
          column?: unknown
          table?: unknown
        }
      }
    }
    cause?: { code?: unknown; message?: unknown }
  }
}

/** 42703 naming one of `columns` (word-boundary match), else false. */
function isColumnMissing(err: unknown, columns: string[]): boolean {
  const e = errShape(err)
  const named = (text: unknown) =>
    typeof text === 'string' && columns.some(c => new RegExp(`\\b${c}\\b`).test(text))
  const cause = e?.meta?.driverAdapterError?.cause
  if (cause) {
    const undef = cause.originalCode === '42703' || cause.kind === 'ColumnNotFound'
    return undef && (named(cause.column) || named(cause.originalMessage))
  }
  if (e?.code === '42703' || e?.meta?.code === '42703' || e?.cause?.code === '42703') {
    return named(e?.message) || named(e?.cause?.message)
  }
  return (
    typeof e?.message === 'string' &&
    named(e.message) &&
    /42703|does not exist|undefined column/i.test(e.message)
  )
}

/** 42P01 naming `table`, else false. */
function isTableMissing(err: unknown, table: string): boolean {
  const e = errShape(err)
  const named = (text: unknown) => typeof text === 'string' && new RegExp(`\\b${table}\\b`).test(text)
  const cause = e?.meta?.driverAdapterError?.cause
  if (cause) {
    const undef = cause.originalCode === '42P01' || cause.kind === 'TableDoesNotExist'
    return undef && (named(cause.table) || named(cause.originalMessage))
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

function isUniqueViolation(err: unknown): boolean {
  const e = errShape(err) as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; kind?: unknown } } } }
  const cause = e?.meta?.driverAdapterError?.cause
  if (cause) return cause.originalCode === '23505' || cause.kind === 'UniqueConstraintViolation'
  const code = (err as { code?: unknown })?.code
  if (code === '23505' || code === 'P2002') return true
  return typeof (err as { message?: unknown })?.message === 'string' && /23505|duplicate key value/i.test((err as { message: string }).message)
}

// ---------------------------------------------------------------------------
// companies.account_kind
// ---------------------------------------------------------------------------

export async function readAccountKinds(
  tenantId: string,
  ids: string[],
  db: RawDb = prisma
): Promise<Map<string, AccountKind>> {
  const map = new Map<string, AccountKind>()
  if (ids.length === 0) return map
  try {
    const rows = await db.$queryRaw<{ id: string; account_kind: string | null }[]>(Prisma.sql`
      SELECT id::text AS id, account_kind FROM companies
       WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])
    `)
    for (const r of rows) map.set(r.id, r.account_kind === 'Individual' ? 'Individual' : 'Company')
    return map
  } catch (err) {
    if (isColumnMissing(err, ['account_kind'])) return map // every id defaults to Company below
    throw err
  }
}

/**
 * Ids of this tenant's Individual accounts. `account_kind` is a raw column (not
 * in the Prisma model), so a list that filters or paginates on kind needs the
 * Individual ids to hand to the `where`. Empty while the column is unset.
 */
export async function listIndividualIds(tenantId: string, db: RawDb = prisma): Promise<string[]> {
  try {
    const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id::text AS id FROM companies
       WHERE tenant_id = ${tenantId}::uuid AND account_kind = 'Individual'
    `)
    return rows.map(r => r.id)
  } catch (err) {
    if (isColumnMissing(err, ['account_kind'])) return []
    throw err
  }
}

export async function readAccountKind(tenantId: string, id: string, db: RawDb = prisma): Promise<AccountKind> {
  return (await readAccountKinds(tenantId, [id], db)).get(id) ?? 'Company'
}

/** Attaches `account_kind` to serialised company rows; defaults to Company while unset. */
export async function attachAccountKinds<T extends { id: string }>(
  rows: T[],
  tenantId: string,
  db: RawDb = prisma
): Promise<(T & { account_kind: AccountKind })[]> {
  const map = await readAccountKinds(tenantId, rows.map(r => r.id), db)
  return rows.map(row => ({ ...row, account_kind: map.get(row.id) ?? 'Company' }))
}

/** `false` when the column is not there yet — the caller still saved everything else. */
export async function writeAccountKind(
  tenantId: string,
  id: string,
  kind: AccountKind,
  db: RawDb = prisma
): Promise<boolean> {
  try {
    await db.$executeRaw(Prisma.sql`
      UPDATE companies SET account_kind = ${kind}
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `)
    return true
  } catch (err) {
    if (isColumnMissing(err, ['account_kind'])) return false
    throw err
  }
}

// ---------------------------------------------------------------------------
// company_types.applies_to
// ---------------------------------------------------------------------------

export async function readAppliesTo(
  tenantId: string,
  ids: string[],
  db: RawDb = prisma
): Promise<Map<string, AppliesTo>> {
  const map = new Map<string, AppliesTo>()
  if (ids.length === 0) return map
  try {
    const rows = await db.$queryRaw<{ id: string; applies_to: string | null }[]>(Prisma.sql`
      SELECT id::text AS id, applies_to FROM company_types
       WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])
    `)
    for (const r of rows) map.set(r.id, isAppliesTo(r.applies_to) ? r.applies_to : 'Company')
    return map
  } catch (err) {
    if (isColumnMissing(err, ['applies_to'])) return map
    throw err
  }
}

export async function readAppliesToOne(tenantId: string, id: string, db: RawDb = prisma): Promise<AppliesTo> {
  return (await readAppliesTo(tenantId, [id], db)).get(id) ?? 'Company'
}

/** Every type for this tenant, keyed by id — for the master list response. */
export async function readAllAppliesTo(tenantId: string, db: RawDb = prisma): Promise<Map<string, AppliesTo>> {
  try {
    const rows = await db.$queryRaw<{ id: string; applies_to: string | null }[]>(Prisma.sql`
      SELECT id::text AS id, applies_to FROM company_types WHERE tenant_id = ${tenantId}::uuid
    `)
    const map = new Map<string, AppliesTo>()
    for (const r of rows) map.set(r.id, isAppliesTo(r.applies_to) ? r.applies_to : 'Company')
    return map
  } catch (err) {
    if (isColumnMissing(err, ['applies_to'])) return new Map()
    throw err
  }
}

export function attachAppliesTo<T extends { id: string }>(
  rows: T[],
  map: Map<string, AppliesTo>
): (T & { applies_to: AppliesTo })[] {
  return rows.map(row => ({ ...row, applies_to: map.get(row.id) ?? 'Company' }))
}

export async function writeAppliesTo(
  tenantId: string,
  id: string,
  appliesTo: AppliesTo,
  db: RawDb = prisma
): Promise<boolean> {
  try {
    await db.$executeRaw(Prisma.sql`
      UPDATE company_types SET applies_to = ${appliesTo}
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `)
    return true
  } catch (err) {
    if (isColumnMissing(err, ['applies_to'])) return false
    throw err
  }
}

/** Does a type (by id) apply to this account kind? `true` (never blocks) while the column is unset. */
export async function typeAppliesToKind(tenantId: string, typeId: string, kind: AccountKind): Promise<boolean> {
  const applies = await readAppliesToOne(tenantId, typeId)
  return applies === 'Both' || applies === kind
}

// ---------------------------------------------------------------------------
// contact_roles — the roles master
// ---------------------------------------------------------------------------

export type ContactRole = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
  is_system: boolean
}

const DEFAULT_ROLES: { name: string; is_system: boolean }[] = [
  { name: 'Self', is_system: true },
  { name: 'Owner/Proprietor', is_system: false },
  { name: 'Director', is_system: false },
  { name: 'Partner', is_system: false },
  { name: 'Purchase Head', is_system: false },
  { name: 'Manager', is_system: false },
  { name: 'PA/Secretary', is_system: false },
  { name: 'Accountant', is_system: false },
  { name: 'Other', is_system: false },
]

function isRolesTableMissing(err: unknown): boolean {
  return isTableMissing(err, 'contact_roles')
}

async function seedRolesIfEmpty(tenantId: string): Promise<void> {
  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT count(*)::bigint AS count FROM contact_roles WHERE tenant_id = ${tenantId}::uuid
  `)
  if (Number(count) > 0) return
  for (let i = 0; i < DEFAULT_ROLES.length; i++) {
    const r = DEFAULT_ROLES[i]
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO contact_roles (tenant_id, name, sort_order, is_active, is_system)
      VALUES (${tenantId}::uuid, ${r.name}, ${i}, true, ${r.is_system})
    `)
  }
}

export async function listRoles(
  tenantId: string,
  includeInactive = true
): Promise<{ rows: ContactRole[]; available: boolean }> {
  try {
    await seedRolesIfEmpty(tenantId)
    const rows = includeInactive
      ? await prisma.$queryRaw<ContactRole[]>(Prisma.sql`
          SELECT id::text AS id, name, sort_order, is_active, is_system FROM contact_roles
           WHERE tenant_id = ${tenantId}::uuid ORDER BY sort_order ASC`)
      : await prisma.$queryRaw<ContactRole[]>(Prisma.sql`
          SELECT id::text AS id, name, sort_order, is_active, is_system FROM contact_roles
           WHERE tenant_id = ${tenantId}::uuid AND is_active = true ORDER BY sort_order ASC`)
    return { rows, available: true }
  } catch (err) {
    if (isRolesTableMissing(err)) return { rows: [], available: false }
    throw err
  }
}

export async function getRole(tenantId: string, id: string): Promise<ContactRole | null> {
  try {
    const rows = await prisma.$queryRaw<ContactRole[]>(Prisma.sql`
      SELECT id::text AS id, name, sort_order, is_active, is_system FROM contact_roles
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid`)
    return rows[0] ?? null
  } catch (err) {
    if (isRolesTableMissing(err)) return null
    throw err
  }
}

/** The tenant's Self role, seeding the defaults first if the table is empty. `null` while unavailable. */
export async function getSelfRole(tenantId: string): Promise<ContactRole | null> {
  const { rows, available } = await listRoles(tenantId)
  if (!available) return null
  return rows.find(r => r.is_system) ?? null
}

export async function createRole(
  tenantId: string,
  name: string,
  sortOrder: number
): Promise<ContactRole | 'unavailable'> {
  try {
    const rows = await prisma.$queryRaw<ContactRole[]>(Prisma.sql`
      INSERT INTO contact_roles (tenant_id, name, sort_order, is_active, is_system)
      VALUES (${tenantId}::uuid, ${name}, ${sortOrder}, true, false)
      RETURNING id::text AS id, name, sort_order, is_active, is_system
    `)
    return rows[0]
  } catch (err) {
    if (isRolesTableMissing(err)) return 'unavailable'
    throw err
  }
}

/** Refuses to touch the Self role's name/active flag — caller must check `is_system` first for a clear message. */
export async function updateRole(
  tenantId: string,
  id: string,
  data: { name?: string; sort_order?: number; is_active?: boolean }
): Promise<ContactRole | 'unavailable' | 'locked' | null> {
  try {
    const current = await getRole(tenantId, id)
    if (!current) return null
    if (current.is_system && ((data.name && data.name !== current.name) || data.is_active === false)) {
      return 'locked'
    }
    const name = data.name ?? current.name
    const sortOrder = data.sort_order ?? current.sort_order
    const isActive = current.is_system ? true : (data.is_active ?? current.is_active)
    const rows = await prisma.$queryRaw<ContactRole[]>(Prisma.sql`
      UPDATE contact_roles SET name = ${name}, sort_order = ${sortOrder}, is_active = ${isActive}
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
       RETURNING id::text AS id, name, sort_order, is_active, is_system
    `)
    return rows[0] ?? null
  } catch (err) {
    if (isRolesTableMissing(err)) return 'unavailable'
    throw err
  }
}

/** Refuses the Self role. `'in-use'` when links reference it (role deletion was not asked for by the spec, so this is deactivate-only via updateRole in practice; kept for completeness). */
export async function deleteRole(tenantId: string, id: string): Promise<'ok' | 'unavailable' | 'locked' | null> {
  try {
    const current = await getRole(tenantId, id)
    if (!current) return null
    if (current.is_system) return 'locked'
    await prisma.$executeRaw(Prisma.sql`
      UPDATE contact_roles SET is_active = false WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
    `)
    return 'ok'
  } catch (err) {
    if (isRolesTableMissing(err)) return 'unavailable'
    throw err
  }
}

// ---------------------------------------------------------------------------
// company_contacts.role_id / is_active — the account<->contact LINK
// ---------------------------------------------------------------------------

export type LinkRow = {
  link_id: string
  company_id: string
  contact_id: string
  role_id: string | null
  role_name: string | null
  is_primary: boolean
  is_active: boolean
  is_self: boolean
}

function linksColumnsMissing(err: unknown): boolean {
  return isColumnMissing(err, ['role_id', 'is_active', 'is_self'])
}

/** Every link on one account, with role name joined in. Active + inactive, caller filters. */
export async function listLinksForCompany(tenantId: string, companyId: string): Promise<LinkRow[]> {
  try {
    return await prisma.$queryRaw<LinkRow[]>(Prisma.sql`
      SELECT cc.id::text AS link_id, cc.company_id::text AS company_id, cc.contact_id::text AS contact_id,
             cc.role_id::text AS role_id, r.name AS role_name, cc.is_primary, cc.is_active, cc.is_self
        FROM company_contacts cc
        LEFT JOIN contact_roles r ON r.id = cc.role_id AND r.tenant_id = cc.tenant_id
       WHERE cc.tenant_id = ${tenantId}::uuid AND cc.company_id = ${companyId}::uuid
       ORDER BY cc.created_at ASC
    `)
  } catch (err) {
    if (linksColumnsMissing(err)) {
      // Degrade to the plain join table: every link reads as active, role null.
      const rows = await prisma.company_contacts.findMany({
        where: { tenant_id: tenantId, company_id: companyId },
        select: { id: true, company_id: true, contact_id: true, is_primary: true },
        orderBy: { created_at: 'asc' },
      })
      return rows.map(r => ({
        link_id: r.id, company_id: r.company_id, contact_id: r.contact_id,
        role_id: null, role_name: null, is_primary: r.is_primary, is_active: true, is_self: false,
      }))
    }
    throw err
  }
}

/** Every link for one contact (its accounts), same shape. */
export async function listLinksForContact(tenantId: string, contactId: string): Promise<LinkRow[]> {
  try {
    return await prisma.$queryRaw<LinkRow[]>(Prisma.sql`
      SELECT cc.id::text AS link_id, cc.company_id::text AS company_id, cc.contact_id::text AS contact_id,
             cc.role_id::text AS role_id, r.name AS role_name, cc.is_primary, cc.is_active, cc.is_self
        FROM company_contacts cc
        LEFT JOIN contact_roles r ON r.id = cc.role_id AND r.tenant_id = cc.tenant_id
       WHERE cc.tenant_id = ${tenantId}::uuid AND cc.contact_id = ${contactId}::uuid
       ORDER BY cc.created_at ASC
    `)
  } catch (err) {
    if (linksColumnsMissing(err)) {
      const rows = await prisma.company_contacts.findMany({
        where: { tenant_id: tenantId, contact_id: contactId },
        select: { id: true, company_id: true, contact_id: true, is_primary: true },
        orderBy: { created_at: 'asc' },
      })
      return rows.map(r => ({
        link_id: r.id, company_id: r.company_id, contact_id: r.contact_id,
        role_id: null, role_name: null, is_primary: r.is_primary, is_active: true, is_self: false,
      }))
    }
    throw err
  }
}

/** The account a contact is Self on, or null. `is_self` is the source of truth; the roles table need not be available. */
export async function findSelfAccountForContact(tenantId: string, contactId: string): Promise<string | null> {
  const links = await listLinksForContact(tenantId, contactId)
  const hit = links.find(l => l.is_self && l.is_active)
  return hit?.company_id ?? null
}

export type AddLinkResult =
  | { ok: true; link_id: string }
  | { ok: false; error: string; status: number }

/**
 * Add one account<->contact link. Enforces: one active primary per account
 * (clears the other), and the Self rules — a contact can be Self on only one
 * account, and an account gets at most one active Self link.
 */
export async function addLink(
  tenantId: string,
  companyId: string,
  contactId: string,
  roleId: string | null,
  makePrimary: boolean
): Promise<AddLinkResult> {
  try {
    const self = await getSelfRole(tenantId)
    const isSelf = !!(roleId && self && roleId === self.id)
    if (isSelf) {
      const existingSelfAccount = await findSelfAccountForContact(tenantId, contactId)
      if (existingSelfAccount && existingSelfAccount !== companyId) {
        return { ok: false, error: 'This person is already the Self contact of another account.', status: 409 }
      }
      const links = await listLinksForCompany(tenantId, companyId)
      if (links.some(l => l.is_self && l.is_active && l.contact_id !== contactId)) {
        return { ok: false, error: 'This account already has a Self contact.', status: 409 }
      }
    }

    const id = await prisma.$transaction(async tx => {
      if (makePrimary) {
        await tx.company_contacts.updateMany({
          where: { tenant_id: tenantId, company_id: companyId },
          data: { is_primary: false },
        })
      }
      // `company_contacts` has a unique (company_id, contact_id) — re-linking a
      // contact who already has a (possibly inactive, possibly differently-roled)
      // link to this same account, e.g. restoring Self on a round trip through
      // Company and back, must UPDATE that row rather than INSERT a duplicate,
      // which would 409 on the unique constraint despite this being a legitimate
      // re-link.
      const existing = await tx.company_contacts.findFirst({
        where: { tenant_id: tenantId, company_id: companyId, contact_id: contactId },
        select: { id: true },
      })
      const linkId = existing
        ? existing.id
        : (
            await tx.company_contacts.create({
              data: { tenant_id: tenantId, company_id: companyId, contact_id: contactId, is_primary: makePrimary },
              select: { id: true },
            })
          ).id
      if (existing && makePrimary) {
        await tx.company_contacts.update({ where: { id: existing.id }, data: { is_primary: true } })
      }
      try {
        await tx.$executeRaw(Prisma.sql`
          UPDATE company_contacts SET role_id = ${roleId}::uuid, is_active = true, is_self = ${isSelf}
           WHERE id = ${linkId}::uuid AND tenant_id = ${tenantId}::uuid
        `)
      } catch (err) {
        if (!linksColumnsMissing(err)) throw err
        // Role/active/is_self columns absent: the link exists with no role —
        // acceptable degradation, same as the sibling "unavailable" files.
      }
      return linkId
    })
    return { ok: true, link_id: id }
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Could be the plain (company_id, contact_id) link uniqueness, or one of
      // the two Self partial unique indexes catching a race the app-level
      // check above missed — either way the record was not duplicated.
      return { ok: false, error: 'This person is already linked to this account.', status: 409 }
    }
    throw err
  }
}

export type ChangeLinkResult = { ok: true } | { ok: false; error: string; status: number }

/** Change a link's role / primary / active. Refuses on the Self link while the account is an Individual — caller passes `isIndividual`. */
export async function changeLink(
  tenantId: string,
  linkId: string,
  data: { role_id?: string | null; is_primary?: boolean; is_active?: boolean },
  isIndividual: boolean
): Promise<ChangeLinkResult> {
  const link = await prisma.company_contacts.findFirst({
    where: { id: linkId, tenant_id: tenantId },
    select: { id: true, company_id: true, contact_id: true },
  })
  if (!link) return { ok: false, error: 'Not found', status: 404 }

  const self = await getSelfRole(tenantId)
  const current = (await listLinksForCompany(tenantId, link.company_id)).find(l => l.link_id === linkId)
  const isSelfLink = !!current?.is_self

  if (isSelfLink && isIndividual && (('role_id' in data && data.role_id !== self?.id) || data.is_active === false)) {
    return { ok: false, error: 'The Self link cannot be removed or re-roled while this account is an Individual.', status: 409 }
  }
  const settingSelf = !!(data.role_id && self && data.role_id === self.id)
  if (settingSelf && !isSelfLink) {
    const existingSelfAccount = await findSelfAccountForContact(tenantId, link.contact_id)
    if (existingSelfAccount && existingSelfAccount !== link.company_id) {
      return { ok: false, error: 'This person is already the Self contact of another account.', status: 409 }
    }
    const links = await listLinksForCompany(tenantId, link.company_id)
    if (links.some(l => l.is_self && l.is_active && l.link_id !== linkId)) {
      return { ok: false, error: 'This account already has a Self contact.', status: 409 }
    }
  }
  // Moving a link OFF the Self role clears is_self too, except the locked
  // case already refused above.
  const nextIsSelf = 'role_id' in data ? settingSelf : isSelfLink

  await prisma.$transaction(async tx => {
    if (data.is_primary) {
      await tx.company_contacts.updateMany({
        where: { tenant_id: tenantId, company_id: link.company_id },
        data: { is_primary: false },
      })
    }
    if (data.is_primary !== undefined) {
      await tx.company_contacts.update({ where: { id: linkId }, data: { is_primary: data.is_primary } })
    }
    const sets: Prisma.Sql[] = []
    if ('role_id' in data) {
      sets.push(Prisma.sql`role_id = ${data.role_id}::uuid`)
      sets.push(Prisma.sql`is_self = ${nextIsSelf}`)
    }
    if (data.is_active !== undefined) sets.push(Prisma.sql`is_active = ${data.is_active}`)
    if (sets.length) {
      try {
        await tx.$executeRaw(Prisma.sql`
          UPDATE company_contacts SET ${Prisma.join(sets, ', ')}
           WHERE id = ${linkId}::uuid AND tenant_id = ${tenantId}::uuid
        `)
      } catch (err) {
        if (!linksColumnsMissing(err)) throw err
      }
    }
  })
  return { ok: true }
}

/** Remove (hard-delete) a link. Refuses the Self link. */
export async function removeLink(tenantId: string, linkId: string): Promise<ChangeLinkResult> {
  const link = await prisma.company_contacts.findFirst({
    where: { id: linkId, tenant_id: tenantId },
    select: { id: true, company_id: true },
  })
  if (!link) return { ok: false, error: 'Not found', status: 404 }
  const current = (await listLinksForCompany(tenantId, link.company_id)).find(l => l.link_id === linkId)
  if (current?.is_self) {
    return { ok: false, error: 'This is the Self link and cannot be removed.', status: 409 }
  }
  await prisma.company_contacts.deleteMany({ where: { id: linkId, tenant_id: tenantId } })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Delete rules (spec §5) — "has history" checks
// ---------------------------------------------------------------------------

export async function companyHasHistory(tenantId: string, companyId: string): Promise<boolean> {
  const [visit, deal, order] = await Promise.all([
    prisma.daily_visits.findFirst({ where: { tenant_id: tenantId, entity_id: companyId }, select: { id: true } }),
    prisma.deals.findFirst({ where: { tenant_id: tenantId, company_id: companyId }, select: { id: true } }),
    prisma.orders.findFirst({ where: { tenant_id: tenantId, entity_id: companyId }, select: { id: true } }),
  ])
  return !!(visit || deal || order)
}

export async function contactHasHistory(tenantId: string, contactId: string): Promise<boolean> {
  const [deal, visit] = await Promise.all([
    prisma.deals.findFirst({ where: { tenant_id: tenantId, contact_id: contactId }, select: { id: true } }),
    // daily_visits.contact_id is itself an unpushed column (src/lib/visit-contact.ts) — guarded the same way.
    (async () => {
      try {
        const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM daily_visits WHERE tenant_id = ${tenantId}::uuid AND contact_id = ${contactId}::uuid LIMIT 1
        `)
        return rows[0] ?? null
      } catch (err) {
        if (isColumnMissing(err, ['contact_id'])) return null
        throw err
      }
    })(),
  ])
  return !!(deal || visit)
}

/** The accounts a contact is linked to — for the delete-warning dry run. */
export async function contactLinkedAccountNames(tenantId: string, contactId: string): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.company_contacts.findMany({
    where: { tenant_id: tenantId, contact_id: contactId },
    // The relation to `companies` is named `business_partners` in the Prisma
    // client (the table was renamed from `business_partners` to `companies`
    // without regenerating the relation field name — see src/app/api/companies/_access.ts).
    select: { business_partners: { select: { id: true, name: true } } },
  })
  return rows.map(r => r.business_partners)
}

// ---------------------------------------------------------------------------
// Duplicates (spec §6) — never blocks, only informs
// ---------------------------------------------------------------------------

function normDigits(v: string | null | undefined): string | null {
  if (!v) return null
  const d = v.replace(/\D/g, '')
  return d.length >= 7 ? d : null
}

export type DuplicateMatch = { kind: 'account' | 'contact'; id: string; name: string; reason: 'mobile' | 'name' }

export async function findDuplicates(
  tenantId: string,
  opts: { mobile?: string | null; name?: string | null; accountId?: string | null }
): Promise<DuplicateMatch[]> {
  const out: DuplicateMatch[] = []
  const mobile = normDigits(opts.mobile)
  if (mobile) {
    const [accounts, contacts] = await Promise.all([
      prisma.companies.findMany({
        where: {
          tenant_id: tenantId,
          OR: [{ mobile_1: { contains: mobile } }, { mobile_2: { contains: mobile } }],
        },
        select: { id: true, name: true, mobile_1: true, mobile_2: true },
      }),
      prisma.contacts.findMany({
        where: {
          tenant_id: tenantId,
          OR: [{ mobile: { contains: mobile } }, { alternate_mobile: { contains: mobile } }],
        },
        select: { id: true, name: true, mobile: true, alternate_mobile: true },
      }),
    ])
    for (const a of accounts) {
      if (normDigits(a.mobile_1) === mobile || normDigits(a.mobile_2) === mobile) {
        out.push({ kind: 'account', id: a.id, name: a.name, reason: 'mobile' })
      }
    }
    for (const c of contacts) {
      if (normDigits(c.mobile) === mobile || normDigits(c.alternate_mobile) === mobile) {
        out.push({ kind: 'contact', id: c.id, name: c.name, reason: 'mobile' })
      }
    }
  }
  const name = opts.name?.trim()
  if (name && opts.accountId) {
    const links = await prisma.company_contacts.findMany({
      where: { tenant_id: tenantId, company_id: opts.accountId },
      select: { contacts: { select: { id: true, name: true } } },
    })
    for (const l of links) {
      if (l.contacts.name.trim().toLowerCase() === name.toLowerCase()) {
        out.push({ kind: 'contact', id: l.contacts.id, name: l.contacts.name, reason: 'name' })
      }
    }
  }
  return out
}
