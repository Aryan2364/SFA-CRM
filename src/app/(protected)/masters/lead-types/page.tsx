'use client'

import { useState } from 'react'
import CrudPage, { Column, masterLocks } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import { Badge } from '@/components/ui/badge'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'

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

const COLS: Column[] = [
  { key: 'name', label: 'Type Name' },
  {
    key: 'applies_to',
    label: 'Applies to',
    render: row => {
      const v = isAppliesTo(row.applies_to) ? row.applies_to : 'Company'
      return <Badge variant={v === 'Both' ? 'neutral' : 'primary'}>{v}</Badge>
    },
  },
]

/**
 * Segmented control for a small, exclusive set of options — the kit has no
 * dedicated component for this (its `tabs`/`section-tabs` are navigation,
 * not form fields; `radio-group` renders round radios, not a pill group), so
 * this is a plain button group styled with the kit's own tokens: a bordered
 * track, a filled `primary` pill for the active option, ~200ms transitions.
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
  const crud = useCrud('/api/masters/lead-types')
  const me = useMe()
  // The real permission map, never a role name — Administrators get every
  // section from /api/auth/me. Denied actions show disabled with a reason.
  const locks = masterLocks(me, 'lead_types', 'lead types', 'create')

  const [open, setOpen]           = useState(false)
  const [editing, setEditing]     = useState<Record<string, unknown> | null>(null)
  const [name, setName]           = useState('')
  const [appliesTo, setAppliesTo] = useState<AppliesTo>('Company')
  const [saving, setSaving]       = useState(false)

  function openAdd() { setName(''); setAppliesTo('Company'); setEditing(null); setOpen(true) }
  function openEdit(row: Record<string, unknown>) {
    setName(String(row.name ?? ''))
    setAppliesTo(isAppliesTo(row.applies_to) ? row.applies_to : 'Company')
    setEditing(row)
    setOpen(true)
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const body = {
      name: name.trim(),
      sort_order: editing ? editing.sort_order : crud.allRows.length,
      applies_to: appliesTo,
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
    return crud.reorder(newRows, row => ({ name: row.name, is_active: row.is_active, applies_to: row.applies_to }))
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
        onToggleActive={(r, v) => crud.update(r.id as string, { name: r.name, sort_order: r.sort_order, is_active: v, applies_to: r.applies_to })}
        onDelete={r => crud.remove(r.id as string)} deleteMode="soft"
        onReorder={handleReorder}
      />
      <Modal title={editing ? 'Edit Lead Type' : 'Add Lead Type'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div className="space-y-4">
          <div>
            <label htmlFor="lead-type-name" className="block text-sm font-medium text-text-secondary mb-1">Type Name <span className="text-danger">*</span></label>
            <input id="lead-type-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Dealer, Institution…"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring"
              autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Applies to</label>
            <AppliesToField value={appliesTo} onChange={setAppliesTo} />
            <p className="text-xs text-text-muted mt-1.5">
              The account form offers only types that apply to its kind.
            </p>
          </div>
        </div>
      </Modal>
    </>
  )
}
