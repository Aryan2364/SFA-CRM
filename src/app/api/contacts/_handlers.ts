import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { CONTACT_INCLUDE, loadCompanies, readCompanyIds, shapeContact } from './_shape'
import { checkEmail, checkLandline, checkPhone, firstError, trimmed } from '@/lib/validation'
import { attachLandlines, LANDLINE_NOT_SAVED, writeLandline } from '@/lib/party-landline'
import { intersectScope, scopedUserIds, scopeWhere } from '@/lib/scope'
import { foreignContactRef } from './_access'
import { getCompanyMemberships, widenScope, type MemberAccess } from '@/lib/sharing'
import { ownerOutsideScope } from '../companies/_access'


/**
 * Contacts — the people half of the Party surface (P1-T11).
 *
 * There was no `/api/contacts` before this: the Leads screen carried one
 * `contact_person_name` string on the company row, and the `contacts` /
 * `company_contacts` tables were written only by `scripts/backfill-parties.mjs`.
 *
 * **The defining rule of REBUILD-PLAN.md §3.4 is that a Contact may belong to
 * many Companies.** `company_contacts` is the many-to-many that expresses it,
 * and every handler here reads and writes the plural — `companies`, never
 * `company_id`. §3.4's consequence note (a Deal cannot auto-fill the Company
 * from a Contact with more than one) only makes sense if this stays plural.
 */

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'contacts', 'view')) return forbidden()
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const companyId = req.nextUrl.searchParams.get('companyId') ?? ''
  // DELETE is a soft delete, so an unfiltered list would show deleted people and
  // make the verb look broken. Active is the default; `?active=all` is the
  // escape hatch for a Status filter that wants to show both.
  const active = req.nextUrl.searchParams.get('active') ?? ''
  const tid = getTenantId()
  // §6.6, same as companies — a Contact scopes on `owner_user_id` too.
  // `?mine=1` narrows to the caller's own contacts whatever the role's scope:
  // the Daily Activity meeting form sends it, matching `?mine=1` on
  // `/api/business-partners` (Daily Activity is for entering your own work).
  //
  // Sharing (src/lib/sharing.ts) widens both forms, OR-ed into the owner
  // filter: `?mine=1` also offers the contacts of accounts shared with the
  // caller at 'work' (the meeting form is for doing work, so a 'view' share
  // does not belong in it); the plain list also shows contacts of accounts
  // shared at any level. Not when `?userId=` narrows to one owner, and not
  // under Company scope (already everything). Nothing shared → unchanged.
  const mine = req.nextUrl.searchParams.get('mine') === '1'
  if (mine && !user.userId) return NextResponse.json([])
  const requestedOwner = req.nextUrl.searchParams.get('userId')
  const ids = mine
    ? [user.userId!]
    : intersectScope(
        await scopedUserIds(user, 'contacts'),
        requestedOwner
      )
  const memberships = ids === null || (!mine && requestedOwner)
    ? new Map<string, MemberAccess>()
    : await getCompanyMemberships(user, tid)
  const sharedCompanies = [...memberships.entries()]
    .filter(([, a]) => !mine || a === 'work')
    .map(([companyId]) => companyId)

  try {
    const where = {
        tenant_id: tid,
        ...widenScope(
          scopeWhere(ids, 'owner_user_id'),
          sharedCompanies.length
            ? [{ company_contacts: { some: { tenant_id: tid, company_id: { in: sharedCompanies } } } }]
            : []
        ),
        ...(active === 'all' ? {} : { is_active: active !== 'false' }),
        // `?q=` matches by name OR mobile (digits only, so "98765 43210" and
        // "9876543210" both hit) — the Individual-account Person picker
        // searches "by name or mobile", and a name-only filter made half of
        // that a lie.
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                ...(q.replace(/\D/g, '')
                  ? [
                      { mobile: { contains: q.replace(/\D/g, '') } },
                      { alternate_mobile: { contains: q.replace(/\D/g, '') } },
                    ]
                  : []),
              ],
            }
          : {}),
        // `some` on the join, with its own tenant_id: the filter has to be a
        // predicate on company_contacts, and that table is tenant-scoped too.
        ...(companyId
          ? { company_contacts: { some: { company_id: companyId, tenant_id: tid } } }
          : {}),
    }

    // `?count=unlinked` - only how many of these contacts are linked to no
    // account (the Parties "Contacts Without Company" alert), counted in the
    // database over the same scoped, tenant-filtered `where`.
    if (req.nextUrl.searchParams.get('count') === 'unlinked') {
      const count = await prisma.contacts.count({
        where: { AND: [where, { company_contacts: { none: { tenant_id: tid } } }] },
      })
      return NextResponse.json({ count })
    }

    const rows = await prisma.contacts.findMany({
      where,
      include: CONTACT_INCLUDE,
      orderBy: { name: 'asc' },
    })

    // serialize() first, shape after — `birthday` and `anniversary` are @db.Date
    // and only come back as "YYYY-MM-DD" while the keys are still the ones
    // Prisma generated (src/lib/db.ts, "Detection is keyed on MODEL + FIELD").
    const data = (serialize(rows, 'contacts') as Record<string, unknown>[])
      .map(shapeContact)
      // `shared_access` only on a row the caller sees BECAUSE an account it is
      // linked to was shared with them (its owner is outside their scope): the
      // best level among those accounts. `null` on every other row.
      .map(row => {
        const r = row as { owner_user_id?: string | null; companies?: { id?: unknown }[] }
        const viaScope = ids === null || (!!r.owner_user_id && ids.includes(r.owner_user_id))
        let shared: MemberAccess | null = null
        let companies = r.companies ?? []
        if (!viaScope) {
          for (const c of companies) {
            const level = memberships.get(String(c.id))
            if (level === 'work') { shared = 'work'; break }
            if (level === 'view') shared = 'view'
          }
          // Privacy with sharing (docs/accounts-contacts-spec.md §9): this row is
          // only visible BECAUSE one of its accounts was shared with the caller —
          // its OTHER accounts (not shared with the caller) must not leak, name
          // included.
          companies = companies.filter(c => memberships.has(String(c.id)))
        }
        return { ...row, companies, shared_access: shared } as Record<string, unknown>
      })

    // `null` until the column exists (src/lib/party-landline.ts).
    return NextResponse.json(await attachLandlines(data as (Record<string, unknown> & { id: string })[], tid, 'contacts'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'contacts', 'create')) return forbidden()
  const {
    name, mobile, alternate_mobile, whatsapp, email, designation,
    contact_type_id, owner_user_id, birthday, anniversary, notes,
    company_ids, primary_company_id, is_active, landline,
  } = await req.json()

  // §3.4 (Stage 1 revision, docs/accounts-contacts-spec.md §2): Name only is
  // compulsory now. Mobile is optional — `contacts.mobile` is NOT NULL in the
  // database, so a blank one is stored as '' until a migration makes the
  // column nullable; a contact with no mobile is marked incomplete instead
  // of being refused.
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const bad = firstError(
    checkPhone(mobile, 'Mobile Number'),
    checkPhone(alternate_mobile, 'Alternate Number'),
    checkPhone(whatsapp, 'WhatsApp Number'),
    checkEmail(email),
    checkLandline(landline),
  )
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  // Company is OPTIONAL and always has been: it lives in `company_contacts`,
  // a many-to-many, not in a column on `contacts`. An empty or absent list is
  // a contact with no company yet, and the nested create below is skipped for
  // it. The Contact form used to require one anyway; it no longer does.
  const parsed = readCompanyIds(company_ids)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const ids = parsed.ids

  const tid = getTenantId()

  try {
    const found = await loadCompanies(ids, tid)
    if ('error' in found) return NextResponse.json({ error: found.error }, { status: 400 })

    // The body's own FK ids. An owner inherited from the company below is
    // already this tenant's — `loadCompanies()` proved the company is.
    const miss = await foreignContactRef(tid, { contact_type_id, owner_user_id })
    if (miss) return NextResponse.json({ error: miss }, { status: 400 })

    // §3.4: "Owner — From Employee Master. Defaults to the Company's Owner."
    // Only meaningful when there is exactly one company: with none there is
    // nothing to inherit, and with several there is no single right answer, so
    // both cases fall back to the creator — as does a company with no owner. An
    // unowned contact is outside every Self/Team scope, so its own creator
    // could not open it again below Company scope.
    //
    // The same scope rule as a company's owner (`../companies/_access.ts`): an
    // explicit owner outside the caller's `contacts` scope is a 403, because
    // the contact would vanish from their own list. An INHERITED owner is a
    // default, not a request, so one outside scope quietly falls back to the
    // creator instead of refusing a form the user filled in correctly.
    const explicitOwner = trimmed(owner_user_id)
    if (explicitOwner) {
      const outside = await ownerOutsideScope(user, 'contacts', explicitOwner)
      if (outside) return NextResponse.json({ error: outside }, { status: 403 })
    }
    const inherited = found.companies.length === 1 ? found.companies[0].owner_user_id : null
    const owner = explicitOwner
      ?? (inherited && !(await ownerOutsideScope(user, 'contacts', inherited)) ? inherited : null)
      ?? user.userId
      ?? null

    // One create, with the join rows nested — a single statement, so a contact
    // can never be left behind with none of its links written.
    const created = await prisma.contacts.create({
      data: {
        tenant_id: tid,
        name: name.trim(),
        mobile: trimmed(mobile) ?? '',
        alternate_mobile: trimmed(alternate_mobile),
        whatsapp: trimmed(whatsapp),
        email: trimmed(email),
        designation: trimmed(designation),
        contact_type_id: contact_type_id || null,
        owner_user_id: owner,
        // @db.Date — the client sends "YYYY-MM-DD".
        birthday: birthday ? new Date(String(birthday)) : null,
        anniversary: anniversary ? new Date(String(anniversary)) : null,
        notes: trimmed(notes),
        ...(is_active === undefined ? {} : { is_active: Boolean(is_active) }),
        ...(ids.length
          ? {
              company_contacts: {
                create: ids.map(id => ({
                  tenant_id: tid,
                  company_id: id,
                  is_primary: id === trimmed(primary_company_id),
                })),
              },
            }
          : {}),
      },
      include: CONTACT_INCLUDE,
    })

    // `is_complete` / `completeness_missing` are deliberately NOT written.
    // src/lib/completeness.ts encodes the rule for a COMPANY — Primary Address,
    // City, State, Pincode, GST Number — and REBUILD-PLAN.md §3.5 defines no
    // Full-Record level for a Contact. Writing a guess would put a value in the
    // column that nothing else agrees with.
    // Beside the insert, through the guarded helper: until the column exists
    // the contact is still created and the response says the landline was not
    // stored (src/lib/party-landline.ts).
    const phone = trimmed(landline)
    const landlineSaved = phone === null || await writeLandline(tid, 'contacts', created.id, phone)

    return NextResponse.json(
      {
        ...shapeContact(serialize(created, 'contacts') as Record<string, unknown>),
        landline: landlineSaved ? phone : null,
        ...(landlineSaved ? {} : { warning: LANDLINE_NOT_SAVED }),
      },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
