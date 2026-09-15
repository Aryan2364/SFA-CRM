import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  if (!user.userId) return NextResponse.json([])
  const tid = getTenantId()

  // .single() returned an error (leaving `mapping` null) when the user had no
  // mapping, and the route answered with []. findUnique's null does the same.
  const mapping = await prisma.user_territory_mappings.findUnique({
    where: { tenant_id_user_id: { tenant_id: tid, user_id: user.userId } },
    select: { state_ids: true, district_ids: true, taluka_ids: true, village_ids: true },
  })

  if (!mapping) return NextResponse.json([])

  const stateSet = new Set<string>(mapping.state_ids ?? [])
  const dIds: string[] = mapping.district_ids ?? []
  const tIds: string[] = mapping.taluka_ids ?? []
  const vIds: string[] = mapping.village_ids ?? []

  const [districts, talukas, villages] = await Promise.all([
    dIds.length > 0 ? prisma.districts.findMany({ where: { id: { in: dIds } }, select: { id: true, name: true, state_id: true } }) : Promise.resolve([]),
    tIds.length > 0 ? prisma.talukas.findMany({ where: { id: { in: tIds } }, select: { id: true, name: true, district_id: true } }) : Promise.resolve([]),
    vIds.length > 0 ? prisma.villages.findMany({ where: { id: { in: vIds } }, select: { id: true, name: true, taluka_id: true } }) : Promise.resolve([]),
  ])

  const activeDistricts = districts.filter(d => stateSet.has(d.state_id))
  const activeDistrictSet = new Set(activeDistricts.map(d => d.id))
  const activeTalukas = talukas.filter(t => activeDistrictSet.has(t.district_id))
  const activeTalukaSet = new Set(activeTalukas.map(t => t.id))
  const activeVillages = villages.filter(v => activeTalukaSet.has(v.taluka_id))

  // Only ids and names reach the response, so no serialise step is needed.
  const places = [
    ...activeDistricts.map(d => ({ id: `district:${d.id}`, label: `District: ${d.name}`, type: 'District', name: d.name })),
    ...activeTalukas.map(t => ({ id: `taluka:${t.id}`, label: `Taluka: ${t.name}`, type: 'Taluka', name: t.name })),
    ...activeVillages.map(v => ({ id: `village:${v.id}`, label: `Village: ${v.name}`, type: 'Village', name: v.name })),
  ].sort((a, b) => a.label.localeCompare(b.label))

  return NextResponse.json(places)
}
