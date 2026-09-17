'use client'

import { useState, useEffect } from 'react'
import { PlusIcon } from 'lucide-react'

import { useToast } from '@/contexts/ToastContext'
import { ORDER_STATUS, StatusBadge } from '@/components/status-badge'
import {
  ListPage,
  type ListColumn,
  type ListFilter,
  type ListPageProps,
} from '@/components/templates/list-page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type OrderRow = {
  id: string
  order_date: string
  order_source: 'meeting' | 'direct'
  entity_type: string | null
  entity_id: string | null
  entity_name: string | null
  visit_id: string | null
  user_id: string
  status: 'Draft' | 'Submitted' | 'Confirmed'
  total_amount: number
  users: { name: string } | null
}

type OrderDetail = OrderRow & {
  order_items: {
    id: string
    product_name: string
    qty: number
    rate: number
    amount: number
  }[]
}

type Product = { id: string; name: string; price: number }
type TeamMember = { id: string; name: string }
type LeadType = { id: string; name: string }
type BizPartner = { id: string; name: string }

type OrderItem = {
  product_id: string | null
  product_name: string
  qty: number
  rate: number
}


function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtAmount(n: number) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ─────────────────────────────────────────────────────────────
// CreateOrderModal
// ─────────────────────────────────────────────────────────────
function CreateOrderModal({
  onClose, onSaved, hasSubordinates,
}: {
  onClose: () => void
  onSaved: () => void
  hasSubordinates: boolean
}) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  // Lead type + mode
  const [leadTypes, setLeadTypes] = useState<LeadType[]>([])
  const [leadType, setLeadType] = useState('')
  const [mode, setMode] = useState<'existing' | 'lead' | 'new'>('existing')

  // Existing / Lead mode: loaded list + search
  const [entities, setEntities] = useState<BizPartner[]>([])
  const [entLoading, setEntLoading] = useState(false)
  const [entityQuery, setEntityQuery] = useState('')
  const [entityDropOpen, setEntityDropOpen] = useState(false)
  const [entityId, setEntityId] = useState('')
  const [entityName, setEntityName] = useState('')

  // New mode
  const [newName, setNewName] = useState('')
  const [newMobile, setNewMobile] = useState('')

  // Order meta
  const [salesExecs, setSalesExecs] = useState<TeamMember[]>([])
  const [salesUserId, setSalesUserId] = useState('')
  const [orderDate, setOrderDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [status, setStatus] = useState<'Draft' | 'Submitted' | 'Confirmed'>('Draft')

  // Products
  const [products, setProducts] = useState<Product[]>([])
  const [items, setItems] = useState<OrderItem[]>([{ product_id: null, product_name: '', qty: 1, rate: 0 }])

  useEffect(() => {
    fetch('/api/masters/lead-types').then(r => r.json()).then((d: LeadType[]) => {
      const list = Array.isArray(d) ? d : []
      setLeadTypes(list)
      if (list.length > 0) setLeadType(list[0].name)
    }).catch(() => toast('Failed to load lead types', 'error'))

    fetch('/api/masters/products').then(r => r.json()).then(d => {
      setProducts(Array.isArray(d) ? d : [])
    }).catch(() => toast('Failed to load products', 'error'))

    if (hasSubordinates) {
      fetch('/api/orders/team').then(r => r.json()).then(d => {
        const team: TeamMember[] = Array.isArray(d) ? d : []
        setSalesExecs(team)
        if (team.length > 0) setSalesUserId(team[0].id)
      }).catch(() => toast('Failed to load team members', 'error'))
    }
  }, [hasSubordinates]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load entities when lead type or mode changes (not needed for 'new' mode)
  useEffect(() => {
    if (!leadType || mode === 'new') { setEntities([]); return }
    setEntityId(''); setEntityName(''); setEntityQuery('')
    setEntLoading(true)
    const status = mode === 'lead' ? 'lead' : 'existing'
    fetch(`/api/business-partners?type=${encodeURIComponent(leadType)}&status=${status}`)
      .then(r => r.json())
      .then(d => { setEntities(Array.isArray(d) ? d : []); setEntLoading(false) })
      .catch(() => setEntLoading(false))
  }, [leadType, mode])

  function resetEntity() {
    setEntityId(''); setEntityName(''); setEntityQuery(''); setEntityDropOpen(false)
    setNewName(''); setNewMobile('')
  }

  function addRow() {
    setItems(prev => [...prev, { product_id: null, product_name: '', qty: 1, rate: 0 }])
  }
  function removeRow(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }
  function updateRow(idx: number, field: keyof OrderItem, value: string | number | null) {
    setItems(prev => prev.map((row, i) => i !== idx ? row : { ...row, [field]: value }))
  }
  function onProductSelect(idx: number, productId: string) {
    const p = products.find(px => px.id === productId)
    if (p) {
      const existingIdx = items.findIndex((row, i) => i !== idx && row.product_id === p.id)
      if (existingIdx !== -1) {
        setItems(prev => prev.map((row, i) => {
          if (i === existingIdx) return { ...row, qty: row.qty + 1 }
          if (i === idx) return { product_id: null, product_name: '', qty: 1, rate: 0 }
          return row
        }))
        return
      }
      setItems(prev => prev.map((row, i) => i !== idx ? row : {
        ...row, product_id: p.id, product_name: p.name, rate: Number(p.price),
      }))
    } else {
      updateRow(idx, 'product_id', null)
    }
  }

  const validItems = items.filter(i => i.product_name.trim() && i.qty > 0)
  const total = validItems.reduce((s, i) => s + i.qty * i.rate, 0)
  const totalQty = validItems.reduce((s, i) => s + i.qty, 0)

  const resolvedEntityName = mode === 'new' ? newName.trim() : entityName
  const resolvedEntityId   = mode === 'new' ? null : entityId

  async function handleSave() {
    if (!leadType) { toast('Please select a lead type', 'error'); return }
    if (mode !== 'new' && !entityId) { toast(`Please select a ${leadType}`, 'error'); return }
    if (mode === 'new' && !newName.trim()) { toast('Please enter a name', 'error'); return }
    if (validItems.length === 0) { toast('Add at least one product', 'error'); return }
    if (total <= 0) { toast('Total order value must be greater than 0', 'error'); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        order_source: 'direct',
        entity_type: leadType,
        entity_id: resolvedEntityId,
        entity_name: resolvedEntityName,
        order_date: orderDate,
        status,
        items: validItems,
      }
      if (hasSubordinates && salesUserId) body.sales_user_id = salesUserId
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        toast((err as { error?: string }).error ?? 'Failed to create order', 'error')
      } else {
        toast('Order created successfully')
        onSaved()
        onClose()
      }
    } catch {
      toast('Network error', 'error')
    }
    setSaving(false)
  }

  const filteredEntities = entityQuery
    ? entities.filter(e => e.name.toLowerCase().includes(entityQuery.toLowerCase()))
    : entities

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-(--backdrop)" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light shrink-0">
          <h3 className="font-medium text-text-primary">Create Order</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-control">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* ── Section 1: Basic Info ── */}
          <div>
            <p className="text-xs font-normal text-text-muted uppercase tracking-wider mb-3">Basic Information</p>
            <div className="space-y-3">

              {/* Lead Type dropdown */}
              <div>
                <label htmlFor="order-lead-type" className="block text-xs text-text-secondary mb-1">Lead Type <span className="text-danger">*</span></label>
                <select id="order-lead-type" value={leadType}
                  onChange={e => { setLeadType(e.target.value); resetEntity() }}
                  className="w-full border border-border-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring bg-surface">
                  <option value="">Select type…</option>
                  {leadTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>

              {/* Mode chips */}
              {leadType && (
                <div>
                  <p className="text-xs text-text-muted mb-1.5">Record Type</p>
                  <div className="flex gap-2">
                    {(['existing', 'lead', 'new'] as const).map(m => (
                      <button key={m} onClick={() => { setMode(m); resetEntity() }}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                          mode === m ? 'bg-primary text-primary-foreground' : 'bg-surface-control text-text-secondary hover:bg-surface-control-hover'
                        }`}>
                        {m === 'existing' ? 'Existing' : m === 'lead' ? 'Lead' : 'New'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Existing / Lead: searchable dropdown */}
              {leadType && mode !== 'new' && (
                <div>
                  <label htmlFor="order-entity-search" className="block text-xs text-text-secondary mb-1">
                    Select {mode === 'lead' ? 'Lead' : leadType} <span className="text-danger">*</span>
                  </label>
                  {entLoading ? (
                    <div className="text-sm text-text-muted py-2">Loading…</div>
                  ) : (
                    <div className="relative">
                      <input id="order-entity-search" type="text" value={entityQuery}
                        onChange={e => { setEntityQuery(e.target.value); setEntityId(''); setEntityName(''); setEntityDropOpen(true) }}
                        onFocus={() => setEntityDropOpen(true)}
                        onBlur={() => setTimeout(() => setEntityDropOpen(false), 150)}
                        placeholder="Search…"
                        className="w-full border border-border-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
                      {entityDropOpen && (
                        <ul className="absolute z-20 w-full mt-1 bg-surface border border-border-light rounded-xl shadow-lg max-h-48 overflow-y-auto">
                          {filteredEntities.length === 0 ? (
                            <li className="px-3 py-2 text-sm text-text-muted">No matches</li>
                          ) : filteredEntities.map(e => (
                            <li key={e.id}
                              onMouseDown={() => { setEntityId(e.id); setEntityName(e.name); setEntityQuery(e.name); setEntityDropOpen(false) }}
                              className="px-3 py-2 text-sm cursor-pointer hover:bg-primary-subtle hover:text-primary border-b border-border-light last:border-0">
                              {e.name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {entities.length === 0 && !entLoading && (
                    <p className="text-xs text-warning mt-1">No records found for this type.</p>
                  )}
                </div>
              )}

              {/* New: basic form */}
              {leadType && mode === 'new' && (
                <div className="space-y-2">
                  <div>
                    <label htmlFor="order-new-name" className="block text-xs text-text-secondary mb-1">Name <span className="text-danger">*</span></label>
                    <input id="order-new-name" type="text" value={newName} onChange={e => setNewName(e.target.value)}
                      placeholder={`Enter ${leadType.toLowerCase()} name`}
                      className="w-full border border-border-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
                  </div>
                  <div>
                    <label htmlFor="order-new-mobile" className="block text-xs text-text-secondary mb-1">Mobile</label>
                    <input id="order-new-mobile" type="tel" value={newMobile} onChange={e => setNewMobile(e.target.value)}
                      placeholder="10-digit number" maxLength={10}
                      className="w-full border border-border-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {/* Sales Executive */}
                <div>
                  <label htmlFor="order-sales-exec" className="block text-xs text-text-secondary mb-1">Sales Executive <span className="text-danger">*</span></label>
                  {hasSubordinates ? (
                    <select id="order-sales-exec" value={salesUserId} onChange={e => setSalesUserId(e.target.value)}
                      className="w-full border border-border-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring bg-surface">
                      {salesExecs.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  ) : (
                    <input id="order-sales-exec" type="text" value="You" readOnly
                      className="w-full border border-border-light rounded-lg px-3 py-2 text-sm bg-surface-sunken text-text-secondary cursor-not-allowed" />
                  )}
                </div>

                {/* Order Date */}
                <div>
                  <label htmlFor="order-date" className="block text-xs text-text-secondary mb-1">Order Date <span className="text-danger">*</span></label>
                  <input id="order-date" type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)}
                    className="w-full border border-border-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
                </div>
              </div>

              {/* Status */}
              <div>
                <label htmlFor="order-status" className="block text-xs text-text-secondary mb-1">Order Status <span className="text-danger">*</span></label>
                <select id="order-status" value={status} onChange={e => setStatus(e.target.value as typeof status)}
                  className="w-full border border-border-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring bg-surface">
                  <option value="Draft">Draft</option>
                  <option value="Submitted">Submitted</option>
                  <option value="Confirmed">Confirmed</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Section 2: Products ── */}
          <div>
            <p className="text-xs font-normal text-text-muted uppercase tracking-wider mb-3">Products</p>

            <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-medium text-text-muted px-1">
              <div className="col-span-5">Product</div>
              <div className="col-span-2 text-center">Unit Price</div>
              <div className="col-span-1 text-center">Qty</div>
              <div className="col-span-2 text-center">Rate</div>
              <div className="col-span-1 text-right">Total</div>
              <div className="col-span-1" />
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5">
                    <select value={item.product_id ?? ''} onChange={e => {
                      if (e.target.value === '') { updateRow(idx, 'product_id', null) }
                      else { onProductSelect(idx, e.target.value) }
                    }} className="w-full border border-border-light rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring bg-surface">
                      <option value="">Select product...</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {!item.product_id && (
                      <input type="text" value={item.product_name} onChange={e => updateRow(idx, 'product_name', e.target.value)}
                        placeholder="Or type name..."
                        className="w-full mt-1 border border-border-light rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-ring" />
                    )}
                  </div>
                  <div className="col-span-2 text-center text-xs text-text-muted">
                    {item.product_id ? `₹${Number(products.find(p => p.id === item.product_id)?.price ?? 0).toFixed(0)}` : '—'}
                  </div>
                  <div className="col-span-1">
                    <input type="number" min="1" value={item.qty}
                      onChange={e => updateRow(idx, 'qty', Math.max(1, Number(e.target.value)))}
                      className="w-full border border-border-light rounded-lg px-1 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary-ring" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" min="0" step="0.01" value={item.rate}
                      onChange={e => updateRow(idx, 'rate', Number(e.target.value))}
                      className="w-full border border-border-light rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary-ring" />
                  </div>
                  <div className="col-span-1 text-right text-sm font-medium text-text-secondary">
                    ₹{(item.qty * item.rate).toFixed(0)}
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {items.length > 1 && (
                      <button onClick={() => removeRow(idx)} className="p-1 text-text-muted hover:text-danger transition">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button onClick={addRow}
              className="mt-3 w-full py-2 border-2 border-dashed border-border-light rounded-lg text-sm text-text-muted hover:border-primary-border hover:text-primary transition flex items-center justify-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              Add Row
            </button>

            <div className="mt-3 flex items-center justify-end gap-2 border-t border-border-light pt-3">
              <span className="text-sm text-text-secondary">Total:</span>
              <span className="text-lg font-medium text-text-primary">{fmtAmount(total)}</span>
            </div>
          </div>

          {/* ── Section 3: Summary ── */}
          {resolvedEntityName && validItems.length > 0 && (
            <div className="rounded-xl bg-surface-sunken border border-border-light p-4">
              <p className="text-xs font-normal text-text-muted uppercase tracking-wider mb-3">Order Summary</p>
              <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                <div><span className="text-text-muted">Entity: </span><span className="font-medium text-text-primary">{resolvedEntityName}</span></div>
                <div><span className="text-text-muted">Sales Exec: </span><span className="font-medium text-text-primary">
                  {hasSubordinates ? salesExecs.find(m => m.id === salesUserId)?.name ?? '—' : 'You'}
                </span></div>
                <div><span className="text-text-muted">Items: </span><span className="font-medium text-text-primary">{validItems.length}</span></div>
                <div><span className="text-text-secondary">Total Qty: </span><span className="font-medium text-text-primary">{totalQty}</span></div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Total Order Value</span>
                <span className="text-xl font-medium text-text-primary">{fmtAmount(total)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2 border-t border-border-light pt-4 shrink-0">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-border-light rounded-xl text-sm font-medium text-text-secondary hover:bg-surface-sunken transition">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 bg-primary hover:bg-primary-hover text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-40 transition">
            {saving ? 'Creating...' : 'Create Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// OrderDetailDrawer
// ─────────────────────────────────────────────────────────────
function OrderDetailDrawer({ order, onClose, onStatusChange }: {
  order: OrderDetail
  onClose: () => void
  onStatusChange: () => void
}) {
  const { toast } = useToast()
  const [status, setStatus] = useState<'Draft' | 'Submitted' | 'Confirmed'>(order.status)
  const [saving, setSaving] = useState(false)

  async function updateStatus(newStatus: 'Draft' | 'Submitted' | 'Confirmed') {
    setSaving(true)
    const r = await fetch(`/api/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (!r.ok) {
      toast('Failed to update status', 'error')
    } else {
      setStatus(newStatus)
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

          {/* Status */}
          <div>
            <span className="text-xs text-text-secondary block mb-1">Status</span>
            <select value={status} onChange={e => updateStatus(e.target.value as typeof status)} disabled={saving}
              className="border border-border-light rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring bg-surface disabled:opacity-50">
              <option value="Draft">Draft</option>
              <option value="Submitted">Submitted</option>
              <option value="Confirmed">Confirmed</option>
            </select>
          </div>

          {/* Items table */}
          <div>
            <p className="text-xs font-normal text-text-muted uppercase tracking-wider mb-3">Products</p>
            <div className="rounded-xl border border-border-light overflow-hidden">
              <div className="grid grid-cols-10 gap-2 px-3 py-2 bg-surface-sunken text-xs font-medium text-text-muted border-b border-border-light">
                <div className="col-span-4">Product</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-2 text-center">Rate</div>
                <div className="col-span-2 text-right">Amount</div>
              </div>
              {order.order_items.map(item => (
                <div key={item.id} className="grid grid-cols-10 gap-2 px-3 py-2.5 border-b border-border-light last:border-0 text-sm">
                  <div className="col-span-4 text-text-primary">{item.product_name}</div>
                  <div className="col-span-2 text-center text-text-secondary">{item.qty}</div>
                  <div className="col-span-2 text-center text-text-secondary">₹{Number(item.rate).toFixed(0)}</div>
                  <div className="col-span-2 text-right font-medium text-text-primary">₹{Number(item.amount).toFixed(0)}</div>
                </div>
              ))}
              {order.order_items.length === 0 && (
                <div className="px-3 py-4 text-sm text-text-muted text-center">No items</div>
              )}
            </div>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between bg-surface-sunken rounded-xl px-4 py-3">
            <span className="text-sm font-medium text-text-secondary">Total Order Value</span>
            <span className="text-xl font-medium text-text-primary">{fmtAmount(Number(order.total_amount))}</span>
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
  Submitted: 'Submitted',
  Confirmed: 'Confirmed',
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
      cellClassName: 'font-medium text-text-primary',
      skeletonWidth: 'w-20',
      cell: order => fmtAmount(Number(order.total_amount)),
    },
    {
      id: 'status',
      header: 'Status',
      className: 'whitespace-nowrap',
      skeletonWidth: 'w-20',
      cell: order => <StatusBadge vocabulary={ORDER_STATUS} status={order.status} />,
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

export default function OrdersPage() {
  const { toast } = useToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [detailOrder, setDetailOrder] = useState<OrderDetail | null>(null)
  const [hasSubordinates, setHasSubordinates] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  /* Bumped when a create or a status change makes the list stale. */
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      setHasSubordinates(d.hasSubordinates ?? false)
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
    if (filters.status) params.set('status', filters.status)
    if (filters.user) params.set('userId', filters.user)
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

  return (
    <>
      <ListPage<OrderRow>
        title="Orders"
        noun={{ one: 'order', many: 'orders' }}
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            Create order
          </Button>
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
          actionLabel: 'Create order',
          onAction: () => setCreateOpen(true),
        }}
      />

      {createOpen && (
        <CreateOrderModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => setRefreshKey(k => k + 1)}
          hasSubordinates={hasSubordinates}
        />
      )}
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
