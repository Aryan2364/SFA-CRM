'use client'

import { useState } from 'react'
import CrudPage, { Column, masterLocks } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'

const COLS: Column[] = [
  { key: 'name', label: 'Reason' },
]

/**
 * "Couldn't-meet reasons" — the reason list shown in the Couldn't meet
 * dialog on a Daily Activity to-do. Backed by `todo_unmet_reasons`, a table
 * not yet pushed (see src/lib/todo-outcomes.ts); every route 503s with a
 * clear message until a human pushes it, which this screen's CrudPage
 * already handles as an ordinary load error.
 */
export default function TodoUnmetReasonsPage() {
  const crud = useCrud('/api/masters/todo-unmet-reasons', { include_inactive: '1' })
  const me = useMe()
  const locks = masterLocks(me, 'todo_unmet_reasons', "couldn't-meet reasons", 'create')

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
      ...(editing ? { is_active: editing.is_active } : {}),
    }
    const ok = editing ? await crud.update(editing.id as string, body) : await crud.create(body)
    setSaving(false)
    if (ok !== false && ok !== null) setOpen(false)
  }

  function handleReorder(newRows: Record<string, unknown>[]) {
    return crud.reorder(newRows, row => ({ name: row.name, is_active: row.is_active }))
  }

  return (
    <>
      <CrudPage
        title="Couldn't-meet Reasons" backHref="/masters" columns={COLS}
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
      <Modal title={editing ? 'Edit Reason' : 'Add Reason'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <label htmlFor="unmet-reason-name" className="block text-sm font-medium text-text-secondary mb-1">Reason <span className="text-danger">*</span></label>
          <input id="unmet-reason-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Customer not available"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring"
            autoFocus />
        </div>
      </Modal>
    </>
  )
}
