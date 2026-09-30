'use client'

import {
  REJECTED_PROBLEM_HEADER, REJECTED_REASON_HEADER, REJECTED_ROW_HEADER, ROW_NUMBER_KEY, normaliseHeader,
  type RawRow, type RowVerdict,
} from '@/lib/bulk-import'

const EXTRA = new Set([REJECTED_ROW_HEADER, REJECTED_PROBLEM_HEADER, REJECTED_REASON_HEADER].map(normaliseHeader))

/**
 * The "rows to fix" workbook: every skipped row's ORIGINAL cells under the
 * file's own headers, then Sheet row, Problem and Reason. Built in the browser
 * from what is already in memory, so nothing new is stored anywhere.
 *
 * The three extra headers are ones `matchColumns` skips outright, and the
 * sheet carries the name the importer looks for — so the user fixes the cells
 * and re-uploads this same file unchanged. A file that was itself a rejected-
 * rows file does not grow a second set of extra columns.
 *
 * `Problem` names the columns to fix, from each issue's structured `column`,
 * never guessed from the message text; it sorts and filters in Excel.
 */
export async function downloadRejectedRows({ sheetName, fileName, headers, sourceRows, verdicts }: {
  sheetName: string
  fileName: string
  /** The file's headers, in the file's order. */
  headers: string[]
  sourceRows: RawRow[]
  verdicts: RowVerdict[]
}): Promise<number> {
  const rejected = verdicts.filter(v => v.status === 'skipped')
  if (rejected.length === 0) return 0

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  const cols = headers.filter(h => h && h !== ROW_NUMBER_KEY && !EXTRA.has(normaliseHeader(h)))
  ws.columns = [
    ...cols.map(h => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 4)) })),
    { header: REJECTED_ROW_HEADER, key: REJECTED_ROW_HEADER, width: 10 },
    { header: REJECTED_PROBLEM_HEADER, key: REJECTED_PROBLEM_HEADER, width: 24 },
    { header: REJECTED_REASON_HEADER, key: REJECTED_REASON_HEADER, width: 60 },
  ]

  const byRow = new Map(sourceRows.map(r => [Number(r[ROW_NUMBER_KEY]), r]))
  for (const v of rejected) {
    const src = byRow.get(v.row) ?? {}
    const errors = v.issues.filter(i => i.severity === 'error')
    const problem = [...new Set(errors.map(i => i.column ?? 'Other'))].join(', ')
    ws.addRow({
      ...Object.fromEntries(cols.map(h => [h, src[h] === undefined || src[h] === null ? '' : String(src[h])])),
      [REJECTED_ROW_HEADER]: v.row,
      [REJECTED_PROBLEM_HEADER]: problem,
      [REJECTED_REASON_HEADER]: errors.map(i => i.message).join('; '),
    })
  }
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length + 3 } }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  a.click()
  // Revoked on the next tick: revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(a.href), 0)
  return rejected.length
}

/** "stock-list.xlsx" → "stock-list - rows to fix.xlsx". */
export function rejectedFileName(original: string): string {
  const base = original.replace(/\.xlsx?$/i, '') || 'import'
  return `${base} - rows to fix.xlsx`
}
