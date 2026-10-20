'use client'

import { useState } from 'react'
import { PencilIcon, PlusIcon, ShieldIcon } from 'lucide-react'

import { masterLocks } from '@/lib/master-locks'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import {
  ListPage,
  type ListColumn,
  type ListPageProps,
} from '@/components/templates/list-page'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'

/**
 * Contact roles master — docs/accounts-contacts-spec.md §2.
 *
 * GET /api/masters/contact-roles answers `{ rows, available }`, not a plain
 * array — `available: false` (the `contact_roles` table not pushed yet)
 * surfaces as a load failure here, the same way it did under the legacy
 * `CrudPage` page (a load error, not an empty list).
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

const DB_NOT_READY = 'This needs a database update first.'
const UNREADABLE_MESSAGE = 'The server sent back an answer this screen could not read. Try again in a moment.'

export default function ContactRolesPage() {
  const me = useMe()
  const { toast } = useToast()
  // Gated on `contacts`, not a dedicated `contact_roles` section — the route
  // does the same, see src/app/api/masters/contact-roles/route.ts.
  const locks = masterLocks(me, 'contacts', 'contact roles', 'create')

  const [allRows, setAllRows] = useState<RoleRow[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RoleRow | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  function openAdd() { setName(''); setEditing(null); setFormError(''); setOpen(true) }
  function openEdit(row: RoleRow) {
    if (row.is_system) {
      toast('Self is a system role and cannot be edited.', 'error')
      return
    }
    setName(row.name); setEditing(row); setFormError(''); setOpen(true)
  }

  async function handleSave() {
    setFormError('')
    if (!name.trim()) { setFormError('Role Name is required.'); return }
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
        setFormError(errorMessage(data, editing ? 'The change could not be saved.' : 'The record could not be created.'))
        return
      }
      toast(editing ? 'Updated successfully' : 'Created successfully')
      setOpen(false)
      setRefreshKey(k => k + 1)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(row: RoleRow, val: boolean) {
    if (row.is_system) {
      toast('The Self role cannot be deactivated.', 'error')
      return
    }
    const res = await fetch(`/api/masters/contact-roles/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: row.name, sort_order: row.sort_order, is_active: val }),
    })
    if (!res.ok) {
      toast('The change could not be saved.', 'error')
      return
    }
    toast('Updated successfully')
    setRefreshKey(k => k + 1)
  }

  /*
   * Deliberately throws rather than returning [] when the body cannot be
   * read or is unavailable: those are load failures, and only the template's
   * own failed-state should speak for them.
   */
  const load: ListPageProps<RoleRow>['load'] = async ({ search, signal }) => {
    const res = await fetch('/api/masters/contact-roles', { signal })
    const text = await res.text()
    let body: unknown = null
    let readable = true
    if (text) {
      try { body = JSON.parse(text) } catch { readable = false }
    }
    if (!res.ok || !readable) {
      throw new Error(readable ? errorMessage(body, 'The server could not return the records.') : UNREADABLE_MESSAGE)
    }
    const rows = body && typeof body === 'object' ? (body as { rows?: unknown }).rows : null
    const available = body && typeof body === 'object' ? (body as { available?: unknown }).available !== false : true
    if (!isRoleRowArray(rows)) throw new Error(UNREADABLE_MESSAGE)
    if (!available) throw new Error(DB_NOT_READY)
    setAllRows(rows)
    const q = search.trim().toLowerCase()
    return q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows
  }

  const columns: ListColumn<RoleRow>[] = [
    {
      id: 'name',
      header: 'Role',
      grow: true,
      skeletonWidth: 'w-40',
      cell: row => {
        if (!row.is_system) return row.name
        return (
          <span className="inline-flex items-center gap-1.5">
            {row.name}
            <PermissionTooltip allowed={false} reason="Self is a system role and is always present — it cannot be renamed, deactivated or deleted.">
              <Badge variant="neutral">
                <ShieldIcon />
                System
              </Badge>
            </PermissionTooltip>
          </span>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-20',
      cell: row => row.is_active === false ? <Badge variant="neutral">Inactive</Badge> : <Badge variant="success">Active</Badge>,
    },
    {
      id: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control w-28',
      cell: row => {
        const editBlocked = row.is_system ? "Self is a system role and can't be changed." : locks.edit
        return (
          <div className="flex items-center justify-end gap-2">
            {editBlocked === undefined ? (
              <Tooltip>
                <TooltipTrigger render={<Button variant="secondary" size="icon" onClick={() => openEdit(row)} />}>
                  <PencilIcon />
                  <span className="sr-only">Edit {row.name}</span>
                </TooltipTrigger>
                <TooltipContent>Edit</TooltipContent>
              </Tooltip>
            ) : (
              <PermissionTooltip allowed={false} reason={editBlocked ?? ''}>
                <Button variant="secondary" size="icon" disabled>
                  <PencilIcon />
                  <span className="sr-only">Edit {row.name}</span>
                </Button>
              </PermissionTooltip>
            )}
            <PermissionTooltip allowed={typeof editBlocked !== 'string'} reason={editBlocked ?? ''}>
              {row.is_active === false ? (
                <Button variant="secondary" disabled={editBlocked !== undefined} onClick={() => toggleActive(row, true)}>
                  Reactivate
                </Button>
              ) : (
                <Button variant="secondary" disabled={editBlocked !== undefined} onClick={() => toggleActive(row, false)}>
                  Deactivate
                </Button>
              )}
            </PermissionTooltip>
          </div>
        )
      },
    },
  ]

  const action = (
    <PermissionTooltip allowed={typeof locks.add !== 'string'} reason={locks.add ?? ''}>
      <Button onClick={openAdd} disabled={locks.add !== undefined}>
        <PlusIcon />
        Add Role
      </Button>
    </PermissionTooltip>
  )

  return (
    <div className="flex min-h-0 flex-col md:h-full">
      <Breadcrumb className="mb-4 shrink-0">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/masters">Masters</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Contact Roles</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <ListPage<RoleRow>
        className="md:h-auto md:min-h-0 md:flex-1"
        title="Contact Roles"
        noun={{ one: 'role', many: 'roles' }}
        action={action}
        columns={columns}
        rowKey={row => row.id}
        load={load}
        refreshKey={refreshKey}
        emptyYet={{
          heading: 'No contact roles yet',
          body: 'Contact roles describe the part a contact plays at an account, such as Purchase Head or Self.',
          actionLabel: locks.add === undefined ? 'Add role' : undefined,
          onAction: locks.add === undefined ? openAdd : undefined,
        }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Role' : 'Add Role'}</DialogTitle>
          </DialogHeader>
          {formError && (
            <div className="bg-danger-bg border border-danger-border text-danger text-sm rounded-lg px-4 py-3">{formError}</div>
          )}
          <div>
            <Label htmlFor="contact-role-name">Role Name <span className="text-danger">*</span></Label>
            <div className="mt-1">
              <Input
                id="contact-role-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Purchase Head"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
