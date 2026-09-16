'use client'

import { useState, useRef, useCallback } from 'react'

type Tab = 'locations' | 'products'
type RawRow = Record<string, string>

type ImportResult = {
  created: Record<string, number>
  existing: Record<string, number>
  skipped: { row: number; reason: string }[]
  error?: string
}

const TAB_CONFIG: Record<Tab, {
  label: string
  sheetName: string
  endpoint: string
  cols: string[]
  hint: string
}> = {
  locations: {
    label: 'Locations',
    sheetName: 'Locations',
    endpoint: '/api/masters/import/locations',
    cols: ['State', 'District', 'Taluka', 'Village'],
    hint: 'Hierarchy: State → District → Taluka → Village. Leave columns empty to create only up to that level.',
  },
  products: {
    label: 'Products',
    sheetName: 'Products',
    endpoint: '/api/masters/import/products',
    cols: ['Category', 'Sub-Category', 'Product Name', 'Price', 'SKU'],
    hint: 'Hierarchy: Category → Sub-Category → Product. Leave Product Name empty to create only higher levels. Price and SKU are optional.',
  },
}

const TABS = Object.keys(TAB_CONFIG) as Tab[]

const EMPTY_ROWS: Record<Tab, RawRow[]> = { locations: [], products: [] }

export default function MastersImportPage() {
  const [tab, setTab] = useState<Tab>('locations')
  const [tabRows, setTabRows] = useState<Record<Tab, RawRow[]>>(EMPTY_ROWS)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const cfg = TAB_CONFIG[tab]
  const rows = tabRows[tab]
  const hasRows = rows.length > 0
  const preview = rows.slice(0, 20)

  // ── Template download ─────────────────────────────────────────────────────
  const downloadTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()

    const addSheet = (name: string, headers: { header: string; width: number }[], rows: (string | number)[][]) => {
      const ws = wb.addWorksheet(name)
      ws.columns = headers.map(h => ({ header: h.header, key: h.header, width: h.width }))
      rows.forEach(r => ws.addRow(r))
      ws.getRow(1).font = { bold: true }
    }

    addSheet('Locations',
      [{ header: 'State', width: 20 }, { header: 'District', width: 20 }, { header: 'Taluka', width: 20 }, { header: 'Village', width: 20 }],
      [['Maharashtra', 'Pune', 'Haveli', 'Hadapsar'], ['Maharashtra', 'Pune', 'Haveli', 'Kharadi'], ['Maharashtra', 'Nagpur', '', ''], ['Karnataka', '', '', '']]
    )
    addSheet('Products',
      [{ header: 'Category', width: 20 }, { header: 'Sub-Category', width: 20 }, { header: 'Product Name', width: 25 }, { header: 'Price', width: 10 }, { header: 'SKU', width: 12 }],
      [['Electronics', 'Smartphones', 'iPhone 15', 79999, 'IPH15'], ['Electronics', 'Smartphones', 'Samsung S24', 69999, 'SS24'], ['Electronics', '', '', '', ''], ['Apparel', 'Shirts', 'Cotton Shirt', 599, 'SH001']]
    )
    addSheet('Distributors',
      [{ header: 'Name', width: 25 }, { header: 'Phone', width: 12 }, { header: 'Address', width: 30 }, { header: 'Description', width: 30 }, { header: 'District', width: 15 }, { header: 'Taluka', width: 15 }, { header: 'Village', width: 15 }, { header: 'Latitude', width: 10 }, { header: 'Longitude', width: 10 }],
      [['Sharma Distributors', '9876543210', '123 Market Road, Pune', 'Primary western region distributor', 'Pune', 'Haveli', '', '', ''], ['Patil Enterprises', '9123456780', '45 Station Road, Nagpur', '', 'Nagpur', 'Hingna', '', '', '']]
    )
    addSheet('Dealers',
      [{ header: 'Name', width: 25 }, { header: 'Phone', width: 12 }, { header: 'Address', width: 25 }, { header: 'Description', width: 25 }, { header: 'District', width: 15 }, { header: 'Taluka', width: 15 }, { header: 'Village', width: 15 }, { header: 'Distributor', width: 25 }, { header: 'Latitude', width: 10 }, { header: 'Longitude', width: 10 }],
      [['ABC Traders', '9988776655', '12 Gandhi Nagar', '', 'Pune', 'Haveli', 'Hadapsar', 'Sharma Distributors', '', ''], ['XYZ Stores', '9871234560', '67 Ring Road', '', 'Pune', 'Haveli', 'Kharadi', 'Sharma Distributors', '', ''], ['Kumar Sales', '9000012345', '5 Civil Lines', '', 'Nagpur', 'Hingna', '', 'Patil Enterprises', '', '']]
    )

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'masters-import-template.xlsx'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── File parsing ──────────────────────────────────────────────────────────
  const parseFile = useCallback(async (file: File) => {
    setParseError('')
    setResult(null)

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setParseError('Please upload an .xlsx file. Use the template provided.')
      return
    }

    try {
      const buf = await file.arrayBuffer()
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf)

      const ws = wb.getWorksheet(cfg.sheetName)
      if (!ws) {
        setParseError(`Sheet "${cfg.sheetName}" not found in this file. Please use the provided template.`)
        return
      }

      // First row is headers
      const headerRow = ws.getRow(1).values as (string | undefined)[]
      const headers = headerRow.slice(1).map(h => String(h ?? ''))

      const parsed: RawRow[] = []
      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return
        const vals = row.values as (string | number | null | undefined)[]
        const obj: RawRow = {}
        headers.forEach((h, i) => { obj[h] = String(vals[i + 1] ?? '') })
        parsed.push(obj)
      })

      if (parsed.length === 0) {
        setParseError('The sheet is empty. Add data rows below the header row.')
        return
      }

      setTabRows(prev => ({ ...prev, [tab]: parsed }))
    } catch {
      setParseError('Could not read the file. Make sure it is a valid .xlsx file.')
    }
  }, [tab, cfg.sheetName])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) parseFile(file)
  }

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!hasRows) return
    setImporting(true)
    setResult(null)
    try {
      const r = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await r.json()
      setResult(data)
    } catch {
      setResult({ created: {}, existing: {}, skipped: [], error: 'Network error — please try again.' })
    } finally {
      setImporting(false)
    }
  }

  const clearFile = () => {
    setTabRows(prev => ({ ...prev, [tab]: [] }))
    setResult(null)
    setParseError('')
  }

  const switchTab = (t: Tab) => {
    setTab(t)
    setResult(null)
    setParseError('')
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Import Master Data</h1>
          <p className="text-sm text-gray-500 mt-0.5">Bulk-create masters from a single Excel workbook</p>
        </div>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 text-sm px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-gray-700"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download Template
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_CONFIG[t].label}
            {tabRows[t].length > 0 && tab !== t && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-blue-100 text-blue-600">
                {tabRows[t].length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Hint */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-sm text-blue-800">
        {cfg.hint}
      </div>

      {/* Upload zone */}
      {!hasRows && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
          }`}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                Drop your .xlsx file here or <span className="text-blue-600">browse</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Must contain a <strong>&quot;{cfg.sheetName}&quot;</strong> sheet — use the template above
              </p>
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFileInput} className="hidden" />
        </div>
      )}

      {/* Parse error */}
      {parseError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {parseError}
        </div>
      )}

      {/* Preview table */}
      {hasRows && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-600">
              <span className="font-medium">{rows.length}</span> rows parsed
              {rows.length > 20 && <span className="text-gray-400"> — showing first 20</span>}
            </p>
            <button onClick={clearFile} className="text-sm text-gray-500 hover:text-red-500 transition-colors">
              × Clear file
            </button>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-3 py-2.5 text-xs font-normal text-gray-500 uppercase tracking-wide w-12">#</th>
                    {cfg.cols.map(c => (
                      <th key={c} className="text-left px-3 py-2.5 text-xs font-normal text-gray-500 uppercase tracking-wide whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400 text-xs">{i + 2}</td>
                      {cfg.cols.map(c => (
                        <td key={c} className="px-3 py-2 text-gray-700 truncate max-w-[180px]">
                          {row[c] || <span className="text-gray-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {!result && (
            <button
              onClick={handleImport}
              disabled={importing}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {importing ? 'Importing…' : `Import ${rows.length} rows`}
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="mt-4 space-y-3">
          {result.error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {result.error}
            </div>
          )}

          {!result.error && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
              <p className="text-sm font-medium text-green-800 mb-2">Import complete</p>
              <div className="space-y-1">
                {Object.entries(result.created).map(([key, count]) => (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    <span className="text-green-600">✓</span>
                    <span className="capitalize text-gray-700 font-medium w-32">{key}:</span>
                    <span className="text-green-700 font-medium">{count} created</span>
                    {(result.existing[key] ?? 0) > 0 && (
                      <span className="text-gray-400">({result.existing[key]} already existed)</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.skipped && result.skipped.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-sm font-medium text-amber-800 mb-2">
                {result.skipped.length} row{result.skipped.length !== 1 ? 's' : ''} skipped
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {result.skipped.map((s, i) => (
                  <div key={i} className="text-sm text-amber-700">
                    Row {s.row}: {s.reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={clearFile}
            className="w-full py-2 border border-gray-300 text-sm text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  )
}
