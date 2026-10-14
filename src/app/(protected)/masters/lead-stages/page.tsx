'use client'

import { useState } from 'react'
import { CircleDashed, Flag, Info } from 'lucide-react'
import CrudPage, { Column, masterLocks } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import { Badge } from '@/components/ui/badge'
import { Banner, BannerAction, BannerDescription, BannerTitle } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { useToast } from '@/contexts/ToastContext'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'

/**
 * Opportunity Stages master (labelled Lead Stages until 13 Oct 2026; the `deal_stages` table — the names diverged when Leads
 * became Deals; `lead_stages` is still the immutable permission key).
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
  if (value === 'Closed') {
    return <Badge variant="primary"><Flag />Closed</Badge>
  }
  if (value === 'Open') {
    return <Badge variant="neutral"><CircleDashed />Open</Badge>
  }
  return <span className="text-text-muted">Not set</span>
}

const COLS: Column[] = [
  { key: 'name', label: 'Stage Name' },
  { key: 'stage_type', label: 'Stage Type', render: r => <StageTypeBadge value={r.stage_type} /> },
  // Relabelled from "Type", which now belongs to the column above. The badge
  // text is unchanged: this one says where the row came from, not what it means.
  { key: 'is_fixed', label: 'Origin', render: r => r.is_fixed
    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface-control text-text-secondary">Fixed</span>
    : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-subtle text-primary">Custom</span>
  },
]

export default function LeadStagesPage() {
  const crud = useCrud('/api/masters/lead-stages')
  const me = useMe()
  const { toast } = useToast()
  const [addingStandard, setAddingStandard] = useState(false)

  // The real permission map, never a role name — Administrators get every
  // section from /api/auth/me. Denied actions show disabled with a reason.
  const locks = masterLocks(me, 'lead_stages', 'opportunity stages', 'create')

  const [open, setOpen]         = useState(false)
  const [editing, setEditing]   = useState<Record<string, unknown> | null>(null)
  const [name, setName]         = useState('')
  const [stageType, setStageType] = useState<StageType>('Open')
  const [saving, setSaving]     = useState(false)

  const isFixed = Boolean(editing?.is_fixed)

  // True only once rows have loaded and every one of them came back without a
  // type — i.e. the column is not in the database yet. An empty list says
  // nothing either way, so it must not raise the notice.
  const typeUnavailable =
    crud.allRows.length > 0 && crud.allRows.every(r => r.stage_type == null)

  /*
   * The firm has no opportunity stages at all (`Existing` is the account
   * sentinel, not a funnel stage). Then the Opportunities board does not
   * exist and nothing can be moved, so the screen offers the standard set in
   * one action. Only once the list has actually loaded: an empty list while
   * loading or after a failure is not "no stages".
   */
  const noFunnelStages =
    !crud.isLoading && !crud.loadError &&
    crud.allRows.filter(r => String(r.name ?? '').trim().toLowerCase() !== 'existing').length === 0

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
        crud.refetch()
      }
    } catch {
      toast('Could not add the standard stages', 'error')
    }
    setAddingStandard(false)
  }

  function openAdd() {
    setName(''); setStageType('Open'); setEditing(null); setOpen(true)
  }

  function openEdit(row: Record<string, unknown>) {
    setName(String(row.name ?? ''))
    setStageType(row.stage_type === 'Closed' ? 'Closed' : 'Open')
    setEditing(row); setOpen(true)
  }

  async function handleSave() {
    if (!isFixed && !name.trim()) return
    setSaving(true)
    const body = {
      name: (isFixed ? String(editing?.name ?? '') : name).trim(),
      sort_order: editing ? editing.sort_order : crud.allRows.length,
      // Carried explicitly so a save never silently reactivates a stage the
      // admin had switched off — the route treats a missing key as `true`.
      ...(editing ? { is_active: editing.is_active } : {}),
      stage_type: stageType,
    }
    const ok = editing ? await crud.update(editing.id as string, body) : await crud.create(body)
    setSaving(false)
    if (ok !== false && ok !== null) setOpen(false)
  }

  // One PUT per moved row, one toast, one refetch; the order is put back if
  // any of them fails. `sort_order` is assigned by the hook.
  function handleReorder(newRows: Record<string, unknown>[]) {
    return crud.reorder(newRows, row => ({
      name: row.name,
      is_active: row.is_active,
      // `stage_type` is omitted deliberately: reordering is not a change of
      // meaning, and the route leaves an absent key alone.
    }))
  }

  return (
    <>
      <CrudPage
        title="Opportunity Stages" backHref="/masters" columns={COLS}
        rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        loadError={crud.loadError} onRetry={crud.refetch} locks={locks}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={openAdd}
        // A fixed stage keeps its name and its position, but whether it ends
        // the deal is still the admin's call — so Edit opens for it too, with
        // the name locked. Previously the button was there and did nothing.
        onEdit={openEdit}
        // Delete is a soft delete. The toggle is how a deleted stage comes
        // back — without it the row is listed but can never be restored.
        // Fixed stages may be switched off and on too; the route only locks
        // their name and position. `stage_type` is left out: absent means
        // unchanged.
        onToggleActive={(r, v) => crud.update(r.id as string, { name: r.name, sort_order: r.sort_order, is_active: v })}
        // Returned so the confirm dialog waits for the delete and CrudPage can
        // toast its failure.
        onDelete={r => crud.remove(r.id as string)} deleteMode="soft"
        deleteDisabledReason={r => r.is_fixed ? "Fixed stages can't be deleted" : null}
        onReorder={handleReorder}
        filterBar={noFunnelStages || typeUnavailable ? (
          <div className="flex flex-col gap-3">
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
                {/* `locks.add`: null = permissions not known yet (disabled,
                    no reason), undefined = allowed, string = the reason. */}
                <PermissionTooltip
                  allowed={typeof locks.add !== 'string'}
                  reason={locks.add ?? ''}
                >
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
        ) : undefined}
      />
      <Modal title={editing ? 'Edit Stage' : 'Add Stage'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <label htmlFor="lead-stage-name" className="block text-sm font-medium text-text-secondary mb-1">Stage Name <span className="text-danger">*</span></label>
          <input id="lead-stage-name" name="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Contacted, Interested…"
            disabled={isFixed}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring disabled:bg-surface-sunken disabled:text-text-muted"
            autoFocus={!isFixed} />
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
      </Modal>
    </>
  )
}
