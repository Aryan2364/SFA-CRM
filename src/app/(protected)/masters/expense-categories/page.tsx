'use client'

import { MasterNamePage } from '@/components/masters/master-name-page'

export default function ExpenseCategoriesPage() {
  return (
    <MasterNamePage
      title="Expense Categories"
      noun={{ one: 'category', many: 'categories' }}
      apiPath="/api/masters/expense-categories"
      section="expense_categories"
      addAction="create"
      nameLabel="Category Name"
      namePlaceholder="e.g. Travel, Food…"
      deleteMode="soft"
      reorder
      includeInactive
      emptyBody="Expense categories classify the expenses users submit."
    />
  )
}
