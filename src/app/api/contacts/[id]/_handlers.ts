import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { CONTACT_INCLUDE, loadCompanies, readCompanyIds, shapeContact } from '../_shape'
import { checkEmail, checkLandline, checkPhone, firstError, trimmed } from '@/lib/validation'
import { LANDLINE_NOT_SAVED, readLandlines, writeLandline } from '@/lib/party-landline'
import { scopedUserIds, scopeWhere } from '@/lib/scope'
import { findScopedContact, foreignContactRef } from '../_access'
import { ownerOutsideScope } from '../../companies/_access'


/**
 * GET — one contact, **with the companies it is linked to** (REBUILD-PLAN.md
 * §3.2: the Contact page shows them, plural). The response is a bare object:
 *
 *   { …contact, contact_types, owner, companies: [{ id, name, type, stage,
 *     is_primary, link_id }, …] }
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'contacts', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    const ids = await scopedUserIds(user, 'contacts')
    // findFirst, not findUnique: the tenant filter is not part of the primary
    // key and it must be in the `where`, or a contact id from another tenant
    // resolves. Dropping it leaks across tenants with nothing crashing. The
    // scope predicate is the list's own (§6.6) — see `../_access.ts`.
    const row = await prisma.contacts.findFirst({
      where: { id: params.id, tenant_id: tid, ...scopeWhere(ids, 'owner_user_id') },
      include: CONTACT_INCLUDE,
    })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // `null` until the column exists (src/lib/party-landline.ts).
    const landline = (await readLandlines(tid, 'contacts', [row.id]))?.get(row.id) ?? null
    return NextResponse.json({ ...shapeContact(serialize(row, 'contacts') as Record<string, unknown>), landline })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * The columns PUT may write.
 *
 * An allow-list, not `data: body`. `/api/companies/[id]` shipped the other way
 * round and it was a mass-assignment bug (P1-T10.2 / gap G5): every column was
 * writable by anything that could reach the route, `id` and `tenant_id`
 * included. A key that is not on this list is IGNORED rather than rejected,
 * because the Contact form posts its whole state back — including the `owner`,
 * `companies` and `contact_types` embeds GET returned — and a 400 on an extra
 * key would break it.
 *
 * `is_complete` / `completeness_missing` are absent by design: they are derived
 * columns and no Contact rule exists to derive them from (see `_handlers.ts`).
 * `company_ids` is absent too — it is not a column; it is handled below.
 */
const UPDATABLE = [
  'name', 'mobile', 'alternate_mobile', 'whatsapp', 'email', 'designation',
  'contact_type_id', 'owner_user_id', 'birthday', 'anniversary', 'notes',
  'is_active',
] as const

/** The nullable TEXT columns in UPDATABLE: a blank value clears them to NULL. */
const NULLABLE_TEXT = new Set([
  'alternate_mobile', 'whatsapp', 'email', 'designation', 'notes',
])

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'contacts', 'edit')) return forbidden()
  const body = await req.json() as Record<string, unknown>

  // The identical set POST runs — the two verbs drifting apart is exactly what
  // src/lib/validation.ts exists to prevent.
  const bad = firstError(
    checkPhone(body.mobile, 'Mobile Number'),
    checkPhone(body.alternate_mobile, 'Alternate Number'),
    checkPhone(body.whatsapp, 'WhatsApp Number'),
    checkEmail(body.email),
    checkLandline(body.landline),
  )
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  const data: Record<string, unknown> = {}
  for (const key of UPDATABLE) {
    if (!(key in body)) continue
    const value = body[key]

    switch (key) {
      // NOT NULL, and compulsory per §3.4. Sending them blank is a 400, not a
      // silent no-op — the form's own required check would have to be bypassed
      // to get here.
      case 'name':
      case 'mobile': {
        const text = trimmed(value)
        if (text === null) {
          const label = key === 'name' ? 'Name' : 'Mobile Number'
          return NextResponse.json({ error: `${label} is required` }, { status: 400 })
        }
        data[key] = text
        break
      }
      // @db.Date — the client sends "YYYY-MM-DD", Prisma wants a Date, and a
      // blank clears it.
      case 'birthday':
      case 'anniversary':
        data[key] = value ? new Date(String(value)) : null
        break
      case 'is_active':
        data.is_active = Boolean(value)
        break
      default:
        // Nullable text (trim, blank -> null) or a nullable uuid FK (empty
        // string -> null).
        data[key] = NULLABLE_TEXT.has(key) ? trimmed(value) : (value || null)
    }
  }

  // Company links are replaced only when the caller actually sends the key.
  // Absent means "leave them alone"; `[]` means "unlink everything", and the two
  // have to stay distinguishable or a PUT from a form that does not render the
  // company picker would silently wipe the links.
  const replaceLinks = 'company_ids' in body
  const parsed = readCompanyIds(replaceLinks ? body.company_ids : undefined)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const ids = parsed.ids

  const tid = getTenantId()

  try {
    const found = await loadCompanies(ids, tid)
    if ('error' in found) return NextResponse.json({ error: found.error }, { status: 400 })

    // The row must be proved to be in this tenant, and in the caller's scope,
    // before the join rows are touched: the delete/insert below key on
    // contact_id, and doing them for a contact that turned out to belong to
    // someone else would have rewritten their links before update() raised
    // P2025.
    const exists = await findScopedContact(user, tid, params.id)
    if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const miss = await foreignContactRef(tid, data)
    if (miss) return NextResponse.json({ error: miss }, { status: 400 })

    // As on a company: reassigning or clearing the owner is held to the
    // caller's `contacts` scope. Only checked when the owner is written.
    if ('owner_user_id' in data) {
      const outside = await ownerOutsideScope(user, 'contacts', data.owner_user_id)
      if (outside) return NextResponse.json({ error: outside }, { status: 403 })
    }

    const primaryId = trimmed(body.primary_company_id)

    const updated = await prisma.$transaction(async tx => {
      if (replaceLinks) {
        // Replace, not merge: the form sends the full set it wants to end with.
        // Both statements carry tenant_id even though contact_id is already
        // proved — the predicate belongs on every query touching the table.
        await tx.company_contacts.deleteMany({
          where: { contact_id: params.id, tenant_id: tid },
        })
        if (ids.length) {
          await tx.company_contacts.createMany({
            data: ids.map(id => ({
              tenant_id: tid,
              contact_id: params.id,
              company_id: id,
              is_primary: id === primaryId,
            })),
          })
        }
      }

      return tx.contacts.update({
        where: { id: params.id, tenant_id: tid },
        data,
        include: CONTACT_INCLUDE,
      })
    })

    // Landline only when the form sent the key, as on a company. Until the
    // column exists the rest is saved and the response says the landline was
    // not stored; a blank sent then loses nothing, so it carries no warning.
    let landline: string | null
    let landlineWarning = false
    if ('landline' in body) {
      landline = trimmed(body.landline)
      const saved = await writeLandline(tid, 'contacts', params.id, landline)
      if (!saved) { landlineWarning = landline !== null; landline = null }
    } else {
      landline = (await readLandlines(tid, 'contacts', [params.id]))?.get(params.id) ?? null
    }

    return NextResponse.json({
      ...shapeContact(serialize(updated, 'contacts') as Record<string, unknown>),
      landline,
      ...(landlineWarning ? { warning: LANDLINE_NOT_SAVED } : {}),
    })
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025')
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * DELETE — a **soft** delete: `is_active = false`, the row stays.
 *
 * A contact is referenced by `company_contacts` and, from Phase 2, by deals and
 * activity; a hard delete would either fail on the FK or take history with it.
 * The list hides inactive contacts by default, so this reads as a delete.
 *
 * An id that is not the caller's to see — another tenant's, another rep's on
 * `own` scope, or one that does not exist — is a 404, found before the write.
 * `updateMany`, not `update`, so a row that vanishes in between stays silent
 * rather than throwing P2025 into a 500 carrying the raw Prisma message.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'contacts', 'delete')) return forbidden()
  const tid = getTenantId()
  try {
    // Outside the caller's scope is a 404, as on GET and PUT.
    const found = await findScopedContact(user, tid, params.id)
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.contacts.updateMany({
      where: { id: found.id, tenant_id: tid },
      data: { is_active: false },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
