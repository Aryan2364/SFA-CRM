'use client'

import { useState } from 'react'
import { PencilIcon, PlusIcon } from 'lucide-react'

import { masterLocks } from '@/lib/master-locks'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
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
import { Badge } from '@/components/ui/badge'
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

/** docs/accounts-contacts-spec.md §1 — `company_types.applies_to`, via
 *  src/lib/account-kind.ts (APPLIES_TO). Kept as a local literal union
 *  rather than imported: that file is server-only (it touches `prisma`
 *  directly) and importing it here would pull a server module into the
 *  client bundle. */
const APPLIES_TO_OPTIONS = ['Company', 'Individual', 'Both'] as const
type AppliesTo = (typeof APPLIES_TO_OPTIONS)[number]
function isAppliesTo(v: unknown): v is AppliesTo {
  return typeof v === 'string' && (APPLIES_TO_OPTIONS as readonly string[]).includes(v)
}

type LeadTypeRow = {
  id: string
  name: string
  applies_to: unknown
  sort_order: number
  is_active: boolean
}

/**
 * Segmented control for a small, exclusive set of options — the kit has no
 * dedicated component for this (its `tabs`/`section-tabs` are navigation,
 * not form fields; `radio-group` renders round radios, not a pill group), so
 * this is a plain button group styled with the kit's own tokens: a bordered
 * track, a filled `primary` pill for the active option, ~200ms transitions.
 * Carried over unchanged from the legacy page — still the closest kit-correct
 * answer; see docs/kit-audit/kit-gaps.md.
 */
function AppliesToField({ value, onChange }: { value: AppliesTo; onChange: (v: AppliesTo) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-sunken p-1 gap-1">
      {APPLIES_TO_OPTIONS.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors duration-200 ${
            value === opt
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

export default function LeadTypesPage() {
  const me = useMe()
  const { toast } = useToast()
  // The real permission map, never a role name — Administrators get every
  // section from /api/auth/me. Denied actions show disabled with a reason.
  const locks = masterLocks(me, 'lead_types', 'lead types', 'create')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<LeadTypeRow | null>(null)
  const [name, setName] = useState('')
  const [appliesTo, setAppliesTo] = useState<AppliesTo>('Company')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [allRows, setAllRows] = useState<LeadTypeRow[]>([])

  function openAdd() { setName(''); setAppliesTo('Company'); setEditing(null); setFormError(''); setOpen(true) }
  function openEdit(row: LeadTypeRow) {
    setName(row.name)
    setAppliesTo(isAppliesTo(row.applies_to) ? row.applies_to : 'Company')
    setEditing(row)
    setFormError('')
    setOpen(true)
  }

  async function handleSave() {
    setFormError('')
    if (!name.trim()) { setFormError('Type Name is required.'); return }
    setSaving(true)
    const body: Record<string, unknown> = {
      name: name.trim(),
      sort_order: editing ? editing.sort_order : allRows.length,
      applies_to: appliesTo,
      // Carried explicitly: the route treats a missing key as `true`, so an
      // edit would otherwise silently reactivate a deactivated row.
      ...(editing ? { is_active: editing.is_active } : {}),
    }
    try {
      const res = await fetch(editing ? `/api/masters/lead-types/${editing.id}` : '/api/masters/lead-types', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  async function toggleActive(row: LeadTypeRow, value: boolean) {
    const res = await fetch(`/api/masters/lead-types/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: row.name, sort_order: row.sort_order, is_active: value, applies_to: row.applies_to }),
    })
    if (!res.ok) { toast('Could not change status. Please try again.', 'error'); return }
    toast(value ? 'Reactivated' : 'Deactivated')
    setRefreshKey(k => k + 1)
  }

  /*
   * `/api/masters/lead-types` has no search param beyond what the client
   * already filters; the template narrows the fetched set client-side, same
   * as the legacy `useCrud` page did. Rows are kept in `allRows` for
   * `sort_order` bookkeeping on create (see `handleSave`).
   */
  const load: ListPageProps<LeadTypeRow>['load'] = async ({ search, signal }) => {
    const r = await fetch('/api/masters/lead-types', { signal })
    if (!r.ok) throw new Error(String(r.status))
    const body = await r.json()
    const rows: LeadTypeRow[] = Array.isArray(body) ? body : []
    setAllRows(rows)
    const q = search.trim().toLowerCase()
    return q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows
  }

  const columns: ListColumn<LeadTypeRow>[] = [
    {
      id: 'name',
      header: 'Type Name',
      grow: true,
      truncate: true,
      cellClassName: 'font-medium text-text-primary',
      skeletonWidth: 'w-40',
      cell: row => row.name,
    },
    {
      id: 'applies_to',
      header: 'Applies to',
      skeletonWidth: 'w-24',
      cell: row => {
        const v = isAppliesTo(row.applies_to) ? row.applies_to : 'Company'
        return <Badge variant="neutral">{v}</Badge>
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
      cell: row => (
        <div className="flex items-center justify-end gap-2">
          {locks.edit === undefined ? (
            <Tooltip>
              <TooltipTrigger render={<Button variant="secondary" size="icon" onClick={() => openEdit(row)} />}>
                <PencilIcon />
                <span className="sr-only">Edit {row.name}</span>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
          ) : (
            <PermissionTooltip allowed={typeof locks.edit !== 'string'} reason={locks.edit ?? ''}>
              <Button variant="secondary" size="icon" disabled>
                <PencilIcon />
                <span className="sr-only">Edit {row.name}</span>
              </Button>
            </PermissionTooltip>
          )}
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
        </div>
      ),
    },
  ]

  const action = (
    <PermissionTooltip allowed={typeof locks.add !== 'string'} reason={locks.add ?? ''}>
      <Button onClick={openAdd} disabled={locks.add !== undefined}>
        <PlusIcon />
        Add Account Type
      </Button>
    </PermissionTooltip>
  )

  // Drag-to-reorder, persisted the same way the legacy CrudPage/useCrud pair
  // did (one PUT per moved row, carrying `name`/`is_active`/`applies_to`
  // unchanged — see docs/kit-audit/kit-gaps.md, the kit has no list-reorder
  // pattern). Shared with master-name-page.tsx via reorderable-rows.tsx.
  const canReorder = locks.edit === undefined
  const { renderReorderableTable } = useReorderableRows<LeadTypeRow>({
    enabled: canReorder,
    apiPath: '/api/masters/lead-types',
    buildBody: r => ({ name: r.name, is_active: r.is_active, applies_to: r.applies_to }),
    onPersisted: () => setRefreshKey(k => k + 1),
  })

  return (
    <div className="flex min-h-0 flex-col md:h-full">
      <Breadcrumb className="mb-4 shrink-0">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/masters">Masters</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Account Types</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <ListPage<LeadTypeRow>
        className="md:h-auto md:min-h-0 md:flex-1"
        title="Account Types"
        noun={{ one: 'account type', many: 'account types' }}
        action={action}
        columns={columns}
        rowKey={row => row.id}
        renderData={rows => renderReorderableTable(rows, columns)}
        load={load}
        refreshKey={refreshKey}
        emptyYet={{
          heading: 'No account types yet',
          body: 'Account types tell the account form which kind of account they apply to.',
          actionLabel: locks.add === undefined ? 'Add account type' : undefined,
          onAction: locks.add === undefined ? openAdd : undefined,
        }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Account Type' : 'Add Account Type'}</DialogTitle>
          </DialogHeader>
          {formError && (
            <div className="bg-danger-bg border border-danger-border text-danger text-sm rounded-lg px-4 py-3">{formError}</div>
          )}
          <div>
            <Label htmlFor="lead-type-name">Type Name <span className="text-danger">*</span></Label>
            <div className="mt-1">
              <Input
                id="lead-type-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Dealer, Institution…"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              />
            </div>
          </div>
          <div>
            <Label>Applies to</Label>
            <div className="mt-1">
              <AppliesToField value={appliesTo} onChange={setAppliesTo} />
            </div>
            <p className="text-xs text-text-muted mt-1.5">
              The account form offers only types that apply to its kind.
            </p>
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
