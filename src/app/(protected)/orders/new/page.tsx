'use client'

/**
 * `/orders/new` — phone-only "Place order" flow. No desktop route exists
 * for this (desktop uses `CreateOrderDialog` inline from `/orders`), so a
 * desktop visitor is redirected to `/orders` (ground rule: new phone-only
 * create URL -> redirect to the matching desktop list page).
 *
 * One screen: Account -> Details (sales executive, date, status) -> Items ->
 * Review. It carries what the desktop dialog carries: a discount on each
 * line, a discount on the whole order, the order date, the Draft / Placed
 * choice, and the sales-executive pick for a manager placing an order for
 * someone on their team. Same payload, same validation words.
 *
 * Totals/GST are never computed here beyond the preview — `orderTotals()`
 * from `src/lib/order-math.ts` (the same module `POST /api/orders` uses)
 * drives the on-screen numbers, and the server re-prices from the Product
 * Master and re-checks completeness authoritatively on save.
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
import { useMe } from '@/hooks/useMe'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { PhoneForm, PhoneFormField } from '@/components/ui/phone-form'
import { PickerSheetField, type PickerOption } from '@/components/ui/picker-sheet'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Input } from '@/components/ui/input'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { fmtAmount } from '@/lib/format'
import { toDateStr } from '@/components/daily-activity/types'
import { toDiscount, type DiscountUnit } from '@/components/orders/discount-field'
import { OptionSelect } from '@/components/orders/option-select'
import { lineInput, type OrderLine } from '@/components/orders/order-line-items'
import { lineTotals, orderTotals, ORDER_STATUSES, type OrderStatus } from '@/lib/order-math'
import { PhoneDiscountField } from '../phone-discount-field'

type Company = {
  id: string
  name: string
  type?: string | null
  account_kind?: 'Company' | 'Individual'
  gst_number?: string | null
  is_complete?: boolean
  completeness_missing?: string | null
}

/** `self` marks the caller; `?for=orders` adds it (GET /api/orders/team). */
type TeamMember = { id: string; name: string; self?: boolean }

const STATUS_OPTIONS: Record<string, string> = Object.fromEntries(ORDER_STATUSES.map(s => [s, s]))

type Product = { id: string; name: string; price: number }

/** The desktop form's own line (product, qty, discount) plus what the phone shows for it. */
type DraftLine = OrderLine & {
  product_name: string
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

/** A line with no discount; callers spread the product facts over it. */
function blankLine(): DraftLine {
  return {
    key: newKey(),
    product_id: null,
    product_name: '',
    qty: 1,
    rate: 0,
    discount_unit: 'percent',
    discount_value: 0,
  }
}

function PhoneNewOrder() {
  const router = useRouter()
  const { toast } = useToast()
  const searchParams = useSearchParams()

  const prefillAccountId = searchParams.get('account') ?? ''
  const fromOrderId = searchParams.get('from') ?? ''
  // ?visit=<daily_visit id>: an order taken in a meeting. Same call and same
  // rules as desktop's Order entry on a meeting: POST with `visit_id` and the
  // meeting's date; the route saves it as a Draft for the caller and keeps one
  // order per meeting (orders.visit_id is unique).
  const visitId = searchParams.get('visit') ?? ''
  const [visitDate, setVisitDate] = useState<Date | null>(null)
  const [visitReady, setVisitReady] = useState(!visitId)

  const [account, setAccount] = useState<PickerOption | null>(null)
  const [accountDetail, setAccountDetail] = useState<Company | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [lastOrder, setLastOrder] = useState<PastOrder | null>(null)
  const [saving, setSaving] = useState(false)

  const [orderDate, setOrderDate] = useState<Date | undefined>(() => new Date())
  const [status, setStatus] = useState<OrderStatus>('Draft')
  // A new order defaults to Draft, like desktop; an incomplete account can only
  // ever be a Draft until it is completed.
  const [statusTouched, setStatusTouched] = useState(false)
  const [orderDiscountUnit, setOrderDiscountUnit] = useState<DiscountUnit>('percent')
  const [orderDiscountValue, setOrderDiscountValue] = useState(0)

  // Sales executive, for a manager placing an order for someone on their team.
  const [salesExecs, setSalesExecs] = useState<TeamMember[]>([])
  const [salesUserId, setSalesUserId] = useState('')
  const [teamFailed, setTeamFailed] = useState(false)
  const [teamReload, setTeamReload] = useState(0)

  const me = useMe()
  // `orders.create` is what POST /api/orders checks; `companies.edit` what the
  // account fix-up screen needs. `undefined` while /me is loading.
  const canCreate = me ? Boolean(me.permissions?.orders?.create) : undefined
  const canEditAccount = me ? Boolean(me.permissions?.companies?.edit) : undefined
  const hasSubordinates = Boolean(me?.hasSubordinates)

  usePhoneAppBar({ title: 'New order', back: '/orders' })

  // Same list, same opt-in, same default as the desktop dialog: only the
  // people the caller may record an order for, the caller preselected.
  useEffect(() => {
    if (!hasSubordinates) return
    let live = true
    setSalesUserId('')
    setTeamFailed(false)
    fetch('/api/orders/team?for=orders')
      .then(r => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then(d => {
        if (!live) return
        const team: TeamMember[] = Array.isArray(d) ? d : []
        setSalesExecs(team)
        setSalesUserId(team.find(m => m.self)?.id ?? '')
      })
      .catch(() => { if (live) { setSalesExecs([]); setTeamFailed(true) } })
    return () => { live = false }
  }, [hasSubordinates, teamReload])

  // ?visit= — the meeting's account and date. A meeting that already has an
  // order opens that order (the one-order-per-meeting rule) rather than
  // starting a second one.
  useEffect(() => {
    if (!visitId) return
    let live = true
    ;(async () => {
      try {
        const existing = await fetch(`/api/orders?visitId=${encodeURIComponent(visitId)}`)
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)
        if (!live) return
        if (existing?.id) {
          toast('This meeting already has an order. Opening it.')
          router.replace(`/orders/${existing.id}`)
          return
        }
        const r = await fetch(`/api/daily-activity/${visitId}`)
        if (!r.ok) throw new Error(String(r.status))
        const d = (await r.json()) as {
          visit?: { entity_id?: string | null; entity_name?: string | null; start_time?: string | null }
        }
        if (!live) return
        const v = d.visit
        if (v?.entity_id && v.entity_name) setAccount({ id: v.entity_id, label: v.entity_name })
        setVisitDate(v?.start_time ? new Date(v.start_time) : new Date())
        setVisitReady(true)
      } catch {
        if (live) toast('Could not load that meeting', 'error')
      }
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId])

  // ?account= prefill.
  useEffect(() => {
    if (!prefillAccountId || visitId) return
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
            ...blankLine(),
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
    setLines(prev => [...prev, { ...blankLine(), product_id: option.id, product_name: option.label, rate: price }])
  }

  function patchLine(key: string, patch: Partial<DraftLine>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  function setQty(key: string, qty: number) {
    patchLine(key, { qty: Math.max(1, Math.min(1_000_000, qty)) })
  }

  function removeLine(key: string) {
    setLines(prev => prev.filter(l => l.key !== key))
  }

  function applyLastOrder() {
    if (!lastOrder) return
    setLines(
      lastOrder.order_items.map(i => ({
        ...blankLine(),
        product_id: i.product_id,
        product_name: i.product_name,
        qty: i.qty,
        rate: Number(i.rate),
      }))
    )
    toast('Last order copied — edit and save')
  }

  // The same function the route runs, over the same line shape the desktop
  // form builds, so the on-screen figures are a preview of the server's answer.
  const orderDiscount = toDiscount(orderDiscountUnit, orderDiscountValue)
  const totals = useMemo(
    () =>
      orderTotals(
        lines.map(l => lineInput(l, l.rate)),
        orderDiscount.discount_type,
        orderDiscount.discount_value
      ),
    [lines, orderDiscount.discount_type, orderDiscount.discount_value]
  )

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

  useEffect(() => {
    if (!statusTouched && accountIncomplete) setStatus('Draft')
  }, [accountIncomplete, statusTouched])

  const editAccountHref = account
    ? `/parties/companies/${account.id}/edit?next=${encodeURIComponent(
        `/orders/new?account=${account.id}${fromOrderId ? `&from=${fromOrderId}` : ''}`
      )}`
    : undefined

  async function save() {
    if (saving) return
    // The desktop dialog's own checks, in its own words.
    if (canCreate === false) { toast('Only someone who can create orders can place one', 'error'); return }
    if (visitId) {
      if (!visitReady) return
      if (lines.length === 0) { toast('Add at least one product', 'error'); return }
      if (totals.total_amount <= 0) { toast('The order total must be more than zero', 'error'); return }
      setSaving(true)
      try {
        const r = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visit_id: visitId,
            order_date: toDateStr(visitDate ?? new Date()),
            items: lines.map(l => ({
              ...(l.product_id
                ? { product_id: l.product_id, product_name: l.product_name, qty: l.qty }
                : { product_id: null, product_name: l.product_name, qty: l.qty, rate: l.rate }),
              ...toDiscount(l.discount_unit, l.discount_value),
            })),
            order_discount_type: orderDiscount.discount_type,
            order_discount_value: orderDiscount.discount_value,
          }),
        })
        const resBody = await r.json().catch(() => ({}))
        if (!r.ok) {
          toast(resBody.error ?? 'Failed to save the order', 'error')
          setSaving(false)
          return
        }
        toast('Order saved')
        router.push(`/orders/${resBody.id}`)
      } catch {
        toast('The connection dropped. The order was not saved.', 'error')
        setSaving(false)
      }
      return
    }
    if (!account) { toast('Select the party this order is for', 'error'); return }
    if (!orderDate) { toast('Pick an order date', 'error'); return }
    if (hasSubordinates && !teamFailed && !salesUserId) { toast('Select the sales executive', 'error'); return }
    if (lines.length === 0) { toast('Add at least one product', 'error'); return }
    if (totals.total_amount <= 0) { toast('The order total must be more than zero', 'error'); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        order_source: 'direct',
        entity_type: accountDetail?.type || null,
        entity_id: account.id,
        entity_name: account.label,
        order_date: toDateStr(orderDate),
        status,
        order_discount_type: orderDiscount.discount_type,
        order_discount_value: orderDiscount.discount_value,
        items: lines.map(l => ({
          product_id: l.product_id,
          qty: l.qty,
          // A copied line with no master product has nothing for the server
          // to read a name or rate from; every other line is priced from the master.
          ...(l.product_id ? {} : { product_name: l.product_name, rate: l.rate }),
          ...toDiscount(l.discount_unit, l.discount_value),
        })),
      }
      if (hasSubordinates && salesUserId) body.sales_user_id = salesUserId

      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const resBody = await r.json().catch(() => ({}))
      if (!r.ok) {
        // §3.5 no-dead-end: the server names the exact reason (e.g. missing
        // GSTIN) with a way forward — opening the account to fix it.
        toast(resBody.error ?? 'Could not create the order. Nothing was saved.', 'error')
        setSaving(false)
        return
      }
      toast(status === 'Draft' ? 'Draft saved' : 'Order placed')
      router.push(`/orders/${resBody.id}`)
    } catch {
      toast('The connection dropped. The order was not saved.', 'error')
      setSaving(false)
    }
  }

  const salesExecOptions = Object.fromEntries(salesExecs.map(m => [m.id, m.name]))
  const validLineCount = lines.length

  return (
    <PhoneForm
      onSave={save}
      saving={saving}
      saveLabel={
        canCreate === false ? 'Not allowed' : visitId ? 'Save order' : status === 'Draft' ? 'Save draft' : 'Place order'
      }
      changed={lines.length > 0 || (!visitId && !!account)}
    >
      <PhoneFormField
        label="Account"
        required
        hint={visitId ? 'Taken in this meeting. Saved as a Draft, one order per meeting.' : undefined}
      >
        <PickerSheetField
          label="Account"
          value={account}
          disabled={Boolean(visitId)}
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

      {!visitId && accountIncomplete && (
        <div className="flex flex-col gap-2 rounded-lg bg-warning-bg border border-warning-border px-3 py-2.5">
          <p className="text-label text-warning">
            Add <strong className="font-medium">{missingFields.join(', ')}</strong> to this account
            before placing an order — until then it can only be saved as a Draft.
          </p>
          <PermissionTooltip
            allowed={canEditAccount !== false}
            reason="Only someone who can edit accounts can add these details"
          >
            <Button
              size="sm"
              disabled={canEditAccount !== true || !editAccountHref}
              onClick={() => editAccountHref && router.push(editAccountHref)}
            >
              Add details
            </Button>
          </PermissionTooltip>
        </div>
      )}

      {!visitId && hasSubordinates ? (
        <PhoneFormField label="Sales executive" required>
          {teamFailed ? (
            <div className="flex flex-col gap-2">
              <Input value="You" readOnly disabled />
              <InlineFieldError className="mt-0">
                Your team could not be loaded, so this order will be booked for you. Retry to pick someone else.
              </InlineFieldError>
              <Button variant="secondary" className="min-h-11" onClick={() => setTeamReload(n => n + 1)}>
                Retry
              </Button>
            </div>
          ) : (
            <OptionSelect
              id="order-sales-exec"
              options={salesExecOptions}
              value={salesUserId}
              onValueChange={setSalesUserId}
              placeholder="Select a team member"
              searchPlaceholder="Search your team"
              className="max-w-none"
            />
          )}
        </PhoneFormField>
      ) : null}

      {!visitId && (
      <PhoneFormField label="Order date" required>
        <DatePicker id="order-date" value={orderDate} onValueChange={setOrderDate} />
      </PhoneFormField>
      )}

      {!visitId && (
      <PhoneFormField
        label="Status"
        required
        hint={status === 'Placed' ? 'Only a party whose record is complete can have an order placed against it.' : undefined}
      >
        <OptionSelect
          id="order-status"
          options={STATUS_OPTIONS}
          value={status}
          onValueChange={v => {
            setStatusTouched(true)
            setStatus(v as OrderStatus)
          }}
          className="max-w-none"
        />
      </PhoneFormField>
      )}

      {!visitId && account && lastOrder && lines.length === 0 && (
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
          {lines.map(line => {
            const t = lineTotals(lineInput(line, line.rate))
            return (
              <li key={line.key} className="flex flex-col gap-2 rounded-lg border border-border-light bg-surface px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 text-body font-medium text-text-primary">{line.product_name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${line.product_name}`}
                    onClick={() => removeLine(line.key)}
                    className="-m-2 flex size-11 shrink-0 items-center justify-center text-text-muted active:text-danger"
                  >
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
                    {fmtAmount(line.rate)} · {fmtAmount(t.gross_amount)}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${line.key}-discount`} className="text-label text-text-secondary">
                    Discount on this line
                  </label>
                  <PhoneDiscountField
                    id={`${line.key}-discount`}
                    label="Line discount"
                    unit={line.discount_unit}
                    value={line.discount_value}
                    onChange={d => patchLine(line.key, { discount_unit: d.unit, discount_value: d.value })}
                  />
                  {t.discount_amount > 0 ? (
                    <span className="text-label tabular-nums text-warning">
                      −{fmtAmount(t.discount_amount)} · line total {fmtAmount(t.amount)}
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
        <PickerSheetField
          label="Add product"
          value={null}
          onChange={addProduct}
          fetchOptions={fetchProducts}
          placeholder="+ Add product"
        />
      </div>

      {validLineCount > 0 && (
        <div className="rounded-xl bg-surface-sunken px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center justify-between text-label">
            <span className="text-text-secondary">Subtotal</span>
            <span className="text-text-primary tabular-nums">{fmtAmount(totals.gross_amount)}</span>
          </div>
          {totals.item_discount_total > 0 ? (
            <div className="flex items-center justify-between text-label">
              <span className="text-text-secondary">Line discounts</span>
              <span className="tabular-nums text-warning">−{fmtAmount(totals.item_discount_total)}</span>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="order-overall-discount" className="text-label text-text-secondary">
              Discount on the whole order
            </label>
            <PhoneDiscountField
              id="order-overall-discount"
              label="Order discount"
              unit={orderDiscountUnit}
              value={orderDiscountValue}
              onChange={d => {
                setOrderDiscountUnit(d.unit)
                setOrderDiscountValue(d.value)
              }}
            />
            {totals.order_discount_amount > 0 ? (
              <span className="text-label tabular-nums text-warning">−{fmtAmount(totals.order_discount_amount)}</span>
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t border-border-light pt-2">
            <span className="text-body font-medium text-text-secondary">Total payable</span>
            <span className="text-card-heading font-medium text-text-primary tabular-nums">
              {fmtAmount(totals.total_amount)}
            </span>
          </div>
          <p className="text-meta text-text-muted">
            Rates come from the Product Master and are applied by the server, so the saved order is priced from the master.
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
