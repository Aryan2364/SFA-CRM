'use client'

import { useState, useEffect } from 'react'
import CrudPage, { Column } from '@/components/ui/CrudPage'
import Modal from '@/components/ui/Modal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useCrud } from '@/hooks/useCrud'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'

const COLS: Column[] = [
  { key: 'name', label: 'Product Name' },
  { key: 'cat', label: 'Category', render: r => (r.product_categories as { name: string } | null)?.name ?? '' },
  { key: 'sub', label: 'Sub-Category', render: r => (r.product_subcategories as { name: string } | null)?.name ?? '' },
  { key: 'price', label: 'Price', render: r => `₹${Number(r.price).toFixed(2)}` },
  { key: 'sku', label: 'SKU', render: r => String(r.sku ?? '—') },
]

type Cat = { id: string; name: string }
type Sub = { id: string; name: string; category_id: string }

export default function ProductsPage() {
  const crud = useCrud('/api/masters/products')
  const me = useMe()
  const { toast } = useToast()
  const isAdmin = me?.role === 'Administrator'
  const canEdit = isAdmin || (me?.permissions?.products?.edit ?? false)
  const canDelete = isAdmin || (me?.permissions?.products?.delete ?? false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState({ name: '', category_id: '', subcategory_id: '', price: '', sku: '' })
  const [cats, setCats] = useState<Cat[]>([])
  const [allSubs, setAllSubs] = useState<Sub[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/masters/product-categories').then(r => r.json()).then(setCats).catch(() => toast('Failed to load product categories. Please refresh.', 'error'))
    fetch('/api/masters/product-subcategories').then(r => r.json()).then(setAllSubs).catch(() => toast('Failed to load product subcategories. Please refresh.', 'error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredSubs = allSubs.filter(s => !form.category_id || s.category_id === form.category_id)

  function openAdd() { setEditing(null); setForm({ name: '', category_id: '', subcategory_id: '', price: '', sku: '' }); setOpen(true) }
  function openEdit(row: Record<string, unknown>) {
    setEditing(row)
    setForm({ name: String(row.name), category_id: String(row.category_id), subcategory_id: String(row.subcategory_id), price: String(row.price), sku: String(row.sku ?? '') })
    setOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim() || !form.category_id || !form.subcategory_id || !form.price) return
    setSaving(true)
    const body = { name: form.name.trim(), category_id: form.category_id, subcategory_id: form.subcategory_id, price: Number(form.price), sku: form.sku || null }
    const ok = editing ? await crud.update(editing.id as string, body) : await crud.create(body)
    setSaving(false)
    if (ok !== false && ok !== null) setOpen(false)
  }

  const catOpts = cats.map(c => ({ value: c.id, label: c.name }))
  const subOpts = filteredSubs.map(s => ({ value: s.id, label: s.name }))

  return (
    <>
      <CrudPage title="Products" backHref="/masters" columns={COLS} rows={crud.rows} allRowsCount={crud.allRows.length}
        isLoading={crud.isLoading} search={crud.search} onSearchChange={crud.setSearch}
        page={crud.page} totalPages={crud.totalPages} onPage={crud.setPage}
        onAdd={canEdit ? openAdd : undefined}
        onEdit={canEdit ? openEdit : undefined}
        onDelete={canDelete ? r => crud.remove(r.id as string) : undefined} />
      <Modal title={editing ? 'Edit Product' : 'Add Product'} isOpen={open} onClose={() => setOpen(false)} onSave={handleSave} isSaving={saving}>
        <div>
          <label htmlFor="product-name" className="block text-sm font-medium text-text-secondary mb-1">Product Name <span className="text-danger">*</span></label>
          <input id="product-name" name="name" type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Enter product name"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
        </div>
        <div>
          <p className="block text-sm font-medium text-text-secondary mb-1">Category <span className="text-danger">*</span></p>
          <SearchableSelect value={form.category_id} onChange={v => setForm(f => ({ ...f, category_id: v, subcategory_id: '' }))} options={catOpts} placeholder="Select category…" />
        </div>
        <div>
          <p className="block text-sm font-medium text-text-secondary mb-1">Sub-Category <span className="text-danger">*</span></p>
          <SearchableSelect value={form.subcategory_id} onChange={v => setForm(f => ({ ...f, subcategory_id: v }))} options={subOpts} placeholder="Select sub-category…" disabled={!form.category_id} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="product-price" className="block text-sm font-medium text-text-secondary mb-1">Price (₹) <span className="text-danger">*</span></label>
            <input id="product-price" name="price" type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
          </div>
          <div>
            <label htmlFor="product-sku" className="block text-sm font-medium text-text-secondary mb-1">SKU</label>
            <input id="product-sku" name="sku" type="text" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="Optional"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring" />
          </div>
        </div>
      </Modal>
    </>
  )
}
