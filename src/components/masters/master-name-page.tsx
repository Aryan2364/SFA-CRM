'use client'

/**
 * Shared kit-conformant list page for the many masters that are just "a
 * name, optionally one parent select, optionally reorderable, optionally
 * soft-deleted" — section 4 rules 2-4 ("never build the same thing
 * twice"). Composes `templates/list-page.tsx` (`ListPage`) the same way
 * `masters/users/page.tsx` does, plus a kit `Dialog` for add/edit and a kit
 * `AlertDialog` for delete, instead of each master re-deriving the same
 * four states (list, add/edit modal, delete confirm, reorder) around the
 * legacy `CrudPage`/`Modal`/`SearchableSelect(.tsx)` trio.
 *
 * Kept from `useCrud`: search debounce, pagination semantics and toasts —
 * this file calls the master's REST routes directly (create/update/remove)
 * the same way `useCrud` does, so behaviour does not change, only the
 * rendering. Section 15.2: `deleteMode: 'soft'` renders Deactivate /
 * Reactivate, never a destroyed-forever Delete, for data other records may
 * reference; `'hard'` keeps the AlertDialog-confirmed permanent delete for
 * masters nothing else points at.
 */
import { useState, useCallback, type ReactNode } from 'react'
import { PencilIcon, PlusIcon } from 'lucide-react'

import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import { masterLocks, type CrudLocks } from '@/lib/master-locks'
import { useReorderableRows } from '@/components/masters/reorderable-rows'
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
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type MasterRow = {
  id: string
  name: string
  is_active?: boolean
  sort_order?: number
  [key: string]: unknown
}

export type MasterParentField = {
  /** Body key, e.g. `state_id`. */
  key: string
  label: string
  /** GET endpoint returning `{ id, name }[]`. */
  fetchUrl: string
  placeholder?: string
}

export interface MasterNamePageProps {
  /** Zone 1 title and the Add/Edit dialog's noun. */
  title: string
  /** Breadcrumb's final crumb, defaults to `title`. */
  breadcrumbLabel?: string
  noun: { one: string; many: string }
  apiPath: string
  /** Permission section key (`role_permissions.section`). */
  section: string
  addAction?: 'create' | 'edit'
  nameLabel?: string
  namePlaceholder?: string
  /** Section 10 rule 4: header for the name column. Defaults to "Name". */
  nameColumnHeader?: string
  /** Custom cell for the name column — e.g. lead-temperatures' colour pill. */
  nameCell?: (row: MasterRow) => ReactNode
  /** A single parent/FK select, e.g. district -> state. */
  parentField?: MasterParentField
  /** Extra read-only column(s) after name, e.g. the parent's name. */
  extraColumns?: ListColumn<MasterRow>[]
  deleteMode: 'soft' | 'hard'
  /** Drag-to-reorder, persisted as `sort_order`. */
  reorder?: boolean
  /** Passes `include_inactive=1` so a soft-deleted row stays listed. */
  includeInactive?: boolean
  emptyBody: string
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function MasterNamePage({
  title,
  breadcrumbLabel,
  noun,
  apiPath,
  section,
  addAction = 'edit',
  nameLabel = 'Name',
  namePlaceholder = 'Enter a name',
  nameColumnHeader = 'Name',
  nameCell,
  parentField,
  extraColumns,
  deleteMode,
  reorder = false,
  includeInactive = false,
  emptyBody,
}: MasterNamePageProps) {
  const me = useMe()
  const { toast } = useToast()
  const locks = masterLocks(me, section, noun.many, addAction)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MasterRow | null>(null)
  const [name, setName] = useState('')
  const [parentValue, setParentValue] = useState('')
  const [parentOptions, setParentOptions] = useState<{ value: string; label: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [pendingDelete, setPendingDelete] = useState<MasterRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const load: ListPageProps<MasterRow>['load'] = useCallback(async ({ search, signal }) => {
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (includeInactive) params.set('include_inactive', '1')
    const qs = params.toString()
    const r = await fetch(`${apiPath}${qs ? `?${qs}` : ''}`, { signal })
    if (!r.ok) throw new Error(String(r.status))
    const body = await r.json()
    return Array.isArray(body) ? (body as MasterRow[]) : []
  }, [apiPath, includeInactive])

  function openAdd() {
    if (parentField) {
      fetch(parentField.fetchUrl)
        .then(r => r.json())
        .then((d: { id: string; name: string }[]) =>
          setParentOptions(Array.isArray(d) ? d.map(x => ({ value: x.id, label: x.name })) : []))
        .catch(() => toast(`Failed to load ${parentField.label.toLowerCase()} options.`, 'error'))
    }
    setEditing(null)
    setName('')
    setParentValue('')
    setFormError('')
    setOpen(true)
  }

  function openEdit(row: MasterRow) {
    if (parentField) {
      fetch(parentField.fetchUrl)
        .then(r => r.json())
        .then((d: { id: string; name: string }[]) =>
          setParentOptions(Array.isArray(d) ? d.map(x => ({ value: x.id, label: x.name })) : []))
        .catch(() => toast(`Failed to load ${parentField.label.toLowerCase()} options.`, 'error'))
    }
    setEditing(row)
    setName(row.name ?? '')
    setParentValue(parentField ? String(row[parentField.key] ?? '') : '')
    setFormError('')
    setOpen(true)
  }

  async function handleSave() {
    setFormError('')
    if (!name.trim()) { setFormError(`${nameLabel} is required.`); return }
    if (parentField && !parentValue) { setFormError(`${parentField.label} is required.`); return }
    setSaving(true)
    const body: Record<string, unknown> = { name: name.trim() }
    if (parentField) body[parentField.key] = parentValue
    if (reorder) {
      body.sort_order = editing ? editing.sort_order : 0
      // Carried explicitly: the route treats a missing key as `true`, so an
      // edit would otherwise silently reactivate a deactivated row.
      if (editing) body.is_active = editing.is_active
    }
    try {
      const res = await fetch(editing ? `${apiPath}/${editing.id}` : apiPath, {
        method: editing ? 'PUT' : 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      setSaving(false)
      if (!res.ok) { setFormError(data?.error ?? 'Save failed. Please try again.'); return }
      toast(editing ? 'Updated successfully' : 'Created successfully')
      setOpen(false)
      setRefreshKey(k => k + 1)
    } catch {
      setSaving(false)
      setFormError('Something went wrong. Please try again.')
    }
  }

  async function toggleActive(row: MasterRow, value: boolean) {
    const body: Record<string, unknown> = { name: row.name, is_active: value }
    if (reorder) body.sort_order = row.sort_order
    if (parentField) body[parentField.key] = row[parentField.key]
    const res = await fetch(`${apiPath}/${row.id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) })
    if (!res.ok) { toast('Could not change status. Please try again.', 'error'); return }
    toast(value ? 'Reactivated' : 'Deactivated')
    setRefreshKey(k => k + 1)
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setIsDeleting(true)
    try {
      const res = await fetch(`${apiPath}/${pendingDelete.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data?.error ?? 'Could not delete. Please try again.', 'error')
        return
      }
      toast('Deleted successfully')
      setPendingDelete(null)
      setRefreshKey(k => k + 1)
    } finally {
      setIsDeleting(false)
    }
  }

  const nameColumn: ListColumn<MasterRow> = nameCell
    ? { id: 'name', header: nameColumnHeader, grow: !extraColumns?.length, cell: nameCell }
    : { id: 'name', header: nameColumnHeader, grow: !extraColumns?.length, truncate: true, cellClassName: 'font-medium text-text-primary', cell: r => r.name ?? '' }

  const actionsColumn: ListColumn<MasterRow> = {
    id: 'actions',
    header: '',
    className: 'whitespace-nowrap',
    cell: row => {
      const editBlocked = locks.edit
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
            <PermissionTooltip allowed={typeof editBlocked !== 'string'} reason={editBlocked ?? ''}>
              <Button variant="secondary" size="icon" disabled>
                <PencilIcon />
                <span className="sr-only">Edit {row.name}</span>
              </Button>
            </PermissionTooltip>
          )}
          {deleteMode === 'soft' ? (
            <PermissionTooltip allowed={typeof locks.edit !== 'string'} reason={locks.edit ?? ''}>
              {row.is_active === false ? (
                <Button variant="secondary" disabled={locks.edit !== undefined} onClick={() => toggleActive(row, true)}>
                  Reactivate
                </Button>
              ) : (
                <Button variant="secondary" disabled={locks.edit !== undefined} onClick={() => toggleActive(row, false)}>
                  Deactivate
                </Button>
              )}
            </PermissionTooltip>
          ) : (
            <PermissionTooltip allowed={typeof locks.delete !== 'string'} reason={locks.delete ?? ''}>
              <Button variant="secondary" disabled={locks.delete !== undefined} onClick={() => setPendingDelete(row)}>
                Delete
              </Button>
            </PermissionTooltip>
          )}
        </div>
      )
    },
  }

  const statusColumn: ListColumn<MasterRow> | null = deleteMode === 'soft' ? {
    id: 'status',
    header: 'Status',
    className: 'whitespace-nowrap',
    cell: row => row.is_active === false
      ? <Badge variant="neutral">Inactive</Badge>
      : <Badge variant="success">Active</Badge>,
  } : null

  const columns: ListColumn<MasterRow>[] = [
    nameColumn,
    ...(extraColumns ?? []),
    ...(statusColumn ? [statusColumn] : []),
    actionsColumn,
  ]

  // Drag-to-reorder, via the shared hook (see
  // src/components/masters/reorderable-rows.tsx — originally written inline
  // here, pulled out so lead-types/lead-stages' bespoke pages can reuse it).
  const canReorder = reorder && locks.edit === undefined
  const { renderReorderableTable } = useReorderableRows<MasterRow>({
    enabled: canReorder,
    apiPath,
    buildBody: r => ({
      name: r.name,
      is_active: r.is_active,
      ...(parentField ? { [parentField.key]: r[parentField.key] } : {}),
    }),
    onPersisted: () => setRefreshKey(k => k + 1),
  })

  const renderData = reorder ? (rows: MasterRow[]) => renderReorderableTable(rows, columns) : undefined

  const addLock: CrudLocks['edit'] = locks.add
  const action = (
    <PermissionTooltip allowed={typeof addLock !== 'string'} reason={addLock ?? ''}>
      <Button onClick={openAdd} disabled={addLock !== undefined}>
        <PlusIcon />
        Add {noun.one}
      </Button>
    </PermissionTooltip>
  )

  const deleteLabel = pendingDelete?.name ?? ''

  return (
    <div className="flex min-h-0 flex-col md:h-full">
      <Breadcrumb className="mb-4 shrink-0">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/masters">Masters</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{breadcrumbLabel ?? title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <ListPage<MasterRow>
        className="md:h-auto md:min-h-0 md:flex-1"
        title={title}
        noun={noun}
        action={action}
        columns={columns}
        rowKey={row => row.id}
        renderData={renderData}
        load={load}
        refreshKey={refreshKey}
        emptyYet={{
          heading: `No ${noun.many} yet`,
          body: emptyBody,
          actionLabel: addLock === undefined ? `Add ${noun.one}` : undefined,
          onAction: addLock === undefined ? openAdd : undefined,
        }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${title}` : `Add ${title}`}</DialogTitle>
          </DialogHeader>
          {formError && (
            <div className="bg-danger-bg border border-danger-border text-danger text-sm rounded-lg px-4 py-3">{formError}</div>
          )}
          {parentField && (
            <div>
              <Label htmlFor="master-parent">{parentField.label} <span className="text-danger">*</span></Label>
              <div className="mt-1">
                <SearchableSelect
                  id="master-parent"
                  options={Object.fromEntries(parentOptions.map(o => [o.value, o.label]))}
                  value={parentValue}
                  onValueChange={setParentValue}
                  placeholder={parentField.placeholder ?? `Select ${parentField.label.toLowerCase()}…`}
                />
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="master-name">{nameLabel} <span className="text-danger">*</span></Label>
            <div className="mt-1">
              <Input
                id="master-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={namePlaceholder}
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

      <AlertDialog open={pendingDelete !== null} onOpenChange={o => { if (!o && !isDeleting) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteLabel ? `Delete ${deleteLabel}?` : 'Delete this record?'}</AlertDialogTitle>
            <AlertDialogDescription>This removes it permanently and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
