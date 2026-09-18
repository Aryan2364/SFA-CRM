import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { recomputeCompanyCompleteness } from '@/lib/completeness'

import {
  ADDRESS_INCLUDE,
  addressData,
  findCompany,
  type AddressBody,
} from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * `PUT`/`DELETE /api/companies/[id]/addresses/[addressId]` — P1-T16, §3.3.
 *
 * The sibling of `../route.ts`; read that file's header for why this table had
 * no write path and why "exactly one primary per company" is the invariant both
 * files exist to hold. The two rules that live HERE:
 *
 * ---------------------------------------------------------------------------
 * 1. THE PRIMARY FLAG MOVES, IT DOES NOT CLEAR
 *
 * `PUT { is_primary: false }` on the current primary is refused with a 400.
 * Honouring it would leave the company with NO primary, and
 * `src/lib/completeness.ts` reads four of its five required fields off the
 * primary row — so the company would fall to Incomplete with no field the user
 * could fill to fix it, and §3.5's order gate would be unsatisfiable. The way
 * to change which address is primary is to promote the other one, which demotes
 * this one as a side effect. One less way to reach a broken state.
 *
 * ---------------------------------------------------------------------------
 * 2. DELETING THE PRIMARY PROMOTES THE OLDEST SURVIVOR
 *
 * Same reason, and the promotion happens IN THE SAME TRANSACTION as the delete.
 * The survivor chosen is the oldest by `created_at, id` — the same tie-break
 * `recomputeCompanyCompleteness` already uses to decide which row is "the"
 * primary, so the row the rest of the system would have picked anyway is the
 * row that gets the flag.
 *
 * Deleting the LAST address leaves the company with none, which is a legitimate
 * state (it is simply Incomplete again) rather than something to refuse.
 */

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; addressId: string } }
) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'edit')) return forbidden()
  const tid = getTenantId()
  const body = await req.json() as AddressBody

  const built = addressData(body)
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 })

  try {
    if (!await findCompany(params.id, tid))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // The address must belong to THIS company AND this tenant. Checking only
    // the id would let one company's address be edited through another's URL.
    const current = await prisma.company_addresses.findFirst({
      where: { id: params.addressId, company_id: params.id, tenant_id: tid },
      select: { id: true, is_primary: true },
    })
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // `is_primary` absent from the body means "leave it alone" — a PUT that
    // only edits the street must not silently demote the primary.
    const asked = body.is_primary === undefined ? undefined : Boolean(body.is_primary)

    if (asked === false && current.is_primary) {
      return NextResponse.json(
        {
          error:
            'A company must keep one primary address. Make another address primary instead.',
        },
        { status: 400 }
      )
    }

    const promoting = asked === true && !current.is_primary

    const writes = [
      ...(promoting
        ? [
            prisma.company_addresses.updateMany({
              where: { company_id: params.id, tenant_id: tid, is_primary: true },
              data: { is_primary: false },
            }),
          ]
        : []),
      prisma.company_addresses.update({
        where: { id: params.addressId },
        data: {
          ...built.data,
          ...(promoting ? { is_primary: true } : {}),
          updated_at: new Date(),
        },
        include: ADDRESS_INCLUDE,
      }),
    ]
    const results = await prisma.$transaction(writes)
    const updated = results[results.length - 1]

    await recomputeCompanyCompleteness(params.id, tid)

    return NextResponse.json(serialize(updated, 'company_addresses'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; addressId: string } }
) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'edit')) return forbidden()
  const tid = getTenantId()

  try {
    if (!await findCompany(params.id, tid))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const current = await prisma.company_addresses.findFirst({
      where: { id: params.addressId, company_id: params.id, tenant_id: tid },
      select: { id: true, is_primary: true },
    })
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Picked BEFORE the delete, by the same tie-break completeness uses.
    const successor = current.is_primary
      ? await prisma.company_addresses.findFirst({
          where: {
            company_id: params.id,
            tenant_id: tid,
            id: { not: params.addressId },
          },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          select: { id: true },
        })
      : null

    // Delete and promote together: a company is never left primary-less by a
    // half-applied pair.
    await prisma.$transaction([
      prisma.company_addresses.deleteMany({
        where: { id: params.addressId, company_id: params.id, tenant_id: tid },
      }),
      ...(successor
        ? [
            prisma.company_addresses.updateMany({
              where: { id: successor.id, tenant_id: tid },
              data: { is_primary: true },
            }),
          ]
        : []),
    ])

    await recomputeCompanyCompleteness(params.id, tid)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
