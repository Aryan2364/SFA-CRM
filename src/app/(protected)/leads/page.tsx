'use client'

import { useState, useEffect, useRef } from 'react'
import CrudPage, { Column } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'
import { useBPForm, BusinessPartnerFormFields } from '@/components/masters/BusinessPartnerForm'
import { useToast } from '@/contexts/ToastContext'

const STAGE_COLORS: Record<string, string> = {
  Prospect:    'bg-gray-100 text-gray-600',
  Contacted:   'bg-blue-50 text-blue-700',
  Interested:  'bg-cyan-50 text-cyan-700',
  Qualified:   'bg-indigo-50 text-indigo-700',
  Proposal:    'bg-amber-50 text-amber-700',
  Negotiation: 'bg-orange-50 text-orange-700',
}

const TEMP_COLORS: Record<string, string> = {
  Cold: 'bg-blue-50 text-blue-700',
  Warm: 'bg-amber-50 text-amber-700',
  Hot:  'bg-red-50 text-red-700',
}

const COLS: Column[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type', render: r => r.type
    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700">{r.type as string}</span>
    : <span className="text-gray-400">—</span>
  },
  { key: 'mobile_1', label: 'Mobile', render: r => String(r.mobile_1 ?? '—') },
  { key: 'place', label: 'Place', render: r => {
    const dist = (r.districts as { name: string } | null)?.name
    const talu = (r.talukas  as { name: string } | null)?.name
    if (!dist && !talu) return <span className="text-gray-400">—</span>
    return <span className="text-sm">{[dist && `District: ${dist}`, talu && `Taluka: ${talu}`].filter(Boolean).join(', ')}</span>
  }},
  { key: 'stage', label: 'Stage', render: r => {
    const v = r.stage as string
    if (!v) return <span className="text-gray-400">—</span>
    const cls = STAGE_COLORS[v] ?? 'bg-gray-100 text-gray-600'
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{v}</span>
  }},
  { key: 'temperature', label: 'Temp', render: r => {
    const v = r.temperature as string
    if (!v) return <span className="text-gray-400">—</span>
    const cls = TEMP_COLORS[v] ?? 'bg-gray-100 text-gray-600'
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{v}</span>
  }},
  { key: 'next_follow_up_date', label: 'Follow-up', render: r => {
    const d = r.next_follow_up_date as string | null
    if (!d) return <span className="text-gray-400">—</span>
    return <span className="text-sm">{new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
  }},
  { key: 'created_by', label: 'Created By', render: r => {
    const u = r.created_by as { name: string } | null
    return u ? <span className="text-sm">{u.name}</span> : <span className="text-gray-400">—</span>
  }},
]

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-medium text-gray-800">Bulk Upload Leads</h3>
          <button onClick={() => { reset(); onClose() }} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Step 1 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Step 1 — Download the template</p>
            <button onClick={() => downloadTemplate(msg => toast(msg, 'error'))}
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded-lg px-4 py-2 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download Excel Template (.xlsx)
            </button>
            <p className="text-xs text-gray-400 mt-1">Template includes dropdowns for Type, State, District, Taluka, Stage and Temperature — populated from your masters.</p>
          </div>

          {/* Step 2 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Step 2 — Upload filled file</p>
            <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition">
              {parsing ? (
                <span className="text-sm text-blue-500">Reading file…</span>
              ) : (
                <>
                  <svg className="w-6 h-6 text-gray-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                  <span className="text-sm text-gray-500">{fileName ? fileName : 'Click to select .xlsx file'}</span>
                  <span className="text-xs text-gray-400 mt-0.5">Only the first (Leads) sheet is imported</span>
                </>
              )}
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            </label>
          </div>

          {/* Preview */}
          {rows.length > 0 && !result && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Preview — {rows.length} row{rows.length > 1 ? 's' : ''} detected</p>
              <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-48">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>{['Name', 'Type', 'Mobile 1', 'State', 'District', 'Temperature'].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="px-3 py-2 text-gray-700">{r.name || <span className="text-red-400">—</span>}</td>
                        <td className="px-3 py-2 text-gray-700">{r.type || <span className="text-red-400">—</span>}</td>
                        <td className="px-3 py-2 text-gray-700">{r.mobile_1 || '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{r.state || '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{r.district || '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{r.temperature || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && <p className="text-xs text-gray-400 mt-1">Showing first 50 of {rows.length} rows.</p>}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-sm text-green-800 font-medium">{result.inserted} lead{result.inserted !== 1 ? 's' : ''} imported successfully</p>
              </div>
              {result.errors.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg max-h-40 overflow-y-auto">
                  <p className="text-sm font-medium text-red-700 mb-2">{result.errors.length} row{result.errors.length !== 1 ? 's' : ''} skipped:</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600">Row {e.row}: {e.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={() => { reset(); onClose() }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={rows.length === 0 || importing}
              className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition">
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
  const crud = useCrud('/api/leads')
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
  const savingRef               = useRef(false)
  const [leadTypes, setLeadTypes] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetch('/api/masters/lead-types').then(r => r.json()).then(d => setLeadTypes(Array.isArray(d) ? d : [])).catch(() => toast('Failed to load lead types', 'error'))
  }, [toast])

  function openAdd() {
    bp.reset()
    bp.setF('stage')('Prospect')
    setEditing(null); setOpen(true)
  }
  function openEdit(row: Record<string, unknown>) { bp.reset(row); setEditing(row); setOpen(true) }

  async function handleSave() {
    if (savingRef.current) return
    if (!bp.form.name.trim()) return
    if (!bp.validate()) return
    savingRef.current = true
    setSaving(true)
    const body = { ...bp.buildBody(), type: bp.form.type || null }
    const ok = editing ? await crud.update(editing.id as string, body) : await crud.create(body)
    savingRef.current = false
    setSaving(false)
    if (ok !== false && ok !== null) setOpen(false)
  }

  const headerExtra = canEdit ? (
    <button
      onClick={() => setBulkOpen(true)}
      className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-800 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
      Bulk Upload
    </button>
  ) : undefined

  return (
    <>
      <CrudPage
        title="Leads" columns={COLS}
        headerExtra={headerExtra}
        rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={canEdit ? openAdd : undefined}
        onEdit={canEdit ? openEdit : undefined}
        onToggleActive={canEdit ? (r, v) => crud.update(r.id as string, { is_active: v }) : undefined}
        onDelete={canDelete ? r => crud.remove(r.id as string) : undefined}
      />

      <Modal title={editing ? 'Edit Lead' : 'Add Lead'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving} size="lg">
        <BusinessPartnerFormFields
          hook={bp}
          namePlaceholder="Lead / Prospect name"
          showLeadStatus
          topSlot={
            <div>
              <label htmlFor="lead-type" className="block text-sm font-medium text-gray-700 mb-1">Lead Type <span className="text-red-500">*</span></label>
              <select id="lead-type" name="type" value={bp.form.type} onChange={bp.F('type')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">Select type…</option>
                {leadTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
          }
        />
      </Modal>

      <BulkUploadModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onDone={() => { crud.refetch() }}
      />
    </>
  )
}
