'use client'

import { useEffect, useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { useMe } from '@/hooks/useMe'
import { Button } from '@/components/ui/button'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fmtAmount } from '@/lib/format'
import { lineTotals, orderTotals, type DiscountType } from '@/lib/order-math'
import { OrderItem, Product, toDateStr, Visit } from './types'

/**
 * A line as this dialog holds it. The discount is not edited here (the Orders
 * screen owns discounts), but a re-punch must CARRY it: this dialog posts the
 * whole order, and a line posted without its discount is saved without one.
 */
type DialogLine = OrderItem & { discount_type?: DiscountType | string; discount_value?: number }

/** The order-level discount of the order being re-punched; none for a new one. */
type OrderDiscount = { type: DiscountType | string; value: number }
const NO_DISCOUNT: OrderDiscount = { type: 'none', value: 0 }

/**
 * Order entry against one meeting. Behaviour unchanged from the legacy
 * screen; it is a file of its own now so P3-T11's cross-links have
 * something to point at.
 *
 * §5.3 rule 4: it opens for any Active or Completed meeting on the day
 * in view, whether or not the user has checked out.
 *
 * RATE: `POST /api/orders` prices every line that carries a `product_id`
 * from `products.price` and discards a posted rate (see `priceLines()`), so
 * on those lines the rate is the master's list price, shown read-only — an
 * editable box there let the rep confirm a total the server then replaced.
 * Only a free-text line (no product picked) keeps a typed rate, because that
 * is the one case the server honours it. Totals come from `order-math`, the
 * same functions the route runs, so the figure on screen is the saved one.
 *
 * DISCOUNTS: re-punching an order that already carries line or order
 * discounts (set on the Orders screen) keeps them — they are loaded with the
 * order, included in the totals shown here through the same `order-math`, and
 * posted back, so a quantity fix here no longer strips them.
 */
export function OrderEntryDialog({
  visit,
  onClose,
  onSaved,
}: {
  visit: Visit
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [items, setItems] = useState<DialogLine[]>([{ product_id: null, product_name: '', qty: 1, rate: 0 }])
  const [orderDiscount, setOrderDiscount] = useState<OrderDiscount>(NO_DISCOUNT)
  const [products, setProducts] = useState<Product[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  /* POST /api/orders on a meeting that already has an order is a re-punch,
     and the route checks orders.edit as well as orders.create for it. The
     Order button that opened this was gated on create; this is the edit half,
     known only once the existing order has been read. `null` while /me is
     loading: disabled, no reason yet. */
  const [hasOrder, setHasOrder] = useState(false)
  const me = useMe()
  const canEditOrder = me ? !!me.permissions?.orders?.edit : null
  const repunchBlocked = hasOrder && canEditOrder !== true

  useEffect(() => {
    fetch('/api/masters/products')
      .then(r => r.json())
      .then(d => setProducts(Array.isArray(d) ? d : []))
      .catch(() => toast('Failed to load products', 'error'))

    fetch(`/api/orders?visitId=${visit.id}`)
      .then(r => r.json())
      .then(d => {
        setHasOrder(Boolean(d?.id))
        if (d?.order_items?.length) {
          setItems(
            d.order_items.map((i: {
              product_id: string | null; product_name: string; qty: number; rate: number
              discount_type?: string | null; discount_value?: number | string | null
            }) => ({
              product_id: i.product_id,
              product_name: i.product_name,
              qty: i.qty,
              rate: Number(i.rate),
              discount_type: i.discount_type ?? 'none',
              discount_value: Number(i.discount_value) || 0,
            }))
          )
        }
        if (d?.id) {
          setOrderDiscount({
            type: d.order_discount_type ?? 'none',
            value: Number(d.order_discount_value) || 0,
          })
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [visit.id])

  function updateRow(idx: number, field: keyof DialogLine, value: string | number | null) {
    setItems(prev => prev.map((row, i) => (i !== idx ? row : { ...row, [field]: value })))
  }

  function onProductSelect(idx: number, productId: string) {
    const p = products.find(p => p.id === productId)
    setItems(prev =>
      prev.map((row, i) =>
        i !== idx ? row : p ? { ...row, product_id: p.id, product_name: p.name, rate: Number(p.price) } : { ...row, product_id: null }
      )
    )
  }

  /** The rate the server will use: the master's price on a product line. */
  function rateOf(item: DialogLine): number {
    if (!item.product_id) return item.rate
    const p = products.find(p => p.id === item.product_id)
    // Until the product list lands, the rate saved on the order is the best
    // preview; the server reprices from the master either way.
    return p ? Number(p.price) : item.rate
  }

  /** A line as `order-math` (and so the route) prices it: master rate, own discount. */
  const priced = (i: DialogLine) => ({
    qty: i.qty,
    rate: rateOf(i),
    discount_type: i.discount_type,
    discount_value: i.discount_value,
  })

  // Only named lines are posted, so only named lines are totalled — with the
  // line and order discounts, exactly as `POST /api/orders` will store them.
  const totals = orderTotals(
    items.filter(i => i.product_name.trim()).map(priced),
    orderDiscount.type,
    orderDiscount.value,
  )
  const total = totals.total_amount
  const discountTotal = totals.item_discount_total + totals.order_discount_amount

  async function handleSave() {
    const validItems = items.filter(i => i.product_name.trim())
    if (validItems.length === 0) { toast('Add at least one product', 'error'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visit_id: visit.id,
          // The meeting's LOCAL calendar date. Slicing the ISO string took the
          // UTC date, which is the previous day for a meeting started before
          // 05:30 IST.
          order_date: toDateStr(visit.start_time ? new Date(visit.start_time) : new Date()),
          // A product line sends no rate: the server would discard it. Each line
          // carries its discount, or a re-punch would save it without one.
          items: validItems.map(i => ({
            ...(i.product_id
              ? { product_id: i.product_id, product_name: i.product_name, qty: i.qty }
              : { product_id: null, product_name: i.product_name, qty: i.qty, rate: i.rate }),
            discount_type: i.discount_type ?? 'none',
            discount_value: i.discount_value ?? 0,
          })),
          order_discount_type: orderDiscount.type,
          order_discount_value: orderDiscount.value,
        }),
      })
      if (!r.ok) toast((await r.json().catch(() => ({}))).error ?? 'Failed to save the order', 'error')
      else { toast('Order saved'); onSaved(); onClose() }
    } catch {
      // The dialog stays open with the lines as typed.
      toast('The connection dropped. The order was not saved.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Order entry</DialogTitle>
          <DialogDescription>{visit.entity_name}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          {loading ? (
            <div className="py-8 text-center text-text-muted">Loading…</div>
          ) : (
            <>
              <div className="hidden grid-cols-12 gap-2 px-1 pb-2 text-label text-text-muted sm:grid">
                <div className="col-span-5">Product</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-2 text-center">Rate</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-1" />
              </div>

              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center">
                    <div className="sm:col-span-5">
                      <Select
                        value={item.product_id ?? ''}
                        onValueChange={v => onProductSelect(idx, String(v))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a product" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {!item.product_id && (
                        <Input
                          className="mt-1"
                          value={item.product_name}
                          onChange={e => updateRow(idx, 'product_name', e.target.value)}
                          placeholder="Or type a name"
                        />
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        aria-label="Quantity"
                        value={item.qty}
                        onChange={e => updateRow(idx, 'qty', Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                        className="text-center"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      {item.product_id ? (
                        <div className="flex items-baseline justify-between gap-2 sm:flex-col sm:items-center sm:gap-0">
                          <span className="text-caption text-text-muted">List price</span>
                          <span className="tabular-nums text-text-secondary">{fmtAmount(rateOf(item))}</span>
                        </div>
                      ) : (
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          aria-label="Rate"
                          value={item.rate}
                          onChange={e => updateRow(idx, 'rate', Math.max(0, Number(e.target.value) || 0))}
                          className="text-center"
                        />
                      )}
                    </div>
                    <div className="tabular-nums sm:col-span-2 sm:text-right">
                      {(() => {
                        const line = lineTotals(priced(item))
                        return (
                          <>
                            {fmtAmount(line.amount)}
                            {line.discount_amount > 0 && (
                              <span className="block text-caption text-text-muted">
                                after {fmtAmount(line.discount_amount)} off
                              </span>
                            )}
                          </>
                        )
                      })()}
                    </div>
                    <div className="flex justify-end sm:col-span-1 sm:justify-center">
                      {items.length > 1 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Remove row"
                          onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                        >
                          <XIcon />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <Button
                variant="secondary"
                className="mt-3 w-full"
                onClick={() => setItems(prev => [...prev, { product_id: null, product_name: '', qty: 1, rate: 0 }])}
              >
                <PlusIcon />
                Add row
              </Button>
            </>
          )}
        </DialogBody>

        <DialogFooter className="justify-between">
          <span className="text-body text-text-secondary">
            Total <span className="font-medium tabular-nums text-text-primary">{fmtAmount(total)}</span>
            {discountTotal > 0 && (
              <span className="block text-caption text-text-muted">
                Includes {fmtAmount(discountTotal)} in discounts
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <PermissionTooltip
              allowed={!(hasOrder && canEditOrder === false)}
              reason="Only someone who can edit orders can change this one"
            >
              <Button onClick={handleSave} disabled={saving || repunchBlocked}>{saving ? 'Saving…' : 'Save order'}</Button>
            </PermissionTooltip>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
