'use client'

import { useState } from 'react'
import { CircleDashed, Flag, Info, PencilIcon, PlusIcon } from 'lucide-react'

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
import { Badge } from '@/components/ui/badge'
import { Banner, BannerAction, BannerDescription, BannerTitle } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Opportunity Stages master (labelled Lead Stages until 13 Oct 2026; the
 * `deal_stages` table — the names diverged when Leads became Deals;
 * `lead_stages` is still the immutable permission key).
 *
 * Each stage carries a **stage type**, Open or Closed. Closed is terminal: the
 * deal has ended and nothing follows — Won and Lost are the two obvious ones.
 * Which stages are terminal is this screen's decision, not a list of names
 * inside the software.
 *
 * `stage_type` arrives as `null` while the column is not in the database yet
 * (see `src/lib/deal-stage-type.ts`). That is a third state and is rendered as
 * one: never as Open, because "we cannot tell" and "still in play" are
 * different facts and treating them alike is how a setting looks like it was
 * saved when it was not.
 */

type StageType = 'Open' | 'Closed'

type StageRow = {
  id: string
  name: string
  stage_type: unknown
  is_fixed: boolean
  sort_order: number
  is_active: boolean
}

const TYPE_CHOICES: { value: StageType; label: string; help: string }[] = [
  {
    value: 'Open',
    label: 'Open — the opportunity is still running',
    help: 'An opportunity in this stage is still in play, and can move on to another stage.',
  },
  {
    value: 'Closed',
    label: 'Closed — the opportunity ends here',
    help: 'Nothing comes after this stage. Use it for outcomes such as Won and Lost.',
  },
]

function StageTypeBadge({ value }: { value: unknown }) {
  if (value === 'Closed') return <Badge variant="neutral"><Flag />Closed</Badge>
  if (value === 'Open') return <Badge variant="neutral"><CircleDashed />Open</Badge>
  return <span className="text-text-muted">Not set</span>
}

export default function LeadStagesPage() {
  const me = useMe()
  const { toast } = useToast()
  const [addingStandard, setAddingStandard] = useState(false)
  const [allRows, setAllRows] = useState<StageRow[]>([])
  const [loadFailed, setLoadFailed] = useState(false)

  // The real permission map, never a role name — Administrators get every
  // section from /api/auth/me. Denied actions show disabled with a reason.
  const locks = masterLocks(me, 'lead_stages', 'opportunity stages', 'create')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<StageRow | null>(null)
  const [name, setName] = useState('')
  const [stageType, setStageType] = useState<StageType>('Open')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [hasLoaded, setHasLoaded] = useState(false)

  const isFixed = Boolean(editing?.is_fixed)

  // True only once rows have loaded and every one of them came back without a
  // type — i.e. the column is not in the database yet. An empty list says
  // nothing either way, so it must not raise the notice.
  const typeUnavailable = allRows.length > 0 && allRows.every(r => r.stage_type == null)

  /*
   * The firm has no opportunity stages at all (`Existing` is the account
   * sentinel, not a funnel stage). Then the Opportunities board does not
   * exist and nothing can be moved, so the screen offers the standard set in
   * one action. Only once the list has actually loaded: an empty list while
   * loading or after a failure is not "no stages".
   */
  const noFunnelStages =
    hasLoaded && !loadFailed &&
    allRows.filter(r => r.name.trim().toLowerCase() !== 'existing').length === 0

  async function addStandardStages() {
    setAddingStandard(true)
    try {
      const r = await fetch('/api/masters/lead-stages/defaults', { method: 'POST' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast(body.error ?? 'Could not add the standard stages', 'error')
      } else {
        const added: string[] = Array.isArray(body.added) ? body.added : []
        toast(added.length > 0 ? `Added ${added.length} stages: ${added.join(', ')}` : 'The standard stages are already here')
        setRefreshKey(k => k + 1)
      }
    } catch {
      toast('Could not add the standard stages', 'error')
    }
    setAddingStandard(false)
  }

  function openAdd() {
    setName(''); setStageType('Open'); setEditing(null); setFormError(''); setOpen(true)
  }

  function openEdit(row: StageRow) {
    setName(row.name)
    setStageType(row.stage_type === 'Closed' ? 'Closed' : 'Open')
    setEditing(row); setFormError(''); setOpen(true)
  }

  async function handleSave() {
    setFormError('')
    if (!isFixed && !name.trim()) { setFormError('Stage Name is required.'); return }
    setSaving(true)
    const body: Record<string, unknown> = {
      name: (isFixed ? String(editing?.name ?? '') : name).trim(),
      sort_order: editing ? editing.sort_order : allRows.length,
      // Carried explicitly so a save never silently reactivates a stage the
      // admin had switched off — the route treats a missing key as `true`.
      ...(editing ? { is_active: editing.is_active } : {}),
      stage_type: stageType,
    }
    try {
      const res = await fetch(editing ? `/api/masters/lead-stages/${editing.id}` : '/api/masters/lead-stages', {
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

  async function toggleActive(row: StageRow, value: boolean) {
    // Delete is a soft delete. The toggle is how a deleted stage comes
    // back. Fixed stages may be switched off and on too; the route only
    // locks their name and position. `stage_type` is left out: absent means
    // unchanged.
    const res = await fetch(`/api/masters/lead-stages/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: row.name, sort_order: row.sort_order, is_active: value }),
    })
    if (!res.ok) { toast('Could not change status. Please try again.', 'error'); return }
    toast(value ? 'Reactivated' : 'Deactivated')
    setRefreshKey(k => k + 1)
  }

  const load: ListPageProps<StageRow>['load'] = async ({ search, signal }) => {
    const r = await fetch('/api/masters/lead-stages', { signal })
    if (!r.ok) { setLoadFailed(true); throw new Error(String(r.status)) }
    const body = await r.json()
    const rows: StageRow[] = Array.isArray(body) ? body : []
    setAllRows(rows)
    setLoadFailed(false)
    setHasLoaded(true)
    const q = search.trim().toLowerCase()
    return q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows
  }

  const columns: ListColumn<StageRow>[] = [
    {
      id: 'name',
      header: 'Stage Name',
      grow: true,
      truncate: true,
      cellClassName: 'font-medium text-text-primary',
      skeletonWidth: 'w-40',
      cell: row => row.name,
    },
    {
      id: 'stage_type',
      header: 'Stage Type',
      skeletonWidth: 'w-20',
      cell: row => <StageTypeBadge value={row.stage_type} />,
    },
    {
      id: 'origin',
      header: 'Origin',
      skeletonWidth: 'w-16',
      // Relabelled from "Type", which now belongs to the column above. The
      // badge text is unchanged: this one says where the row came from, not
      // what it means.
      cell: row => row.is_fixed ? <Badge variant="neutral">Fixed</Badge> : <Badge variant="neutral">Custom</Badge>,
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
        return (
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
        )
      },
    },
  ]

  const action = (
    <PermissionTooltip allowed={typeof locks.add !== 'string'} reason={locks.add ?? ''}>
      <Button onClick={openAdd} disabled={locks.add !== undefined}>
        <PlusIcon />
        Add Stage
      </Button>
    </PermissionTooltip>
  )

  // Drag-to-reorder, persisted the same way the legacy CrudPage/useCrud pair
  // did — one PUT per moved row, carrying `name`/`is_active` only.
  // `stage_type` is deliberately omitted: reordering is not a change of
  // meaning, and the route leaves an absent key alone. See
  // docs/kit-audit/kit-gaps.md — the kit has no list-reorder pattern. Shared
  // with master-name-page.tsx via reorderable-rows.tsx.
  const canReorder = locks.edit === undefined
  const { renderReorderableTable } = useReorderableRows<StageRow>({
    enabled: canReorder,
    apiPath: '/api/masters/lead-stages',
    buildBody: r => ({ name: r.name, is_active: r.is_active }),
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
            <BreadcrumbPage>Opportunity Stages</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {(noFunnelStages || typeUnavailable) && (
        <div className="mb-4 flex flex-col gap-3 shrink-0">
          {noFunnelStages && (
            <Banner variant="warning">
              <Info />
              <BannerTitle>No opportunity stages yet</BannerTitle>
              <BannerDescription>
                Without stages the Opportunities board is not shown and an opportunity cannot be moved on.
                Add the standard set, Prospect, Contacted, Qualified, Proposal, Negotiation, Won and Lost,
                then rename or remove any you do not use.
              </BannerDescription>
              <BannerAction>
                <PermissionTooltip allowed={typeof locks.add !== 'string'} reason={locks.add ?? ''}>
                  <Button size="sm" disabled={locks.add !== undefined || addingStandard} onClick={addStandardStages}>
                    {addingStandard ? 'Adding…' : 'Add standard stages'}
                  </Button>
                </PermissionTooltip>
              </BannerAction>
            </Banner>
          )}
          {typeUnavailable && (
            <Banner>
              <Info />
              <BannerTitle>Stage type is waiting on a database update</BannerTitle>
              <BannerDescription>
                Marking a stage Open or Closed is built and will start saving as soon as the
                pending <code>stage_type</code> column is added. Everything else on this screen works normally.
              </BannerDescription>
            </Banner>
          )}
        </div>
      )}

      <ListPage<StageRow>
        className="md:h-auto md:min-h-0 md:flex-1"
        title="Opportunity Stages"
        noun={{ one: 'stage', many: 'stages' }}
        action={action}
        columns={columns}
        rowKey={row => row.id}
        renderData={rows => renderReorderableTable(rows, columns)}
        load={load}
        refreshKey={refreshKey}
        emptyYet={{
          heading: 'No opportunity stages yet',
          body: 'Stages describe the path an opportunity moves through, from first contact to Won or Lost.',
          actionLabel: locks.add === undefined ? 'Add stage' : undefined,
          onAction: locks.add === undefined ? openAdd : undefined,
        }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Stage' : 'Add Stage'}</DialogTitle>
          </DialogHeader>
          {formError && (
            <div className="bg-danger-bg border border-danger-border text-danger text-sm rounded-lg px-4 py-3">{formError}</div>
          )}
          <div>
            <Label htmlFor="lead-stage-name">Stage Name <span className="text-danger">*</span></Label>
            <div className="mt-1">
              <Input
                id="lead-stage-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Contacted, Interested…"
                disabled={isFixed}
                autoFocus={!isFixed}
                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              />
            </div>
            {isFixed && (
              <p className="mt-1.5 text-xs text-text-secondary">
                This stage is built into the software and keeps its name and position. Its stage type can still be changed.
              </p>
            )}
          </div>

          <fieldset>
            <legend className="block text-sm font-medium text-text-secondary mb-2">Stage Type</legend>
            <RadioGroup
              value={stageType}
              onValueChange={v => setStageType(v === 'Closed' ? 'Closed' : 'Open')}
              className="gap-3"
            >
              {TYPE_CHOICES.map(choice => (
                <label key={choice.value} className="flex items-start gap-3 cursor-pointer">
                  <RadioGroupItem value={choice.value} className="mt-0.5" aria-label={choice.label} />
                  <span className="min-w-0">
                    <span className="block text-sm text-text-primary">{choice.label}</span>
                    <span className="block text-xs text-text-secondary mt-0.5">{choice.help}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
