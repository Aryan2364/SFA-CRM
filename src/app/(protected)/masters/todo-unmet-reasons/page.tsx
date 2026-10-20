'use client'

import { MasterNamePage } from '@/components/masters/master-name-page'

/**
 * "Couldn't-meet reasons" — the reason list shown in the Couldn't meet
 * dialog on a Daily Activity to-do. Backed by `todo_unmet_reasons`, a table
 * not yet pushed (see src/lib/todo-outcomes.ts); every route 503s with a
 * clear message until a human pushes it, which this screen's `ListPage`
 * already handles as an ordinary load error.
 */
export default function TodoUnmetReasonsPage() {
  return (
    <MasterNamePage
      title="Couldn't-meet Reasons"
      noun={{ one: 'reason', many: 'reasons' }}
      apiPath="/api/masters/todo-unmet-reasons"
      section="todo_unmet_reasons"
      addAction="create"
      nameLabel="Reason"
      namePlaceholder="e.g. Customer not available"
      deleteMode="soft"
      reorder
      includeInactive
      emptyBody="These reasons are offered when a to-do couldn't be met."
    />
  )
}
