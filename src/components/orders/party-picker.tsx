'use client'

import { useCallback, useEffect, useState } from 'react'
import { PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { OptionSelect } from '@/components/orders/option-select'
import {
  QuickCreateDialog,
  type QuickCreated,
} from '@/app/(protected)/parties/quick-create-dialog'

/**
 * F17 — "record type is not need rather than that simple heading with drop
 * down and create new lead button".
 *
 * ---------------------------------------------------------------------------
 * WHAT THE REMOVED CONTROLS ACTUALLY WROTE
 *
 * The form had two selectors above the party, and they were not the same kind
 * of thing:
 *
 *   "Lead Type"   — a dropdown of `company_types`. Its value was POSTED as
 *                   `orders.entity_type`, and it also filtered the list below.
 *   "Record Type" — three chips, Existing / Lead / New. Client state only.
 *                   It was NEVER posted: it chose `?status=existing|lead` on
 *                   the partner fetch, or switched to a free-text name.
 *
 * So "Record Type" wrote nothing and could go. "Lead Type" wrote a real
 * column, and deleting the control without deciding what replaces it would
 * have left `entity_type` null on every new order — a join key the Orders
 * list renders in its own column and the detail drawer shows as "Type".
 *
 * It did not need to be asked. `entity_type` held "Dealer" / "Distributor" /
 * "Institution", which is exactly `companies.type` on the party being ordered
 * against — the user was being asked to restate a fact the chosen record
 * already carries, and nothing stopped them restating it wrongly. So the
 * picker below reports the selected party's own `type` as `entity_type`. A
 * party with no type set (Quick Create leaves it blank) reports null rather
 * than an empty string, because "not classified" is the truth and `''` would
 * match no `?type=` filter while looking like a value.
 *
 * ---------------------------------------------------------------------------
 * ONE LIST, NOT A TYPE FILTER AND THEN A LIST
 *
 * Leads and existing parties are one dropdown now. They are one table, they
 * are both orderable, and making the user pick the right of three chips
 * before the names appeared was the reason the old control existed at all.
 *
 * The "New" chip is gone and NOT mourned: it posted a typed name with no
 * `entity_id`, and §3.5's gate answers "Party is not a saved record" to every
 * one of those — so it could only ever produce a Draft that nobody could
 * place. "Create new lead" saves the record first, through the same
 * `QuickCreateDialog` and the same `POST /api/companies` the Parties screen
 * uses, and then selects it. The order is then against a real party, and the
 * gate can say something the user can act on.
 */

export type Party = {
  id: string
  name: string
  type: string | null
  stage: string | null
  is_active: boolean
  is_complete: boolean
  completeness_missing: string | null
}

export function PartyPicker({
  value,
  onChange,
  canCreate,
}: {
  value: Party | null
  onChange: (party: Party | null) => void
  /**
   * Real permission, never a role name: `/api/auth/me` reports a section's
   * `edit` as `can_edit || can_create`, and `POST /api/companies` authorises
   * on `can_create ?? can_edit`. A user without it is not shown a button
   * whose only outcome is a 403.
   */
  canCreate: boolean
}) {
  const [parties, setParties] = useState<Party[] | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)

  const loadParties = useCallback(async (): Promise<Party[]> => {
    const r = await fetch('/api/companies')
    if (!r.ok) return []
    const body = await r.json()
    const rows: Party[] = Array.isArray(body) ? body : []
    return rows.filter(p => p.is_active)
  }, [])

  useEffect(() => {
    let live = true
    loadParties().then(rows => { if (live) setParties(rows) })
    return () => { live = false }
  }, [loadParties])

  /* The label carries the type because the three chips used to keep
     same-named parties of different types apart, and one flat list would
     otherwise show two identical rows. */
  const options = Object.fromEntries(
    (parties ?? []).map(p => [p.id, p.type ? `${p.name} · ${p.type}` : p.name])
  )

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-label font-medium text-text-primary">Party</h4>
        {canCreate ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setQuickOpen(true)}
            className="w-full sm:w-auto"
          >
            <PlusIcon />
            Create new lead
          </Button>
        ) : null}
      </div>

      {parties === null ? (
        <Skeleton className="h-control w-full" />
      ) : parties.length === 0 ? (
        <p className="text-body text-text-secondary">
          No parties are visible to you yet.
          {canCreate ? ' Create one to raise an order against it.' : ''}
        </p>
      ) : (
        <>
          <Label htmlFor="order-party" className="sr-only">
            Party
          </Label>
          <OptionSelect
            id="order-party"
            options={options}
            value={value?.id ?? ''}
            onValueChange={id =>
              onChange((parties ?? []).find(p => p.id === id) ?? null)
            }
            placeholder="Select a party"
            searchPlaceholder="Search parties"
            emptyMessage="No party matches that search."
            className="max-w-none"
          />
        </>
      )}

      {/* §3.5, said before the refusal rather than by it. The gate is the
          server's; this only repeats what the party record already says. */}
      {value && !value.is_complete ? (
        <p className="text-label text-text-secondary">
          This party is incomplete
          {value.completeness_missing ? `: ${value.completeness_missing}` : ''}.
          An order against it can be saved as a Draft but not Placed.
        </p>
      ) : null}

      <QuickCreateDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        onCreated={async (created: QuickCreated) => {
          /* Re-read rather than splice the response in: the list is scoped
             by `owner_user_id` server-side, and a row this screen invented
             would be a row the next reload does not have. */
          const rows = await loadParties()
          setParties(rows)
          onChange(rows.find(p => p.id === created.id) ?? null)
        }}
      />
    </section>
  )
}
