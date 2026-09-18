import ExcelJS from 'exceljs'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const TEMPS = ['Cold', 'Warm', 'Hot']

export async function GET() {
  await requireUser()

  const tid = getTenantId()

  const [leadTypes, leadStages, states, districts, talukas] = await Promise.all([
    prisma.company_types.findMany({ where: { tenant_id: tid }, select: { name: true }, orderBy: { sort_order: 'asc' } }),
    prisma.deal_stages.findMany({ where: { tenant_id: tid }, select: { name: true }, orderBy: { sort_order: 'asc' } }),
    prisma.states.findMany({ where: { tenant_id: tid }, select: { name: true }, orderBy: { name: 'asc' } }),
    prisma.districts.findMany({ where: { tenant_id: tid }, select: { name: true }, orderBy: { name: 'asc' } }),
    prisma.talukas.findMany({ where: { tenant_id: tid }, select: { name: true }, orderBy: { name: 'asc' } }),
  ])

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'RGB Admin'
  workbook.created = new Date()

  // Helper: add a hidden reference sheet and return row count
  function addRefSheet(sheetName: string, values: string[]): number {
    const ws = workbook.addWorksheet(sheetName)
    ws.state = 'veryHidden'
    values.forEach((v, i) => { ws.getCell(i + 1, 1).value = v })
    return values.length
  }

  const typeCount  = addRefSheet('Ref_Types',     leadTypes.map(r => r.name))
  const stageCount = addRefSheet('Ref_Stages',    leadStages.map(r => r.name))
  const stateCount = addRefSheet('Ref_States',    states.map(r => r.name))
  const distCount  = addRefSheet('Ref_Districts', districts.map(r => r.name))
  const taluCount  = addRefSheet('Ref_Talukas',   talukas.map(r => r.name))
  addRefSheet('Ref_Temps', TEMPS)

  // ── Main "Leads" sheet ────────────────────────────────────────────────────
  const ws = workbook.addWorksheet('Leads')

  ws.columns = [
    { header: 'Name *',            key: 'name',                 width: 26 },
    { header: 'Type *',            key: 'type',                 width: 20 },
    { header: 'Contact Person',    key: 'contact_person_name',  width: 22 },
    { header: 'Mobile 1',          key: 'mobile_1',             width: 14 },
    { header: 'Mobile 2',          key: 'mobile_2',             width: 14 },
    { header: 'Email',             key: 'email',                width: 26 },
    { header: 'GST Number',        key: 'gst_number',           width: 20 },
    { header: 'Pin Code',          key: 'pincode',              width: 12 },
    { header: 'Address',           key: 'address',              width: 32 },
    { header: 'State',             key: 'state',                width: 20 },
    { header: 'District',          key: 'district',             width: 20 },
    { header: 'Taluka',            key: 'taluka',               width: 20 },
    { header: 'Stage',             key: 'stage',                width: 18 },
    { header: 'Temperature',       key: 'temperature',          width: 16 },
    { header: 'Next Follow-up Date (YYYY-MM-DD)', key: 'next_follow_up_date', width: 30 },
    { header: 'Description',       key: 'description',          width: 32 },
  ]

  // Style header row
  const headerRow = ws.getRow(1)
  headerRow.height = 22
  headerRow.eachCell(cell => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
    cell.border    = { bottom: { style: 'thin', color: { argb: 'FF1D4ED8' } } }
  })

  // Sample row
  ws.addRow([
    'ABC Solar', '', 'Ravi Kumar', '9876543210', '', 'ravi@example.com',
    '', '411001', '123 Main St', '', '', '', 'Prospect', 'Warm', '2026-05-01',
    'Interested in 3kW system',
  ])

  // Style sample row with a light tint so the user can distinguish it
  const sampleRow = ws.getRow(2)
  sampleRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }
  })

  // ── Data validations (rows 2 – 1001) ─────────────────────────────────────
  const MAX = 1001
  const dv = (ws as any).dataValidations as { add: (range: string, def: object) => void }

  if (typeCount > 0)
    dv.add(`B2:B${MAX}`, { type: 'list', allowBlank: true, formulae: [`'Ref_Types'!$A$1:$A$${typeCount}`] })

  if (stateCount > 0)
    dv.add(`J2:J${MAX}`, { type: 'list', allowBlank: true, formulae: [`'Ref_States'!$A$1:$A$${stateCount}`] })

  if (distCount > 0)
    dv.add(`K2:K${MAX}`, { type: 'list', allowBlank: true, formulae: [`'Ref_Districts'!$A$1:$A$${distCount}`] })

  if (taluCount > 0)
    dv.add(`L2:L${MAX}`, { type: 'list', allowBlank: true, formulae: [`'Ref_Talukas'!$A$1:$A$${taluCount}`] })

  if (stageCount > 0)
    dv.add(`M2:M${MAX}`, { type: 'list', allowBlank: true, formulae: [`'Ref_Stages'!$A$1:$A$${stageCount}`] })
  dv.add(`N2:N${MAX}`, { type: 'list', allowBlank: true, formulae: [`'Ref_Temps'!$A$1:$A$${TEMPS.length}`] })

  // Freeze header
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, activeCell: 'A2' }]

  // ── Write buffer ──────────────────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer()

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="leads_template.xlsx"',
    },
  })
}
