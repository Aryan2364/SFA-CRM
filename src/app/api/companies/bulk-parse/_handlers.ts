import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { requireUser } from '@/lib/auth'
import { checkPermission, forbidden } from '@/lib/permissions'
import { IMPORT_MAX_ROWS, ROW_NUMBER_KEY, duplicateHeaders, duplicateHeadersMessage } from '@/lib/bulk-import'
import { COMPANY_NOTES_SHEET, COMPANY_SHEET } from '../bulk-import/_columns'

/** Checked on the client too, before the upload. */
const MAX_FILE_BYTES = 5 * 1024 * 1024

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ''
  // A date cell is a UTC-midnight Date: its first ten ISO characters are the
  // date the sheet shows.
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('result' in v) {
      const r = (v as ExcelJS.CellFormulaValue).result
      if (r instanceof Date) return r.toISOString().slice(0, 10)
      return r === null || r === undefined || typeof r === 'object' ? '' : String(r).trim()
    }
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map(r => r.text).join('').trim()
    if ('text' in v) return String((v as unknown as { text: string }).text).trim()
    // An error value (#N/A) or anything else not a plain value reads as blank.
    return ''
  }
  return String(v).trim()
}

/**
 * Reads the uploaded sheet into rows keyed by the file's OWN header text, each
 * with its sheet row number in `__row` — the same shape the masters import
 * page builds in the browser. Columns are matched to fields by header in
 * `bulk-import` (`matchColumns`), never by position here.
 *
 * Every row with a value in any cell is returned: a row with no Name is a
 * reported error at the check step, never a silent omission.
 */
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
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'This file is larger than 5 MB. Split it into smaller files, then upload each one.' }, { status: 400 })
  }

  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(await file.arrayBuffer() as Parameters<typeof workbook.xlsx.load>[0])
  } catch {
    return NextResponse.json({ error: 'This file could not be read. Save it as an Excel workbook (.xlsx), then upload it again.' }, { status: 400 })
  }

  // Read the "Companies" sheet. A template downloaded before P1-T10 names that
  // sheet "Leads", so it is still accepted; the last-worksheet fallback (the
  // template puts the data sheet last, after the hidden Ref_ sheets) covers a
  // renamed or hand-built file. The template's guidance sheet, which now comes
  // after the data sheet, is never the fallback: its example would import.
  const candidates = workbook.worksheets.filter(w => w.name !== COMPANY_NOTES_SHEET)
  const ws =
    workbook.getWorksheet(COMPANY_SHEET) ??
    workbook.getWorksheet('Leads') ??
    candidates[candidates.length - 1]

  if (!ws) return NextResponse.json({ error: 'No worksheet found in file' }, { status: 400 })

  const headerRow = ws.getRow(1)
  const headers: string[] = []
  for (let c = 1; c <= headerRow.cellCount; c++) headers.push(cellText(headerRow.getCell(c)))
  // Rows are keyed by header text, so a repeated header would let the later
  // column overwrite the earlier one's value.
  const dups = duplicateHeaders(headers)
  if (dups.length > 0) return NextResponse.json({ error: duplicateHeadersMessage(dups) }, { status: 400 })

  const rows: Record<string, string>[] = []
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const obj: Record<string, string> = { [ROW_NUMBER_KEY]: String(rowNumber) }
    let any = false
    headers.forEach((h, i) => {
      if (!h) return
      const t = cellText(row.getCell(i + 1))
      obj[h] = t
      if (t) any = true
    })
    // eachRow also visits a row that only carries formatting.
    if (any) rows.push(obj)
  })

  if (rows.length > IMPORT_MAX_ROWS) {
    return NextResponse.json(
      { error: `This sheet has ${rows.length} rows; the limit is ${IMPORT_MAX_ROWS} per import. Split it into smaller files, then upload each one.` },
      { status: 400 },
    )
  }

  return NextResponse.json({ sheet: ws.name, headers: headers.filter(Boolean), rows })
}
