import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

interface LeadRow {
  name: string
  type: string
  contact_person_name?: string
  mobile_1?: string
  mobile_2?: string
  email?: string
  gst_number?: string
  pincode?: string
  address?: string
  state?: string
  district?: string
  taluka?: string
  stage?: string
  temperature?: string
  next_follow_up_date?: string
  description?: string
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'leads', 'edit')) return forbidden()

  const body = await req.json()
  const rows: LeadRow[] = body.leads
  if (!Array.isArray(rows) || rows.length === 0)
    return NextResponse.json({ error: 'No leads provided' }, { status: 400 })

  const tid = getTenantId()

  // Fetch lookup tables once
  const [states, districts, talukas, leadTypes, leadStages] = await Promise.all([
    prisma.states.findMany({ where: { tenant_id: tid }, select: { id: true, name: true } }),
    prisma.districts.findMany({ where: { tenant_id: tid }, select: { id: true, name: true, state_id: true } }),
    prisma.talukas.findMany({ where: { tenant_id: tid }, select: { id: true, name: true, district_id: true } }),
    prisma.lead_types.findMany({ where: { tenant_id: tid }, select: { id: true, name: true } }),
    prisma.lead_stages.findMany({ where: { tenant_id: tid }, select: { name: true } }),
  ])

  const stateMap   = new Map(states.map(r => [r.name.toLowerCase(), r.id]))
  const distMap    = new Map(districts.map(r => [r.name.toLowerCase(), { id: r.id, state_id: r.state_id }]))
  const talukaMap  = new Map(talukas.map(r => [r.name.toLowerCase(), { id: r.id, district_id: r.district_id }]))
  const typeNames  = new Set(leadTypes.map(r => r.name.toLowerCase()))
  const VALID_STAGES = new Set(leadStages.map(r => r.name.toLowerCase()))

  const VALID_TEMPS = new Set(['cold', 'warm', 'hot'])

  const inserted: number[] = []
  const errors: { row: number; message: string }[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rowNum = i + 1

    if (!r.name?.trim()) { errors.push({ row: rowNum, message: 'Name is required' }); continue }
    if (!r.type?.trim()) { errors.push({ row: rowNum, message: 'Type is required' }); continue }
    if (!typeNames.has(r.type.trim().toLowerCase())) {
      errors.push({ row: rowNum, message: `Lead type "${r.type}" not found` }); continue
    }
    if (r.mobile_1 && !/^\d{10}$/.test(String(r.mobile_1).trim())) {
      errors.push({ row: rowNum, message: 'Mobile 1 must be exactly 10 digits' }); continue
    }
    if (r.mobile_2 && !/^\d{10}$/.test(String(r.mobile_2).trim())) {
      errors.push({ row: rowNum, message: 'Mobile 2 must be exactly 10 digits' }); continue
    }
    if (r.stage && !VALID_STAGES.has(r.stage.trim().toLowerCase())) {
      errors.push({ row: rowNum, message: `Stage "${r.stage}" not found in masters` }); continue
    }
    if (r.temperature && !VALID_TEMPS.has(r.temperature.trim().toLowerCase())) {
      errors.push({ row: rowNum, message: 'Temperature must be Cold, Warm, or Hot' }); continue
    }
    if (r.next_follow_up_date && isNaN(Date.parse(r.next_follow_up_date))) {
      errors.push({ row: rowNum, message: 'Next Follow-up Date must be a valid date (YYYY-MM-DD)' }); continue
    }

    // Resolve geo IDs
    const stateId    = r.state    ? stateMap.get(r.state.trim().toLowerCase())    ?? null : null
    const distEntry  = r.district ? distMap.get(r.district.trim().toLowerCase())  ?? null : null
    const taluEntry  = r.taluka   ? talukaMap.get(r.taluka.trim().toLowerCase())  ?? null : null
    const districtId = distEntry?.id ?? null
    const talukaId   = taluEntry?.id ?? null

    const rawStage = r.stage?.trim()
    const stage = rawStage
      ? rawStage.charAt(0).toUpperCase() + rawStage.slice(1).toLowerCase()
      : 'Prospect'

    // One INSERT per row, each with its own error captured — unlike the product
    // importer (PLAN.md 13.4), a bad row here does NOT abort the whole import.
    // That per-row behaviour is preserved exactly: the throw is caught inside the
    // loop and recorded against the row number.
    try {
      await prisma.business_partners.create({
        data: {
          tenant_id: tid,
          stage,
          name: r.name.trim(),
          type: r.type.trim(),
          contact_person_name: r.contact_person_name?.trim() || null,
          mobile_1: r.mobile_1?.trim() || null,
          mobile_2: r.mobile_2?.trim() || null,
          gst_number: r.gst_number?.trim().toUpperCase() || null,
          pincode: r.pincode?.trim() || null,
          address: r.address?.trim() || null,
          description: r.description?.trim() || null,
          state_id: stateId,
          district_id: districtId,
          taluka_id: talukaId,
          temperature: r.temperature ? (r.temperature.trim().charAt(0).toUpperCase() + r.temperature.trim().slice(1).toLowerCase()) : null,
          // next_follow_up_date is @db.Date.
          next_follow_up_date: r.next_follow_up_date?.trim() ? new Date(r.next_follow_up_date.trim()) : null,
        },
      })
      inserted.push(rowNum)
    } catch (err) {
      errors.push({ row: rowNum, message: dbErrorMessage(err) })
    }
  }

  return NextResponse.json({ inserted: inserted.length, errors })
}
