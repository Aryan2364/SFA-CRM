'use client'

import Link from 'next/link'
import { ArrowRightIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fmtAmount, fmtDate } from '@/lib/format'
import { InlineOrderEntry } from './inline-order-entry'
import type { MeetingOrder, VisitOrder } from './types'

/**
 * §5.5 — the Company's **last few Orders (not all)**, any Order already drafted
 * and not yet placed, inline order taking, and View All.
 *
 * ---------------------------------------------------------------------------
 * "NOT ALL" IS THE SPECIFICATION, NOT A PAGE SIZE
 *
 * The server sends five and the true count alongside them. This screen is what
 * somebody reads standing in a shop; a year of order history is what the Orders
 * page is for, which is exactly why View All exists and why the count is
 * printed next to it rather than the list silently ending.
 *
 * ---------------------------------------------------------------------------
 * VIEW ALL CARRIES THE COMPANY AND MUST NOT DEAD-END
 *
 * The link carries the company's ID, not its name. `/api/orders` now takes
 * `?entityId=` and matches both ways an order reaches a party — its own
 * `entity_id`, or the visit it was taken at — because an order punched against
 * a meeting has NO `entity_name` at all, so a name search finds a party's
 * direct orders and silently drops the ones taken in front of them.
 *
 * ⚠️ Seeding the Orders SCREEN's own controls from that parameter is P3-T11's
 * cross-linking task and is NOT done here: `templates/list-page.tsx`
 * initialises its search and filter state to empty and never reads
 * `useSearchParams`, and both that file and `orders/page.tsx` belong to other
 * tasks. The server side of the filter and this end of the link are done; the
 * page-side seeding is one `useSearchParams` call away and is not yet written.
 * An unfiltered Orders page is a worse landing than a filtered one but it is
 * still the right place, so the link is never withheld.
 */
export function OrdersSection({
  visitId,
  visitDate,
  companyId,
  companyName,
  recentOrders,
  orderCount,
  draftOrders,
  visitOrder,
  visible,
  canCreateOrder,
  partyComplete,
  partyMissing,
  onSaved,
}: {
  visitId: string
  visitDate: string
  companyId: string | null
  companyName: string
  recentOrders: MeetingOrder[]
  orderCount: number
  draftOrders: MeetingOrder[]
  visitOrder: VisitOrder | null
  visible: boolean
  canCreateOrder: boolean
  partyComplete: boolean
  partyMissing: string | null
  onSaved: () => void
}) {
  const viewAll = companyId ? `/orders?entityId=${companyId}` : '/orders'

  /*
   * A Draft is also a recent order, and the server sends it in both lists
   * because they answer two different questions. Rendering both would put the
   * same order on the screen twice — the same fact said twice, which reads as
   * two orders and makes the party look busier than it is. The Draft block is
   * the one that says something actionable, so it keeps the row and the recent
   * list drops it.
   */
  const draftIds = new Set(draftOrders.map(o => o.id))
  const recent = recentOrders.filter(o => !draftIds.has(o.id))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
        {visible ? (
          <CardAction>
            <Link
              href={viewAll}
              className="flex min-h-11 items-center gap-1 text-body text-text-primary underline underline-offset-2 sm:min-h-0"
            >
              View all{orderCount > 0 ? ` (${orderCount})` : ''}
              <ArrowRightIcon className="size-4" />
            </Link>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {!visible ? (
          <p className="py-6 text-center text-body text-text-secondary">
            Orders are not part of your access.
          </p>
        ) : (
          <>
            {/* §5.5: an order drafted for this party and not yet placed. */}
            {draftOrders.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-label font-medium text-text-primary">
                  Drafted, not yet placed
                </h3>
                <ul className="flex flex-col gap-2">
                  {draftOrders.map(order => (
                    <OrderRow key={order.id} order={order} />
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="flex flex-col gap-2">
              <h3 className="text-label font-medium text-text-primary">
                Recent orders
              </h3>
              {recent.length === 0 ? (
                <p className="py-4 text-body text-text-secondary">
                  No orders yet for {companyName}.
                  {canCreateOrder ? ' Take the first one below.' : ''}
                </p>
              ) : (
                <>
                  <ul className="flex flex-col gap-2">
                    {recent.map(order => (
                      <OrderRow key={order.id} order={order} />
                    ))}
                  </ul>
                  {orderCount > recent.length + draftOrders.length ? (
                    <p className="text-label text-text-secondary">
                      Showing the last {recent.length + draftOrders.length} of {orderCount}.{' '}
                      <Link href={viewAll} className="text-text-primary underline underline-offset-2">
                        View all
                      </Link>
                    </p>
                  ) : null}
                </>
              )}
            </section>

            {canCreateOrder ? (
              <section className="flex flex-col gap-3 border-t border-border-light pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-label font-medium text-text-primary">
                    {visitOrder ? 'Order taken in this meeting' : 'Take an order'}
                  </h3>
                  {visitOrder ? <Badge variant="warning">{visitOrder.status}</Badge> : null}
                </div>

                {/* §3.5. The gate lives in the API and is not bypassed from
                    here; this only explains, in advance, what the user is
                    about to be told, so a Draft that will not place is not a
                    surprise after the fact. */}
                {companyId && !partyComplete ? (
                  <p className="rounded-lg border border-warning-border bg-warning-bg p-3 text-label text-warning">
                    {companyName} is an incomplete record
                    {partyMissing ? `: ${partyMissing}` : ''}. An order taken now
                    stays a Draft until those details are filled in.
                  </p>
                ) : null}

                <InlineOrderEntry
                  visitId={visitId}
                  orderDate={visitDate}
                  existing={visitOrder}
                  onSaved={onSaved}
                />
              </section>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function OrderRow({ order }: { order: MeetingOrder }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border-light p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-body font-medium text-text-primary">
          {fmtAmount(order.total_amount)}
          <span className="ml-2 text-label font-normal text-text-secondary">
            {order.item_count} {order.item_count === 1 ? 'line' : 'lines'}
          </span>
        </p>
        <p className="text-label text-text-secondary">
          {fmtDate(order.order_date)}
          {order.users ? ` · ${order.users.name}` : ''}
          {order.order_source === 'meeting' ? ' · from a meeting' : ''}
        </p>
        {order.blocked_reason ? (
          <p className="text-label text-warning">{order.blocked_reason}</p>
        ) : null}
      </div>
      <Badge variant={order.status === 'Placed' ? 'success' : 'warning'}>
        {order.status}
      </Badge>
    </li>
  )
}
