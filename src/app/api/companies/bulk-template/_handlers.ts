import ExcelJS from 'exceljs'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getTenantId } from '@/lib/tenant'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { COMPANY_NOTES_SHEET, COMPANY_SHEET } from '../bulk-import/_columns'


const TEMPS = ['Cold', 'Warm', 'Hot']

export async function GET() {
  const user = await requireUser()
  // The template exists only to feed bulk-import, which checks the same
  // action; it also lists the tenant's masters, so it is not handed out
  // beyond the people who can use it.
  if (!await checkPermission(user, 'companies', 'create')) return forbidden()

  const tid = getTenantId()

  const [companyTypes, dealStages, states, districts, talukas] = await Promise.all([
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

  const typeCount  = addRefSheet('Ref_Types',     companyTypes.map(r => r.name))
  const stageCount = addRefSheet('Ref_Stages',    dealStages.map(r => r.name))
  const stateCount = addRefSheet('Ref_States',    states.map(r => r.name))
  const distCount  = addRefSheet('Ref_Districts', districts.map(r => r.name))
  const taluCount  = addRefSheet('Ref_Talukas',   talukas.map(r => r.name))
  addRefSheet('Ref_Temps', TEMPS)

  // ── Main "Companies" sheet ────────────────────────────────────────────────
  // `bulk-parse` looks for this name first and falls back to "Leads" so a
  // template downloaded before P1-T10 still imports. Columns are matched by
  // header (`COMPANY_COLUMNS`), so the `*` and the date hint below are fine.
  const ws = workbook.addWorksheet(COMPANY_SHEET)

  ws.columns = [
    { header: 'Name *',            key: 'name',                 width: 26 },
    // No asterisk: Company Type is not compulsory (REBUILD-PLAN.md:126).
    { header: 'Type',              key: 'type',                 width: 20 },
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

  // No sample row on this sheet: one left in would be imported as a real
  // company. The example lives on COMPANY_NOTES_SHEET, which `bulk-parse`
  // never reads.

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

  // ── "How to fill": guidance and an example, never imported ───────────────
  const notes = workbook.addWorksheet(COMPANY_NOTES_SHEET)
  notes.columns = [{ width: 34 }, { width: 70 }]
  const note = (cells: string[], bold = false) => { notes.addRow(cells).font = { bold } }
  note(['Fill in the Companies sheet, one company per row. This sheet is never imported.'], true)
  note([])
  note(['Column', 'What to enter'], true)
  ;[
    ['Name *', 'Required. A row with no GST Number and no mobile is matched to an existing company by this name.'],
    ['Type, State, District, Taluka, Stage, Temperature', 'Pick from the dropdown; these come from your masters. A blank Stage starts the company as Prospect.'],
    ['Mobile 1, Mobile 2', '10-digit mobile numbers.'],
    ['GST Number', 'The 15-character GSTIN.'],
    ['Next Follow-up Date (YYYY-MM-DD)', 'A date written like 2026-05-01.'],
  ].forEach(r => note(r))
  note([])
  note(['Example row (copy the values, not the row)'], true)
  const example: [string, string][] = [
    ['Name *', 'ABC Solar'], ['Contact Person', 'Ravi Kumar'], ['Mobile 1', '9876543210'],
    ['Email', 'ravi@example.com'], ['Pin Code', '411001'], ['Address', '123 Main St'],
    ['Stage', 'Prospect'], ['Temperature', 'Warm'], ['Next Follow-up Date (YYYY-MM-DD)', '2026-05-01'],
    ['Description', 'Interested in 3kW system'],
  ]
  example.forEach(r => note(r))

  // ── Write buffer ──────────────────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer()

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="companies_template.xlsx"',
    },
  })
}
