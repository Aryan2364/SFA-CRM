'use client'

import { useState } from 'react'
import CrudPage, { Column } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'

const COLS: Column[] = [
  { key: 'name', label: 'Category Name' },
]

export default function ExpenseCategoriesPage() {
  const crud = useCrud('/api/masters/expense-categories')
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
        title="Expense Categories" backHref="/masters" columns={COLS}
        rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={isAdmin ? openAdd : undefined}
        onEdit={isAdmin ? openEdit : undefined}
        onDelete={isAdmin ? r => crud.remove(r.id as string) : undefined}
        onReorder={isAdmin ? handleReorder : undefined}
      />
      <Modal title={editing ? 'Edit Category' : 'Add Category'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <label htmlFor="expense-category-name" className="block text-sm font-medium text-text-secondary mb-1">Category Name <span className="text-danger">*</span></label>
          <input id="expense-category-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Travel, Food…"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring"
            autoFocus />
        </div>
      </Modal>
    </>
  )
}
