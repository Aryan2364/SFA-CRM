import { NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  if (!await checkPermission(user, 'territory_mapping', 'view')) return forbidden()
  const tid = getTenantId()

  try {
  const [users, mappings] = await Promise.all([
    prisma.users.findMany({
      where: { tenant_id: tid, status: 'Active' },
      select: { id: true, name: true, contact: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user_territory_mappings.findMany({
      where: { tenant_id: tid },
      select: { user_id: true, state_ids: true, district_ids: true },
    }),
  ])

  // Collect all district IDs across all mappings
  const allDistrictIds = [...new Set(mappings.flatMap(m => m.district_ids ?? []))]
  let districtRows: { id: string; name: string; state_id: string }[] = []
  if (allDistrictIds.length > 0) {
    // tenant_id IS filtered here, unlike the pre-migration query. The ids come
    // from user_territory_mappings.district_ids, a uuid[] column with NO foreign
    // key — so unlike the dealers lookup, nothing in the database guarantees
    // they belong to this tenant. That absence makes the filter MORE necessary,
    // not less: it is the only control that exists on this path. It can only
    // withhold rows that should never have been visible, never add or alter
    // any, and live measures 730 referenced ids across 10 mappings with zero
    // cross-tenant hits, so there is no observable change today.
    districtRows = await prisma.districts.findMany({
      where: { tenant_id: tid, id: { in: allDistrictIds } },
      select: { id: true, name: true, state_id: true },
    })
  }

  const result = users.map(user => {
    const mapping = mappings.find(m => m.user_id === user.id)
    let district_summary = ''
    if (mapping && (mapping.district_ids ?? []).length > 0) {
      const stateSet = new Set<string>(mapping.state_ids ?? [])
      const activeNames = (mapping.district_ids as string[])
        .map(id => districtRows.find(d => d.id === id))
        .filter(d => d && stateSet.has(d.state_id))
        .map(d => d!.name)
      if (activeNames.length === 0) {
        // Show all saved district names if none active
        const allNames = (mapping.district_ids as string[]).map(id => districtRows.find(d => d.id === id)?.name).filter(Boolean) as string[]
        district_summary = allNames.length <= 3 ? allNames.join(', ') : `${allNames.slice(0, 3).join(', ')} ... +${allNames.length - 3} more`
      } else {
        district_summary = activeNames.length <= 3 ? activeNames.join(', ') : `${activeNames.slice(0, 3).join(', ')} ... +${activeNames.length - 3} more`
      }
    }
    return { ...user, district_summary, has_mapping: !!(mapping && (mapping.district_ids ?? []).length > 0) }
  })

  // Only ids, names and derived strings — nothing to serialise.
  return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 })
  }
}
