'use client'

import { useState, useEffect } from 'react'
import CrudPage, { Column } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'

const COLS: Column[] = [
  { key: 'name', label: 'Name' },
  { key: 'taluka', label: 'Taluka', render: r => (r.talukas as { name: string } | null)?.name ?? '' },
]

export default function VillagesPage() {
  const crud = useCrud('/api/masters/villages')
  const me = useMe()
  const { toast } = useToast()
  const isAdmin = me?.role === 'Administrator'
  const canEdit = isAdmin || (me?.permissions?.villages?.edit ?? false)
  const canDelete = isAdmin || (me?.permissions?.villages?.delete ?? false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [name, setName] = useState(''); const [talukaId, setTalukaId] = useState('')
  const [talukas, setTalukas] = useState<{ value: string; label: string }[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/masters/talukas').then(r => r.json()).then((d: { id: string; name: string }[]) =>
      setTalukas(d.map(x => ({ value: x.id, label: x.name })))).catch(() => toast('Failed to load talukas. Please refresh.', 'error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd() { setEditing(null); setName(''); setTalukaId(''); setOpen(true) }
  function openEdit(row: Record<string, unknown>) { setEditing(row); setName(String(row.name)); setTalukaId(String(row.taluka_id)); setOpen(true) }

  async function handleSave() {
    if (!name.trim() || !talukaId) return
    setSaving(true)
    const ok = editing
      ? await crud.update(editing.id as string, { name: name.trim(), taluka_id: talukaId })
      : await crud.create({ name: name.trim(), taluka_id: talukaId })
    setSaving(false)
    if (ok !== false && ok !== null) setOpen(false)
  }

  return (
    <>
      <CrudPage title="Villages" backHref="/masters" columns={COLS} rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={canEdit ? openAdd : undefined}
        onEdit={canEdit ? openEdit : undefined}
        onDelete={canDelete ? r => crud.remove(r.id as string) : undefined} />
      <Modal title={editing ? 'Edit Village' : 'Add Village'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <p className="block text-sm font-medium text-text-secondary mb-1">Taluka <span className="text-danger">*</span></p>
          <SearchableSelect value={talukaId} onChange={setTalukaId} options={talukas} placeholder="Select taluka…" />
        </div>
        <div>
          <label htmlFor="village-name" className="block text-sm font-medium text-text-secondary mb-1">Village Name <span className="text-danger">*</span></label>
          <input id="village-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Enter village name"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
        </div>
      </Modal>
    </>
  )
}
