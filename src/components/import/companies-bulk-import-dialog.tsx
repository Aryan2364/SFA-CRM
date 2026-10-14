'use client'

import { useRef, useState } from 'react'
import { CircleCheckIcon, DownloadIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon, UploadIcon } from 'lucide-react'
import { Banner, BannerAction, BannerDescription, BannerTitle } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { Truncate } from '@/components/ui/truncate'
import { ImportReview, initialFilter, type ReviewFilter } from '@/components/import/import-review'
import { downloadRejectedRows, rejectedFileName } from '@/components/import/rejected-rows'
import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'
import { fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { IMPORT_MAX_ROWS, matchColumns, type ImportResponse, type RawRow } from '@/lib/bulk-import'
import { COMPANY_COLUMNS, COMPANY_SHEET } from '@/app/api/companies/bulk-import/_columns'

type ParsedFile = { name: string; sheet: string; headers: string[]; rows: RawRow[] }

const MAX_FILE_BYTES = 5 * 1024 * 1024
/** Section 14 rule 4: every request carries a deadline. */
const PARSE_TIMEOUT_MS = 60_000
const CHECK_TIMEOUT_MS = 60_000
/** Companies insert one per row, so a full file takes longer than a check. */
const IMPORT_TIMEOUT_MS = 300_000
/** Shown beside each verdict so a row can be recognised without the file. */
const KEY_COLUMNS = ['Name', 'Kind', 'Mobile 1', 'GST Number', 'State']
const PERM_REASON = 'Only someone who can create companies can import them'

async function withDeadline(input: string, init: RequestInit, ms: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const r = await fetch(input, { ...init, signal: controller.signal })
    return { ok: r.ok, data: await r.json().catch(() => null) }
  } finally {
    clearTimeout(timer)
  }
}

const isResponse = (d: unknown): d is ImportResponse =>
  !!d && typeof d === 'object' && Array.isArray((d as ImportResponse).rows) && !!(d as ImportResponse).counts

/**
 * Bulk Upload Companies: template → choose file → automatic check → review →
 * import → result, all on the shared importer contract (`@/lib/bulk-import`).
 *
 * The confirmation is a step inside this dialog, not a second dialog on top
 * of it (section 24: never open a dialog from inside a dialog). Import is
 * gated on `companies.create`, the action `bulk-parse` and `bulk-import`
 * check, read from /api/auth/me — never a role name.
 */
export function CompaniesBulkImportDialog({ open, onOpenChange, onImported }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a commit that created at least one company. */
  onImported: () => void
}) {
  const me = useMe()
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<ParsedFile | null>(null)
  const [busy, setBusy] = useState<'reading' | 'checking' | 'importing' | null>(null)
  const [check, setCheck] = useState<ImportResponse | null>(null)
  const [result, setResult] = useState<ImportResponse | null>(null)
  const [fileError, setFileError] = useState('')
  const [importError, setImportError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [filter, setFilter] = useState<ReviewFilter>('all')

  const known = me !== null
  const allowed = !!me?.permissions?.companies?.create

  const reset = () => {
    setFile(null); setBusy(null); setCheck(null); setResult(null)
    setFileError(''); setImportError(''); setConfirming(false); setFilter('all')
  }

  const close = (next: boolean) => {
    // An import in flight is not abandoned by a stray click on the backdrop.
    if (!next && busy === 'importing') return
    if (!next) reset()
    onOpenChange(next)
  }

  const downloadTemplate = async () => {
    try {
      const res = await fetch('/api/companies/bulk-template')
      if (!res.ok) { toast('The template could not be generated. Try again.', 'error'); return }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'companies_template.xlsx'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 0)
    } catch {
      toast('The template could not be downloaded. Check your connection, then try again.', 'error')
    }
  }

  const handleFile = async (picked: File) => {
    reset()
    if (!/\.xlsx$/i.test(picked.name)) { setFileError('Upload an .xlsx file. Download the template if you need one.'); return }
    if (picked.size > MAX_FILE_BYTES) { setFileError('This file is larger than 5 MB. Split it into smaller files, then upload each one.'); return }

    setBusy('reading')
    try {
      const fd = new FormData()
      fd.append('file', picked)
      const parsed = await withDeadline('/api/companies/bulk-parse', { method: 'POST', body: fd }, PARSE_TIMEOUT_MS)
      if (!parsed.ok || !Array.isArray(parsed.data?.rows)) {
        setBusy(null); setFileError(parsed.data?.error ?? 'This file could not be read. Try again.'); return
      }
      if (parsed.data.rows.length === 0) {
        setBusy(null); setFileError('The sheet has no data rows below the header row.'); return
      }
      const next: ParsedFile = {
        name: picked.name, sheet: parsed.data.sheet ?? COMPANY_SHEET, headers: parsed.data.headers ?? [], rows: parsed.data.rows,
      }
      setFile(next)

      // The check runs straight away: it writes nothing.
      setBusy('checking')
      const checked = await withDeadline('/api/companies/bulk-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'validate', rows: next.rows }),
      }, CHECK_TIMEOUT_MS)
      setBusy(null)
      if (checked.ok && isResponse(checked.data)) { setCheck(checked.data); setFilter(initialFilter(checked.data)) }
      else setFileError(checked.data?.error ?? 'The file could not be checked. Try again.')
    } catch {
      setBusy(null)
      setFileError('The server did not answer. Check your connection, then choose the file again.')
    }
  }

  const handleImport = async () => {
    if (!file) return
    setConfirming(false)
    setImportError('')
    setBusy('importing')
    try {
      const { ok, data } = await withDeadline('/api/companies/bulk-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'commit', rows: file.rows }),
      }, IMPORT_TIMEOUT_MS)
      if (ok && isResponse(data)) {
        setResult(data)
        setFilter(initialFilter(data))
        const n = data.counts.created
        if (n > 0) {
          toast(`${fmtNumber(n)} compan${n === 1 ? 'y' : 'ies'} imported${data.counts.skipped ? `; ${fmtNumber(data.counts.skipped)} skipped` : ''}`,
            data.counts.skipped ? 'warning' : 'success')
          // §10: an Individual row imports with no Self contact yet.
          if ((data as ImportResponse & { message?: string }).message) {
            toast((data as ImportResponse & { message?: string }).message!, 'warning')
          }
          onImported()
        }
      } else {
        setImportError(data?.error ?? 'The import did not finish. Try again.')
      }
    } catch {
      // Companies insert one per row, so some may have landed. Re-checking
      // the file matches those by GST Number or mobile — or by name, for a
      // row with neither — and reports them as "Already exists".
      setImportError('The server did not confirm the import, so some rows may already be in. Choose the same file again: rows already imported are matched by GST Number or mobile (or by name, for a row with neither), show as "Already exists", and are not imported twice.')
    } finally {
      setBusy(null)
    }
  }

  const downloadRejected = async (res: ImportResponse) => {
    if (!file) return
    await downloadRejectedRows({
      sheetName: COMPANY_SHEET,
      fileName: rejectedFileName(file.name),
      headers: file.headers,
      sourceRows: file.rows,
      verdicts: res.rows,
    })
  }

  const shown = result ?? check
  const skipped = shown?.counts.skipped ?? 0
  const ready = check?.counts.ready ?? 0
  const mapping = file ? matchColumns(file.headers, COMPANY_COLUMNS).mapping : {}
  const reviewColumns = KEY_COLUMNS.map(label => ({ label, header: mapping[label] }))

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Bulk upload companies</DialogTitle>
          <DialogDescription>
            Every row is checked before anything is imported. Good rows are imported; rows with problems are skipped and listed.
          </DialogDescription>
        </DialogHeader>

        {/* One scroller only: the review table owns the scroll, so the body
            does not scroll around it (section 1 rule 8). */}
        <DialogBody className={cn('flex flex-col gap-4', shown && 'overflow-hidden')}>
          {!shown && (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-body font-medium text-text-primary">1. Download the template</p>
                <p className="text-label text-text-secondary">
                  Dropdowns for Type, State, District, Taluka, Stage and Temperature, filled from your masters.
                </p>
                <div>
                  <Button variant="secondary" onClick={downloadTemplate} className="min-h-11 w-full sm:min-h-0 sm:w-auto">
                    <DownloadIcon />
                    Download template
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-body font-medium text-text-primary">2. Upload the filled file</p>
                <div className={cn(
                  'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-center',
                  allowed ? 'border-border' : 'border-border-light bg-surface-sunken',
                )}>
                  <UploadIcon className={cn('size-6', allowed ? 'text-text-secondary' : 'text-text-muted')} />
                  <p className="text-label text-text-secondary">
                    .xlsx only, up to 5 MB and {fmtNumber(IMPORT_MAX_ROWS)} rows. Columns are matched by their header, so their order does not matter.
                  </p>
                  <PermissionTooltip allowed={!known || allowed} reason={PERM_REASON}>
                    <Button
                      variant="secondary"
                      disabled={!allowed || busy !== null}
                      onClick={() => fileRef.current?.click()}
                      className="min-h-11 sm:min-h-0"
                    >
                      {busy === 'reading' ? 'Reading file…' : busy === 'checking' ? 'Checking…' : 'Choose file'}
                    </Button>
                  </PermissionTooltip>
                  <input
                    ref={fileRef} type="file" accept=".xlsx" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f) }}
                  />
                </div>
              </div>

              {busy && busy !== 'importing' && (
                <div className="flex flex-col gap-2" aria-busy="true" aria-label="Checking your file">
                  {[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              )}

              {fileError && (
                <Banner variant="danger">
                  <OctagonXIcon />
                  <BannerTitle>This file cannot be imported</BannerTitle>
                  <BannerDescription>{fileError}</BannerDescription>
                </Banner>
              )}
            </>
          )}

          {file && shown && (
            <>
              <div className="flex shrink-0 flex-col gap-1">
                <p className="text-body font-medium text-text-primary"><Truncate>{file.name}</Truncate></p>
                <p className="text-label text-text-secondary">
                  {result
                    ? `${fmtNumber(result.counts.created)} of ${fmtNumber(result.total)} rows were imported.`
                    : `${fmtNumber(ready)} of ${fmtNumber(shown.total)} rows are ready and will be imported` +
                      (skipped ? `; ${fmtNumber(skipped)} with problems will be skipped.` : '.')}
                </p>
              </div>

              {result && (
                result.counts.created > 0 ? (
                  <Banner variant="success" className="shrink-0">
                    <CircleCheckIcon />
                    <BannerTitle>{fmtNumber(result.counts.created)} compan{result.counts.created === 1 ? 'y' : 'ies'} imported</BannerTitle>
                    {skipped > 0 && (
                      <BannerDescription>
                        {fmtNumber(skipped)} row{skipped === 1 ? ' was' : 's were'} skipped. Download them, fix the cells named in Problem, then upload that same file.
                      </BannerDescription>
                    )}
                  </Banner>
                ) : (
                  <Banner variant={skipped ? 'warning' : 'neutral'} className="shrink-0">
                    {skipped ? <TriangleAlertIcon /> : <InfoIcon />}
                    <BannerTitle>Nothing was imported</BannerTitle>
                  </Banner>
                )
              )}

              {!result && ready === 0 && (
                <Banner variant={skipped ? 'warning' : 'neutral'} className="shrink-0">
                  {skipped ? <TriangleAlertIcon /> : <InfoIcon />}
                  <BannerTitle>{skipped ? 'No row can be imported yet' : 'Nothing new to import'}</BannerTitle>
                  <BannerDescription>
                    {skipped
                      ? 'Download the rows to fix, correct the cells named in Problem, then upload that same file.'
                      : 'Every row in this file matches a company that is already in the system.'}
                  </BannerDescription>
                </Banner>
              )}

              {importError && (
                <Banner variant="danger" className="shrink-0">
                  <OctagonXIcon />
                  <BannerTitle>The import did not finish</BannerTitle>
                  <BannerDescription>{importError}</BannerDescription>
                  <BannerAction>
                    <Button variant="secondary" size="sm" onClick={reset}>Choose the file again</Button>
                  </BannerAction>
                </Banner>
              )}

              {shown.unrecognisedColumns.length > 0 && (
                <Banner variant="warning" className="shrink-0">
                  <TriangleAlertIcon />
                  <BannerTitle>Some columns are ignored</BannerTitle>
                  <BannerDescription>
                    {shown.unrecognisedColumns.map(c => `"${c}"`).join(', ')} did not match any template column, so those values are not imported.
                  </BannerDescription>
                </Banner>
              )}

              <ImportReview
                className="flex-1"
                response={shown}
                sourceRows={file.rows}
                columns={reviewColumns}
                filter={filter}
                onFilterChange={setFilter}
              />
            </>
          )}
        </DialogBody>

        <DialogFooter className="flex-wrap">
          {confirming ? (
            <>
              <p className="mr-auto text-body text-text-primary">
                Import {fmtNumber(ready)} compan{ready === 1 ? 'y' : 'ies'}?{skipped ? ` ${fmtNumber(skipped)} will be skipped.` : ''}
              </p>
              <Button variant="secondary" onClick={() => setConfirming(false)}>Back</Button>
              <Button onClick={handleImport}>Import {fmtNumber(ready)} compan{ready === 1 ? 'y' : 'ies'}</Button>
            </>
          ) : (
            <>
              {skipped > 0 && shown && (
                <Button variant="secondary" onClick={() => downloadRejected(shown)} className="sm:mr-auto">
                  <DownloadIcon />
                  Download {fmtNumber(skipped)} row{skipped === 1 ? '' : 's'} to fix
                </Button>
              )}
              {check && !result && (
                <Button variant="secondary" onClick={reset} disabled={busy === 'importing'}>Choose another file</Button>
              )}
              {result || !check ? (
                <Button variant={result ? 'primary' : 'secondary'} onClick={() => close(false)}>
                  {result ? 'Done' : 'Cancel'}
                </Button>
              ) : (
                <PermissionTooltip allowed={!known || allowed} reason={PERM_REASON}>
                  <Button onClick={() => setConfirming(true)} disabled={!allowed || ready === 0 || busy === 'importing'}>
                    <UploadIcon />
                    {busy === 'importing' ? 'Importing…' : `Import ${fmtNumber(ready)} ready row${ready === 1 ? '' : 's'}`}
                  </Button>
                </PermissionTooltip>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
