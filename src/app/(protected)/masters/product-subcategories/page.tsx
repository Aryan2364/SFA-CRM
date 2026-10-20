'use client'

import { MasterNamePage, type MasterRow } from '@/components/masters/master-name-page'
import type { ListColumn } from '@/components/templates/list-page'

const categoryColumn: ListColumn<MasterRow> = {
  id: 'category',
  header: 'Category',
  tier: 'hide-below-1024',
  truncate: true,
  cellClassName: 'text-text-secondary',
  cell: row => (row.product_categories as { name: string } | null)?.name ?? '—',
}

export default function ProductSubcategoriesPage() {
  return (
    <MasterNamePage
      title="Product Sub-Categories"
      noun={{ one: 'sub-category', many: 'sub-categories' }}
      apiPath="/api/masters/product-subcategories"
      section="product_subcategories"
      nameLabel="Sub-Category Name"
      namePlaceholder="Enter sub-category name"
      parentField={{ key: 'category_id', label: 'Category', fetchUrl: '/api/masters/product-categories' }}
      extraColumns={[categoryColumn]}
      deleteMode="hard"
      emptyBody="Sub-categories sit under a product category."
    />
  )
}
