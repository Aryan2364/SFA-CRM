'use client'

/**
 * `/orders/[id]` — phone-only record screen. Desktop has no route here: an
 * order is read in `OrderDetailDrawer` on `/orders` (see `../page.tsx`),
 * reached via `?open=<id>`, so a desktop visitor to this URL is sent there
 * (ground rule: new phone-only URL -> redirect to the matching desktop
 * list page).
 *
 * Phone: RecordSummary + item list, three-dot menu with "Reorder" ->
 * `/orders/new?from=<id>`.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MoreVerticalIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { useLayout } from '@/lib/layout'
import { usePhoneAppBar } from '@/components/shell/phone-app-bar'
import { RecordSummary } from '@/components/ui/record-summary'
import { StatusBadge, SpecBadge, DISCOUNT_FLAG, ORDER_STATUS } from '@/components/status-badge'
import { fmtAmount, fmtDate, fmtQty } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DiscountType, OrderStatus } from '@/lib/order-math'

type OrderDetail = {
  id: string
  order_date: string
  order_source: 'meeting' | 'direct'
  entity_type: string | null
  entity_name: string | null
  entity_id: string | null
  visit_id: string | null
  status: OrderStatus
  total_amount: number
  gross_amount: number
  has_discount: boolean
  item_discount_total: number
  order_discount_type: DiscountType
  order_discount_value: number
  order_discount_amount: number
  blocked_reason: string | null
  users: { name: string } | null
  order_items: {
    id: string
    product_name: string
    qty: number
    rate: number
    discount_amount: number
    amount: number
  }[]
}

function PhoneOrderDetail({ id }: { id: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [state, setState] = useState<'loading' | 'failed' | 'ready'>('loading')

  useEffect(() => {
    let live = true
    setState('loading')
    fetch(`/api/orders/${id}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r)))
      .then(d => { if (live) { setOrder(d); setState('ready') } })
      .catch(() => { if (live) setState('failed') })
    return () => { live = false }
  }, [id])

  usePhoneAppBar({
    title: order?.entity_name ?? (order?.visit_id ? 'Meeting order' : 'Order'),
    back: '/orders',
    menu: (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              aria-label="More"
              className="flex size-11 items-center justify-center rounded-lg text-text-secondary active:bg-surface-control"
            />
          }
        >
          <MoreVerticalIcon className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => router.push(`/orders/new?from=${id}`)}>
            <RotateCcwIcon className="size-4" />
            Reorder
          </DropdownMenuItem>
          {order?.entity_id ? (
            <DropdownMenuItem onClick={() => router.push(`/orders/new?account=${order.entity_id}`)}>
              <PlusIcon className="size-4" />
              Place another order
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  })

  if (state === 'loading') {
    return <div className="px-4 py-10 text-center text-body text-text-muted">Loading…</div>
  }
  if (state === 'failed' || !order) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-body font-medium text-text-primary">Could not load this order</p>
        <Button variant="secondary" onClick={() => router.push('/orders')}>Back to orders</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <RecordSummary
        name={order.entity_name ?? (order.visit_id ? 'Meeting order' : 'Direct order')}
        badges={
          <>
            <StatusBadge vocabulary={ORDER_STATUS} status={order.status} />
            {order.has_discount && <SpecBadge spec={DISCOUNT_FLAG} />}
          </>
        }
        meta={fmtDate(order.order_date)}
        facts={[
          { label: 'Sales executive', value: order.users?.name ?? null },
          { label: 'Total', value: fmtAmount(order.total_amount) },
        ]}
      />

      {order.status === 'Draft' && order.blocked_reason ? (
        <p className="rounded-lg bg-warning-bg border border-warning-border px-3 py-2 text-label text-warning">
          This order cannot be placed. {order.blocked_reason}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="text-label font-medium text-text-secondary">Products</p>
        <ul className="flex flex-col divide-y divide-border-light rounded-xl border border-border-light bg-surface">
          {order.order_items.map(item => (
            <li key={item.id} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 text-body font-medium text-text-primary">{item.product_name}</span>
                <span className="shrink-0 text-body font-medium text-text-primary">{fmtAmount(item.amount)}</span>
              </div>
              <span className="text-label text-text-secondary">
                {fmtQty(item.qty)} × {fmtAmount(item.rate)}
                {Number(item.discount_amount) > 0 ? ` · −${fmtAmount(item.discount_amount)}` : ''}
              </span>
            </li>
          ))}
          {order.order_items.length === 0 && (
            <li className="px-4 py-6 text-center text-body text-text-muted">No items</li>
          )}
        </ul>
      </div>

      <div className="rounded-xl bg-surface-sunken px-4 py-3 flex flex-col gap-2">
        {order.has_discount && (
          <>
            <Row label="Subtotal" value={fmtAmount(order.gross_amount)} />
            {Number(order.item_discount_total) > 0 && (
              <Row label="Item discounts" value={`−${fmtAmount(order.item_discount_total)}`} warn />
            )}
            {Number(order.order_discount_amount) > 0 && (
              <Row label="Overall discount" value={`−${fmtAmount(order.order_discount_amount)}`} warn />
            )}
          </>
        )}
        <div className="flex items-center justify-between border-t border-border-light pt-2 first:border-0 first:pt-0">
          <span className="text-body font-medium text-text-secondary">Total</span>
          <span className="text-card-heading font-medium text-text-primary">{fmtAmount(order.total_amount)}</span>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between text-label">
      <span className="text-text-secondary">{label}</span>
      <span className={warn ? 'text-warning' : 'text-text-primary'}>{value}</span>
    </div>
  )
}

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { layout } = useLayout()

  useEffect(() => {
    if (layout === 'desktop') router.replace(`/orders?open=${params.id}`)
  }, [layout, router, params.id])

  if (layout !== 'phone') return null
  return <PhoneOrderDetail id={params.id} />
}
