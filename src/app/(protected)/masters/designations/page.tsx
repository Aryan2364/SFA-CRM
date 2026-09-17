'use client'

import { useState, useEffect } from 'react'
import CrudPage, { Column } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'

const COLS: Column[] = [
  { key: 'name', label: 'Name' },
]

export default function DesignationsPage() {
  const crud = useCrud('/api/masters/designations')
  const me = useMe()
  const isAdmin = me?.role === 'Administrator'
  const canEdit = isAdmin || (me?.permissions?.designations?.edit ?? false)
  const canDelete = isAdmin || (me?.permissions?.designations?.delete ?? false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  function openAdd() { setEditing(null); setName(''); setOpen(true) }
  function openEdit(row: Record<string, unknown>) { setEditing(row); setName(String(row.name)); setOpen(true) }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const ok = editing
      ? await crud.update(editing.id as string, { name: name.trim() })
      : await crud.create({ name: name.trim() })
    setSaving(false)
    if (ok !== false && ok !== null) setOpen(false)
  }

  return (
    <>
      <CrudPage title="Designations" backHref="/masters" columns={COLS} rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={canEdit ? openAdd : undefined}
        onEdit={canEdit ? openEdit : undefined}
        onDelete={canDelete ? r => crud.remove(r.id as string) : undefined} />
      <Modal title={editing ? 'Edit Designation' : 'Add Designation'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <label htmlFor="designation-name" className="block text-sm font-medium text-text-secondary mb-1">Designation Name <span className="text-danger">*</span></label>
          <input id="designation-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Enter designation name"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
        </div>
      </Modal>
    </>
  )
}
