import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { CONTACT_INCLUDE, loadCompanies, readCompanyIds, shapeContact } from '../_shape'
import { checkEmail, checkLandline, checkPhone, firstError, trimmed } from '@/lib/validation'
import { LANDLINE_NOT_SAVED, readLandlines, writeLandline } from '@/lib/party-landline'
import { findScopedContact, foreignContactRef } from '../_access'
import { getCompanyAccessLevel } from '@/lib/sharing'
import { ownerOutsideScope } from '../../companies/_access'
import { contactHasHistory, contactLinkedAccountNames, findSelfAccountForContact } from '@/lib/account-kind'


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
    // The list's own rule (§6.6), widened by sharing — see `../_access.ts`.
    const found = await findScopedContact(user, tid, params.id, 'read')
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // findFirst, not findUnique: the tenant filter is not part of the primary
    // key and it must be in the `where`, or a contact id from another tenant
    // resolves. Dropping it leaks across tenants with nothing crashing.
    const row = await prisma.contacts.findFirst({
      where: { id: found.id, tenant_id: tid },
      include: CONTACT_INCLUDE,
    })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // `null` until the column exists (src/lib/party-landline.ts).
    const landline = (await readLandlines(tid, 'contacts', [row.id]))?.get(row.id) ?? null
    const shaped = shapeContact(serialize(row, 'contacts') as Record<string, unknown>) as Record<string, unknown> & {
      companies: (Record<string, unknown> & { id?: unknown })[]
    }
    // Privacy with sharing (docs/accounts-contacts-spec.md §9): "A contact
    // reached through a shared account shows only its links to accounts the
    // viewer can access." Someone who reaches this contact only through a
    // SHARED account must not learn it is ALSO linked to some other account
    // they cannot open — even the other account's NAME is other-tenant-owner
    // data the viewer has no access to. Not filtered for owner-scope viewers,
    // whose page is exactly as before (every link visible, as always).
    if (found.access !== 'owner-scope') {
      const checked = await Promise.all(
        shaped.companies.map(async c => ({
          row: c,
          accessible: (await getCompanyAccessLevel(user, tid, String(c.id))) !== null,
        }))
      )
      shaped.companies = checked.filter(c => c.accessible).map(c => c.row)
    }
    return NextResponse.json({
      ...shaped,
      landline,
      // 'owner-scope' | 'work' | 'view' — so the page can disable its write
      // controls for a 'view' member without deciding access itself.
      access: found.access,
    })
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
      // NOT NULL and compulsory. Sending it blank is a 400, not a silent no-op
      // — the form's own required check would have to be bypassed to get here.
      case 'name': {
        const text = trimmed(value)
        if (text === null) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
        data.name = text
        break
      }
      // Mobile is optional (docs/accounts-contacts-spec.md §2). NOT NULL in the
      // database, so a cleared mobile stores '' rather than null.
      case 'mobile':
        data.mobile = trimmed(value) ?? ''
        break
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
    // 'write': owner-scope, or a 'work' member of an account it is linked to.
    const exists = await findScopedContact(user, tid, params.id, 'write')
    if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // A shared member works the contact; they do not get to re-own it or move
    // it between accounts (they cannot even see every account it is linked
    // to). The form posts its whole state back, so an UNCHANGED owner or
    // company set is accepted and simply not rewritten.
    if (exists.access !== 'owner-scope') {
      const current = await prisma.contacts.findFirst({
        where: { id: exists.id, tenant_id: tid },
        select: {
          owner_user_id: true,
          company_contacts: { where: { tenant_id: tid }, select: { company_id: true } },
        },
      })
      if ('owner_user_id' in data) {
        if ((current?.owner_user_id ?? null) !== (data.owner_user_id ?? null)) {
          return NextResponse.json(
            { error: 'Only the owner, or someone whose team includes the owner, can change who owns this contact.' },
            { status: 403 }
          )
        }
        delete data.owner_user_id
      }
      if (replaceLinks) {
        const now = new Set((current?.company_contacts ?? []).map(l => l.company_id))
        const same = now.size === ids.length && ids.every(id => now.has(id))
        if (!same) {
          return NextResponse.json(
            { error: "Only the contact's owner, or someone whose team includes the owner, can change which accounts it belongs to." },
            { status: 403 }
          )
        }
      }
    }

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
 * DELETE — a **soft** delete: `is_active = false`, the row stays (existing
 * behaviour, kept as-is per the build instructions).
 *
 * docs/accounts-contacts-spec.md §5 adds three checks ahead of the write:
 *   - a Self contact is refused outright, naming the Individual account;
 *   - a contact with any history (an opportunity, or a meeting logged against
 *     it) is refused — "make inactive" is exactly what this soft delete does,
 *     so the message points at the same verb;
 *   - otherwise the client must confirm (`?confirm=1`); without it this
 *     returns the list of linked accounts as a 409 dry run so the UI can warn
 *     before the user commits.
 *
 * An id that is not the caller's to see — another tenant's, another rep's on
 * `own` scope, or one that does not exist — is a 404, found before any of it.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'contacts', 'delete')) return forbidden()
  const tid = getTenantId()
  try {
    // Outside the caller's scope is a 404, as on GET and PUT. 'owner': a
    // shared member never deletes the contact.
    const found = await findScopedContact(user, tid, params.id, 'owner')
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const selfAccountId = await findSelfAccountForContact(tid, found.id)
    if (selfAccountId) {
      const acct = await prisma.companies.findFirst({ where: { id: selfAccountId, tenant_id: tid }, select: { name: true } })
      return NextResponse.json({
        error: `This person is the Self contact of ${acct?.name ?? 'an Individual account'}. Delete or deactivate that Individual account instead.`,
        self_account_id: selfAccountId,
      }, { status: 409 })
    }

    if (await contactHasHistory(tid, found.id)) {
      return NextResponse.json(
        { error: 'This contact has meetings or opportunities on record. Make it inactive instead of deleting it.' },
        { status: 409 }
      )
    }

    const confirmed = req.nextUrl.searchParams.get('confirm') === '1'
    if (!confirmed) {
      const accounts = await contactLinkedAccountNames(tid, found.id)
      if (accounts.length > 0) {
        return NextResponse.json({ error: 'confirm_required', linked_accounts: accounts }, { status: 409 })
      }
    }

    await prisma.contacts.updateMany({
      where: { id: found.id, tenant_id: tid },
      data: { is_active: false },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
