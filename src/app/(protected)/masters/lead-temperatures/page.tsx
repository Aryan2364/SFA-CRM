'use client'

import { useState } from 'react'
import CrudPage, { Column } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'

const TEMP_COLORS: Record<string, string> = {
  Cold: 'bg-blue-50 text-blue-700',
  Warm: 'bg-amber-50 text-amber-700',
  Hot:  'bg-red-50 text-red-700',
}

const COLS: Column[] = [
  { key: 'name', label: 'Temperature', render: r => {
    const v = r.name as string
    const cls = TEMP_COLORS[v] ?? 'bg-gray-100 text-gray-600'
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{v}</span>
  }},
]

export default function LeadTemperaturesPage() {
  const crud = useCrud('/api/masters/lead-temperatures')
  const me = useMe()
  const isAdmin = me?.role === 'Administrator'

  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [name, setName]       = useState('')
  const [saving, setSaving]   = useState(false)

  function openAdd() { setName(''); setEditing(null); setOpen(true) }
  function openEdit(row: Record<string, unknown>) { setName(String(row.name ?? '')); setEditing(row); setOpen(true) }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const body = { name: name.trim(), sort_order: editing ? editing.sort_order : crud.allRows.length }
    const ok = editing ? await crud.update(editing.id as string, body) : await crud.create(body)
    setSaving(false)
    if (ok !== false && ok !== null) setOpen(false)
  }

  async function handleReorder(newRows: Record<string, unknown>[]) {
    await Promise.all(
      newRows.map((row, idx) =>
        crud.update(row.id as string, { name: row.name, sort_order: idx })
      )
    )
  }

  return (
    <>
      <CrudPage
        title="Lead Temperatures" backHref="/masters" columns={COLS}
        rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={isAdmin ? openAdd : undefined}
        onEdit={isAdmin ? openEdit : undefined}
        onDelete={isAdmin ? r => crud.remove(r.id as string) : undefined}
        onReorder={isAdmin ? handleReorder : undefined}
      />
      <Modal title={editing ? 'Edit Temperature' : 'Add Temperature'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <label htmlFor="lead-temperature-name" className="block text-sm font-medium text-text-secondary mb-1">Temperature Name <span className="text-danger">*</span></label>
          <input id="lead-temperature-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cold, Warm, Hot…"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring"
            autoFocus />
        </div>
      </Modal>
    </>
  )
}
