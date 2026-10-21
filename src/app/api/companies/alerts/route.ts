import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { visibleDealScope } from '@/lib/deal-visibility'
import { GST_FIELD } from '@/lib/gst-policy'
import { buildCompanyWhere } from '../_where'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/companies/alerts` — the two Accounts data-health numbers as counts,
 * so the screen no longer downloads every account and every deal to count them.
 *
 *   incomplete   accounts in the caller's scope that read "Incomplete" in the list
 *   noDeal       accounts in scope with no opportunity the caller can see;
 *                `null` when the caller lacks the deals permission ("not
 *                knowable", never zero)
 *   missing      the fields those incomplete accounts are short of, commonest
 *                first — `[{ field, count }]`
 *
 * `?kinds=1` adds `kinds: { total, company, individual }` - the Kind chip counts
 * on the phone Accounts list.
 *
 * Authorised and scoped by the same `buildCompanyWhere` as the list, so a count
 * never covers an account the caller cannot open.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'view')) return forbidden()
  const tid = getTenantId()

  try {
    const dealsAllowed = await checkPermission(user, 'deals', 'view')
    const dealWhere = dealsAllowed ? (await visibleDealScope(user, tid, null)).where : null

    const [incompleteQ, noDealQ] = await Promise.all([
      buildCompanyWhere(user, tid, { completeness: 'incomplete' }),
      dealWhere ? buildCompanyWhere(user, tid, { noDealWhere: dealWhere }) : Promise.resolve(null),
    ])
    const { where, gstRequired, individuals } = incompleteQ
    if (req.nextUrl.searchParams.get('kinds') === '1') {
      const [all, indiv] = await Promise.all([
        buildCompanyWhere(user, tid, {}),
        buildCompanyWhere(user, tid, { kind: 'Individual' }),
      ])
      const [total, individual] = await Promise.all([
        prisma.companies.count({ where: all.where }),
        prisma.companies.count({ where: indiv.where }),
      ])
      return NextResponse.json({ kinds: { total, company: total - individual, individual } })
    }
    const mobileBlank = { OR: [{ mobile_1: null }, { mobile_1: '' }] }

    const [incomplete, noDeal, groups, blankGroups] = await Promise.all([
      prisma.companies.count({ where }),
      noDealQ ? prisma.companies.count({ where: noDealQ.where }) : Promise.resolve(null),
      // What is missing, tallied by the stored string (a handful of distinct
      // values) rather than per row.
      prisma.companies.groupBy({
        by: ['completeness_missing'],
        where: { AND: [where, { NOT: mobileBlank }] },
        _count: { _all: true },
      }),
      prisma.companies.groupBy({
        by: ['completeness_missing'],
        where: { AND: [where, mobileBlank] },
        _count: { _all: true },
      }),
    ])

    // Same rules as the list: the GST field drops out when it is not required
    // (an Individual is exempt even when it is), and a blank mobile always
    // adds "Mobile Number".
    const tally = new Map<string, number>()
    const add = (field: string, n: number) => tally.set(field, (tally.get(field) ?? 0) + n)
    const parts = (raw: string | null) => (raw ?? '').split(',').map(p => p.trim()).filter(Boolean)
    for (const g of groups) {
      for (const f of parts(g.completeness_missing)) {
        if (f === GST_FIELD && !gstRequired) continue
        add(f, g._count._all)
      }
    }
    for (const g of blankGroups) {
      const list = parts(g.completeness_missing).filter(f => gstRequired || f !== GST_FIELD)
      for (const f of list) add(f, g._count._all)
      if (!list.includes('Mobile Number')) add('Mobile Number', g._count._all)
    }
    // Individuals under a GST-required firm are exempt from the GST field; take
    // them back out of that one tally line.
    if (gstRequired && individuals.length && tally.has(GST_FIELD)) {
      const exempt = await prisma.companies.count({
        where: { AND: [where, { id: { in: individuals } }, { completeness_missing: { contains: GST_FIELD } }] },
      })
      const left = (tally.get(GST_FIELD) ?? 0) - exempt
      if (left > 0) tally.set(GST_FIELD, left)
      else tally.delete(GST_FIELD)
    }
    const missing = [...tally.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([field, count]) => ({ field, count }))

    return NextResponse.json({ incomplete, noDeal, missing })
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
