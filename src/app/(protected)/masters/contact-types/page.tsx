'use client'

import { useState } from 'react'
import CrudPage, { Column } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'

const COLS: Column[] = [
  { key: 'name', label: 'Contact Type' },
]

export default function ContactTypesPage() {
  const crud = useCrud('/api/masters/contact-types')
  const me = useMe()
  // The real permission, not a role name. /api/auth/me returns every section
  // true for Administrator, so this covers that case without naming the role;
  // its `edit` flag is `can_edit || can_create`, which is what gates Add too.
  const canEdit   = me?.permissions?.contact_types?.edit ?? false
  const canDelete = me?.permissions?.contact_types?.delete ?? false

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
        crud.update(row.id as string, { name: row.name, sort_order: idx, is_active: row.is_active })
      )
    )
  }

  return (
    <>
      {/*
        No `backHref`: AGENTS.md §1 rule 11 forbids the back arrow CrudPage
        renders for it. §11.2's breadcrumb is the sanctioned replacement and
        `masters/users` is the worked example. Unlike that screen, CrudPage's
        root is a plain block with no `h-full`, so the breadcrumb needs no
        flex-column wrapper to keep the scroll where it belongs.
      */}
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/masters">Masters</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Contact Types</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <CrudPage
        title="Contact Types" columns={COLS}
        rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={canEdit ? openAdd : undefined}
        onEdit={canEdit ? openEdit : undefined}
        /* Delete is a soft delete. The toggle is how a deactivated type comes
           back — without it the row is visible but unreachable. */
        onToggleActive={canEdit ? (r, v) => crud.update(r.id as string, { name: r.name, sort_order: r.sort_order, is_active: v }) : undefined}
        onDelete={canDelete ? r => crud.remove(r.id as string) : undefined}
        onReorder={canEdit ? handleReorder : undefined}
      />
      <Modal title={editing ? 'Edit Contact Type' : 'Add Contact Type'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <label htmlFor="contact-type-name" className="block text-sm font-medium text-text-secondary mb-1">Contact Type <span className="text-danger">*</span></label>
          <input id="contact-type-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Decision Maker, Influencer…"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring"
            autoFocus />
        </div>
      </Modal>
    </>
  )
}
