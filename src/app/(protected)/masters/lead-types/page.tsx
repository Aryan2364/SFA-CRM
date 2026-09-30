'use client'

import { useState } from 'react'
import CrudPage, { Column, masterLocks } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'

const COLS: Column[] = [
  { key: 'name', label: 'Type Name' },
]

export default function LeadTypesPage() {
  const crud = useCrud('/api/masters/lead-types')
  const me = useMe()
  // The real permission map, never a role name — Administrators get every
  // section from /api/auth/me. Denied actions show disabled with a reason.
  const locks = masterLocks(me, 'lead_types', 'lead types', 'create')

  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [name, setName]       = useState('')
  const [saving, setSaving]   = useState(false)

  function openAdd() { setName(''); setEditing(null); setOpen(true) }
  function openEdit(row: Record<string, unknown>) { setName(String(row.name ?? '')); setEditing(row); setOpen(true) }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const body = {
      name: name.trim(),
      sort_order: editing ? editing.sort_order : crud.allRows.length,
      // Carried explicitly: the route treats a missing key as `true`, so an
      // edit would otherwise silently reactivate a deactivated row.
      ...(editing ? { is_active: editing.is_active } : {}),
    }
    const ok = editing ? await crud.update(editing.id as string, body) : await crud.create(body)
    setSaving(false)
    if (ok !== false && ok !== null) setOpen(false)
  }

  // One PUT per moved row, one toast, one refetch; the order is put back if
  // any of them fails. `sort_order` is assigned by the hook.
  function handleReorder(newRows: Record<string, unknown>[]) {
    return crud.reorder(newRows, row => ({ name: row.name, is_active: row.is_active }))
  }

  return (
    <>
      <CrudPage
        title="Lead Types" backHref="/masters" columns={COLS}
        rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        loadError={crud.loadError} onRetry={crud.refetch} locks={locks}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={openAdd}
        onEdit={openEdit}
        onToggleActive={(r, v) => crud.update(r.id as string, { name: r.name, sort_order: r.sort_order, is_active: v })}
        onDelete={r => crud.remove(r.id as string)} deleteMode="soft"
        onReorder={handleReorder}
      />
      <Modal title={editing ? 'Edit Lead Type' : 'Add Lead Type'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <label htmlFor="lead-type-name" className="block text-sm font-medium text-text-secondary mb-1">Type Name <span className="text-danger">*</span></label>
          <input id="lead-type-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Dealer, Institution…"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring"
            autoFocus />
        </div>
      </Modal>
    </>
  )
}
