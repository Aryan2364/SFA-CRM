import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { recomputeCompanyCompleteness, withMobileCompleteness } from '@/lib/completeness'
import { getGstRequiredForOrders } from '@/lib/gst-setting'
import { withGstPolicy } from '@/lib/gst-policy'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'
import { attachLandlines, LANDLINE_NOT_SAVED, writeLandline } from '@/lib/party-landline'
import { COMPANY_INCLUDE, shapeCompany } from './_shape'
import { foreignCompanyRef, ownerOutsideScope } from './_access'
import { getCompanyMemberships, widenScope, type MemberAccess } from '@/lib/sharing'
import {
  addLink, attachAccountKinds, findSelfAccountForContact, getSelfRole,
  isAccountKind, typeAppliesToKind, writeAccountKind, type AccountKind,
} from '@/lib/account-kind'
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
 * Companies — the Party surface. `/api/leads` re-exports these handlers while
 * the Leads page is still on the old URL (P1-T13 retires it).
 *
 * `companies` is the renamed `business_partners` table (commit a1d43e0), so a
 * Dealer, a Distributor and an Institution are rows here too, separated by
 * `type` + `stage = 'Existing'`. This route does NOT filter on stage — it never
 * did — so it lists every party in the tenant.
 */

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const type = req.nextUrl.searchParams.get('type') ?? ''
  const kindFilter = req.nextUrl.searchParams.get('kind') ?? ''
  const tid = getTenantId()
  // §6.6 Self/Team/Company. This list was tenant-wide for anyone with view
  // rights. ⚠️ A Party scopes on `owner_user_id`, not `user_id`, so the column
  // is passed explicitly — and an unowned company (owner_user_id NULL) is
  // therefore invisible below Company scope, which is the filter working: no
  // one owns it, so it is nobody's row.
  const requestedOwner = req.nextUrl.searchParams.get('userId')
  const ids = intersectScope(await scopedUserIds(user, 'companies'), requestedOwner)

  try {
    // Sharing (src/lib/sharing.ts): accounts shared with the caller are OR-ed
    // into the scope — never in place of it. Not under Company scope (already
    // everything) and not when `?userId=` narrows to one owner (a filter by
    // owner means that owner's rows). Nothing shared → the query is unchanged.
    const memberships = ids === null || requestedOwner
      ? new Map<string, MemberAccess>()
      : await getCompanyMemberships(user, tid)
    const rows = await prisma.companies.findMany({
      where: {
        tenant_id: tid,
        ...widenScope(scopeWhere(ids, 'owner_user_id'), memberships.size ? [{ id: { in: [...memberships.keys()] } }] : []),
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(type ? { type } : {}),
      },
      include: COMPANY_INCLUDE,
      orderBy: { name: 'asc' },
    })

    // DATE next_follow_up_date (PLAN.md 5.1).
    // Completeness as this tenant counts it: with GST not required, a company
    // missing only its GST number reads as complete (src/lib/gst-policy.ts).
    // The Parties list's badge, filter and data-health alerts all read these.
    const gstRequired = await getGstRequiredForOrders(tid)
    const withKinds = await attachAccountKinds(
      (serialize(rows, 'companies') as Record<string, unknown>[]).map(shapeCompany) as (Record<string, unknown> & { id: string })[],
      tid
    )
    const data = withKinds
      .filter(row => !kindFilter || row.account_kind === kindFilter)
      // Individuals never carry a GST requirement (spec §1): the firm's
      // switch, when on, still only governs Companies.
      .map(row => withMobileCompleteness(withGstPolicy(
        row as Record<string, unknown> & { is_complete?: boolean; completeness_missing?: string | null; mobile_1?: string | null },
        gstRequired && row.account_kind !== 'Individual'
      )))
      // `shared_access` is set only on a row the caller sees BECAUSE it was
      // shared with them (its owner is outside their scope) — the list's
      // "Shared" badge. `null` on every other row.
      .map(row => {
        const owner = (row as { owner_user_id?: string | null }).owner_user_id ?? null
        const viaScope = ids === null || (!!owner && ids.includes(owner))
        const shared = viaScope ? null : memberships.get(String((row as { id: unknown }).id)) ?? null
        return { ...row, shared_access: shared } as Record<string, unknown>
      })

    // The edit dialog prefills from this list, so it carries the landline too
    // — one guarded query for every row, `null` until the column exists
    // (src/lib/party-landline.ts).
    return NextResponse.json(await attachLandlines(data as (Record<string, unknown> & { id: string })[], tid, 'companies'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  // 'create', not 'edit' (P1-T10.3). The old route checked 'edit', which let a
  // role with edit-but-not-create create companies and stopped a create-only
  // role from doing the one thing it was granted.
  if (!await checkPermission(user, 'companies', 'create')) return forbidden()
  const {
    name, type, contact_person_name, pincode, gst_number,
    mobile_1, mobile_2, address, description,
    state_id, district_id, taluka_id, village_id,
    temperature, next_follow_up_date,
    email, website, industry_id, owner_user_id, landline,
    account_kind, self_contact_id, self_new_person,
  } = await req.json()

  // Required to create: name only (spec §1) — Company Type was already not
  // compulsory (REBUILD-PLAN.md:126); an Individual needs no mobile either.
  // An Individual's name may be left blank — it defaults to the person's name
  // once that is known, below.
  const kind: AccountKind = isAccountKind(account_kind) ? account_kind : 'Company'
  if (kind === 'Company' && !name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (kind === 'Individual' && !name?.trim() && !self_contact_id && !trimmed(self_new_person?.name)) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // POST validated neither GSTIN nor pincode before; PUT validated GSTIN only.
  // Both verbs now run the identical set (P1-T10.6).
  const bad = firstError(
    checkMobile(mobile_1, 'Mobile Number 1'),
    checkMobile(mobile_2, 'Mobile Number 2'),
    checkPincode(pincode),
    checkGstin(gst_number),
    checkEmail(email),
    checkLandline(landline),
  )
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  const tid = getTenantId()

  try {
    // Body-sourced ids, looked up in the caller's tenant before the insert.
    // `distributor_id` is not written here, so the helper skips it.
    const miss = await foreignCompanyRef(tid, {
      state_id, district_id, taluka_id, village_id, industry_id, owner_user_id,
    })
    if (miss) return NextResponse.json({ error: miss }, { status: 400 })

    // The type master's Applies to (spec §1): a type picked for an Individual
    // must apply to Individual (or Both), and vice-versa. `companies.type`
    // stores the type's NAME (it is plain text, not a FK), so the matching
    // `company_types` row is looked up by name. `true` while the applies_to
    // column is unset, so this never blocks before the migration runs.
    const typeName = trimmed(type)
    if (typeName) {
      const typeRow = await prisma.company_types.findFirst({ where: { tenant_id: tid, name: typeName }, select: { id: true } })
      if (typeRow && !(await typeAppliesToKind(tid, typeRow.id, kind))) {
        return NextResponse.json({ error: `This type does not apply to ${kind} accounts.` }, { status: 400 })
      }
    }

    // A blank owner defaults to the creator (below). An explicit one must be
    // inside the caller's own `companies` scope, or the new company would be
    // invisible to the person who just created it — see `./_access.ts`.
    const owner = trimmed(owner_user_id) ?? user.userId ?? null
    const outside = await ownerOutsideScope(user, 'companies', owner)
    if (outside) return NextResponse.json({ error: outside }, { status: 403 })

    // Individual: resolve the Self contact (spec §3) BEFORE the company is
    // created, so a name defaults from the person and so a problem here (an
    // existing contact already Self elsewhere, a bad new-person mobile) is a
    // 400/409 rather than an account created with no Self link.
    let resolvedSelfContactId: string | null = null
    let resolvedName = trimmed(name)
    if (kind === 'Individual') {
      if (self_contact_id) {
        const contact = await prisma.contacts.findFirst({
          where: { id: self_contact_id, tenant_id: tid },
          select: { id: true, name: true },
        })
        if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 400 })
        const existingSelfAccount = await findSelfAccountForContact(tid, contact.id)
        if (existingSelfAccount) {
          return NextResponse.json(
            { error: 'This person is already the Self contact of another account.', existing_account_id: existingSelfAccount },
            { status: 409 }
          )
        }
        resolvedSelfContactId = contact.id
        resolvedName = resolvedName ?? contact.name
      } else {
        const personName = trimmed(self_new_person?.name)
        if (!personName) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
        const personMobile = trimmed(self_new_person?.mobile)
        const personEmail = trimmed(self_new_person?.email)
        const personBad = firstError(
          checkMobile(personMobile, 'Mobile Number'),
          checkEmail(personEmail),
        )
        if (personBad) return NextResponse.json({ error: personBad }, { status: 400 })
        // Before creating a brand-new contact, check whether a contact with
        // this exact mobile already exists and is already the Self contact
        // of another Individual account — otherwise two phone submissions
        // of the same person (no "existing contact" picked) silently create
        // two contacts and two accounts instead of surfacing the same 409
        // the self_contact_id branch above gives.
        if (personMobile) {
          const existingContact = await prisma.contacts.findFirst({
            where: { tenant_id: tid, mobile: personMobile },
            select: { id: true },
          })
          if (existingContact) {
            const existingSelfAccount = await findSelfAccountForContact(tid, existingContact.id)
            if (existingSelfAccount) {
              return NextResponse.json(
                { error: 'This person is already the Self contact of another account.', existing_account_id: existingSelfAccount },
                { status: 409 }
              )
            }
          }
        }
        const person = await prisma.contacts.create({
          data: {
            tenant_id: tid,
            name: personName,
            mobile: personMobile ?? '',
            email: personEmail,
            owner_user_id: owner,
          },
          select: { id: true, name: true },
        })
        resolvedSelfContactId = person.id
        resolvedName = resolvedName ?? person.name
      }
    }
    if (!resolvedName) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

    const created = await prisma.companies.create({
      data: {
        tenant_id: tid,
        // `companies.type` is NOT NULL with no default, so "blank" is the empty
        // string until a migration makes the column nullable. It reads as blank
        // everywhere and matches no `?type=` filter, which is the intent.
        type: trimmed(type) ?? '',
        stage: 'Prospect',
        name: resolvedName,
        contact_person_name: trimmed(contact_person_name),
        pincode: trimmed(pincode),
        gst_number: normaliseGstin(gst_number),
        mobile_1: trimmed(mobile_1),
        mobile_2: trimmed(mobile_2),
        address: address || null,
        description: description || null,
        state_id: state_id || null,
        district_id: district_id || null,
        taluka_id: taluka_id || null,
        village_id: village_id || null,
        temperature: temperature || null,
        // next_follow_up_date is @db.Date — the client sends "YYYY-MM-DD".
        next_follow_up_date: next_follow_up_date ? new Date(next_follow_up_date) : null,
        email: trimmed(email),
        website: trimmed(website),
        industry_id: industry_id || null,
        // A blank owner defaults to the creator, as POST /api/deals does: an
        // unowned company is outside every Self/Team scope, so its own creator
        // could not reach it again below Company scope.
        owner_user_id: owner,
        created_by_user_id: user.userId || null,
      },
    })

    // is_complete / completeness_missing are derived, never taken from the body
    // (P1-T10.7). A brand-new company has no addresses, so this always resolves
    // to "incomplete" — it is written anyway so the row never carries the
    // column default as if it had been computed.
    const completeness = await recomputeCompanyCompleteness(created.id, created.tenant_id)

    // account_kind, through the guarded helper: `false` while the column is
    // unset means the row was still created as a Company (the default), same
    // degradation as the landline below.
    const kindSaved = kind === 'Company' || await writeAccountKind(tid, created.id, kind)

    // The Self link, once the account exists to link it to. `self` is null
    // while contact_roles has not been pushed — the account is still created,
    // just with no link yet (same degrade-gracefully rule as every other
    // guarded helper here).
    let selfLinkWarning: string | null = null
    if (kind === 'Individual' && resolvedSelfContactId) {
      const self = await getSelfRole(tid)
      if (self) {
        const linked = await addLink(tid, created.id, resolvedSelfContactId, self.id, true)
        if (!linked.ok) selfLinkWarning = linked.error
      } else {
        selfLinkWarning = 'This needs a database update first — the Self contact was not linked yet.'
      }
    }

    // The landline is written beside the insert, through the guarded helper:
    // until the column exists the company is still created and the response
    // says the landline was not stored (src/lib/party-landline.ts).
    const phone = trimmed(landline)
    const landlineSaved = phone === null || await writeLandline(tid, 'companies', created.id, phone)

    const gstRequired = await getGstRequiredForOrders(created.tenant_id)
    return NextResponse.json(
      {
        ...withMobileCompleteness(withGstPolicy(
          { ...(serialize(created, 'companies') as Record<string, unknown>), ...completeness },
          gstRequired && kind !== 'Individual'
        )),
        account_kind: kindSaved ? kind : 'Company',
        landline: landlineSaved ? phone : null,
        ...(landlineSaved ? {} : { warning: LANDLINE_NOT_SAVED }),
        ...(selfLinkWarning ? { warning: selfLinkWarning } : {}),
      },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
