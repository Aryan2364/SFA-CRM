'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import CrudPage, { Column, masterLocks } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import { Badge } from '@/components/ui/badge'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'

/**
 * Contact roles master — docs/accounts-contacts-spec.md §2.
 *
 * GET /api/masters/contact-roles answers `{ rows, available }`, not a plain
 * array, so this screen cannot use the `useCrud` hook (its `send()` only
 * accepts `Array.isArray(reply.body)` from a list fetch — see
 * src/hooks/useCrud.ts). The fetch/search/pagination/toast behaviour below
 * is deliberately kept parallel to that hook's for consistency with every
 * other master screen; only the response-shape handling differs. `available:
 * false` (the `contact_roles` table not pushed yet) surfaces the same way a
 * 503 does elsewhere — a load error, not an empty list.
 */

type RoleRow = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
  is_system: boolean
}

function isRoleRowArray(v: unknown): v is RoleRow[] {
  return Array.isArray(v) && v.every(r => r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string')
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error
  }
  return fallback
}

const COLS: Column[] = [
  {
    key: 'name',
    label: 'Role',
    render: row => {
      const r = row as unknown as RoleRow
      if (!r.is_system) return r.name
      return (
        <span className="inline-flex items-center gap-1.5">
          {r.name}
          <PermissionTooltip allowed={false} reason="Self is a system role and is always present — it cannot be renamed, deactivated or deleted.">
            <Badge variant="neutral">
              <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              System
            </Badge>
          </PermissionTooltip>
        </span>
      )
    },
  },
]

const PAGE_SIZE = 15
const DB_NOT_READY = 'This needs a database update first.'
const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'
const UNREADABLE_MESSAGE = 'The server sent back an answer this screen could not read. Try again in a moment.'

export default function ContactRolesPage() {
  const me = useMe()
  // Gated on `contacts`, not a dedicated `contact_roles` section — the route
  // does the same, see src/app/api/masters/contact-roles/route.ts.
  const locks = masterLocks(me, 'contacts', 'contact roles', 'create')
  const { toast } = useToast()

  const [allRows, setAllRows] = useState<RoleRow[]>([])
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const fetchRows = useCallback(async () => {
    let res: Response
    let text: string
    try {
      res = await fetch('/api/masters/contact-roles')
      text = await res.text()
    } catch {
      setLoadError(NETWORK_MESSAGE)
      toast(NETWORK_MESSAGE, 'error')
      return
    }
    let body: unknown = null
    let readable = true
    if (text) {
      try { body = JSON.parse(text) } catch { readable = false }
    }
    if (!res.ok || !readable) {
      const message = readable ? errorMessage(body, 'The server could not return the records.') : UNREADABLE_MESSAGE
      setLoadError(message)
      toast(message, 'error')
      return
    }
    const rows = body && typeof body === 'object' ? (body as { rows?: unknown }).rows : null
    const available = body && typeof body === 'object' ? (body as { available?: unknown }).available !== false : true
    if (!isRoleRowArray(rows)) {
      setLoadError(UNREADABLE_MESSAGE)
      toast(UNREADABLE_MESSAGE, 'error')
      return
    }
    setAllRows(rows)
    setHasLoaded(true)
    setLoadError(available ? null : DB_NOT_READY)
  }, [toast])

  useEffect(() => { fetchRows() }, [fetchRows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? allRows.filter(r => r.name.toLowerCase().includes(q)) : allRows
  }, [allRows, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])
  const rows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  )

  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState<RoleRow | null>(null)
  const [name, setName]       = useState('')
  const [saving, setSaving]   = useState(false)

  function openAdd() { setName(''); setEditing(null); setOpen(true) }
  function openEdit(row: Record<string, unknown>) {
    const r = row as unknown as RoleRow
    if (r.is_system) {
      toast('Self is a system role and cannot be edited.', 'error')
      return
    }
    setName(r.name); setEditing(r); setOpen(true)
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const url = editing ? `/api/masters/contact-roles/${editing.id}` : '/api/masters/contact-roles'
      const body = editing
        ? { name: name.trim(), sort_order: editing.sort_order, is_active: editing.is_active }
        : { name: name.trim(), sort_order: allRows.length }
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      let data: unknown = null
      try { data = text ? JSON.parse(text) : null } catch { /* handled by !res.ok below when relevant */ }
      if (!res.ok) {
        toast(errorMessage(data, editing ? 'The change could not be saved.' : 'The record could not be created.'), 'error')
        return
      }
      toast(editing ? 'Updated successfully' : 'Created successfully')
      setOpen(false)
      await fetchRows()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(row: Record<string, unknown>, val: boolean) {
    const r = row as unknown as RoleRow
    if (r.is_system) {
      toast('The Self role cannot be deactivated.', 'error')
      return
    }
    const res = await fetch(`/api/masters/contact-roles/${r.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: r.name, sort_order: r.sort_order, is_active: val }),
    })
    if (!res.ok) {
      toast('The change could not be saved.', 'error')
      return
    }
    toast('Updated successfully')
    await fetchRows()
  }

  async function removeRow(row: Record<string, unknown>) {
    const r = row as unknown as RoleRow
    const res = await fetch(`/api/masters/contact-roles/${r.id}`, { method: 'DELETE' })
    const text = await res.text()
    let data: unknown = null
    try { data = text ? JSON.parse(text) : null } catch { /* fallback message below */ }
    if (!res.ok) {
      return { message: errorMessage(data, 'The record could not be deleted.'), inUse: res.status === 409 }
    }
    toast('Deleted successfully')
    await fetchRows()
    return null
  }

  return (
    <>
      <CrudPage
        title="Contact Roles" backHref="/masters" columns={COLS}
        rows={rows as unknown as Record<string, unknown>[]} allRowsCount={filtered.length}
        isLoading={!hasLoaded && !loadError} search={search} onSearchChange={v => { setSearch(v); setPage(1) }}
        loadError={loadError} onRetry={fetchRows} locks={locks}
        page={safePage} totalPages={totalPages} onPage={setPage}
        onAdd={openAdd}
        onEdit={openEdit}
        onToggleActive={toggleActive}
        onDelete={removeRow} deleteMode="soft"
        deleteDisabledReason={row => ((row as unknown as RoleRow).is_system ? 'The Self role cannot be deleted.' : null)}
        editDisabledReason={row => ((row as unknown as RoleRow).is_system ? "Self is a system role and can't be changed." : null)}
      />
      <Modal title={editing ? 'Edit Role' : 'Add Role'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <label htmlFor="contact-role-name" className="block text-sm font-medium text-text-secondary mb-1">Role Name <span className="text-danger">*</span></label>
          <input id="contact-role-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Purchase Head"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring"
            autoFocus />
        </div>
      </Modal>
    </>
  )
}
