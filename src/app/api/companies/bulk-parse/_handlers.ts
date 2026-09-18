import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'


// Column index → field key (1-based, matches the template sheet)
const COL_MAP: Record<number, string> = {
  1:  'name',
  2:  'type',
  3:  'contact_person_name',
  4:  'mobile_1',
  5:  'mobile_2',
  6:  'email',
  7:  'gst_number',
  8:  'pincode',
  9:  'address',
  10: 'state',
  11: 'district',
  12: 'taluka',
  13: 'stage',
  14: 'temperature',
  15: 'next_follow_up_date',
  16: 'description',
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().split('T')[0]
  if (typeof v === 'object') {
    if ('result' in v) return String((v as ExcelJS.CellFormulaValue).result ?? '')
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map(r => r.text).join('')
    if ('text' in v) return String((v as unknown as { text: string }).text)
  }
  return String(v).trim()
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!await checkPermission(user, 'companies', 'create')) return forbidden()

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const arrayBuf = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(arrayBuf as Parameters<typeof workbook.xlsx.load>[0])

  // Read the "Companies" sheet. A template downloaded before P1-T10 names that
  // sheet "Leads", so it is still accepted; the last-worksheet fallback (the
  // template puts the data sheet last, after the hidden Ref_ sheets) covers a
  // renamed or hand-built file.
  const ws =
    workbook.getWorksheet('Companies') ??
    workbook.getWorksheet('Leads') ??
    workbook.worksheets[workbook.worksheets.length - 1]

  if (!ws) return NextResponse.json({ error: 'No worksheet found in file' }, { status: 400 })

  const rows: Record<string, string>[] = []

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // skip header
    const obj: Record<string, string> = {}
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = COL_MAP[colNumber]
      if (key) obj[key] = cellText(cell)
    })
    // Only include rows that have at least a name or type
    if (obj.name?.trim() || obj.type?.trim()) rows.push(obj)
  })

  return NextResponse.json({ rows })
}
