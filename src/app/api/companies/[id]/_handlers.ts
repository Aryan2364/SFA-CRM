import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { recomputeCompanyCompleteness, withMobileCompleteness } from '@/lib/completeness'
import { getGstRequiredForOrders } from '@/lib/gst-setting'
import { withGstPolicy } from '@/lib/gst-policy'
import { LANDLINE_NOT_SAVED, readLandlines, writeLandline } from '@/lib/party-landline'
import { COMPANY_INCLUDE, shapeCompany } from '../_shape'
import { findScopedCompany, foreignCompanyRef, ownerOutsideScope } from '../_access'
import { canShareCompany, deleteAllCompanyMembers, isSharingAvailable } from '@/lib/sharing'
import { companyHasHistory, readAccountKind, typeAppliesToKind } from '@/lib/account-kind'
import {
  checkEmail,
  checkGstin,
  checkLandline,
  checkMobile,
  checkPincode,
  firstError,
  normaliseGstin,
  trimmed,
} from '@/lib/validation'


/**
 * GET — one company, with its contacts and its addresses (P1-T10.1).
 *
 * New in P1-T10: `/api/leads/[id]` exported only PUT and DELETE, so the Leads
 * screen had to find a row by filtering the whole list. §3.2's Company page
 * reads this instead.
 *
 * Response shape — a bare object, no envelope:
 *   { …company, created_by, owner, industries, contacts: [...], addresses: [...] }
 * `contacts` carries the person's own fields plus `is_primary` and `link_id`
 * from the `company_contacts` join row, because a Contact may belong to several
 * Companies (§3.4) and `is_primary` is a property of the LINK, not the person.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    // The list's own rule (§6.6) widened by sharing: owner-scope, or an
    // `account_members` row at any level — see `../_access.ts`. A company the
    // caller cannot see in the list is a 404 here too.
    const found = await findScopedCompany(user, tid, params.id, 'read')
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // findFirst, not findUnique: the tenant filter is not part of the primary
    // key, and it must be in the `where` or a company id from another tenant
    // resolves. Dropping it leaks across tenants with nothing crashing.
    const row = await prisma.companies.findFirst({
      where: { id: found.id, tenant_id: tid },
      include: {
        ...COMPANY_INCLUDE,
        states: { select: { name: true } },
        company_contacts: {
          include: {
            contacts: {
              include: { contact_types: { select: { id: true, name: true } } },
            },
          },
          orderBy: { created_at: 'asc' },
        },
        company_addresses: {
          include: {
            states: { select: { name: true } },
            districts: { select: { name: true } },
            talukas: { select: { name: true } },
            villages: { select: { name: true } },
          },
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        },
      },
    })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // serialize() first — it walks relations by their Prisma field names, so the
    // nested @db.Date columns (contacts.birthday/anniversary) are only converted
    // while the keys are still the ones Prisma generated.
    const serialised = serialize(row, 'companies') as Record<string, unknown> & {
      company_contacts: { id: string; is_primary: boolean; contacts: Record<string, unknown> }[]
      company_addresses: Record<string, unknown>[]
    }

    const { company_contacts, company_addresses, ...company } = serialised
    // Completeness as this tenant counts it (src/lib/gst-policy.ts).
    const gstRequired = await getGstRequiredForOrders(tid)
    const kind = await readAccountKind(tid, row.id)
    // The company's own landline and its contacts', in one guarded query each;
    // `null` until the column exists (src/lib/party-landline.ts).
    const [ownLandline, contactLandlines] = await Promise.all([
      readLandlines(tid, 'companies', [row.id]),
      readLandlines(tid, 'contacts', company_contacts.map(cc => String(cc.contacts.id))),
    ])
    return NextResponse.json({
      ...withMobileCompleteness(withGstPolicy(
        shapeCompany(company) as Record<string, unknown> & { is_complete?: boolean; completeness_missing?: string | null; mobile_1?: string | null },
        gstRequired && kind !== 'Individual'
      )),
      account_kind: kind,
      landline: ownLandline?.get(row.id) ?? null,
      contacts: company_contacts.map(cc => ({
        ...cc.contacts,
        landline: contactLandlines?.get(String(cc.contacts.id)) ?? null,
        is_primary: cc.is_primary,
        link_id: cc.id,
      })),
      addresses: company_addresses,
      // So the "no field recorded" banner names only the fields this tenant
      // actually requires.
      gst_required_for_orders: gstRequired,
      // How the caller reaches this account ('owner-scope' | 'work' | 'view')
      // and whether they may change its "Shared with" list. Decided here, on
      // the server, so the page never re-derives either (src/lib/sharing.ts).
      access: found.access,
      can_share: await canShareCompany(user, { owner_user_id: row.owner_user_id }),
      // False until `account_members` exists; the page then shows no
      // "Shared with" section at all, exactly as before sharing.
      sharing_available: await isSharingAvailable(tid, ['account_members']),
    })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

/**
 * The columns PUT may write (P1-T10.2 / gap G5).
 *
 * The old route did `prisma.companies.update({ data: body })` after deleting
 * `tenant_id` — every other column was writable by anything that could reach
 * the route, including `id`, `created_by_user_id`, `created_at` and the derived
 * `is_complete`/`completeness_missing`. An allow-list is the fix: a key that is
 * not here is ignored, not rejected, because the Leads form posts its whole
 * state back and a 400 on an extra key would break it.
 *
 * `is_complete` and `completeness_missing` are deliberately ABSENT — they are
 * derived, and recomputed below on every write (P1-T10.7).
 */
const UPDATABLE = [
  'name', 'type', 'sub_type', 'stage', 'temperature',
  'contact_person_name', 'mobile_1', 'mobile_2', 'email', 'website',
  'gst_number', 'pincode', 'address', 'description',
  'state_id', 'district_id', 'taluka_id', 'village_id',
  'next_follow_up_date',
  'industry_id', 'owner_user_id', 'distributor_id', 'is_active',
] as const

/**
 * The nullable TEXT columns in UPDATABLE: a blank value clears them to NULL.
 * (`name`, `type` and `stage` are NOT NULL and are handled case-by-case; the
 * rest of UPDATABLE is nullable uuid FKs and the follow-up date.)
 */
const NULLABLE_TEXT = new Set([
  'sub_type', 'temperature', 'contact_person_name', 'mobile_1', 'mobile_2',
  'email', 'website', 'gst_number', 'pincode', 'address', 'description',
])

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'edit')) return forbidden()
  const body = await req.json() as Record<string, unknown>

  // Both verbs now run the identical validation set (P1-T10.6). PUT used to
  // check GSTIN and the two mobiles; pincode and email went through unchecked.
  const bad = firstError(
    checkMobile(body.mobile_1, 'Mobile Number 1'),
    checkMobile(body.mobile_2, 'Mobile Number 2'),
    checkPincode(body.pincode),
    checkGstin(body.gst_number),
    checkEmail(body.email),
    checkLandline(body.landline),
  )
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  const data: Record<string, unknown> = {}
  for (const key of UPDATABLE) {
    if (!(key in body)) continue
    const value = body[key]

    switch (key) {
      case 'name': {
        const name = trimmed(value)
        if (name === null)
          return NextResponse.json({ error: 'Name is required' }, { status: 400 })
        data.name = name
        break
      }
      // NOT NULL with no default. Company Type is not compulsory
      // (REBUILD-PLAN.md:126) and the Leads form sends `type: null` to mean
      // blank, so "blank" is stored as the empty string until a migration makes
      // the column nullable.
      case 'type':
        data.type = trimmed(value) ?? ''
        break
      // NOT NULL, default 'Existing'. A blank means "leave it alone" rather
      // than "clear it" — there is no such thing as a company with no stage.
      case 'stage': {
        const stage = trimmed(value)
        if (stage !== null) data.stage = stage
        break
      }
      case 'gst_number':
        data.gst_number = normaliseGstin(value)
        break
      // @db.Date — the client sends "YYYY-MM-DD", Prisma wants a Date.
      case 'next_follow_up_date':
        data.next_follow_up_date = value ? new Date(String(value)) : null
        break
      case 'is_active':
        data.is_active = Boolean(value)
        break
      default:
        // The remaining keys are either nullable text (trim, blank → null) or a
        // nullable uuid FK (empty string → null).
        data[key] = NULLABLE_TEXT.has(key) ? trimmed(value) : (value || null)
    }
  }

  const tid = getTenantId()

  try {
    // 'write': owner-scope, or a 'work' member of the account. A 'view' member
    // gets the same 404 as anyone outside it.
    const found = await findScopedCompany(user, tid, params.id, 'write')
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Handing the account to a new owner is the owner's call, not a shared
    // member's: sharing grants record access, not ownership.
    if ('owner_user_id' in data && found.access !== 'owner-scope') {
      const current = await prisma.companies.findFirst({
        where: { id: found.id, tenant_id: tid },
        select: { owner_user_id: true },
      })
      if ((current?.owner_user_id ?? null) !== (data.owner_user_id ?? null)) {
        return NextResponse.json(
          { error: 'Only the owner, or someone whose team includes the owner, can change who owns this account.' },
          { status: 403 }
        )
      }
      // The edit form posts its whole state back, owner included. Unchanged,
      // it is not a reassignment — drop it, or the scope check below would
      // refuse every edit a member makes (the owner is outside their scope by
      // definition, which is why they needed sharing).
      delete data.owner_user_id
    }

    // Only keys that survived the allow-list reach the check; an absent or
    // cleared FK is skipped.
    const miss = await foreignCompanyRef(tid, data)
    if (miss) return NextResponse.json({ error: miss }, { status: 400 })

    // Applies to (spec §1), against the account's CURRENT kind — changing kind
    // is its own endpoint (POST /api/companies/[id]/kind) and is not done here.
    if (typeof data.type === 'string' && data.type) {
      const kind = await readAccountKind(tid, found.id)
      const typeRow = await prisma.company_types.findFirst({ where: { tenant_id: tid, name: data.type }, select: { id: true } })
      if (typeRow && !(await typeAppliesToKind(tid, typeRow.id, kind))) {
        return NextResponse.json({ error: `This type does not apply to ${kind} accounts.` }, { status: 400 })
      }
    }

    // Reassigning (or clearing) the owner is held to the caller's scope, as
    // POST is: an `own`-scope rep handing a company to someone else would make
    // it vanish from their own list. Only checked when the owner is written.
    if ('owner_user_id' in data) {
      const outside = await ownerOutsideScope(user, 'companies', data.owner_user_id)
      if (outside) return NextResponse.json({ error: outside }, { status: 403 })
    }

    // update(), not updateMany(): the original ended in .select().single().
    const updated = await prisma.companies.update({
      where: { id: found.id, tenant_id: tid },
      data,
    })
    const completeness = await recomputeCompanyCompleteness(updated.id, updated.tenant_id)

    // Landline only when the form sent the key — the Active toggle PUTs
    // `is_active` alone and must not clear it. Until the column exists the
    // rest is saved and the response says the landline was not stored; a
    // blank sent then loses nothing, so it carries no warning.
    let landline: string | null
    let landlineWarning = false
    if ('landline' in body) {
      landline = trimmed(body.landline)
      const saved = await writeLandline(tid, 'companies', updated.id, landline)
      if (!saved) { landlineWarning = landline !== null; landline = null }
    } else {
      landline = (await readLandlines(tid, 'companies', [updated.id]))?.get(updated.id) ?? null
    }

    const gstRequired = await getGstRequiredForOrders(tid)
    const kind = await readAccountKind(tid, updated.id)
    return NextResponse.json({
      ...withMobileCompleteness(withGstPolicy({
        ...(serialize(updated, 'companies') as Record<string, unknown>),
        ...completeness,
      }, gstRequired && kind !== 'Individual')),
      account_kind: kind,
      landline,
      ...(landlineWarning ? { warning: LANDLINE_NOT_SAVED } : {}),
    })
  } catch (err) {
    // An id that belongs to another tenant matches nothing, and update() throws
    // P2025 for that. The old route let it out as a 500 carrying the raw Prisma
    // message ("An operation failed because it depends on one or more records
    // that were required but not found…"); it is a 404, and the internals do
    // not belong in the response.
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025')
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'delete')) return forbidden()
  const tid = getTenantId()
  try {
    // A company outside the caller's scope is a 404, as on GET and PUT —
    // without this an `own`-scope rep could hard-delete anyone's company.
    // 'owner': sharing never lets a member delete the account.
    const found = await findScopedCompany(user, tid, params.id, 'owner')
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // docs/accounts-contacts-spec.md §5: any meeting, opportunity or order on
    // the account refuses the delete — "make it inactive" instead.
    if (await companyHasHistory(tid, found.id)) {
      return NextResponse.json(
        { error: 'This account has meetings, opportunities or orders on record. Make it inactive instead of deleting it.' },
        { status: 409 }
      )
    }

    // `account_members` (src/lib/sharing.ts) has no FK to `companies` at all,
    // so nothing but this call would ever clear a deleted account's sharing
    // rows; it is a hard delete, not the usual close-the-row removal, because
    // there is no account left for them to be history of. Guarded: a no-op
    // until the table exists. Not part of the transaction below — losing a
    // stray membership row to a later failure is harmless (it just points at
    // a company id that no longer resolves to anything), unlike the FK-backed
    // deletes, which must all succeed together or the company delete 500s.
    await deleteAllCompanyMembers(tid, found.id)

    // Its links and addresses go first — both `company_contacts` and
    // `company_addresses` have a FK to `companies` with onDelete: NoAction,
    // so a company with either would otherwise fail the delete outright.
    // Deleting a LINK here is fine even when it is the account's Self link:
    // the account itself is going away. (companies is the only other NoAction
    // child besides deals, which companyHasHistory() above already blocks on.)
    await prisma.$transaction([
      prisma.company_contacts.deleteMany({ where: { company_id: found.id, tenant_id: tid } }),
      prisma.company_addresses.deleteMany({ where: { company_id: found.id, tenant_id: tid } }),
      // deleteMany: a no-match was silent before (PLAN.md 8.4).
      prisma.companies.deleteMany({ where: { id: found.id, tenant_id: tid } }),
    ])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
