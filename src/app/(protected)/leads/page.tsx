'use client'

import { useState, useEffect, useRef } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon, UploadIcon } from 'lucide-react'

import Modal from '@/components/ui/Modal'
import { useMe } from '@/hooks/useMe'
import { useBPForm, BusinessPartnerFormFields } from '@/components/masters/BusinessPartnerForm'
import { useToast } from '@/contexts/ToastContext'
import {
  LEAD_STAGE,
  LEAD_TEMPERATURE,
  StatusBadge,
} from '@/components/status-badge'
import {
  ListPage,
  type ListColumn,
  type ListFilter,
  type ListPageProps,
} from '@/components/templates/list-page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type LeadRow = {
  id: string
  name: string
  type: string | null
  mobile_1: string | null
  stage: string | null
  temperature: string | null
  next_follow_up_date: string | null
  is_active: boolean | null
  districts: { name: string } | null
  talukas: { name: string } | null
  created_by: { name: string } | null
}

/*
 * Section 27.1: the tooltip on the search field carries the full list of
 * fields the box covers, so nobody concludes a record does not exist
 * when they simply searched a field the box does not reach.
 *
 * `/api/leads` matches on `name` and nothing else. That is the route as
 * it stands and this conversion did not change the server, so the hint
 * states the truth rather than the ambition — see the report.
 */
const SEARCH_HINT = 'Searches the lead name. Type, place, stage and temperature are filters.'

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function place(lead: LeadRow) {
  const district = lead.districts?.name
  const taluka = lead.talukas?.name
  if (!district && !taluka) return '—'
  return [district && `District: ${district}`, taluka && `Taluka: ${taluka}`]
    .filter(Boolean)
    .join(', ')
}

/**
 * Section 10 rule 4: every column declares its tier.
 *
 * Name truncates under the template's `truncate && !grow` cap. Section
 * 8 wants one column taking the table's slack, and the identifier would
 * normally be it — but this table has no slack to take (see the frozen
 * column below), so nothing carries `grow`.
 * Mobile, Stage and Temperature survive every width: a lead is a phone
 * number plus where it has got to plus how warm it is, which is the
 * whole point of the screen. Active and the row actions are controls,
 * not data, so they cannot drop either — a toggle that disappears at
 * 1024 is a capability that disappears.
 *
 * Created By and Place go first at 1024: provenance, and a geography
 * that is long text and is on the record's own form anyway. Type and
 * Follow-up survive to 768 — Type qualifies the name the way it does on
 * Orders, and the follow-up date is the one column somebody works
 * FROM. Nothing that drops becomes unreachable; all four are on the
 * edit form.
 *
 * Ten columns at 1280, eight at 768. Measured at both — see the report
 * for `scrollWidth` against `clientWidth`.
 */
function leadColumns({
  canEdit,
  canDelete,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  canEdit: boolean
  canDelete: boolean
  onEdit: (lead: LeadRow) => void
  onToggleActive: (lead: LeadRow, value: boolean) => void
  onDelete: (lead: LeadRow) => void
}): ListColumn<LeadRow>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      truncate: true,
      // OVERNIGHT: no column carries `grow` here — on a table that overflows it collapses the identifier to 32px — see overnight-queue-2026-09-18.md
      /*
       * Section 10 rule 2's second half. Ten columns at 1280 is past
       * its own "more than eight columns at desktop width" threshold
       * and the table scrolls sideways at every supported width
       * (measurements in the report), so the first column freezes.
       *
       * `grow` is deliberately NOT set: `w-full max-w-0` only takes
       * slack when there is slack, and on a table that overflows it
       * collapses the identifier to nothing — measured at 32px before
       * this changed. A capped, truncating column is the honest one
       * here.
       *
       * The head needs no background of its own: `thead` carries
       * `bg-surface-sunken` across the full table width and scrolls
       * under this cell. A body row carries none, so the cell brings
       * `bg-surface` and re-states the row hover itself — the template
       * puts no group on `tr`, so there is no group-hover to use. See
       * the report: a frozen column is a template capability this
       * screen is standing in for.
       */
      // OVERNIGHT: a frozen first column is a ListColumn capability the screen is standing in for — see overnight-queue-2026-09-18.md
      className: 'sticky left-0 z-20 border-r border-border-light',
      // OVERNIGHT: and so is re-stating the row hover, because the template puts no group on `tr` — see overnight-queue-2026-09-18.md
      cellClassName:
        'bg-surface [tr:hover_&]:bg-surface-sunken font-medium text-text-primary',
      skeletonWidth: 'w-40',
      cell: lead => lead.name,
    },
    {
      id: 'type',
      header: 'Type',
      tier: 'hide-below-768',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-20',
      /* Not a status — a category. Section 11.1's "status is always a
         badge" does not reach it, and section 2.4 has no colour for a
         category, so it reads as text like Orders' own Type column. */
      cell: lead => lead.type ?? '—',
    },
    {
      id: 'mobile',
      header: 'Mobile',
      className: 'whitespace-nowrap',
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-24',
      cell: lead => lead.mobile_1 ?? '—',
      truncate: true,
    },
    {
      id: 'place',
      header: 'Place',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-32',
      cell: place,
    },
    {
      id: 'stage',
      header: 'Stage',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-24',
      /* An absent stage is not a status, so it is a dash rather than
         the vocabulary's Unknown badge — which is for a word this file
         has not been told about, not for no word at all. */
      cell: lead =>
        lead.stage ? (
          <StatusBadge vocabulary={LEAD_STAGE} status={lead.stage} />
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      id: 'temperature',
      header: 'Temp',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-20',
      cell: lead =>
        lead.temperature ? (
          <StatusBadge
            vocabulary={LEAD_TEMPERATURE}
            status={lead.temperature}
          />
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      id: 'followUp',
      header: 'Follow-up',
      tier: 'hide-below-768',
      className: 'whitespace-nowrap',
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-24',
      cell: lead =>
        lead.next_follow_up_date ? fmtDate(lead.next_follow_up_date) : '—',
      truncate: true,
    },
    {
      id: 'createdBy',
      header: 'Created By',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-28',
      cell: lead => lead.created_by?.name ?? '—',
    },
    // OVERNIGHT: the is_active toggle has no template slot, so it stays the column it already was — see overnight-queue-2026-09-18.md
    /*
     * Section 15.2: once anything points at a master record it is
     * deactivated rather than deleted, so this is the action that is
     * always available and Delete is the one that often is not. The
     * template has no slot for it because it is not chrome — it is a
     * per-ROW control, and a per-row control is a column. It sits
     * immediately before the row actions for that reason.
     */
    {
      id: 'active',
      header: 'Active',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-5 w-9',
      /* Section 26: someone without edit rights sees the same screen
         with the control disabled, not a screen missing a column — the
         value is data they are entitled to read. */
      cell: lead => (
        <Switch
          aria-label={`Active — ${lead.name}`}
          checked={Boolean(lead.is_active)}
          disabled={!canEdit}
          onCheckedChange={
            canEdit ? value => onToggleActive(lead, value) : undefined
          }
        />
      ),
    },
    {
      id: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control w-20',
      cell: lead => (
        <div className="flex items-center justify-end gap-2">
          {canEdit && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => onEdit(lead)}
                  />
                }
              >
                <PencilIcon />
                <span className="sr-only">Edit {lead.name}</span>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="danger"
                    size="icon"
                    onClick={() => onDelete(lead)}
                  />
                }
              >
                <Trash2Icon />
                <span className="sr-only">Delete {lead.name}</span>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          )}
        </div>
      ),
    },
  ]
}

// ── Template download (server-side, returns .xlsx with dropdowns) ─────────────
async function downloadTemplate(onError: (msg: string) => void) {
  try {
    const res = await fetch('/api/leads/bulk-template')
    if (!res.ok) { onError('Failed to generate template'); return }
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'leads_template.xlsx'; a.click()
    URL.revokeObjectURL(url)
  } catch {
    onError('Failed to download template')
  }
}

// ── Bulk Upload Modal ─────────────────────────────────────────────────────────
function BulkUploadModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows]           = useState<Record<string, string>[]>([])
  const [fileName, setFileName]   = useState('')
  const [parsing, setParsing]     = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult]       = useState<{ inserted: number; errors: { row: number; message: string }[] } | null>(null)

  function reset() { setRows([]); setFileName(''); setResult(null); if (fileRef.current) fileRef.current.value = '' }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    setRows([])
    setParsing(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/leads/bulk-parse', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { toast(data.error ?? 'Failed to read file', 'error'); return }
      if (!data.rows?.length) { toast('No data rows found in file', 'error'); return }
      setRows(data.rows)
    } catch {
      toast('Failed to read file', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (rows.length === 0) return
    setImporting(true)
    try {
      const res = await fetch('/api/leads/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: rows }),
      })
      const data = await res.json()
      setResult(data)
      if (data.inserted > 0) {
        toast(`${data.inserted} lead${data.inserted > 1 ? 's' : ''} imported successfully`, 'success')
        onDone()
      }
    } catch {
      toast('Import failed', 'error')
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-(--backdrop) px-4">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <h3 className="text-base font-medium text-text-primary">Bulk Upload Leads</h3>
          <button onClick={() => { reset(); onClose() }} className="text-text-muted hover:text-text-secondary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Step 1 */}
          <div>
            <p className="text-sm font-medium text-text-secondary mb-2">Step 1 — Download the template</p>
            <button onClick={() => downloadTemplate(msg => toast(msg, 'error'))}
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded-lg px-4 py-2 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download Excel Template (.xlsx)
            </button>
            <p className="text-xs text-text-muted mt-1">Template includes dropdowns for Type, State, District, Taluka, Stage and Temperature — populated from your masters.</p>
          </div>

          {/* Step 2 */}
          <div>
            <p className="text-sm font-medium text-text-secondary mb-2">Step 2 — Upload filled file</p>
            <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary-border hover:bg-primary-subtle transition">
              {parsing ? (
                <span className="text-sm text-primary">Reading file…</span>
              ) : (
                <>
                  <svg className="w-6 h-6 text-text-muted mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                  <span className="text-sm text-text-muted">{fileName ? fileName : 'Click to select .xlsx file'}</span>
                  <span className="text-xs text-text-muted mt-0.5">Only the first (Leads) sheet is imported</span>
                </>
              )}
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            </label>
          </div>

          {/* Preview */}
          {rows.length > 0 && !result && (
            <div>
              <p className="text-sm font-medium text-text-secondary mb-2">Preview — {rows.length} row{rows.length > 1 ? 's' : ''} detected</p>
              <div className="overflow-x-auto rounded-lg border border-border-light max-h-48">
                <table className="w-full text-xs">
                  <thead className="bg-surface-sunken sticky top-0">
                    <tr>{['Name', 'Type', 'Mobile 1', 'State', 'District', 'Temperature'].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-text-secondary whitespace-nowrap">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-border-light">
                        <td className="px-3 py-2 text-text-secondary">{r.name || <span className="text-danger">—</span>}</td>
                        <td className="px-3 py-2 text-text-secondary">{r.type || <span className="text-danger">—</span>}</td>
                        <td className="px-3 py-2 text-text-secondary">{r.mobile_1 || '—'}</td>
                        <td className="px-3 py-2 text-text-secondary">{r.state || '—'}</td>
                        <td className="px-3 py-2 text-text-secondary">{r.district || '—'}</td>
                        <td className="px-3 py-2 text-text-secondary">{r.temperature || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && <p className="text-xs text-text-muted mt-1">Showing first 50 of {rows.length} rows.</p>}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-success-bg border border-success-border rounded-lg">
                <svg className="w-5 h-5 text-success flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-sm text-success font-medium">{result.inserted} lead{result.inserted !== 1 ? 's' : ''} imported successfully</p>
              </div>
              {result.errors.length > 0 && (
                <div className="p-3 bg-danger-bg border border-danger-border rounded-lg max-h-40 overflow-y-auto">
                  <p className="text-sm font-medium text-danger mb-2">{result.errors.length} row{result.errors.length !== 1 ? 's' : ''} skipped:</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-danger">Row {e.row}: {e.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-light flex justify-end gap-3">
          <button onClick={() => { reset(); onClose() }} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary border border-border-light rounded-lg">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={rows.length === 0 || importing}
              className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition">
              {importing ? 'Importing…' : `Import ${rows.length > 0 ? rows.length + ' Leads' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LeadsPage() {
  const me = useMe()
  const { toast } = useToast()
  const isAdmin = me?.role === 'Administrator'
  const canEdit  = isAdmin || (me?.permissions?.business?.edit   ?? false)
  const canDelete = isAdmin || (me?.permissions?.business?.delete ?? false)

  const bp = useBPForm()
  const [open, setOpen]         = useState(false)
  const [editing, setEditing]   = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving]     = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [deleting, setDeleting] = useState<LeadRow | null>(null)
  const savingRef               = useRef(false)
  const [leadTypes, setLeadTypes] = useState<{ id: string; name: string }[]>([])
  const [stages, setStages] = useState<{ id: string; name: string }[]>([])
  const [temperatures, setTemperatures] = useState<{ id: string; name: string }[]>([])
  /* Bumped when a create, an edit, a toggle or a delete makes the list stale. */
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    fetch('/api/masters/lead-types').then(r => r.json()).then(d => setLeadTypes(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load lead types', 'error'))
    // OVERNIGHT: filter options come from the tenant's master table, not the badge vocabulary — see overnight-queue-2026-09-18.md
    fetch('/api/masters/lead-stages').then(r => r.json()).then(d => setStages(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load lead stages', 'error'))
    // OVERNIGHT: filter options come from the tenant's master table, not the badge vocabulary — see overnight-queue-2026-09-18.md
    fetch('/api/masters/lead-temperatures').then(r => r.json()).then(d => setTemperatures(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load lead temperatures', 'error'))
  }, [toast])

  function openAdd() {
    bp.reset()
    bp.setF('stage')('Prospect')
    setEditing(null); setOpen(true)
  }
  function openEdit(row: LeadRow) {
    bp.reset(row as unknown as Record<string, unknown>)
    setEditing(row as unknown as Record<string, unknown>)
    setOpen(true)
  }

  async function handleSave() {
    if (savingRef.current) return
    if (!bp.form.name.trim()) return
    if (!bp.validate()) return
    savingRef.current = true
    setSaving(true)
    const body = { ...bp.buildBody(), type: bp.form.type || null }
    const path = editing ? `/api/leads/${editing.id as string}` : '/api/leads'
    const res = await fetch(path, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    savingRef.current = false
    setSaving(false)
    if (!res.ok) {
      toast((data as { error?: string }).error ?? (editing ? 'Update failed' : 'Create failed'), 'error')
      return
    }
    toast(editing ? 'Updated successfully' : 'Created successfully')
    setRefreshKey(k => k + 1)
    setOpen(false)
  }

  async function toggleActive(lead: LeadRow, value: boolean) {
    const res = await fetch(`/api/leads/${lead.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: value }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast((data as { error?: string }).error ?? 'Update failed', 'error')
      return
    }
    toast('Updated successfully')
    setRefreshKey(k => k + 1)
  }

  async function confirmDelete() {
    const lead = deleting
    if (!lead) return
    setDeleting(null)
    const res = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast((data as { error?: string }).error ?? 'Delete failed', 'error')
      return
    }
    toast('Deleted successfully')
    setRefreshKey(k => k + 1)
  }

  /*
   * Deliberately NOT memoised: the template holds `load` in a ref and
   * never makes it an effect dependency. No deadline and no catch here
   * either — the template races this against its own timer, so a
   * rejection IS the failed state (section 14 rules 3 and 4).
   *
   * `/api/leads` takes `q` and `type` and nothing else, so the three
   * remaining filters narrow the answer here rather than in SQL. The
   * template counts, pages and empty-states off what this returns, so
   * all four behave identically whichever side of the wire they run.
   */
  const load: ListPageProps<LeadRow>['load'] = async ({ search, filters, signal }) => {
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (filters.type) params.set('type', filters.type)
    const query = params.toString()
    const r = await fetch(`/api/leads${query ? `?${query}` : ''}`, { signal })
    if (!r.ok) throw new Error(String(r.status))
    const body = await r.json()
    const rows: LeadRow[] = Array.isArray(body) ? body : []
    return rows.filter(lead => {
      if (filters.stage && lead.stage !== filters.stage) return false
      if (filters.temperature && lead.temperature !== filters.temperature) return false
      if (filters.active === 'active' && !lead.is_active) return false
      if (filters.active === 'inactive' && lead.is_active) return false
      return true
    })
  }

  const filters: ListFilter[] = [
    {
      id: 'type',
      label: 'Type',
      kind: 'select',
      /* Section 16.3: lead types run past six in a real tenant. */
      searchable: leadTypes.length > 6,
      options: {
        '': 'Any type',
        ...Object.fromEntries(leadTypes.map(t => [t.name, t.name])),
      },
    },
    {
      id: 'stage',
      label: 'Stage',
      kind: 'select',
      searchable: stages.length > 6,
      // OVERNIGHT: filter options come from the tenant's master table, not the badge vocabulary — see overnight-queue-2026-09-18.md
      options: {
        '': 'Any stage',
        ...Object.fromEntries(stages.map(s => [s.name, s.name])),
      },
    },
    {
      id: 'temperature',
      label: 'Temperature',
      kind: 'select',
      // OVERNIGHT: filter options come from the tenant's master table, not the badge vocabulary — see overnight-queue-2026-09-18.md
      options: {
        '': 'Any temperature',
        ...Object.fromEntries(temperatures.map(t => [t.name, t.name])),
      },
    },
    {
      id: 'active',
      label: 'Active',
      kind: 'select',
      options: { '': 'Any', active: 'Active only', inactive: 'Inactive only' },
    },
  ]

  return (
    <>
      <ListPage<LeadRow>
        title="Leads"
        noun={{ one: 'lead', many: 'leads' }}
        /*
         * Section 6.1 rules 1 and 2 are what license two buttons here:
         * exactly ONE primary per screen, and everything else secondary.
         * Add is the primary; Bulk Upload is a second way to do the same
         * thing for many rows at once, so it belongs beside it rather
         * than anywhere else on the page — and it is secondary, which is
         * both what rule 2 requires and what it already looked like.
         * Section 11.1's "one primary action button on the right" is
         * satisfied: there is one primary, and it is on the right.
         *
         * Rejected: Bulk Upload in `toolbarExtra` (zone 2's far right is
         * section 11.6's view switcher, and an import is not a view);
         * inside the Add dialog as a second tab (buries a whole route
         * behind a control that means "add one"); and dropping it, which
         * would be dropping behaviour.
         */
        // OVERNIGHT: two buttons in `action` — the slot's doc says one primary, and one is what this is — see overnight-queue-2026-09-18.md
        action={
          canEdit ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setBulkOpen(true)}>
                {/* Section 23.1 has no Upload row and the kit is read-only
                    here, so this is `download`'s counterpart — see report. */}
                <UploadIcon />
                Bulk Upload
              </Button>
              <Button onClick={openAdd}>
                <PlusIcon />
                Add lead
              </Button>
            </div>
          ) : undefined
        }
        columns={leadColumns({
          canEdit,
          canDelete,
          onEdit: openEdit,
          onToggleActive: toggleActive,
          onDelete: setDeleting,
        })}
        rowKey={lead => lead.id}
        filters={filters}
        load={load}
        refreshKey={refreshKey}
        searchHint={SEARCH_HINT}
        emptyYet={{
          heading: 'No leads yet',
          body: 'Prospects being worked towards becoming a dealer, distributor or farmer customer are listed here.',
          actionLabel: 'Add lead',
          onAction: canEdit ? openAdd : undefined,
        }}
      />

      <Modal title={editing ? 'Edit Lead' : 'Add Lead'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving} size="lg">
        <BusinessPartnerFormFields
          hook={bp}
          namePlaceholder="Lead / Prospect name"
          showLeadStatus
          topSlot={
            <div>
              <label htmlFor="lead-type" className="block text-sm font-medium text-text-secondary mb-1">Lead Type <span className="text-danger">*</span></label>
              <select id="lead-type" name="type" value={bp.form.type} onChange={bp.F('type')}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring bg-surface">
                <option value="">Select type…</option>
                {leadTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
          }
        />
      </Modal>

      {/* Section 15: an irreversible action opens a confirmation dialog.
          This replaces a native `confirm()`, which the template's screens
          may not use. */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the lead permanently. A lead that is already
              referenced cannot be deleted — deactivate it instead, which
              keeps its history and takes it out of new entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete lead
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkUploadModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onDone={() => setRefreshKey(k => k + 1)}
      />
    </>
  )
}
