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
  { key: 'name', label: 'Reason for Loss' },
]

/**
 * Reason for Loss master (P2-T3, REBUILD-PLAN.md §4.9).
 *
 * Built on CrudPage, not `templates/list-page.tsx`: `sort_order` is part of the
 * master shape and `list-page` has no reorder API, so a master built on it
 * loses its ordering silently — the rows still render, just never in the order
 * anyone set. Copied wholesale from `masters/contact-types`, which is the
 * worked example.
 */
export default function ReasonForLossPage() {
  const crud = useCrud('/api/masters/reason-for-loss')
  const me = useMe()
  // The real permission, not a role name. /api/auth/me returns every section
  // true for Administrator, so this covers that case without naming the role;
  // its `edit` flag is `can_edit || can_create`, which is what gates Add too.
  const canEdit   = me?.permissions?.reason_for_loss?.edit ?? false
  const canDelete = me?.permissions?.reason_for_loss?.delete ?? false

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
        renders for it. §11.2's breadcrumb is the sanctioned replacement.
      */}
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/masters">Masters</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Reason for Loss</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <CrudPage
        title="Reason for Loss" columns={COLS}
        rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={canEdit ? openAdd : undefined}
        onEdit={canEdit ? openEdit : undefined}
        /* Delete is a soft delete — a reason already recorded against a closed
           Deal must stay readable. The toggle is how a deactivated reason comes
           back; without it the row is visible but unreachable. */
        onToggleActive={canEdit ? (r, v) => crud.update(r.id as string, { name: r.name, sort_order: r.sort_order, is_active: v }) : undefined}
        onDelete={canDelete ? r => crud.remove(r.id as string) : undefined}
        onReorder={canEdit ? handleReorder : undefined}
      />
      <Modal title={editing ? 'Edit Reason for Loss' : 'Add Reason for Loss'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <label htmlFor="reason-for-loss-name" className="block text-sm font-medium text-text-secondary mb-1">Reason for Loss <span className="text-danger">*</span></label>
          <input id="reason-for-loss-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Price, Competitor, No Budget…"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring"
            autoFocus />
        </div>
      </Modal>
    </>
  )
}
