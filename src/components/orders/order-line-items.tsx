'use client'

import { useMemo } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { OptionSelect } from '@/components/orders/option-select'
import { DiscountField, toDiscount, type DiscountUnit } from '@/components/orders/discount-field'
import { fmtAmount } from '@/lib/format'
import { lineTotals, type LineInput } from '@/lib/order-math'

/**
 * F18 — "Product / Qty / Rate / Discount / Total / Select product… / Or type
 * name… / 1 / 0 / None / ₹ / ₹0.00 — this section is poorly made its design
 * has be working again."
 *
 * Read that list back and it is the row as it rendered: five headings over
 * seven controls. Three faults, and none of them is styling.
 *
 * 1. TWO INPUTS FOR ONE FIELD. "Select product…" and "Or type name…" sat
 *    stacked, both claiming the Product column. The free-text one existed so
 *    a product missing from the master could still be ordered — but a
 *    free-text line has no master row, so the RATE next to it became typeable
 *    too, and that is the one number on this form the server refuses to take
 *    from the browser. One escape hatch quietly turned the column beside it
 *    into a field the user could set. It is gone: a line is a product from
 *    the Product Master, the way the meeting-order screen already works
 *    (`components/meeting/inline-order-entry.tsx`). Something not in the
 *    master is added to the master.
 *
 * 2. A RATE BOX THAT DID NOTHING. For a master product the rate was already
 *    read-only, and for a typed one it was editable and then discarded by
 *    the route. Rate is now rendered, never typed, on every row — and the
 *    row sends no rate at all, so there is no number in the request log that
 *    somebody later has to check which of the two won.
 *
 * 3. THE DISCOUNT SAID NOTHING THREE TIMES. See `discount-field.tsx`.
 *
 * ---------------------------------------------------------------------------
 * THE TOTALS ARE A PREVIEW, NOT AN INSTRUCTION
 *
 * Every figure here comes from `lineTotals`/`orderTotals` in
 * `src/lib/order-math.ts` — the SAME functions `POST /api/orders` runs, not a
 * second implementation that happens to agree. The rate is `products.price`
 * as this screen last read it. The saved order is priced by the server from
 * the master regardless, so this is a preview of that answer.
 *
 * ---------------------------------------------------------------------------
 * ROWS ARE KEYED, NEVER INDEXED
 *
 * `key` is a counter, not the array position. An index key re-keys every row
 * below a deletion, which React reads as "a different row" — it tears down
 * the input being typed in and rebuilds it, losing focus and the caret. Every
 * update maps and returns the same object for untouched rows, so a total
 * changing never re-creates a row the user is working in.
 */

export type Product = { id: string; name: string; price: number }

export type OrderLine = {
  key: string
  product_id: string | null
  qty: number
  discount_unit: DiscountUnit
  discount_value: number
}

let lineSeq = 0
export function newOrderLine(): OrderLine {
  lineSeq += 1
  return { key: `line-${lineSeq}`, product_id: null, qty: 1, discount_unit: 'percent', discount_value: 0 }
}

/** The `order-math` input for one row, from the row and the master. */
export function lineInput(line: OrderLine, rate: number): LineInput {
  return { qty: line.qty, rate, ...toDiscount(line.discount_unit, line.discount_value) }
}

export function OrderLineItems({
  products,
  lines,
  onChange,
}: {
  products: Product[]
  lines: OrderLine[]
  onChange: (next: OrderLine[]) => void
}) {
  const priceOf = useMemo(() => {
    const map = new Map(products.map(p => [p.id, Number(p.price)]))
    return (id: string | null) => (id ? map.get(id) ?? 0 : 0)
  }, [products])

  const productOptions = useMemo(
    () => Object.fromEntries(products.map(p => [p.id, p.name])),
    [products]
  )

  function update(key: string, patch: Partial<OrderLine>) {
    onChange(lines.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  /**
   * Picking a product a row above already has folds the two together rather
   * than leaving a duplicate line for the same product. Kept from the old
   * screen: the totals were correct either way, but two lines for one
   * product is a data-entry slip the user has to spot in the saved order.
   */
  function pickProduct(key: string, productId: string) {
    const duplicate = lines.find(l => l.key !== key && l.product_id === productId)
    if (duplicate) {
      const bumped = lines.map(l =>
        l.key === duplicate.key ? { ...l, qty: l.qty + 1 } : l
      )
      onChange(
        bumped.length > 1
          ? bumped.filter(l => l.key !== key)
          : bumped.map(l => (l.key === key ? { ...l, product_id: productId } : l))
      )
      return
    }
    update(key, { product_id: productId })
  }

  if (products.length === 0) {
    return (
      <p className="text-body text-text-secondary">
        No products are available to you, so an order cannot be raised here.
        Products are added in the Product Master.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Hidden below sm, where a row becomes a labelled stack rather than a
          twelve-column grid nothing fits in. */}
      <div className="hidden grid-cols-12 items-end gap-2 px-1 text-label text-text-muted sm:grid">
        <div className="col-span-4">Product</div>
        <div className="col-span-1 text-center">Qty</div>
        <div className="col-span-2 pr-2 text-right">Rate</div>
        <div className="col-span-3">Discount</div>
        <div className="col-span-1 text-right">Amount</div>
        <div className="col-span-1" />
      </div>

      <ul className="flex flex-col gap-2">
        {lines.map(line => {
          const rate = priceOf(line.product_id)
          const totals = lineTotals(lineInput(line, rate))
          const picked = Boolean(line.product_id)
          return (
            <li
              key={line.key}
              className="grid grid-cols-1 gap-3 rounded-xl border border-border-light p-3 sm:grid-cols-12 sm:items-center sm:gap-2 sm:rounded-none sm:border-0 sm:p-0"
            >
              <div className="sm:col-span-4">
                <Label htmlFor={`${line.key}-product`} className="sr-only">
                  Product
                </Label>
                <OptionSelect
                  id={`${line.key}-product`}
                  options={productOptions}
                  value={line.product_id ?? ''}
                  onValueChange={v => pickProduct(line.key, v)}
                  placeholder="Select a product"
                  searchPlaceholder="Search products"
                  emptyMessage="No product matches that search."
                  className="max-w-none"
                />
              </div>

              <div className="sm:col-span-1">
                <Label htmlFor={`${line.key}-qty`} className="sm:sr-only">
                  Qty
                </Label>
                <Input
                  id={`${line.key}-qty`}
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  className="mt-1.5 text-base sm:mt-0 sm:text-center sm:text-body"
                  value={line.qty}
                  onChange={e =>
                    update(line.key, {
                      qty: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                    })
                  }
                />
              </div>

              {/* Rendered, never typed. The route reads `products.price`. */}
              <div className="flex items-baseline justify-between text-body tabular-nums text-text-secondary sm:col-span-2 sm:justify-end">
                <span className="text-label sm:hidden">Rate</span>
                <span>{picked ? fmtAmount(rate) : '—'}</span>
              </div>

              <div className="sm:col-span-3">
                <Label htmlFor={`${line.key}-discount`} className="sm:sr-only">
                  Discount
                </Label>
                <div className="mt-1.5 sm:mt-0">
                  <DiscountField
                    id={`${line.key}-discount`}
                    label="Line discount"
                    unit={line.discount_unit}
                    value={line.discount_value}
                    onChange={d =>
                      update(line.key, { discount_unit: d.unit, discount_value: d.value })
                    }
                  />
                </div>
              </div>

              <div className="flex items-baseline justify-between sm:col-span-1 sm:block sm:text-right">
                <span className="text-label text-text-secondary sm:hidden">Amount</span>
                <span className="text-body font-medium tabular-nums text-text-primary">
                  {picked ? fmtAmount(totals.amount) : '—'}
                </span>
                {totals.discount_amount > 0 ? (
                  <span className="block text-label tabular-nums text-text-muted line-through">
                    {fmtAmount(totals.gross_amount)}
                  </span>
                ) : null}
              </div>

              <div className="flex justify-end sm:col-span-1">
                {lines.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove this line"
                    onClick={() => onChange(lines.filter(l => l.key !== line.key))}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      <div>
        <Button
          variant="secondary"
          className="w-full sm:w-auto"
          onClick={() => onChange([...lines, newOrderLine()])}
        >
          <PlusIcon />
          Add a line
        </Button>
      </div>
    </div>
  )
}
