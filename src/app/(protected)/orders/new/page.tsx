'use client'

/**
 * `/orders/new` — phone-only "Place order" flow. No desktop route exists
 * for this (desktop uses `CreateOrderDialog` inline from `/orders`), so a
 * desktop visitor is redirected to `/orders` (ground rule: new phone-only
 * create URL -> redirect to the matching desktop list page).
 *
 * One screen, three sections: Account -> Items -> Review. Totals/GST are
 * never computed here — `orderTotals()` from `src/lib/order-math.ts` (the
 * same module `POST /api/orders` uses) drives the on-screen numbers, and
 * the server re-prices and re-checks GST authoritatively on save.
 *
 * Query params:
 *   ?account=<id>   prefill the account (shared URL contract)
 *   ?from=<orderId> copy that order's account + items into this draft
 *                    (client-side read-then-post "Reorder" — no new route)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MinusIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { useLayout } from '@/lib/layout'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField } from '@/components/ui/phone-form'
import { PickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { fmtAmount } from '@/lib/format'
import { toDateStr } from '@/components/daily-activity/types'
import { orderTotals, type LineInput } from '@/lib/order-math'

type Company = {
  id: string
  name: string
  type?: string | null
  account_kind?: 'Company' | 'Individual'
  gst_number?: string | null
  is_complete?: boolean
  completeness_missing?: string | null
}

type MeLite = { permissions?: Record<string, { create?: boolean; edit?: boolean }> }

type Product = { id: string; name: string; price: number }

type DraftLine = {
  key: string
  product_id: string | null
  product_name: string
  qty: number
  rate: number
}

type PastOrder = {
  entity_id: string | null
  entity_name: string | null
  order_items: { product_id: string | null; product_name: string; qty: number; rate: number }[]
}

function newKey() {
  return Math.random().toString(36).slice(2)
}

function PhoneNewOrder() {
  const router = useRouter()
  const { toast } = useToast()
  const searchParams = useSearchParams()

  const prefillAccountId = searchParams.get('account') ?? ''
  const fromOrderId = searchParams.get('from') ?? ''

  const [account, setAccount] = useState<PickerOption | null>(null)
  const [accountDetail, setAccountDetail] = useState<Company | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [lastOrder, setLastOrder] = useState<PastOrder | null>(null)
  const [saving, setSaving] = useState(false)
  const [canCreate, setCanCreate] = useState<boolean | undefined>(undefined)
  const [canEditAccount, setCanEditAccount] = useState<boolean | undefined>(undefined)

  usePhoneAppBar({ title: 'New order', back: '/orders' })

  useEffect(() => {
    fetch('/api/auth/me').then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: MeLite) => {
        setCanCreate(Boolean(d.permissions?.orders?.create))
        setCanEditAccount(Boolean(d.permissions?.companies?.edit))
      })
      .catch(() => { setCanCreate(false); setCanEditAccount(false) })
  }, [])

  // ?account= prefill.
  useEffect(() => {
    if (!prefillAccountId) return
    fetch(`/api/companies/${prefillAccountId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: Company) => setAccount({ id: d.id, label: d.name }))
      .catch(() => toast('Could not load that account', 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillAccountId])

  // Load the chosen account's completeness/GST facts whenever it changes.
  useEffect(() => {
    if (!account) { setAccountDetail(null); return }
    let live = true
    fetch(`/api/companies/${account.id}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: Company) => { if (live) setAccountDetail(d) })
      .catch(() => { if (live) setAccountDetail(null) })
    return () => { live = false }
  }, [account])

  // ?from=<orderId> — Reorder. Copies account + items into the draft.
  useEffect(() => {
    if (!fromOrderId) return
    fetch(`/api/orders/${fromOrderId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: PastOrder & { entity_name?: string | null }) => {
        if (d.entity_id && d.entity_name) setAccount({ id: d.entity_id, label: d.entity_name })
        setLines(
          (d.order_items ?? []).map(i => ({
            key: newKey(),
            product_id: i.product_id,
            product_name: i.product_name,
            qty: i.qty,
            rate: Number(i.rate),
          }))
        )
      })
      .catch(() => toast('Could not load that order to reorder', 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromOrderId])

  // "Reorder last order" row — offered once an account with a previous
  // order is chosen, per the owner's decision in the task brief.
  useEffect(() => {
    if (!account || fromOrderId) { setLastOrder(null); return }
    let live = true
    fetch(`/api/orders?entityId=${account.id}`)
      .then(r => (r.ok ? r.json() : []))
      .then((rows: PastOrder[]) => { if (live) setLastOrder(Array.isArray(rows) && rows.length > 0 ? rows[0] : null) })
      .catch(() => { if (live) setLastOrder(null) })
    return () => { live = false }
  }, [account, fromOrderId])

  const fetchProducts = useCallback(async (q: string): Promise<PickerOption[]> => {
    const r = await fetch(`/api/masters/products?q=${encodeURIComponent(q)}`)
    if (!r.ok) return []
    const data: Product[] = await r.json()
    return data.map(p => ({ id: p.id, label: p.name, sublabel: fmtAmount(p.price) }))
  }, [])

  function addProduct(option: PickerOption) {
    // Rate shown here is advisory only — the server re-reads products.price
    // and discards whatever was posted (POST /api/orders, priceLines()).
    const price = Number(option.sublabel?.replace(/[^0-9.]/g, '') || 0)
    setLines(prev => [...prev, { key: newKey(), product_id: option.id, product_name: option.label, qty: 1, rate: price }])
  }

  function setQty(key: string, qty: number) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, qty: Math.max(1, Math.min(1_000_000, qty)) } : l)))
  }

  function removeLine(key: string) {
    setLines(prev => prev.filter(l => l.key !== key))
  }

  function applyLastOrder() {
    if (!lastOrder) return
    setLines(
      lastOrder.order_items.map(i => ({
        key: newKey(),
        product_id: i.product_id,
        product_name: i.product_name,
        qty: i.qty,
        rate: Number(i.rate),
      }))
    )
    toast('Last order copied — edit and save')
  }

  const totals = useMemo(() => {
    const lineInputs: LineInput[] = lines.map(l => ({ qty: l.qty, rate: l.rate }))
    return orderTotals(lineInputs)
  }, [lines])

  // The account's completeness as GET /api/companies/[id] already reports it
  // — that response has run `withGstPolicy` + `withMobileCompleteness`
  // (src/lib/gst-policy.ts, src/lib/completeness.ts), so `completeness_missing`
  // here is the SAME field list the server's own `placementBlock()` reads for
  // POST /api/orders. This screen never re-derives the rule, it just reads it.
  const missingFields = (accountDetail?.completeness_missing ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  const accountIncomplete = accountDetail?.is_complete === false && missingFields.length > 0

  const editAccountHref = account
    ? `/parties/companies/${account.id}/edit?next=${encodeURIComponent(
        `/orders/new?account=${account.id}${fromOrderId ? `&from=${fromOrderId}` : ''}`
      )}`
    : undefined

  async function save() {
    if (!account) { toast('Choose an account first', 'error'); return }
    if (lines.length === 0) { toast('Add at least one product', 'error'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_source: 'direct',
          entity_type: accountDetail?.type || null,
          entity_id: account.id,
          entity_name: account.label,
          order_date: toDateStr(new Date()),
          status: 'Placed',
          items: lines.map(l => ({ product_id: l.product_id, product_name: l.product_name, qty: l.qty })),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        // §3.5 no-dead-end: the server names the exact reason (e.g. missing
        // GSTIN) with a way forward — opening the account to fix it.
        toast(body.error ?? 'Could not place this order. Nothing was saved.', 'error')
        setSaving(false)
        return
      }
      toast('Order placed')
      router.push(`/orders/${body.id}`)
    } catch {
      toast('The connection dropped. The order was not placed.', 'error')
      setSaving(false)
    }
  }

  return (
    <PhoneForm
      onSave={save}
      saving={saving}
      saveLabel={canCreate === false ? 'Not allowed' : 'Place order'}
      changed={!!account || lines.length > 0}
    >
      <PhoneFormField label="Account" required>
        <PickerSheetField
          label="Account"
          value={account}
          onChange={setAccount}
          fetchOptions={async q => {
            const r = await fetch(`/api/companies?q=${encodeURIComponent(q)}`)
            if (!r.ok) return []
            const data: Company[] = await r.json()
            return data.map(c => ({ id: c.id, label: c.name }))
          }}
          onCreate={name => router.push(`/parties/new?name=${encodeURIComponent(name)}&next=${encodeURIComponent('/orders/new')}`)}
        />
      </PhoneFormField>

      {accountIncomplete && (
        <div className="flex flex-col gap-2 rounded-lg bg-warning-bg border border-warning-border px-3 py-2.5">
          <p className="text-label text-warning">
            Add <strong className="font-medium">{missingFields.join(', ')}</strong> to this account
            before ordering — an order placed against it will stay in Draft
            until these are filled in.
          </p>
          <PermissionTooltip
            allowed={canEditAccount !== false}
            reason="Only someone who can edit accounts can add these details"
          >
            <Button
              size="sm"
              disabled={canEditAccount === false || !editAccountHref}
              onClick={() => editAccountHref && router.push(editAccountHref)}
            >
              Add details
            </Button>
          </PermissionTooltip>
        </div>
      )}

      {account && lastOrder && lines.length === 0 && (
        <button
          type="button"
          onClick={applyLastOrder}
          className="flex min-h-11 items-center justify-center rounded-lg border border-dashed border-border-light px-3 text-body font-medium text-primary active:bg-surface-control"
        >
          Reorder last order
        </button>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-label font-medium text-text-secondary">Items</span>
        </div>
        <ul className="flex flex-col gap-2">
          {lines.map(line => (
            <li key={line.key} className="flex flex-col gap-2 rounded-lg border border-border-light bg-surface px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 text-body font-medium text-text-primary">{line.product_name}</span>
                <button type="button" aria-label="Remove" onClick={() => removeLine(line.key)} className="shrink-0 text-text-muted">
                  <Trash2Icon className="size-4" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    onClick={() => setQty(line.key, line.qty - 1)}
                    className="flex size-11 items-center justify-center rounded-lg border border-border-light active:bg-surface-control"
                  >
                    <MinusIcon className="size-4" />
                  </button>
                  <span className="w-10 text-center text-body font-medium tabular-nums">{line.qty}</span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    onClick={() => setQty(line.key, line.qty + 1)}
                    className="flex size-11 items-center justify-center rounded-lg border border-border-light active:bg-surface-control"
                  >
                    <PlusIcon className="size-4" />
                  </button>
                </div>
                <span className="text-body text-text-secondary tabular-nums">
                  {fmtAmount(line.rate)} · {fmtAmount(line.rate * line.qty)}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <PickerSheetField
          label="Add product"
          value={null}
          onChange={addProduct}
          fetchOptions={fetchProducts}
          placeholder="+ Add product"
        />
      </div>

      {lines.length > 0 && (
        <div className="rounded-xl bg-surface-sunken px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-label">
            <span className="text-text-secondary">Subtotal</span>
            <span className="text-text-primary tabular-nums">{fmtAmount(totals.gross_amount)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border-light pt-2">
            <span className="text-body font-medium text-text-secondary">Total</span>
            <span className="text-card-heading font-medium text-text-primary tabular-nums">
              {fmtAmount(totals.total_amount)}
            </span>
          </div>
          <p className="text-meta text-text-muted">
            GST and any order-level discount are applied by the server when the order is placed.
          </p>
        </div>
      )}
    </PhoneForm>
  )
}

export default function NewOrderPage() {
  const router = useRouter()
  const { layout } = useLayout()

  useEffect(() => {
    if (layout === 'desktop') router.replace('/orders')
  }, [layout, router])

  if (layout !== 'phone') return null
  return <PhoneNewOrder />
}
