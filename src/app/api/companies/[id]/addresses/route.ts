import { NextRequest, NextResponse } from 'next/server'
import { prisma, serialize, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { recomputeCompanyCompleteness } from '@/lib/completeness'

import {
  ADDRESS_INCLUDE,
  ADDRESS_ORDER,
  addressData,
  findCompany,
  type AddressBody,
} from './_shared'

export const dynamic = 'force-dynamic'

/**
 * `GET`/`POST /api/companies/[id]/addresses` — P1-T16, `REBUILD-PLAN.md` §3.3.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ROUTE DID NOT EXIST AND HAD TO
 *
 * `company_addresses` was created by the data-model task, backfilled by
 * `scripts/backfill-parties.mjs`, and READ by `GET /api/companies/[id]` — but
 * nothing ever wrote it from the application.
 *
 * That is not cosmetic. `src/lib/completeness.ts` takes FOUR of its five
 * required fields (Primary Address, City, State, Pincode) from the company's
 * PRIMARY row in this table. With no write path a company created through the
 * UI could never become Complete however carefully it was filled in, and
 * §3.5's rule that an order against an incomplete party cannot leave Draft
 * could never be satisfied. The feature was dead on arrival.
 *
 * ---------------------------------------------------------------------------
 * THE ONE INVARIANT: EXACTLY ONE PRIMARY PER COMPANY
 *
 * Completeness reads "the primary address" and breaks ties with
 * `ORDER BY created_at, id LIMIT 1`. TWO primaries make which row counts an
 * accident of insertion order; ZERO makes the company permanently incomplete
 * with no field the user can fill to fix it. So:
 *
 *   - the FIRST address on a company is primary whether or not it was asked for
 *   - promoting a new primary demotes the old one IN THE SAME TRANSACTION
 *   - the flag cannot be cleared directly, only moved (see `[addressId]` PUT)
 *   - deleting the primary promotes the oldest survivor (see `[addressId]`)
 *
 * ⚠️ The demote/insert pair is one `prisma.$transaction`. A sibling task lost
 * an order's line items to exactly this shape: two writes, the second failed,
 * the first was already committed. Here a half-applied pair leaves a company
 * with two primaries or none.
 *
 * ---------------------------------------------------------------------------
 * SHAPE, SCOPE AND PERMISSION
 *
 * Bare array / bare object / `{ error }` — there is no envelope in this
 * codebase. `serialize(rows, 'company_addresses')` turns the `Decimal(10,7)`
 * latitude/longitude into NUMBERS; left alone a Decimal reaches the client as a
 * STRING through `JSON.stringify` and every arithmetic on it is silently wrong
 * (PLAN.md §5.1).
 *
 * `tenant_id` is in the `where` of every read and the `data` of every create,
 * and the parent company is re-read under the tenant filter before any write.
 *
 * Permissions read the `companies` section: adding or changing an address is
 * editing the company it hangs off, so writes check `edit`. `create` and
 * `delete` govern the company record itself and are not what this is.
 */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    if (!await findCompany(params.id, tid))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const rows = await prisma.company_addresses.findMany({
      where: { company_id: params.id, tenant_id: tid },
      include: ADDRESS_INCLUDE,
      orderBy: ADDRESS_ORDER,
    })

    return NextResponse.json(serialize(rows, 'company_addresses'))
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'edit')) return forbidden()
  const tid = getTenantId()
  const body = await req.json() as AddressBody

  const built = addressData(body)
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 })

  try {
    if (!await findCompany(params.id, tid))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    /*
     * The first address on a company is primary whether or not the caller asked
     * for it. §3.3 requires one address marked Primary and completeness reads
     * that row, so a lone non-primary address would leave the company
     * incomplete with nothing the user could type to fix it. A smart default
     * beats a toggle the user has to know to set.
     */
    const existing = await prisma.company_addresses.count({
      where: { company_id: params.id, tenant_id: tid },
    })
    const primary = existing === 0 ? true : Boolean(body.is_primary)

    /*
     * One transaction: the demote and the insert land together or not at all.
     *
     * The demote is included ONLY when this row is becoming primary. Running it
     * unconditionally would either flip every primary to false (losing the
     * invariant) or rewrite rows to the value they already hold, firing
     * `updated_at` on an address nobody touched.
     */
    const writes = [
      ...(primary
        ? [
            prisma.company_addresses.updateMany({
              where: { company_id: params.id, tenant_id: tid, is_primary: true },
              data: { is_primary: false },
            }),
          ]
        : []),
      prisma.company_addresses.create({
        data: {
          ...built.data,
          tenant_id: tid,
          company_id: params.id,
          is_primary: primary,
        },
        include: ADDRESS_INCLUDE,
      }),
    ]
    const results = await prisma.$transaction(writes)
    const created = results[results.length - 1]

    // Four of the five completeness fields live on this row. Recomputed AFTER
    // the write and never restated here — `src/lib/completeness.ts` owns the
    // rule, and its stored string must stay byte-identical to the backfill's.
    await recomputeCompanyCompleteness(params.id, tid)

    return NextResponse.json(serialize(created, 'company_addresses'), { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
