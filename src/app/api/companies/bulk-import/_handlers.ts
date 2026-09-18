import { NextRequest, NextResponse } from 'next/server'
import { prisma, dbErrorMessage } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { recomputeCompanyCompleteness } from '@/lib/completeness'
import { checkEmail, checkGstin, checkMobile, checkPincode, firstError } from '@/lib/validation'


interface CompanyRow {
  name: string
  type?: string
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
  // 'create', not 'edit' — this route only ever inserts (P1-T10.3).
  if (!await checkPermission(user, 'companies', 'create')) return forbidden()

  // `leads` is the key the importer on the Leads screen posts; `companies` is
  // what the Parties screen will post. Accept both so the rename of the screen
  // (P1-T13) and of this route can land independently.
  const body = await req.json()
  const rows: CompanyRow[] = body.companies ?? body.leads
  if (!Array.isArray(rows) || rows.length === 0)
    return NextResponse.json({ error: 'No companies provided' }, { status: 400 })

  const tid = getTenantId()

  // Fetch lookup tables once
  const [states, districts, talukas, companyTypes, dealStages] = await Promise.all([
    prisma.states.findMany({ where: { tenant_id: tid }, select: { id: true, name: true } }),
    prisma.districts.findMany({ where: { tenant_id: tid }, select: { id: true, name: true, state_id: true } }),
    prisma.talukas.findMany({ where: { tenant_id: tid }, select: { id: true, name: true, district_id: true } }),
    prisma.company_types.findMany({ where: { tenant_id: tid }, select: { id: true, name: true } }),
    prisma.deal_stages.findMany({ where: { tenant_id: tid }, select: { name: true } }),
  ])

  const stateMap   = new Map(states.map(r => [r.name.toLowerCase(), r.id]))
  const distMap    = new Map(districts.map(r => [r.name.toLowerCase(), { id: r.id, state_id: r.state_id }]))
  const talukaMap  = new Map(talukas.map(r => [r.name.toLowerCase(), { id: r.id, district_id: r.district_id }]))
  const typeNames  = new Set(companyTypes.map(r => r.name.toLowerCase()))
  const VALID_STAGES = new Set(dealStages.map(r => r.name.toLowerCase()))

  const VALID_TEMPS = new Set(['cold', 'warm', 'hot'])

  const inserted: number[] = []
  const errors: { row: number; message: string }[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rowNum = i + 1

    if (!r.name?.trim()) { errors.push({ row: rowNum, message: 'Name is required' }); continue }
    // Company Type is NOT compulsory (REBUILD-PLAN.md:126) — a blank column is
    // accepted. A value that is not in the master is still an error: it is a
    // typo, not a blank.
    if (r.type?.trim() && !typeNames.has(r.type.trim().toLowerCase())) {
      errors.push({ row: rowNum, message: `Company type "${r.type}" not found` }); continue
    }
    const bad = firstError(
      checkMobile(r.mobile_1, 'Mobile 1'),
      checkMobile(r.mobile_2, 'Mobile 2'),
      checkPincode(r.pincode),
      checkGstin(r.gst_number),
      checkEmail(r.email),
    )
    if (bad) { errors.push({ row: rowNum, message: bad }); continue }
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
      const created = await prisma.companies.create({
        data: {
          tenant_id: tid,
          stage,
          name: r.name.trim(),
          // NOT NULL with no default — blank is the empty string. See
          // POST /api/companies for why.
          type: r.type?.trim() || '',
          email: r.email?.trim() || null,
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
      // Derived, never imported (P1-T10.7). An imported company has no
      // company_addresses row yet, so this always writes the incomplete state —
      // the spreadsheet has no address columns that map to one.
      await recomputeCompanyCompleteness(created.id, tid)
      inserted.push(rowNum)
    } catch (err) {
      errors.push({ row: rowNum, message: dbErrorMessage(err) })
    }
  }

  return NextResponse.json({ inserted: inserted.length, errors })
}
