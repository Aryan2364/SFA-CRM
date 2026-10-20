'use client'

import { MasterNamePage } from '@/components/masters/master-name-page'

export default function ProductCategoriesPage() {
  return (
    <MasterNamePage
      title="Product Categories"
      noun={{ one: 'category', many: 'categories' }}
      apiPath="/api/masters/product-categories"
      section="product_categories"
      nameLabel="Category Name"
      namePlaceholder="Enter category name"
      deleteMode="hard"
      emptyBody="Product categories group sub-categories and products."
    />
  )
}
