'use client'

import { useState, useEffect, useCallback } from 'react'
import { PencilIcon, PlusIcon } from 'lucide-react'

import { masterLocks } from '@/lib/master-locks'
import { useMe } from '@/hooks/useMe'
import { useToast } from '@/contexts/ToastContext'
import { loadList } from '@/lib/load-list'
import {
  ListPage,
  type ListColumn,
  type ListPageProps,
} from '@/components/templates/list-page'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type Cat = { id: string; name: string }
type Sub = { id: string; name: string; category_id: string }

type ProductRow = {
  id: string
  name: string
  category_id: string
  subcategory_id: string
  price: number | string
  sku: string | null
  product_categories: { name: string } | null
  product_subcategories: { name: string } | null
}

export default function ProductsPage() {
  const me = useMe()
  const { toast } = useToast()
  // The real permission map, never a role name — Administrators get every
  // section from /api/auth/me. Denied actions show disabled with a reason.
  const locks = masterLocks(me, 'products', 'products')

  const [refreshKey, setRefreshKey] = useState(0)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ProductRow | null>(null)
  const [form, setForm] = useState({ name: '', category_id: '', subcategory_id: '', price: '', sku: '' })
  const [cats, setCats] = useState<Cat[]>([])
  const [allSubs, setAllSubs] = useState<Sub[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ProductRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // The pickers below are only as good as these two lists. Without the
  // guard a 403 lands an { error } body in state typed as an array and
  // the next render throws on .map; with no guard at all the pickers sit
  // empty for ever and say nothing.
  const [refError, setRefError] = useState<{ forbidden: boolean } | null>(null)
  const [refLoading, setRefLoading] = useState(true)

  const loadRefs = useCallback(async () => {
    setRefLoading(true)
    setRefError(null)
    const [catRes, subRes] = await Promise.all([
      loadList<Cat>('/api/masters/product-categories'),
      loadList<Sub>('/api/masters/product-subcategories'),
    ])
    if (catRes.ok) setCats(catRes.data)
    if (subRes.ok) setAllSubs(subRes.data)
    const failed = [catRes, subRes].filter(r => !r.ok) as { ok: false; forbidden: boolean }[]
    setRefError(failed.length === 0 ? null : { forbidden: failed.every(f => f.forbidden) })
    setRefLoading(false)
  }, [])

  useEffect(() => { loadRefs() }, [loadRefs])

  const filteredSubs = allSubs.filter(s => !form.category_id || s.category_id === form.category_id)

  function openAdd() { setEditing(null); setForm({ name: '', category_id: '', subcategory_id: '', price: '', sku: '' }); setFormError(''); setOpen(true) }
  function openEdit(row: ProductRow) {
    setEditing(row)
    setForm({ name: row.name, category_id: row.category_id, subcategory_id: row.subcategory_id, price: String(row.price), sku: row.sku ?? '' })
    setFormError('')
    setOpen(true)
  }

  async function handleSave() {
    setFormError('')
    if (!form.name.trim()) { setFormError('Product Name is required.'); return }
    if (!form.category_id) { setFormError('Category is required.'); return }
    if (!form.subcategory_id) { setFormError('Sub-Category is required.'); return }
    if (!form.price) { setFormError('Price is required.'); return }
    setSaving(true)
    const body = { name: form.name.trim(), category_id: form.category_id, subcategory_id: form.subcategory_id, price: Number(form.price), sku: form.sku || null }
    try {
      const res = await fetch(editing ? `/api/masters/products/${editing.id}` : '/api/masters/products', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      setSaving(false)
      if (!res.ok) { setFormError(data?.error ?? 'Save failed. Please try again.'); return }
      toast(editing ? 'Updated successfully' : 'Created successfully')
      setOpen(false)
      setRefreshKey(k => k + 1)
    } catch {
      setSaving(false)
      setFormError('Something went wrong. Please try again.')
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/masters/products/${pendingDelete.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data?.error ?? 'Could not delete. Please try again.', 'error')
        return
      }
      toast('Deleted successfully')
      setPendingDelete(null)
      setRefreshKey(k => k + 1)
    } finally {
      setIsDeleting(false)
    }
  }

  const load: ListPageProps<ProductRow>['load'] = async ({ search, signal }) => {
    const r = await fetch('/api/masters/products', { signal })
    if (!r.ok) throw new Error(String(r.status))
    const body = await r.json()
    const rows: ProductRow[] = Array.isArray(body) ? body : []
    const q = search.trim().toLowerCase()
    return q ? rows.filter(row => row.name.toLowerCase().includes(q)) : rows
  }

  const columns: ListColumn<ProductRow>[] = [
    {
      id: 'name',
      header: 'Product Name',
      grow: true,
      truncate: true,
      cellClassName: 'font-medium text-text-primary',
      skeletonWidth: 'w-40',
      cell: row => row.name,
    },
    {
      id: 'category',
      header: 'Category',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-28',
      cell: row => row.product_categories?.name ?? '',
    },
    {
      id: 'subcategory',
      header: 'Sub-Category',
      tier: 'hide-below-1024',
      truncate: true,
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-28',
      cell: row => row.product_subcategories?.name ?? '',
    },
    {
      id: 'price',
      header: 'Price',
      numeric: true,
      skeletonWidth: 'w-16',
      cell: row => `₹${Number(row.price).toFixed(2)}`,
    },
    {
      id: 'sku',
      header: 'SKU',
      className: 'whitespace-nowrap',
      cellClassName: 'text-text-secondary',
      skeletonWidth: 'w-20',
      cell: row => row.sku ?? '—',
    },
    {
      id: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      skeletonWidth: 'h-control w-20',
      cell: row => (
        <div className="flex items-center justify-end gap-2">
          {locks.edit === undefined ? (
            <Tooltip>
              <TooltipTrigger render={<Button variant="secondary" size="icon" onClick={() => openEdit(row)} />}>
                <PencilIcon />
                <span className="sr-only">Edit {row.name}</span>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
          ) : (
            <PermissionTooltip allowed={typeof locks.edit !== 'string'} reason={locks.edit ?? ''}>
              <Button variant="secondary" size="icon" disabled>
                <PencilIcon />
                <span className="sr-only">Edit {row.name}</span>
              </Button>
            </PermissionTooltip>
          )}
          <PermissionTooltip allowed={typeof locks.delete !== 'string'} reason={locks.delete ?? ''}>
            <Button variant="secondary" disabled={locks.delete !== undefined} onClick={() => setPendingDelete(row)}>
              Delete
            </Button>
          </PermissionTooltip>
        </div>
      ),
    },
  ]

  const action = (
    <PermissionTooltip allowed={typeof locks.add !== 'string'} reason={locks.add ?? ''}>
      <Button onClick={openAdd} disabled={locks.add !== undefined}>
        <PlusIcon />
        Add Product
      </Button>
    </PermissionTooltip>
  )

  const catOpts = Object.fromEntries(cats.map(c => [c.id, c.name]))
  const subOpts = Object.fromEntries(filteredSubs.map(s => [s.id, s.name]))

  return (
    <div className="flex min-h-0 flex-col md:h-full">
      <Breadcrumb className="mb-4 shrink-0">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/masters">Masters</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Products</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <ListPage<ProductRow>
        className="md:h-auto md:min-h-0 md:flex-1"
        title="Products"
        noun={{ one: 'product', many: 'products' }}
        action={action}
        columns={columns}
        rowKey={row => row.id}
        load={load}
        refreshKey={refreshKey}
        emptyYet={{
          heading: 'No products yet',
          body: 'Products are what an order or opportunity line is for, each priced and filed under a category and sub-category.',
          actionLabel: locks.add === undefined ? 'Add product' : undefined,
          onAction: locks.add === undefined ? openAdd : undefined,
        }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Product' : 'Add Product'}</DialogTitle>
          </DialogHeader>
          {formError && (
            <div className="bg-danger-bg border border-danger-border text-danger text-sm rounded-lg px-4 py-3">{formError}</div>
          )}
          <div>
            <Label htmlFor="product-name">Product Name <span className="text-danger">*</span></Label>
            <div className="mt-1">
              <Input
                id="product-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Enter product name"
              />
            </div>
          </div>
          {refError ? (
            <LoadError
              forbidden={refError.forbidden}
              what="product categories"
              onRetry={refLoading ? undefined : loadRefs}
            />
          ) : (
            <>
              <div>
                <Label htmlFor="product-category">Category <span className="text-danger">*</span></Label>
                <div className="mt-1">
                  <SearchableSelect
                    id="product-category"
                    value={form.category_id}
                    onValueChange={v => setForm(f => ({ ...f, category_id: v, subcategory_id: '' }))}
                    options={catOpts}
                    placeholder="Select category…"
                    disabled={refLoading}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="product-subcategory">Sub-Category <span className="text-danger">*</span></Label>
                <div className="mt-1">
                  <SearchableSelect
                    id="product-subcategory"
                    value={form.subcategory_id}
                    onValueChange={v => setForm(f => ({ ...f, subcategory_id: v }))}
                    options={subOpts}
                    placeholder="Select sub-category…"
                    disabled={refLoading || !form.category_id}
                  />
                </div>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="product-price">Price (₹) <span className="text-danger">*</span></Label>
              <div className="mt-1">
                <Input
                  id="product-price"
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="product-sku">SKU</Label>
              <div className="mt-1">
                <Input
                  id="product-sku"
                  value={form.sku}
                  onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={o => { if (!o && !isDeleting) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDelete ? `Delete ${pendingDelete.name}?` : 'Delete this product?'}</AlertDialogTitle>
            <AlertDialogDescription>This removes it permanently and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
