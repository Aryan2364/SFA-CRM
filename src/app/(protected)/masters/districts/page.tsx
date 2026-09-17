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
  { key: 'state', label: 'State', render: r => (r.states as { name: string } | null)?.name ?? '' },
]

export default function DistrictsPage() {
  const crud = useCrud('/api/masters/districts')
  const me = useMe()
  const { toast } = useToast()
  const isAdmin = me?.role === 'Administrator'
  const canEdit = isAdmin || (me?.permissions?.districts?.edit ?? false)
  const canDelete = isAdmin || (me?.permissions?.districts?.delete ?? false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [name, setName] = useState(''); const [stateId, setStateId] = useState('')
  const [states, setStates] = useState<{ value: string; label: string }[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/masters/states').then(r => r.json()).then((d: { id: string; name: string }[]) =>
      setStates(d.map(s => ({ value: s.id, label: s.name })))).catch(() => toast('Failed to load states. Please refresh.', 'error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd() { setEditing(null); setName(''); setStateId(''); setOpen(true) }
  function openEdit(row: Record<string, unknown>) { setEditing(row); setName(String(row.name)); setStateId(String(row.state_id)); setOpen(true) }

  async function handleSave() {
    if (!name.trim() || !stateId) return
    setSaving(true)
    const ok = editing
      ? await crud.update(editing.id as string, { name: name.trim(), state_id: stateId })
      : await crud.create({ name: name.trim(), state_id: stateId })
    setSaving(false)
    if (ok !== false && ok !== null) setOpen(false)
  }

  return (
    <>
      <CrudPage title="Districts" backHref="/masters" columns={COLS} rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={canEdit ? openAdd : undefined}
        onEdit={canEdit ? openEdit : undefined}
        onDelete={canDelete ? r => crud.remove(r.id as string) : undefined} />
      <Modal title={editing ? 'Edit District' : 'Add District'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <p className="block text-sm font-medium text-text-secondary mb-1">State <span className="text-danger">*</span></p>
          <SearchableSelect value={stateId} onChange={setStateId} options={states} placeholder="Select state…" />
        </div>
        <div>
          <label htmlFor="district-name" className="block text-sm font-medium text-text-secondary mb-1">District Name <span className="text-danger">*</span></label>
          <input id="district-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Enter district name"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
        </div>
      </Modal>
    </>
  )
}
