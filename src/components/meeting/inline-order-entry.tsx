'use client'

import { useEffect, useMemo, useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtAmount } from '@/lib/format'
import type { Product, VisitOrder } from './types'

/**
 * §5.5 — "Order taking happens **inline**, against the meeting row. Products
 * come from the existing Product Master; the user enters Quantity, the system
 * picks the Rate, and the total Amount is shown."
 *
 * ---------------------------------------------------------------------------
 * RATE IS RENDERED, NOT TYPED, AND THAT IS NOT A UI PREFERENCE
 *
 * `POST /api/orders` reads `products.price` for every line carrying a
 * `product_id` and DISCARDS whatever rate was posted (see `priceLines()`).
 * Without that, §7.4's "Discount Given by Sales Person" would report over
 * numbers the sales person typed, and a rep could post `rate: 1` with no
 * discount recorded and take the entire margin while appearing nowhere in the
 * discount report.
 *
 * So the number in the Rate column is the master's price, shown so the user can
 * see what the line costs — it is not an input, and the totals below are a
 * PREVIEW of what the server will compute, not an instruction to it. A rate
 * forged in the browser changes this preview and nothing else; the saved order
 * comes back priced from the master.
 *
 * The existing modal in `components/daily-activity/order-entry-dialog.tsx` does
 * let the rate be typed. It is not wrong — the server ignores it there too —
 * but it invites the user to believe a number that will not be used, and §5.5
 * asks for the opposite behaviour here.
 *
 * ---------------------------------------------------------------------------
 * ONE ORDER PER MEETING
 *
 * `orders.visit_id` is `@unique` and the meeting branch of the route UPSERTS on
 * it, so saving twice revises the meeting's order rather than making a second
 * one. That is why this opens already filled in when an order exists: a blank
 * grid over an order that is about to be overwritten is how a line gets lost.
 */

type Line = { key: string; product_id: string | null; qty: number }

let lineSeq = 0
function newLine(): Line {
  lineSeq += 1
  return { key: `line-${lineSeq}`, product_id: null, qty: 1 }
}

export function InlineOrderEntry({
  visitId,
  orderDate,
  existing,
  onSaved,
}: {
  visitId: string
  /** `YYYY-MM-DD`. The meeting's own date, never "today". */
  orderDate: string
  existing: VisitOrder | null
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [lines, setLines] = useState<Line[]>(() =>
    existing && existing.order_items.length > 0
      ? existing.order_items.map(item => {
          lineSeq += 1
          return { key: `line-${lineSeq}`, product_id: item.product_id, qty: item.qty }
        })
      : [newLine()]
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/masters/products')
      .then(r => (r.ok ? r.json() : []))
      .then(d => { if (!cancelled) setProducts(Array.isArray(d) ? d : []) })
      .catch(() => { if (!cancelled) setProducts([]) })
    return () => { cancelled = true }
  }, [])

  const priceOf = useMemo(() => {
    const map = new Map((products ?? []).map(p => [p.id, Number(p.price)]))
    return (id: string | null) => (id ? map.get(id) ?? 0 : 0)
  }, [products])

  const productOptions = useMemo(
    () => Object.fromEntries((products ?? []).map(p => [p.id, p.name])),
    [products]
  )

  const total = lines.reduce((sum, l) => sum + priceOf(l.product_id) * l.qty, 0)

  /*
   * Every mutation maps over the existing array and returns the SAME object for
   * every row it is not changing, keyed by a stable `key` that is never the
   * array index. An index key would re-key every row below a deletion, which is
   * React's definition of "this is a different row" — the input the user is
   * typing in would be torn down and rebuilt, losing focus and the caret.
   */
  function update(key: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function save() {
    const valid = lines.filter(l => l.product_id && l.qty > 0)
    if (valid.length === 0) {
      toast('Pick a product and a quantity first', 'error')
      return
    }
    setSaving(true)
    const r = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      /*
       * `qty` and `product_id` only. No rate is sent at all — not because
       * sending one would be accepted, but because sending a number the server
       * throws away is a lie in the request log and the next person to read it
       * has to go and check which one won.
       */
      body: JSON.stringify({
        visit_id: visitId,
        order_date: orderDate,
        items: valid.map(l => ({ product_id: l.product_id, qty: l.qty })),
      }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      toast(err.error ?? 'Could not save the order', 'error')
      setSaving(false)
      return
    }
    setSaving(false)
    toast(existing ? 'Order updated' : 'Order saved')
    onSaved()
  }

  if (products === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <p className="py-4 text-body text-text-secondary">
        No products are available to you, so an order cannot be taken here. The
        Product Master is where they are added.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="hidden grid-cols-12 gap-2 px-1 text-label text-text-muted sm:grid">
        <div className="col-span-6">Product</div>
        <div className="col-span-2 text-center">Qty</div>
        <div className="col-span-2 text-right">Rate</div>
        <div className="col-span-1 text-right">Amount</div>
        <div className="col-span-1" />
      </div>

      <ul className="flex flex-col gap-2">
        {lines.map(line => {
          const rate = priceOf(line.product_id)
          return (
            <li
              key={line.key}
              className="grid grid-cols-1 gap-2 rounded-lg border border-border-light p-2 sm:grid-cols-12 sm:items-center sm:border-0 sm:p-0"
            >
              <div className="sm:col-span-6">
                {/* SearchableSelect, not Select: §16.3 of the design system
                    puts a search box on any menu past six options, and a
                    product master runs to far more than six. A plain Select
                    here warns in development and is a scroll-hunt in a shop. */}
                <SearchableSelect
                  options={productOptions}
                  value={line.product_id ?? ''}
                  onValueChange={v => update(line.key, { product_id: v })}
                  placeholder="Select a product"
                  searchPlaceholder="Search products"
                />
              </div>

              <div className="sm:col-span-2">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  /* 16px on mobile. Anything smaller makes iOS zoom the page
                     on focus and the user has to pinch back out. */
                  className="text-base sm:text-center sm:text-body"
                  value={line.qty}
                  aria-label="Quantity"
                  onChange={e =>
                    update(line.key, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
                  }
                />
              </div>

              <div className="flex justify-between text-body tabular-nums text-text-secondary sm:col-span-2 sm:justify-end">
                <span className="sm:hidden">Rate</span>
                <span>{line.product_id ? fmtAmount(rate) : '—'}</span>
              </div>

              <div className="flex justify-between text-body font-medium tabular-nums text-text-primary sm:col-span-1 sm:justify-end">
                <span className="sm:hidden">Amount</span>
                <span>{line.product_id ? fmtAmount(rate * line.qty) : '—'}</span>
              </div>

              <div className="flex justify-end sm:col-span-1">
                {lines.length > 1 ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove this line"
                    onClick={() => setLines(prev => prev.filter(l => l.key !== line.key))}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-col gap-3 border-t border-border-light pt-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="secondary"
          className="w-full sm:w-auto"
          onClick={() => setLines(prev => [...prev, newLine()])}
        >
          <PlusIcon />
          Add a line
        </Button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <span className="text-body text-text-secondary">
            Total{' '}
            <span className="font-medium tabular-nums text-text-primary">
              {fmtAmount(total)}
            </span>
          </span>
          <Button className="w-full sm:w-auto" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : existing ? 'Update order' : 'Save order'}
          </Button>
        </div>
      </div>

      <p className="text-label text-text-secondary">
        Rates come from the Product Master and are applied by the server, so the
        saved order is priced from the master whatever this screen shows.
      </p>
    </div>
  )
}
