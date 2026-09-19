'use client'

import { useEffect, useMemo, useState } from 'react'

import { useToast } from '@/contexts/ToastContext'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { DiscountField, toDiscount, type DiscountUnit } from '@/components/orders/discount-field'
import { OptionSelect } from '@/components/orders/option-select'
import {
  OrderLineItems,
  lineInput,
  newOrderLine,
  type OrderLine,
  type Product,
} from '@/components/orders/order-line-items'
import { PartyPicker, type Party } from '@/components/orders/party-picker'
import { fmtAmount, fmtQty } from '@/lib/format'
import { orderTotals, ORDER_STATUSES, type OrderStatus } from '@/lib/order-math'

/**
 * The Create Order form, F16 / F17 / F18.
 *
 * Lifted out of `app/(protected)/orders/page.tsx`, where it was a 430-line
 * function in a 1,292-line file next to the list, the detail drawer, the
 * column definitions and the filters. Nothing about it is page-specific.
 *
 * ---------------------------------------------------------------------------
 * WHAT GOES ON THE WIRE, AND WHAT DOES NOT
 *
 * A line sends `product_id`, `qty` and its discount. No rate and no product
 * name: `POST /api/orders` reads BOTH from `products.price` / `products.name`
 * for any line carrying a `product_id` and discards whatever was posted. That
 * is not a formality — without it §7.4's "Discount Given by Sales Person"
 * would report over numbers the sales person typed, and a rep could post
 * `rate: 1` against a real product, record no discount, take the whole margin
 * and appear nowhere in the discount report.
 *
 * The totals on screen are computed by `orderTotals`, the same function the
 * route runs, over the master prices this dialog read. They are a PREVIEW of
 * the server's answer. A rate forged in the browser would change this preview
 * and nothing else; the order comes back priced from the master.
 *
 * `entity_type` is the selected party's own `companies.type` — see
 * `party-picker.tsx` for why it is no longer asked for.
 */

type TeamMember = { id: string; name: string }

/** Local calendar date as `YYYY-MM-DD`. Never `toISOString`, which is UTC. */
function toDateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const STATUS_OPTIONS: Record<string, string> = Object.fromEntries(
  ORDER_STATUSES.map(s => [s, s])
)

export function CreateOrderDialog({
  open,
  onOpenChange,
  onSaved,
  hasSubordinates,
  canCreateParty,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  hasSubordinates: boolean
  /** `companies` create rights, read from `/api/auth/me` by the page. */
  canCreateParty: boolean
}) {
  const { toast } = useToast()

  const [party, setParty] = useState<Party | null>(null)
  const [salesExecs, setSalesExecs] = useState<TeamMember[]>([])
  const [salesUserId, setSalesUserId] = useState('')
  const [orderDate, setOrderDate] = useState<Date | undefined>(() => new Date())
  const [status, setStatus] = useState<OrderStatus>('Draft')

  const [products, setProducts] = useState<Product[] | null>(null)
  const [lines, setLines] = useState<OrderLine[]>(() => [newOrderLine()])

  /* §4.10's second discount: one off the order, on top of any line ones. */
  const [orderDiscountUnit, setOrderDiscountUnit] = useState<DiscountUnit>('percent')
  const [orderDiscountValue, setOrderDiscountValue] = useState(0)

  const [saving, setSaving] = useState(false)

  /* A fresh dialog every time it opens. Reopening after a save used to show
     the last order's lines still sitting there. */
  useEffect(() => {
    if (!open) return
    setParty(null)
    setOrderDate(new Date())
    setStatus('Draft')
    setLines([newOrderLine()])
    setOrderDiscountUnit('percent')
    setOrderDiscountValue(0)
    setSaving(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    let live = true
    fetch('/api/masters/products')
      .then(r => (r.ok ? r.json() : []))
      .then(d => { if (live) setProducts(Array.isArray(d) ? d : []) })
      .catch(() => { if (live) { setProducts([]); toast('Failed to load products', 'error') } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !hasSubordinates) return
    let live = true
    fetch('/api/orders/team')
      .then(r => (r.ok ? r.json() : []))
      .then(d => {
        if (!live) return
        const team: TeamMember[] = Array.isArray(d) ? d : []
        setSalesExecs(team)
        setSalesUserId(prev => prev || (team[0]?.id ?? ''))
      })
      .catch(() => { if (live) toast('Failed to load team members', 'error') })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasSubordinates])

  const priceOf = useMemo(() => {
    const map = new Map((products ?? []).map(p => [p.id, Number(p.price)]))
    return (id: string | null) => (id ? map.get(id) ?? 0 : 0)
  }, [products])

  const validLines = lines.filter(l => l.product_id && l.qty > 0)
  const orderDiscount = toDiscount(orderDiscountUnit, orderDiscountValue)
  const totals = orderTotals(
    validLines.map(l => lineInput(l, priceOf(l.product_id))),
    orderDiscount.discount_type,
    orderDiscount.discount_value
  )
  const totalQty = validLines.reduce((s, l) => s + l.qty, 0)

  async function save() {
    if (saving) return
    if (!party) { toast('Select the party this order is for', 'error'); return }
    if (!orderDate) { toast('Pick an order date', 'error'); return }
    if (validLines.length === 0) { toast('Add at least one product', 'error'); return }
    if (totals.total_amount <= 0) { toast('The order total must be more than zero', 'error'); return }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        order_source: 'direct',
        /* The party's own classification, not a second answer to it. Blank
           on a Quick Created party, which is `null` rather than `''`. */
        entity_type: party.type || null,
        entity_id: party.id,
        entity_name: party.name,
        order_date: toDateOnly(orderDate),
        status,
        order_discount_type: orderDiscount.discount_type,
        order_discount_value: orderDiscount.discount_value,
        items: validLines.map(l => ({
          product_id: l.product_id,
          qty: l.qty,
          ...toDiscount(l.discount_unit, l.discount_value),
        })),
      }
      if (hasSubordinates && salesUserId) body.sales_user_id = salesUserId

      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        /* §3.5's refusal names the missing fields. Replacing it with
           "Failed to create order" throws away the actionable half. */
        const err = await r.json().catch(() => ({})) as { error?: string }
        toast(err.error ?? 'Could not create the order', 'error')
        setSaving(false)
        return
      }
      toast('Order created')
      onSaved()
      onOpenChange(false)
    } catch {
      toast('Network error', 'error')
    }
    setSaving(false)
  }

  const salesExecOptions = Object.fromEntries(salesExecs.map(m => [m.id, m.name]))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Section 24 `lg` — 800px. A line grid is content that benefits from
          width; at the old 560px the discount column had nowhere to go. */}
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Create order</DialogTitle>
          <DialogDescription>
            Rates come from the Product Master and are applied by the server,
            so the saved order is priced from the master.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <PartyPicker value={party} onChange={setParty} canCreate={canCreateParty} />

          <Separator />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="order-sales-exec" required={hasSubordinates}>
                Sales executive
              </Label>
              <div className="mt-1.5">
                {hasSubordinates ? (
                  <OptionSelect
                    id="order-sales-exec"
                    options={salesExecOptions}
                    value={salesUserId}
                    onValueChange={setSalesUserId}
                    placeholder="Select a team member"
                    searchPlaceholder="Search your team"
                    className="max-w-none"
                  />
                ) : (
                  /* Not a one-option dropdown: there is no choice to make. */
                  <Input id="order-sales-exec" value="You" readOnly disabled />
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="order-date" required>Order date</Label>
              <div className="mt-1.5">
                <DatePicker id="order-date" value={orderDate} onValueChange={setOrderDate} />
              </div>
            </div>

            <div>
              <Label htmlFor="order-status" required>Status</Label>
              <div className="mt-1.5">
                <OptionSelect
                  id="order-status"
                  options={STATUS_OPTIONS}
                  value={status}
                  onValueChange={v => setStatus(v as OrderStatus)}
                  className="max-w-none"
                />
              </div>
              {status === 'Placed' ? (
                <p className="mt-1.5 text-label text-text-secondary">
                  Only a party whose record is complete can have an order placed
                  against it.
                </p>
              ) : null}
            </div>
          </div>

          <Separator />

          <section className="flex flex-col gap-3">
            <h4 className="text-label font-medium text-text-primary">Products</h4>
            {products === null ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-control w-full" />
                <Skeleton className="h-control w-full" />
              </div>
            ) : (
              <OrderLineItems products={products} lines={lines} onChange={setLines} />
            )}
          </section>

          {/* The order discount sits on the total it reduces, not up with the
              order's metadata: a control belongs beside what it controls. */}
          <div className="flex flex-col gap-2 border-t border-border-light pt-3">
            <div className="flex items-center justify-between gap-3 text-body">
              <span className="text-text-secondary">Subtotal</span>
              <span className="tabular-nums text-text-primary">
                {fmtAmount(totals.gross_amount)}
              </span>
            </div>

            {totals.item_discount_total > 0 ? (
              <div className="flex items-center justify-between gap-3 text-body">
                <span className="text-text-secondary">Line discounts</span>
                <span className="tabular-nums text-warning">
                  −{fmtAmount(totals.item_discount_total)}
                </span>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Label htmlFor="order-overall-discount" className="text-text-secondary">
                Discount on the whole order
              </Label>
              <div className="flex items-center gap-3">
                <div className="w-full sm:w-56">
                  <DiscountField
                    id="order-overall-discount"
                    label="Order discount"
                    unit={orderDiscountUnit}
                    value={orderDiscountValue}
                    onChange={d => {
                      setOrderDiscountUnit(d.unit)
                      setOrderDiscountValue(d.value)
                    }}
                  />
                </div>
                {/* Rendered only when there is one. Nothing reads ₹0.00. */}
                {totals.order_discount_amount > 0 ? (
                  <span className="shrink-0 tabular-nums text-body text-warning">
                    −{fmtAmount(totals.order_discount_amount)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border-light pt-3">
              <span className="text-body font-medium text-text-secondary">
                Total payable
                {validLines.length > 0 ? (
                  <span className="ml-2 font-normal text-text-muted">
                    {validLines.length} {validLines.length === 1 ? 'line' : 'lines'},{' '}
                    {fmtQty(totalQty)} {totalQty === 1 ? 'unit' : 'units'}
                  </span>
                ) : null}
              </span>
              <span className="text-section font-medium tabular-nums text-text-primary">
                {fmtAmount(totals.total_amount)}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
