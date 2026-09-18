import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { recomputeCompanyCompleteness } from '@/lib/completeness'
import { COMPANY_INCLUDE, shapeCompany } from '../_shape'
import {
  checkEmail,
  checkGstin,
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
    // findFirst, not findUnique: the tenant filter is not part of the primary
    // key, and it must be in the `where` or a company id from another tenant
    // resolves. Dropping it leaks across tenants with nothing crashing.
    const row = await prisma.companies.findFirst({
      where: { id: params.id, tenant_id: tid },
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
    // nested Decimals (company_addresses.latitude/longitude) and @db.Date
    // columns (contacts.birthday/anniversary) are only converted while the keys
    // are still the ones Prisma generated.
    const serialised = serialize(row, 'companies') as Record<string, unknown> & {
      company_contacts: { id: string; is_primary: boolean; contacts: Record<string, unknown> }[]
      company_addresses: Record<string, unknown>[]
    }

    const { company_contacts, company_addresses, ...company } = serialised
    return NextResponse.json({
      ...shapeCompany(company),
      contacts: company_contacts.map(cc => ({
        ...cc.contacts,
        is_primary: cc.is_primary,
        link_id: cc.id,
      })),
      addresses: company_addresses,
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
  'latitude', 'longitude', 'next_follow_up_date',
  'industry_id', 'owner_user_id', 'distributor_id', 'is_active',
] as const

/**
 * The nullable TEXT columns in UPDATABLE: a blank value clears them to NULL.
 * (`name`, `type` and `stage` are NOT NULL and are handled case-by-case; the
 * rest of UPDATABLE is nullable uuid FKs and the two Decimals.)
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
      case 'latitude':
      case 'longitude':
        data[key] = value != null && value !== '' ? Number(value) : null
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

  try {
    // update(), not updateMany(): the original ended in .select().single().
    const updated = await prisma.companies.update({
      where: { id: params.id, tenant_id: getTenantId() },
      data,
    })
    const completeness = await recomputeCompanyCompleteness(updated.id, updated.tenant_id)
    return NextResponse.json({
      ...(serialize(updated, 'companies') as Record<string, unknown>),
      ...completeness,
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
  try {
    // deleteMany: a no-match was silent before (PLAN.md 8.4).
    await prisma.companies.deleteMany({
      where: { id: params.id, tenant_id: getTenantId() },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
