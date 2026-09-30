'use client'

import { useCallback, useRef, useState } from 'react'
import {
  CircleCheckIcon, DownloadIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon, UploadIcon,
} from 'lucide-react'
import { Banner, BannerAction, BannerDescription, BannerTitle } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Truncate } from '@/components/ui/truncate'
import { ImportReview, initialFilter, type ReviewFilter } from '@/components/import/import-review'
import { ImportConfirmDialog } from '@/components/import/import-confirm-dialog'
import { downloadRejectedRows, rejectedFileName } from '@/components/import/rejected-rows'
import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'
import { fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { LOCATION_COLUMNS, PRODUCT_COLUMNS } from '@/app/api/masters/import/_columns'
import {
  IMPORT_MAX_ROWS, ROW_NUMBER_KEY, ambiguousColumnsMessage, duplicateHeaders, duplicateHeadersMessage,
  matchColumns, missingColumnsMessage,
  type ImportColumn, type ImportResponse, type RawRow,
} from '@/lib/bulk-import'

type Tab = 'locations' | 'products'

type ParsedFile = { name: string; headers: string[]; rows: RawRow[] }

/**
 * One tab's import, start to finish. `check` is the server's dry run and
 * `result` its commit — the same response shape, drawn by the same table.
 */
type TabState = {
  file: ParsedFile | null
  busy: 'checking' | 'importing' | null
  check: ImportResponse | null
  result: ImportResponse | null
  /** A problem with the file itself: nothing in it can be imported as it is. */
  fileError: string
  /** The import itself did not finish; the check still stands and it can be retried. */
  importError: string
  filter: ReviewFilter
}

const EMPTY_TAB: TabState = {
  file: null, busy: null, check: null, result: null, fileError: '', importError: '', filter: 'all',
}

/** Checked here too, so a large file is refused before anything is read. */
const MAX_FILE_BYTES = 5 * 1024 * 1024
/** Section 14 rule 4: every request carries a deadline. */
const CHECK_TIMEOUT_MS = 60_000
const IMPORT_TIMEOUT_MS = 120_000

const TAB_CONFIG: Record<Tab, {
  label: string
  sheetName: string
  endpoint: string
  columns: ImportColumn[]
  noun: string
  hint: string
  /** The permission the route checks, read from /api/auth/me. */
  permSection: 'states' | 'products'
  permReason: string
}> = {
  locations: {
    label: 'Locations',
    sheetName: 'Locations',
    endpoint: '/api/masters/import/locations',
    columns: LOCATION_COLUMNS,
    noun: 'location rows',
    hint: 'State → District → Taluka → Village. Leave the right-hand columns empty to create only up to that level. Names that already exist are matched, never duplicated or renamed.',
    permSection: 'states',
    permReason: 'Only someone who can edit States can import locations',
  },
  products: {
    label: 'Products',
    sheetName: 'Products',
    endpoint: '/api/masters/import/products',
    columns: PRODUCT_COLUMNS,
    noun: 'product rows',
    hint: 'Category → Sub-Category → Product. Leave Product Name empty to create only the higher levels. A product needs a Sub-Category and a Price; SKU is optional. A product that already exists is left as it is, price included.',
    permSection: 'products',
    permReason: 'Only someone who can edit Products can import products',
  },
}

const TABS = Object.keys(TAB_CONFIG) as Tab[]

async function postWithDeadline(url: string, body: unknown, ms: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await r.json().catch(() => null)
    return { ok: r.ok, data }
  } finally {
    clearTimeout(timer)
  }
}

const isResponse = (d: unknown): d is ImportResponse =>
  !!d && typeof d === 'object' && Array.isArray((d as ImportResponse).rows) && !!(d as ImportResponse).counts

export default function MastersImportPage() {
  const me = useMe()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('locations')
  const [state, setState] = useState<Record<Tab, TabState>>({ locations: EMPTY_TAB, products: EMPTY_TAB })
  const [parseError, setParseError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const cfg = TAB_CONFIG[tab]
  const s = state[tab]
  const patch = useCallback((t: Tab, p: Partial<TabState>) =>
    setState(prev => ({ ...prev, [t]: { ...prev[t], ...p } })), [])

  // "Not known yet" is not "not allowed": disabled while /me loads, with a
  // reason only once the answer has landed.
  const known = me !== null
  const allowed = !!me?.permissions?.[cfg.permSection]?.edit

  // ── Template download ─────────────────────────────────────────────────────
  const downloadTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()

    const locationHeaders = [{ header: 'State', width: 20 }, { header: 'District', width: 20 }, { header: 'Taluka', width: 20 }, { header: 'Village', width: 20 }]
    const productHeaders = [{ header: 'Category', width: 20 }, { header: 'Sub-Category', width: 20 }, { header: 'Product Name', width: 25 }, { header: 'Price', width: 10 }, { header: 'SKU', width: 12 }]
    // The data sheets carry headers only. An example row there would be
    // imported like any other if the user left it in, so the examples live on
    // a separate sheet the importer never reads.
    const addSheet = (name: string, headers: { header: string; width: number }[]) => {
      const ws = wb.addWorksheet(name)
      ws.columns = headers.map(h => ({ header: h.header, key: h.header, width: h.width }))
      ws.getRow(1).font = { bold: true }
    }
    addSheet('Locations', locationHeaders)
    addSheet('Products', productHeaders)

    const notes = wb.addWorksheet('How to fill')
    notes.columns = [{ width: 24 }, { width: 20 }, { width: 25 }, { width: 20 }, { width: 12 }]
    const note = (cells: (string | number)[], bold = false) => { notes.addRow(cells).font = { bold } }
    note(['Fill in the Locations and Products sheets. This sheet is never imported.'], true)
    note([])
    note(['Locations'], true)
    note([TAB_CONFIG.locations.hint])
    note(locationHeaders.map(h => h.header), true)
    ;[['Maharashtra', 'Pune', 'Haveli', 'Hadapsar'], ['Maharashtra', 'Pune', 'Haveli', 'Kharadi'], ['Maharashtra', 'Nagpur', '', ''], ['Karnataka', '', '', '']]
      .forEach(r => note(r))
    note([])
    note(['Products'], true)
    note([TAB_CONFIG.products.hint])
    note(productHeaders.map(h => h.header), true)
    ;[['Electronics', 'Smartphones', 'iPhone 15', 79999, 'IPH15'], ['Electronics', 'Smartphones', 'Samsung S24', 69999, 'SS24'], ['Electronics', '', '', '', ''], ['Apparel', 'Shirts', 'Cotton Shirt', 599, 'SH001']]
      .forEach(r => note(r))

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'masters-import-template.xlsx'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 0)
  }

  // ── Check (dry run) ───────────────────────────────────────────────────────
  const runCheck = useCallback(async (t: Tab, file: ParsedFile) => {
    patch(t, { file, busy: 'checking', check: null, result: null, fileError: '', importError: '' })
    try {
      const { ok, data } = await postWithDeadline(TAB_CONFIG[t].endpoint, { mode: 'validate', rows: file.rows }, CHECK_TIMEOUT_MS)
      if (ok && isResponse(data)) patch(t, { busy: null, check: data, filter: initialFilter(data) })
      else patch(t, { busy: null, fileError: data?.error ?? 'The file could not be checked. Try again.' })
    } catch {
      patch(t, { busy: null, fileError: 'The file could not be checked: the server did not answer. Check your connection, then choose the file again.' })
    }
  }, [patch])

  // ── File parsing ──────────────────────────────────────────────────────────
  const parseFile = useCallback(async (file: File) => {
    setParseError('')
    if (!/\.xlsx$/i.test(file.name)) {
      setParseError('Upload an .xlsx file. Download the template above if you need one.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setParseError('This file is larger than 5 MB. Split it into smaller files, then upload each one.')
      return
    }

    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(await file.arrayBuffer())

      const ws = wb.getWorksheet(cfg.sheetName)
      if (!ws) {
        setParseError(`This file has no "${cfg.sheetName}" sheet. Use the template, or rename the sheet to "${cfg.sheetName}".`)
        return
      }

      // First row is headers. `.text` rather than `.values`: a rich-text,
      // formula or hyperlink cell is an object, and String() of one is
      // "[object Object]".
      const headerRow = ws.getRow(1)
      const headers: string[] = []
      for (let c = 1; c <= headerRow.cellCount; c++) headers.push(headerRow.getCell(c).text.trim())

      // Rows are keyed by header text, so a repeated header would let the
      // later column overwrite the earlier one's value.
      const dups = duplicateHeaders(headers)
      if (dups.length > 0) { setParseError(duplicateHeadersMessage(dups)); return }

      // Checked here, before anything is uploaded, with the server's own rule.
      const match = matchColumns(headers, cfg.columns)
      if (match.missing.length > 0) { setParseError(missingColumnsMessage(match, cfg.columns, headers)); return }
      if (match.ambiguous.length > 0) { setParseError(ambiguousColumnsMessage(match)); return }

      const rows: RawRow[] = []
      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return
        // The sheet's own row number travels with the row: eachRow skips
        // blank rows, so a position in this array is not a row number.
        const obj: RawRow = { [ROW_NUMBER_KEY]: String(rowNum) }
        headers.forEach((h, i) => { if (h) obj[h] = row.getCell(i + 1).text.trim() })
        rows.push(obj)
      })

      if (rows.length === 0) { setParseError('The sheet is empty. Add data rows below the header row.'); return }
      if (rows.length > IMPORT_MAX_ROWS) {
        setParseError(`This sheet has ${fmtNumber(rows.length)} rows; the limit is ${fmtNumber(IMPORT_MAX_ROWS)} per import. Split it into smaller files, then upload each one.`)
        return
      }

      // The check runs straight away: it writes nothing.
      await runCheck(tab, { name: file.name, headers: headers.filter(Boolean), rows })
    } catch {
      setParseError('This file could not be read. Save it as an Excel workbook (.xlsx), then upload it again.')
    }
  }, [tab, cfg.sheetName, cfg.columns, runCheck])

  const openPicker = () => { if (allowed) fileRef.current?.click() }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!allowed) return
    const file = e.dataTransfer.files?.[0]
    if (file) parseFile(file)
  }

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    setConfirming(false)
    const t = tab
    const file = s.file
    if (!file) return
    patch(t, { busy: 'importing', importError: '' })
    try {
      const { ok, data } = await postWithDeadline(TAB_CONFIG[t].endpoint, { mode: 'commit', rows: file.rows }, IMPORT_TIMEOUT_MS)
      if (ok && isResponse(data)) {
        patch(t, { busy: null, result: data, filter: initialFilter(data) })
        const n = data.counts.created
        if (n > 0) {
          toast(
            `${fmtNumber(n)} row${n === 1 ? '' : 's'} imported${data.counts.skipped ? `; ${fmtNumber(data.counts.skipped)} skipped` : ''}`,
            data.counts.skipped ? 'warning' : 'success',
          )
        }
      } else {
        patch(t, { busy: null, importError: data?.error ?? 'The import did not finish and nothing was imported. Try again.' })
      }
    } catch {
      patch(t, {
        busy: null,
        importError: 'The server did not confirm the import. Check your connection, then choose the file again to see what was imported: rows already in the system are matched, never duplicated.',
      })
    }
  }

  const downloadRejected = async (res: ImportResponse) => {
    if (!s.file) return
    await downloadRejectedRows({
      sheetName: cfg.sheetName,
      fileName: rejectedFileName(s.file.name),
      headers: s.file.headers,
      sourceRows: s.file.rows,
      verdicts: res.rows,
    })
  }

  const clearFile = () => { patch(tab, EMPTY_TAB); setParseError('') }

  const switchTab = (t: Tab) => { setTab(t); setParseError('') }

  // Which header in the file supplies each column, for the review table.
  const reviewColumns = (file: ParsedFile) => {
    const mapping = matchColumns(file.headers, cfg.columns).mapping
    return cfg.columns.map(c => ({ label: c.label, header: mapping[c.label] }))
  }

  const shown = s.result ?? s.check
  const skipped = shown?.counts.skipped ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header — pinned: only the table below scrolls. */}
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page-title font-medium text-text-primary">Import Master Data</h1>
          <p className="text-meta text-text-muted">Bulk-create masters from one Excel workbook</p>
        </div>
        <Button variant="secondary" onClick={downloadTemplate} className="min-h-11 w-full sm:min-h-0 sm:w-auto">
          <DownloadIcon />
          Download template
        </Button>
      </div>

      <Tabs value={tab} onValueChange={v => switchTab(v as Tab)} className="shrink-0">
        <TabsList>
          {TABS.map(t => (
            <TabsTrigger key={t} value={t}>{TAB_CONFIG[t].label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <p className="shrink-0 text-body text-text-secondary">{cfg.hint}</p>

      {known && !allowed && (
        <Banner variant="neutral" className="shrink-0">
          <InfoIcon />
          <BannerTitle>{cfg.permReason}</BannerTitle>
          <BannerDescription>Ask an administrator for that permission, or for someone who has it to run this import.</BannerDescription>
        </Banner>
      )}

      {/* ── Upload ─────────────────────────────────────────────────────── */}
      {!s.file && (
        <div
          role="button"
          tabIndex={allowed ? 0 : -1}
          aria-disabled={!allowed || undefined}
          aria-label={`Choose an .xlsx file with a "${cfg.sheetName}" sheet`}
          onDragOver={e => { e.preventDefault(); if (allowed) setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={openPicker}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker() } }}
          className={cn(
            'shrink-0 rounded-xl border-2 border-dashed p-8 text-center transition-colors outline-none',
            'focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring',
            !allowed
              ? 'cursor-default border-border-light bg-surface-sunken'
              : dragOver
                ? 'cursor-pointer border-primary-border bg-primary-subtle'
                : 'cursor-pointer border-border hover:border-primary-border hover:bg-surface-sunken',
          )}
        >
          <div className="flex flex-col items-center gap-3">
            <UploadIcon className={cn('size-6', allowed ? 'text-text-secondary' : 'text-text-muted')} />
            <div>
              <p className={cn('text-body font-medium', allowed ? 'text-text-primary' : 'text-text-muted')}>
                Drop your .xlsx file here, or choose one
              </p>
              <p className="mt-1 text-label text-text-secondary">
                .xlsx only, up to 5 MB and {fmtNumber(IMPORT_MAX_ROWS)} rows, with a &quot;{cfg.sheetName}&quot; sheet. The file is checked before anything is imported.
              </p>
            </div>
            <PermissionTooltip allowed={!known || allowed} reason={cfg.permReason}>
              <Button variant="secondary" size="sm" disabled={!allowed} tabIndex={-1} className="min-h-11 sm:min-h-0">
                Choose file
              </Button>
            </PermissionTooltip>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx" onChange={handleFileInput} className="hidden" />
        </div>
      )}

      {parseError && (
        <Banner variant="danger" className="shrink-0">
          <OctagonXIcon />
          <BannerTitle>This file cannot be imported</BannerTitle>
          <BannerDescription>{parseError}</BannerDescription>
        </Banner>
      )}

      {/* ── Checking ───────────────────────────────────────────────────── */}
      {s.file && s.busy === 'checking' && (
        <div className="flex shrink-0 flex-col gap-3" aria-busy="true" aria-label="Checking your file">
          <p className="text-body text-text-secondary">Checking {s.file.name}…</p>
          <div className="flex gap-2">
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-control-sm w-28" />)}
          </div>
          {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {s.file && s.fileError && (
        <Banner variant="danger" className="shrink-0">
          <OctagonXIcon />
          <BannerTitle>This file cannot be imported</BannerTitle>
          <BannerDescription>{s.fileError}</BannerDescription>
          <BannerAction>
            <Button variant="secondary" size="sm" onClick={clearFile}>Choose another file</Button>
          </BannerAction>
        </Banner>
      )}

      {/* ── Checked / imported ─────────────────────────────────────────── */}
      {s.file && shown && (
        <>
          <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-body font-medium text-text-primary"><Truncate>{s.file.name}</Truncate></p>
              <p className="text-label text-text-secondary">
                {s.result
                  ? `Imported. ${fmtNumber(s.result.counts.created)} of ${fmtNumber(s.result.total)} rows were written.`
                  : `${fmtNumber(shown.counts.ready)} of ${fmtNumber(shown.total)} rows are ready and will be imported` +
                    (skipped ? `; ${fmtNumber(skipped)} with problems will be skipped.` : '.')}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {skipped > 0 && (
                <Button variant="secondary" onClick={() => downloadRejected(shown)} className="min-h-11 sm:min-h-0">
                  <DownloadIcon />
                  Download {fmtNumber(skipped)} row{skipped === 1 ? '' : 's'} to fix
                </Button>
              )}
              {s.result ? (
                <Button onClick={clearFile} className="min-h-11 sm:min-h-0">Import another file</Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={clearFile} disabled={s.busy === 'importing'} className="min-h-11 sm:min-h-0">
                    Choose another file
                  </Button>
                  <PermissionTooltip allowed={!known || allowed} reason={cfg.permReason}>
                    <Button
                      onClick={() => setConfirming(true)}
                      disabled={!allowed || shown.counts.ready === 0 || s.busy === 'importing'}
                      className="min-h-11 w-full sm:min-h-0 sm:w-auto"
                    >
                      <UploadIcon />
                      {s.busy === 'importing'
                        ? 'Importing…'
                        : `Import ${fmtNumber(shown.counts.ready)} ready row${shown.counts.ready === 1 ? '' : 's'}`}
                    </Button>
                  </PermissionTooltip>
                </>
              )}
            </div>
          </div>

          {s.importError && (
            <Banner variant="danger" className="shrink-0">
              <OctagonXIcon />
              <BannerTitle>Nothing was imported</BannerTitle>
              <BannerDescription>{s.importError}</BannerDescription>
            </Banner>
          )}

          {s.result && <ResultBanner result={s.result} />}

          {!s.result && shown.counts.ready === 0 && (
            <Banner variant={skipped ? 'warning' : 'neutral'} className="shrink-0">
              {skipped ? <TriangleAlertIcon /> : <InfoIcon />}
              <BannerTitle>{skipped ? 'No row can be imported yet' : 'Nothing new to import'}</BannerTitle>
              <BannerDescription>
                {skipped
                  ? 'Download the rows to fix, correct the cells named in Problem, then upload that same file.'
                  : 'Every row in this file is already in the system, so there is nothing to create.'}
              </BannerDescription>
            </Banner>
          )}

          {shown.unrecognisedColumns.length > 0 && (
            <Banner variant="warning" className="shrink-0">
              <TriangleAlertIcon />
              <BannerTitle>Some columns are ignored</BannerTitle>
              <BannerDescription>
                {shown.unrecognisedColumns.map(c => `"${c}"`).join(', ')} did not match any of{' '}
                {cfg.columns.map(c => c.label).join(', ')}, so those values are not imported.
                If one of them holds one of these, rename its header to match the template.
              </BannerDescription>
            </Banner>
          )}

          <ImportReview
            className="flex-1"
            response={shown}
            sourceRows={s.file.rows}
            columns={reviewColumns(s.file)}
            filter={s.filter}
            onFilterChange={f => patch(tab, { filter: f })}
          />
        </>
      )}

      <ImportConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        ready={s.check?.counts.ready ?? 0}
        skipped={s.check?.counts.skipped ?? 0}
        noun={cfg.noun}
        onConfirm={handleImport}
      />
    </div>
  )
}

/**
 * Success only when something was created. Everything-already-existed is
 * neutral, and a result that wrote nothing is never "Import complete".
 */
function ResultBanner({ result }: { result: ImportResponse }) {
  const created = result.created ?? {}
  const existing = result.existing ?? {}
  const createdTotal = Object.values(created).reduce((a, b) => a + b, 0)
  const counts = (
    <ul className="mt-2 space-y-1">
      {Object.entries(created).map(([key, count]) => (
        <li key={key}>
          <span className="capitalize font-medium">{key}:</span> {fmtNumber(count)} created
          {(existing[key] ?? 0) > 0 && <> ({fmtNumber(existing[key])} already existed)</>}
        </li>
      ))}
    </ul>
  )
  const skipped = result.counts.skipped
  const skippedLine = skipped > 0 && (
    <p>{fmtNumber(skipped)} row{skipped === 1 ? ' was' : 's were'} skipped. Download them, fix the cells named in Problem, then upload that same file.</p>
  )

  if (createdTotal > 0) {
    return (
      <Banner variant="success" className="shrink-0">
        <CircleCheckIcon />
        <BannerTitle>Import complete</BannerTitle>
        <BannerDescription>{skippedLine}{counts}</BannerDescription>
      </Banner>
    )
  }
  return (
    <Banner variant={skipped ? 'warning' : 'neutral'} className="shrink-0">
      {skipped ? <TriangleAlertIcon /> : <InfoIcon />}
      <BannerTitle>{skipped ? 'Nothing new was imported' : 'Nothing new to import'}</BannerTitle>
      <BannerDescription>
        {skippedLine || <p>Every name in this file already exists, so nothing was created.</p>}
        {counts}
      </BannerDescription>
    </Banner>
  )
}
