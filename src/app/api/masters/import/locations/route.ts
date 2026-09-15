import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

type RawRow = Record<string, string | number | null | undefined>

function field(row: RawRow, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()]
    if (v !== undefined && v !== null) return String(v).trim()
  }
  return ''
}

// Case-insensitive dedup: keeps first-seen casing, discards subsequent variants
function uniqueByLower(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n) }
  }
  return out
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'states', 'edit')) return forbidden()
  const body = await req.json() as { rows: RawRow[] }
  if (!Array.isArray(body.rows)) return NextResponse.json({ error: 'rows must be an array' }, { status: 400 })
  if (body.rows.length > 2000) return NextResponse.json({ error: 'Maximum 2000 rows per import' }, { status: 400 })

  const tid = getTenantId()

  const skipped: { row: number; reason: string }[] = []
  const created = { states: 0, districts: 0, talukas: 0, villages: 0 }
  const existing = { states: 0, districts: 0, talukas: 0, villages: 0 }

  const rows = body.rows.map((r, i) => ({
    rowNum: i + 2,
    state:    field(r, 'State',    'STATE'),
    district: field(r, 'District', 'DISTRICT'),
    taluka:   field(r, 'Taluka',   'TALUKA'),
    village:  field(r, 'Village',  'VILLAGE'),
  }))

  // ── 1. STATES ────────────────────────────────────────────────────────────
  // Dedup input names case-insensitively (keep first-seen casing)
  const stateNames = uniqueByLower(rows.filter(r => r.state).map(r => r.state))

  // Fetch ALL states for tenant → case-insensitive map
  const existingStates = await prisma.states.findMany({
    where: { tenant_id: tid }, select: { id: true, name: true },
  })
  const stateMap = new Map<string, string>(existingStates.map(s => [s.name.toLowerCase(), s.id]))

  existing.states = stateNames.filter(n => stateMap.has(n.toLowerCase())).length
  const toCreateStates = stateNames.filter(n => !stateMap.has(n.toLowerCase()))

  if (toCreateStates.length > 0) {
    // .insert([...]).select(...) returns the inserted rows; createMany does NOT
    // (it returns only a count), so createManyAndReturn is the faithful
    // equivalent here. PostgreSQL-only, which is what we target (PLAN.md 8.4).
    let ns
    try {
      ns = await prisma.states.createManyAndReturn({
        data: toCreateStates.map(name => ({ tenant_id: tid, name, is_active: true })),
        select: { id: true, name: true },
      })
    } catch (err) {
      return NextResponse.json({ error: `States: ${dbErrorMessage(err)}` }, { status: 500 })
    }
    for (const s of ns) stateMap.set(s.name.toLowerCase(), s.id)
    created.states = ns.length
  }

  // ── 2. DISTRICTS ─────────────────────────────────────────────────────────
  // Deduplicate inputs by compound key (stateId|district.lower), keep first-seen casing
  const districtInputsMap = new Map<string, { name: string; stateId: string }>()
  const skippedStateKeys = new Set<string>()
  for (const r of rows) {
    if (!r.state || !r.district) continue
    const sid = stateMap.get(r.state.toLowerCase())
    if (!sid) {
      if (!skippedStateKeys.has(r.state.toLowerCase())) {
        skipped.push({ row: r.rowNum, reason: `State "${r.state}" not found` })
        skippedStateKeys.add(r.state.toLowerCase())
      }
      continue
    }
    const key = `${sid}|${r.district.toLowerCase()}`
    if (!districtInputsMap.has(key)) districtInputsMap.set(key, { name: r.district, stateId: sid })
  }
  const districtInputs = [...districtInputsMap.values()]

  const districtMap = new Map<string, string>()
  if (districtInputs.length > 0) {
    // Fetch ALL districts for the relevant states (not by name — avoids case sensitivity)
    const relevantStateIds = [...new Set(districtInputs.map(d => d.stateId))]
    const eds = await prisma.districts.findMany({
      where: { tenant_id: tid, state_id: { in: relevantStateIds } },
      select: { id: true, name: true, state_id: true },
    })
    for (const d of eds) districtMap.set(`${d.state_id}|${d.name.toLowerCase()}`, d.id)

    existing.districts = districtInputs.filter(d => districtMap.has(`${d.stateId}|${d.name.toLowerCase()}`)).length
    const toCreate = districtInputs.filter(d => !districtMap.has(`${d.stateId}|${d.name.toLowerCase()}`))
    if (toCreate.length > 0) {
      let nd
      try {
        nd = await prisma.districts.createManyAndReturn({
          data: toCreate.map(d => ({ tenant_id: tid, name: d.name, state_id: d.stateId, is_active: true })),
          select: { id: true, name: true, state_id: true },
        })
      } catch (err) {
        return NextResponse.json({ error: `Districts: ${dbErrorMessage(err)}` }, { status: 500 })
      }
      for (const d of nd) districtMap.set(`${d.state_id}|${d.name.toLowerCase()}`, d.id)
      created.districts = nd.length
    }
  }

  // ── 3. TALUKAS ───────────────────────────────────────────────────────────
  const talukaInputsMap = new Map<string, { name: string; districtId: string }>()
  for (const r of rows) {
    if (!r.state || !r.district || !r.taluka) continue
    const sid = stateMap.get(r.state.toLowerCase())
    const did = sid ? districtMap.get(`${sid}|${r.district.toLowerCase()}`) : undefined
    if (!did) continue
    const key = `${did}|${r.taluka.toLowerCase()}`
    if (!talukaInputsMap.has(key)) talukaInputsMap.set(key, { name: r.taluka, districtId: did })
  }
  const talukaInputs = [...talukaInputsMap.values()]

  const talukaMap = new Map<string, string>()
  if (talukaInputs.length > 0) {
    // Fetch ALL talukas for the relevant districts
    const relevantDistrictIds = [...new Set(talukaInputs.map(t => t.districtId))]
    const ets = await prisma.talukas.findMany({
      where: { tenant_id: tid, district_id: { in: relevantDistrictIds } },
      select: { id: true, name: true, district_id: true },
    })
    for (const t of ets) talukaMap.set(`${t.district_id}|${t.name.toLowerCase()}`, t.id)

    existing.talukas = talukaInputs.filter(t => talukaMap.has(`${t.districtId}|${t.name.toLowerCase()}`)).length
    const toCreate = talukaInputs.filter(t => !talukaMap.has(`${t.districtId}|${t.name.toLowerCase()}`))
    if (toCreate.length > 0) {
      let nt
      try {
        nt = await prisma.talukas.createManyAndReturn({
          data: toCreate.map(t => ({ tenant_id: tid, name: t.name, district_id: t.districtId, is_active: true })),
          select: { id: true, name: true, district_id: true },
        })
      } catch (err) {
        return NextResponse.json({ error: `Talukas: ${dbErrorMessage(err)}` }, { status: 500 })
      }
      for (const t of nt) talukaMap.set(`${t.district_id}|${t.name.toLowerCase()}`, t.id)
      created.talukas = nt.length
    }
  }

  // ── 4. VILLAGES ──────────────────────────────────────────────────────────
  const villageInputsMap = new Map<string, { name: string; talukaId: string }>()
  for (const r of rows) {
    if (!r.state || !r.district || !r.taluka || !r.village) continue
    const sid = stateMap.get(r.state.toLowerCase())
    const did = sid ? districtMap.get(`${sid}|${r.district.toLowerCase()}`) : undefined
    const tkid = did ? talukaMap.get(`${did}|${r.taluka.toLowerCase()}`) : undefined
    if (!tkid) continue
    const key = `${tkid}|${r.village.toLowerCase()}`
    if (!villageInputsMap.has(key)) villageInputsMap.set(key, { name: r.village, talukaId: tkid })
  }
  const villageInputs = [...villageInputsMap.values()]

  if (villageInputs.length > 0) {
    // Fetch ALL villages for the relevant talukas
    const relevantTalukaIds = [...new Set(villageInputs.map(v => v.talukaId))]
    const evs = await prisma.villages.findMany({
      where: { tenant_id: tid, taluka_id: { in: relevantTalukaIds } },
      select: { id: true, name: true, taluka_id: true },
    })
    const villageMap = new Map(evs.map(v => [`${v.taluka_id}|${v.name.toLowerCase()}`, v.id]))

    existing.villages = villageInputs.filter(v => villageMap.has(`${v.talukaId}|${v.name.toLowerCase()}`)).length
    const toCreate = villageInputs.filter(v => !villageMap.has(`${v.talukaId}|${v.name.toLowerCase()}`))
    if (toCreate.length > 0) {
      try {
        const nv = await prisma.villages.createManyAndReturn({
          data: toCreate.map(v => ({ tenant_id: tid, name: v.name, taluka_id: v.talukaId, is_active: true })),
          select: { id: true },
        })
        created.villages = nv.length
      } catch (err) {
        return NextResponse.json({ error: `Villages: ${dbErrorMessage(err)}` }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ created, existing, skipped })
}
