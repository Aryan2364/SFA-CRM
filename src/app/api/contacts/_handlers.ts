import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { CONTACT_INCLUDE, loadCompanies, readCompanyIds, shapeContact } from './_shape'
import { checkEmail, checkMobile, firstError, trimmed } from '@/lib/validation'


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

  try {
    const rows = await prisma.contacts.findMany({
      where: {
        tenant_id: tid,
        ...(active === 'all' ? {} : { is_active: active !== 'false' }),
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        // `some` on the join, with its own tenant_id: the filter has to be a
        // predicate on company_contacts, and that table is tenant-scoped too.
        ...(companyId
          ? { company_contacts: { some: { company_id: companyId, tenant_id: tid } } }
          : {}),
      },
      include: CONTACT_INCLUDE,
      orderBy: { name: 'asc' },
    })

    // serialize() first, shape after — `birthday` and `anniversary` are @db.Date
    // and only come back as "YYYY-MM-DD" while the keys are still the ones
    // Prisma generated (src/lib/db.ts, "Detection is keyed on MODEL + FIELD").
    const data = (serialize(rows, 'contacts') as Record<string, unknown>[]).map(shapeContact)

    return NextResponse.json(data)
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
    company_ids, primary_company_id, is_active,
  } = await req.json()

  // §3.4: Contact Person Name and Mobile Number are the two compulsory fields.
  // `contacts.mobile` is NOT NULL in the database as well, so a blank one is a
  // 400 here rather than a 500 from the insert.
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!mobile?.trim())
    return NextResponse.json({ error: 'Mobile Number is required' }, { status: 400 })

  const bad = firstError(
    checkMobile(mobile, 'Mobile Number'),
    checkMobile(alternate_mobile, 'Alternate Number'),
    checkMobile(whatsapp, 'WhatsApp Number'),
    checkEmail(email),
  )
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  const parsed = readCompanyIds(company_ids)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const ids = parsed.ids

  const tid = getTenantId()

  try {
    const found = await loadCompanies(ids, tid)
    if ('error' in found) return NextResponse.json({ error: found.error }, { status: 400 })

    // §3.4: "Owner — From Employee Master. Defaults to the Company's Owner."
    // Only meaningful when there is exactly one company: with none there is
    // nothing to inherit, and with several there is no single right answer, so
    // both cases leave the column to whatever the caller sent.
    const owner = trimmed(owner_user_id)
      ?? (found.companies.length === 1 ? found.companies[0].owner_user_id : null)

    // One create, with the join rows nested — a single statement, so a contact
    // can never be left behind with none of its links written.
    const created = await prisma.contacts.create({
      data: {
        tenant_id: tid,
        name: name.trim(),
        mobile: mobile.trim(),
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
    return NextResponse.json(
      shapeContact(serialize(created, 'contacts') as Record<string, unknown>),
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
