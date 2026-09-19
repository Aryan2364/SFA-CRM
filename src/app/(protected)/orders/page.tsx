'use client'

import { Suspense, useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { PlusIcon, SquareArrowOutUpRightIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { DataHealthAlert, QuickFilterChip } from '@/components/alerts/data-health-alert'
import { DISCOUNT_FLAG, ORDER_STATUS, SpecBadge, StatusBadge } from '@/components/status-badge'
import {
  ListPage,
  type ListColumn,
  type ListFilter,
  type ListPageProps,
} from '@/components/templates/list-page'
import { CreateOrderDialog } from '@/components/orders/create-order-dialog'
import { OptionSelect } from '@/components/orders/option-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fmtAmount, fmtDate, fmtQty } from '@/lib/format'
import { ORDER_STATUSES, type DiscountType, type OrderStatus } from '@/lib/order-math'

type OrderRow = {
  id: string
  order_date: string
  order_source: 'meeting' | 'direct'
  entity_type: string | null
  entity_id: string | null
  entity_name: string | null
  visit_id: string | null
  user_id: string
  status: OrderStatus
  /* The NET payable. `gross_amount` is what it was before any discount. */
  total_amount: number
  gross_amount: number
  /* Stored rather than derived (§7.2) — the list reads it directly. */
  has_discount: boolean
  users: { name: string } | null
  /* P5-T7 §7.7: "Pending Draft Orders, with the reason each is stuck".
     `GET /api/orders` selects every scalar column (no `select`, only
     `include`), so this is already on the wire — it was simply not on
     the type the list read. Null on anything that was never blocked. */
  blocked_reason: string | null
}

type OrderDetail = OrderRow & {
  /**
   * §5.6's Order → Meeting link, already scope-checked by
   * `GET /api/orders/[id]`. NOT derived from `visit_id`: that column says an
   * order came from a meeting, it does not say this reader may open it. Null
   * covers both "no meeting" and "not yours", and the drawer must render
   * nothing for either — a link the reader cannot follow, or a party name
   * they were never granted, are the same leak in two shapes.
   */
  meeting: { id: string; entity_name: string; visit_date: string } | null
  item_discount_total: number
  order_discount_type: DiscountType
  order_discount_value: number
  order_discount_amount: number
  /* Why this order could not be Placed, written by the API (§3.5). */
  blocked_reason: string | null
  order_items: {
    id: string
    product_name: string
    qty: number
    rate: number
    gross_amount: number
    discount_type: DiscountType
    discount_value: number
    discount_amount: number
    /* The NET line total. */
    amount: number
  }[]
}

type TeamMember = { id: string; name: string }

/** The drawer's status picker. Two words and no third (§4.10). */
const DETAIL_STATUS_OPTIONS: Record<string, string> = Object.fromEntries(
  ORDER_STATUSES.map(s => [s, s])
)

// ─────────────────────────────────────────────────────────────
// OrderDetailDrawer
// ─────────────────────────────────────────────────────────────
function OrderDetailDrawer({ order, onClose, onStatusChange }: {
  order: OrderDetail
  onClose: () => void
  onStatusChange: () => void
}) {
  const { toast } = useToast()
  const [status, setStatus] = useState<OrderStatus>(order.status)
  const [saving, setSaving] = useState(false)
  /* §3.5's refusal, kept on screen after the toast has gone: the reason an
     order cannot be placed is a property of the record, so it stays visible
     until the party is fixed rather than vanishing in four seconds. */
  const [blockedReason, setBlockedReason] = useState<string | null>(order.blocked_reason)

  async function updateStatus(newStatus: OrderStatus) {
    setSaving(true)
    const r = await fetch(`/api/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (!r.ok) {
      /* The API says WHY — an incomplete party, and which fields. Repeating
         "Failed to update status" over the top of that would throw away the
         only part of the answer the user can act on. */
      const err = await r.json().catch(() => ({})) as { error?: string; blocked_reason?: string }
      setBlockedReason(err.blocked_reason ?? null)
      toast(err.error ?? 'Failed to update status', 'error')
    } else {
      setStatus(newStatus)
      setBlockedReason(null)
      toast('Status updated')
      onStatusChange()
    }
    setSaving(false)
  }

  return (
    <>
      <div className="fixed inset-0 bg-(--backdrop) z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-screen w-[480px] max-w-full bg-surface shadow-2xl border-l border-border-light z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light shrink-0">
          <div>
            <h3 className="font-medium text-text-primary">
              {order.entity_name ?? (order.visit_id ? 'Meeting Order' : 'Direct Order')}
            </h3>
            <p className="text-xs text-text-muted mt-0.5">{fmtDate(order.order_date)}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-control">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-text-muted block mb-0.5">Entity</span>
              <span className="font-medium text-text-primary">{order.entity_name ?? '(Meeting-based)'}</span>
            </div>
            <div>
              <span className="text-xs text-text-muted block mb-0.5">Type</span>
              <span className="font-medium text-text-primary">{order.entity_type ?? '—'}</span>
            </div>
            <div>
              <span className="text-xs text-text-muted block mb-0.5">Sales Executive</span>
              <span className="font-medium text-text-primary">{order.users?.name ?? '—'}</span>
            </div>
            <div>
              <span className="text-xs text-text-muted block mb-0.5">Source</span>
              <span className={`text-xs font-normal px-2 py-0.5 rounded-full ${order.order_source === 'direct' ? 'bg-chart-1 text-primary-foreground' : 'bg-chart-2 text-primary-foreground'}`}>
                {order.order_source === 'direct' ? 'Direct' : 'Meeting'}
              </span>
            </div>
          </div>

          {/*
            §5.6, Order → Meeting. It sits directly under Source, which is the
            field that says this order came from a meeting at all — the link
            belongs beside the fact it follows from, not in a corner.

            Rendered ONLY when the API resolved a meeting this reader may open.
            A Direct order has none and shows nothing here; so does an order
            whose meeting is outside the reader's scope. §5.6: if meetings
            exist, links appear; if not, nothing appears — no empty row, no
            disabled link, no "no meeting" line.
          */}
          {order.meeting && (
            <Link
              href={`/daily-activity/meeting/${order.meeting.id}`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border-light px-3 py-2.5 transition-colors hover:bg-surface-control"
            >
              <span className="min-w-0">
                <span className="text-xs text-text-muted block mb-0.5">Taken in this meeting</span>
                <span className="block truncate text-sm font-medium text-text-primary">
                  {order.meeting.entity_name}
                  <span className="ml-2 font-normal text-text-secondary">
                    {fmtDate(order.meeting.visit_date)}
                  </span>
                </span>
              </span>
              <SquareArrowOutUpRightIcon className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
            </Link>
          )}

          {/* Status */}
          <div>
            <label htmlFor="order-detail-status" className="text-xs text-text-secondary block mb-1">Status</label>
            <div className="flex items-center gap-2 flex-wrap">
              {/* F16: the kit's Select, like every other picker on this
                  screen. A native <select> paints the operating system's
                  menu and cannot carry §16.2's selected-vs-hovered rule. */}
              <div className="w-40">
                <OptionSelect
                  id="order-detail-status"
                  options={DETAIL_STATUS_OPTIONS}
                  value={status}
                  onValueChange={v => updateStatus(v as OrderStatus)}
                  disabled={saving}
                  className="max-w-none"
                />
              </div>
              {order.has_discount && <SpecBadge spec={DISCOUNT_FLAG} />}
            </div>
            {blockedReason && (
              <p className="mt-2 rounded-lg bg-warning-bg border border-warning-border px-3 py-2 text-xs text-warning">
                This order cannot be placed. {blockedReason}
              </p>
            )}
          </div>

          {/* Items table */}
          <div>
            <p className="text-xs font-normal text-text-muted uppercase tracking-wider mb-3">Products</p>
            <div className="rounded-xl border border-border-light overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-surface-sunken text-xs font-medium text-text-muted border-b border-border-light">
                <div className="col-span-4">Product</div>
                <div className="col-span-1 text-center">Qty</div>
                <div className="col-span-2 text-right">Rate</div>
                <div className="col-span-3 text-right">Discount</div>
                <div className="col-span-2 text-right">Amount</div>
              </div>
              {order.order_items.map(item => (
                <div key={item.id} className="grid grid-cols-12 gap-2 px-3 py-2.5 border-b border-border-light last:border-0 text-sm">
                  <div className="col-span-4 text-text-primary break-words">{item.product_name}</div>
                  <div className="col-span-1 text-center text-text-secondary tabular-nums">{fmtQty(item.qty)}</div>
                  <div className="col-span-2 text-right text-text-secondary tabular-nums">{fmtAmount(item.rate)}</div>
                  <div className="col-span-3 text-right tabular-nums whitespace-nowrap">
                    {Number(item.discount_amount) > 0 ? (
                      <span className="text-warning">
                        −{fmtAmount(item.discount_amount)}
                        {item.discount_type === 'percent' && (
                          <span className="block text-xs text-text-muted">{Number(item.discount_value)}%</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </div>
                  <div className="col-span-2 text-right font-medium text-text-primary tabular-nums">
                    {fmtAmount(item.amount)}
                  </div>
                </div>
              ))}
              {order.order_items.length === 0 && (
                <div className="px-3 py-4 text-sm text-text-muted text-center">No items</div>
              )}
            </div>
          </div>

          {/* Total. Gross, each discount and the net, so the arithmetic on
              the row can be followed rather than taken on trust. The middle
              lines are omitted on a clean order — there is nothing to show
              and an order with no discount should read as one line. */}
          <div className="bg-surface-sunken rounded-xl px-4 py-3 space-y-2">
            {order.has_discount && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Subtotal</span>
                  <span className="text-text-primary tabular-nums">{fmtAmount(order.gross_amount)}</span>
                </div>
                {Number(order.item_discount_total) > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Item discounts</span>
                    <span className="text-warning tabular-nums">−{fmtAmount(order.item_discount_total)}</span>
                  </div>
                )}
                {Number(order.order_discount_amount) > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">
                      Overall discount
                      {order.order_discount_type === 'percent' && ` (${Number(order.order_discount_value)}%)`}
                    </span>
                    <span className="text-warning tabular-nums">−{fmtAmount(order.order_discount_amount)}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center justify-between border-t border-border-light pt-2 first:border-0 first:pt-0">
              <span className="text-sm font-medium text-text-secondary">Total Order Value</span>
              <span className="text-xl font-medium text-text-primary tabular-nums">{fmtAmount(order.total_amount)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// Main Page — section 11.1's four zones, via templates/list-page
// ─────────────────────────────────────────────────────────────

/**
 * The template treats `''` as "filter not applied", so it is also the
 * key of every picker's "any" option — one value, not a sentinel the
 * screen has to translate.
 */
const STATUS_OPTIONS: Record<string, string> = {
  '': 'Any status',
  Draft: 'Draft',
  Placed: 'Placed',
}

/** §7.2's "Discount Applied (Yes/No)", as a filter over the stored column. */
const DISCOUNT_OPTIONS: Record<string, string> = {
  '': 'Any order',
  yes: 'Discounted',
  no: 'No discount',
}

/**
 * Section 27.1 asks the search field to carry the list of fields it
 * covers, and asks for any exclusion to be declared.
 *
 * **This is a gap, not a decision.** `/api/orders` matches `q` against
 * `entity_name` and nothing else, so entity type, the sales
 * executive's name and the status label are all invisible to search —
 * somebody typing a colleague's name gets an empty list and no way to
 * tell that the box never looked there. Widening it is a change to the
 * route's `where` clause, not to this screen, so the field says what
 * it does rather than pretending.
 */
const SEARCH_HINT = 'Searches the entity name.'

/**
 * COLUMN CLASSIFICATION — section 10 rule 4 requires every table to
 * declare one, and section 10 rule 2 makes it the alternative to
 * scrolling sideways.
 *
 *   essential          Entity, Amount, Status, View
 *   hide-below-1024    Sales Exec, Source
 *   hide-below-768     Date, Type
 *
 * Entity, Amount and Status are what an order IS — who it is for, what
 * it is worth, and whether it still needs doing — and View is the only
 * route into the record, so a row without it is a dead end.
 *
 * Sales Exec and Source go first because they are the two a reader can
 * most afford to lose: a rep sees their own name on every row, and
 * Direct-versus-Meeting is provenance rather than content. Date and
 * Type survive to 768 because the list is sorted by date and Type
 * qualifies the entity name. All four dropped columns are still on the
 * record's own panel, so nothing becomes unreachable.
 *
 * Eight columns at 1280, six at 768, measured to fit at both: the
 * table is 901px in 911px of zone 3 at 1024 and 709 in 719 at 768, so
 * it never scrolls sideways and no column is frozen.
 */
function orderColumns(onOpen: (id: string) => void): ListColumn<OrderRow>[] {
  return [
    {
      id: 'date',
      header: 'Date',
      tier: 'hide-below-768',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-24',
      cell: order => fmtDate(order.order_date),
    },
    {
      id: 'entity',
      header: 'Entity',
      grow: true,
      truncate: true,
      cellClassName: 'font-medium text-text-primary',
      skeletonWidth: 'w-40',
      cell: order => order.entity_name ?? '—',
    },
    {
      id: 'type',
      header: 'Type',
      tier: 'hide-below-768',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-20',
      cell: order => order.entity_type ?? '—',
    },
    {
      id: 'exec',
      header: 'Sales Exec',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-28',
      cell: order => order.users?.name ?? '—',
    },
    {
      id: 'amount',
      header: 'Amount',
      numeric: true,
      className: 'whitespace-nowrap',
      cellClassName: 'font-medium text-text-primary tabular-nums',
      skeletonWidth: 'w-20',
      cell: order => (
        <>
          {fmtAmount(order.total_amount)}
          {order.has_discount && (
            <span className="block text-xs font-normal text-text-muted line-through">
              {fmtAmount(order.gross_amount)}
            </span>
          )}
        </>
      ),
    },
    {
      /* §4.10: a discounted order must be visibly different from a clean
         one. The flag rides in the Status cell rather than taking an
         eighth column, because it is read in the same glance as the
         status and the table is already measured to the pixel (see the
         classification note above). A clean order shows nothing. */
      id: 'status',
      header: 'Status',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-20',
      cell: order => (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <StatusBadge vocabulary={ORDER_STATUS} status={order.status} />
            {order.has_discount && <SpecBadge spec={DISCOUNT_FLAG} />}
          </div>
          {/* P5-T7 §7.7: "with the reason each is stuck" — plain text, no
              Tooltip, same reasoning as the Parties list's completeness
              line: a client-only overlay component in a table cell is the
              variable that broke hydration there. */}
          {order.status === 'Draft' && order.blocked_reason && (
            <span
              className="block max-w-40 truncate text-xs text-text-secondary"
              title={order.blocked_reason}
            >
              {order.blocked_reason}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'source',
      header: 'Source',
      tier: 'hide-below-1024',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-16',
      /* Not a status, so not a status colour. These two are the
         categorical pair this screen already carried, left as they
         were — see status-badge.tsx for what IS status here. */
      cell: order => (
        <Badge
          className={
            order.order_source === 'direct'
              ? 'border-chart-1 bg-chart-1 text-primary-foreground'
              : 'border-chart-2 bg-chart-2 text-primary-foreground'
          }
        >
          {order.order_source === 'direct' ? 'Direct' : 'Meeting'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control-sm w-16',
      cell: order => (
        <Button variant="secondary" size="sm" onClick={() => onOpen(order.id)}>
          View
        </Button>
      ),
    },
  ]
}

/**
 * §5.5's View All — "goes to the Orders page with the **Company filter applied
 * automatically. Other filters remain available.**" (P3-T9.)
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS SEEDED HERE AND NOT IN `templates/list-page.tsx`
 *
 * The specification asks for this of ORDERS, not of the ten screens that share
 * that template. Teaching the template to read `useSearchParams` would change
 * the URL handling of nine screens that never asked for it, and none of them
 * could opt out. So the narrowing lives in the one screen that needs it.
 *
 * ---------------------------------------------------------------------------
 * IT IS A PAGE-LEVEL NARROWING, NOT A `ListFilter`
 *
 * Exactly the shape `onlyDraft` below already has, and for the same reason: the
 * template owns its own filter state, and reaching into it from outside —
 * whether through a new prop or a controlled-value escape hatch — would make
 * this screen's filter panel behave unlike every other one. Instead the company
 * rides the query `load()` builds, and the chip says it is on and offers the
 * way out of it. The declared filters are untouched: date, status, discount and
 * team member all stay usable and none of them is cleared or locked, which is
 * the second half of the sentence above.
 *
 * ⚠️ IT KEYS ON THE COMPANY ID, NEVER THE NAME. Two parties can share a name,
 * and more importantly an order punched against a meeting carries NO
 * `entity_name` at all — see the meeting branch of `POST /api/orders`, which
 * writes neither `entity_type` nor `entity_id` nor `entity_name`. A name filter
 * would therefore show a party's direct orders and silently drop the ones taken
 * in front of them. `?entityId=` on the API matches both routes an order can
 * reach a party: its own `entity_id`, or the visit it was taken at. The name is
 * looked up afterwards for the chip's LABEL only and never filters anything.
 */
function OrdersPageInner() {
  const { toast } = useToast()
  const searchParams = useSearchParams()

  /*
   * Read once, on mount. A lazy initialiser rather than an effect, so the
   * value is already in the closure when the template runs its first load —
   * an effect would fire a second, unfiltered request first and the user
   * would watch the full list appear and then narrow.
   */
  const [companyId, setCompanyId] = useState(() => searchParams.get('entityId') ?? '')
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    if (!companyId) { setCompanyName(''); return }
    let live = true
    fetch(`/api/companies/${companyId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live && d?.name) setCompanyName(d.name) })
      .catch(() => { /* the chip falls back to naming no party */ })
    return () => { live = false }
  }, [companyId])

  const [createOpen, setCreateOpen] = useState(false)
  const [detailOrder, setDetailOrder] = useState<OrderDetail | null>(null)
  const [hasSubordinates, setHasSubordinates] = useState(false)
  const [canCreateOrder, setCanCreateOrder] = useState(false)
  const [canCreateParty, setCanCreateParty] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  /* Bumped when a create or a status change makes the list stale. */
  const [refreshKey, setRefreshKey] = useState(0)

  /* P5-T7 §7.7 — "Pending Draft Orders". A separate, unfiltered fetch of
     the same scoped `/api/orders?status=Draft`, for the same reason the
     Parties list keeps its alert counts off a fetch of their own rather
     than off whatever the table currently has on screen. */
  const [draftOrders, setDraftOrders] = useState<OrderRow[] | null>(null)
  const [onlyDraft, setOnlyDraft] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/orders?status=Draft')
      .then(r => (r.ok ? r.json() : []))
      .then(d => { if (live) setDraftOrders(Array.isArray(d) ? d : []) })
      .catch(() => { if (live) setDraftOrders([]) })
    return () => { live = false }
  }, [refreshKey])

  const draftCount = draftOrders?.length ?? 0

  /* Real permissions, never a role name. `/api/auth/me` reports a section's
     `edit` as `can_edit || can_create`, which is the closest the wire gets to
     "may create" — and it is what `POST /api/orders` and `POST /api/companies`
     both authorise against (`can_create ?? can_edit`). A button whose only
     outcome for this user is a 403 is not shown. */
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      setHasSubordinates(d.hasSubordinates ?? false)
      setCanCreateOrder(Boolean(d.permissions?.orders?.edit))
      setCanCreateParty(Boolean(d.permissions?.companies?.edit))
    }).catch(() => toast('Failed to load user settings', 'error'))
  }, [toast])

  useEffect(() => {
    if (hasSubordinates) {
      fetch('/api/orders/team').then(r => r.json()).then(d => {
        setTeamMembers(Array.isArray(d) ? d : [])
      }).catch(() => toast('Failed to load team members', 'error'))
    }
  }, [hasSubordinates, toast])

  async function openDetail(orderId: string) {
    const r = await fetch(`/api/orders/${orderId}`)
    if (!r.ok) { toast('Could not load order details', 'error'); return }
    setDetailOrder(await r.json())
  }

  /*
   * §5.6's Meeting → Order landing. There is no `/orders/[id]` page — an
   * order is read in the drawer below — so a link to one order carries
   * `?open=<id>` and this opens it on arrival, over the list it belongs to.
   *
   * Read once, not watched: a `searchParams` dependency would re-open the
   * drawer every time the URL changed for any other reason, including the
   * user closing it. And the id is NOT trusted — `openDetail` fetches it
   * through the scoped route, so a stale or guessed id ends in the toast and
   * the plain list, never in somebody else's order.
   */
  const [deepLinkId] = useState(() => searchParams.get('open') ?? '')
  useEffect(() => {
    if (deepLinkId) void openDetail(deepLinkId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId])

  /*
   * Deliberately NOT memoised. The template holds `load` in a ref and
   * never makes it an effect dependency, so a new function on every
   * render costs nothing — and a screen getting that wrong is the
   * failure mode the ref exists to remove.
   *
   * No deadline and no catch here: the template races this against its
   * own timer, so a rejection IS the failed state and a hang becomes
   * one (section 14 rule 4).
   */
  const load: ListPageProps<OrderRow>['load'] = async ({ search, filters, signal }) => {
    const params = new URLSearchParams()
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
    if (filters.dateTo) params.set('dateTo', filters.dateTo)
    if (search) params.set('q', search)
    // P5-T7: the alert banner's one-click narrowing. `/api/orders` already
    // takes `?status=`, so — unlike the Parties/Deals overrides — this one
    // can ride the server-side filter rather than a client-side pass; it
    // only applies when the user has not picked a status of their own.
    if (filters.status) params.set('status', filters.status)
    else if (onlyDraft) params.set('status', 'Draft')
    if (filters.discounted) params.set('discounted', filters.discounted)
    if (filters.user) params.set('userId', filters.user)
    /* §5.5's View All. It rides alongside the declared filters rather than
       replacing any of them, so arriving here narrowed by company still
       leaves date, status, discount and team member free to use. */
    if (companyId) params.set('entityId', companyId)
    const query = params.toString()
    const r = await fetch(`/api/orders${query ? `?${query}` : ''}`, { signal })
    if (!r.ok) throw new Error(String(r.status))
    const body = await r.json()
    return Array.isArray(body) ? (body as OrderRow[]) : []
  }

  const filters: ListFilter[] = [
    { id: 'dateFrom', label: 'From', kind: 'date' },
    { id: 'dateTo', label: 'To', kind: 'date' },
    { id: 'status', label: 'Status', kind: 'select', options: STATUS_OPTIONS },
    { id: 'discounted', label: 'Discount', kind: 'select', options: DISCOUNT_OPTIONS },
    /* Section 26: the team picker only exists for somebody who has a
       team. Section 16.3: a team runs past six names sooner than it
       does not, so it is the searchable kind. */
    ...(hasSubordinates
      ? [
          {
            id: 'user',
            label: 'Team member',
            kind: 'select' as const,
            searchable: true,
            options: {
              '': 'Anyone',
              ...Object.fromEntries(teamMembers.map(m => [m.id, m.name])),
            },
          },
        ]
      : []),
  ]

  const draftReasons = [
    ...new Set((draftOrders ?? []).map(o => o.blocked_reason).filter((r): r is string => Boolean(r))),
  ]

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        {companyId ? (
          <QuickFilterChip
            label={
              companyName
                ? `Showing orders for ${companyName}`
                : 'Showing orders for one company'
            }
            /* Never a dead end: the narrowing the link applied can be taken
               off without leaving the page. `refreshKey` is what re-runs the
               query — `load` is held in a ref by the template and is not an
               effect dependency there, so changing this state alone would
               leave the old rows on screen. */
            onClear={() => { setCompanyId(''); setRefreshKey(k => k + 1) }}
          />
        ) : null}
        {onlyDraft ? (
          <QuickFilterChip
            label="Showing Draft orders only"
            onClear={() => { setOnlyDraft(false); setRefreshKey(k => k + 1) }}
          />
        ) : (
          <DataHealthAlert
            count={draftCount}
            title={`${draftCount} ${draftCount === 1 ? 'order is' : 'orders are'} stuck in Draft`}
            description={
              draftReasons.length > 0
                ? `Reasons on these orders: ${draftReasons.join('; ')}.`
                : 'A Draft order stays there until its party record is complete.'
            }
            actionLabel="View Draft orders"
            onAction={() => { setOnlyDraft(true); setRefreshKey(k => k + 1) }}
          />
        )}
      <ListPage<OrderRow>
        className="h-auto min-h-0 flex-1"
        title="Orders"
        noun={{ one: 'order', many: 'orders' }}
        action={
          canCreateOrder ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              Create order
            </Button>
          ) : undefined
        }
        columns={orderColumns(openDetail)}
        rowKey={order => order.id}
        filters={filters}
        load={load}
        refreshKey={refreshKey}
        searchHint={SEARCH_HINT}
        emptyYet={{
          heading: 'No orders yet',
          body: 'Orders raised against a dealer, distributor or lead are listed here.',
          ...(canCreateOrder
            ? { actionLabel: 'Create order', onAction: () => setCreateOpen(true) }
            : {}),
        }}
      />
      </div>

      <CreateOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => setRefreshKey(k => k + 1)}
        hasSubordinates={hasSubordinates}
        canCreateParty={canCreateParty}
      />
      {detailOrder && (
        <OrderDetailDrawer
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          onStatusChange={() => {
            setRefreshKey(k => k + 1)
            setDetailOrder(null)
          }}
        />
      )}
    </>
  )
}

/**
 * `useSearchParams` makes this screen depend on the request URL, so Next
 * requires a Suspense boundary around it — without one the whole route opts
 * out of static rendering and the build says so. The fallback is deliberately
 * nothing: the template paints its own skeleton the moment it mounts, and a
 * second, differently-shaped loading state flashing before it is worse than a
 * beat of blank.
 */
export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersPageInner />
    </Suspense>
  )
}
