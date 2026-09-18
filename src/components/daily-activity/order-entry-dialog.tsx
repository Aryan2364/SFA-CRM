'use client'

import { useEffect, useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { Button } from '@/components/ui/button'
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
import { OrderItem, Product, toDateStr, Visit } from './types'

/**
 * Order entry against one meeting. Behaviour unchanged from the legacy
 * screen; it is a file of its own now so P3-T11's cross-links have
 * something to point at.
 *
 * §5.3 rule 4: it opens for any Active or Completed meeting on the day
 * in view, whether or not the user has checked out.
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
  const [items, setItems] = useState<OrderItem[]>([{ product_id: null, product_name: '', qty: 1, rate: 0 }])
  const [products, setProducts] = useState<Product[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/masters/products')
      .then(r => r.json())
      .then(d => setProducts(Array.isArray(d) ? d : []))
      .catch(() => toast('Failed to load products', 'error'))

    fetch(`/api/orders?visitId=${visit.id}`)
      .then(r => r.json())
      .then(d => {
        if (d?.order_items?.length) {
          setItems(
            d.order_items.map((i: { product_id: string | null; product_name: string; qty: number; rate: number }) => ({
              product_id: i.product_id,
              product_name: i.product_name,
              qty: i.qty,
              rate: Number(i.rate),
            }))
          )
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [visit.id])

  function updateRow(idx: number, field: keyof OrderItem, value: string | number | null) {
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

  const total = items.reduce((s, i) => s + i.qty * i.rate, 0)

  async function handleSave() {
    const validItems = items.filter(i => i.product_name.trim())
    if (validItems.length === 0) { toast('Add at least one product', 'error'); return }
    setSaving(true)
    const r = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visit_id: visit.id,
        order_date: visit.start_time?.split('T')[0] ?? toDateStr(new Date()),
        items: validItems,
      }),
    })
    if (!r.ok) toast((await r.json()).error ?? 'Failed to save the order', 'error')
    else { toast('Order saved'); onSaved(); onClose() }
    setSaving(false)
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
                        inputMode="numeric"
                        value={item.qty}
                        onChange={e => updateRow(idx, 'qty', Math.max(1, Number(e.target.value)))}
                        className="text-center"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={item.rate}
                        onChange={e => updateRow(idx, 'rate', Number(e.target.value))}
                        className="text-center"
                      />
                    </div>
                    <div className="tabular-nums sm:col-span-2 sm:text-right">{fmtAmount(item.qty * item.rate)}</div>
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
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save order'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
